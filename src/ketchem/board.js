// Ketch'em board: a full world built headless, frozen, seeded with life, then laid with stores, roads, spurs,
// signposts and landmarks. Spec: docs/01 Design/Ketch'em Mechanics.md sections 14 and 15. Like visit.js this
// module works on the sim's own module state (grid, road, flora, ...); the Worker in board.worker.js wraps
// buildBoard() and ships the finished world to the page as a snapshot. Every board decision draws on its own seeded
// stream (bRng), so the sim's four streams see exactly the ticks they see in any other run of the same seed.
import {
  CFG, DEFAULT_CFG, T, TNAME, W, H, WORLD, grid, elev, road, flora, fauna, riverData, volcActive, volcAge, volcLife,
  idx, inb, clamp, mulberry32, initWorld, step, setWorldSize, landCoverage, applyElevationIntensity, generateRivers,
  addSpring, seedFloraCluster, seedFaunaGroup, computeAridity, applyClimate, reclassTerrain,
} from '../sim.js';
import { newFog, revealSquare, SIGHT_HALF } from './fog.js';

// Section 15.1. target(r) maps one uniform draw to the land target; cfg layers on DEFAULT_CFG for genesis;
// origins = how many volcanic origins are planted before the first tick (one at the centre, or several spread out).
export const SETTINGS = {
  continent: {
    label: 'Continent', blurb: 'one clumped landmass; boats matter little',
    target: r => 0.60 + 0.35 * Math.sqrt(r),                       // median ~85%
    cfg: { coastalSpreadBase: 0.010, volcanoChancePerTile: 0.00002 },
    origins: [1, 1], springs: [0, 0],
  },
  archipelago: {
    label: 'Archipelago', blurb: 'islands, bridges and boats',
    // 45-60%, not the 60-75% first written: measured 2026-10-24, the sim's coastal spread has merged every island of
    // store size into one landmass by 60-65% land, whatever the origin or spread knobs (mechanics 15.1 note).
    target: r => 0.45 + 0.15 * r,
    cfg: { coastalSpreadBase: 0.002, volcanoChancePerTile: 0.00012, erosionChanceBase: 0.0005, elevationIntensity: 0.8, riverAccumThreshold: 10 },
    origins: [4, 7], springs: [0, 0],
  },
  highlands: {
    label: 'Highlands', blurb: 'many peaks and springs; Climber matters',
    target: r => 0.70 + 0.25 * r,
    cfg: { elevationIntensity: 1.4, volcanoChancePerTile: 0.0002, maxVolcanoCenters: 6, volcanoBirthRate: 0.05, minVolcanoSpacing: 8 },
    origins: [1, 1], springs: [2, 6],
  },
};
export const SETTING_IDS = Object.keys(SETTINGS);

export const POSTS = ['Post', 'Depot', 'Trading', 'Outfitters'];
export const BRIDGE_MAX = 12;          // water tiles in one straight bridge run (14.3)
export const SPUR_MAX_LEN = 25;        // tiles a spur may add (14.4)
export const STORE_MARGIN = 6;         // tiles from the quadrant's edges (14.1)
export const SPUR_STORE_GAP = 6;       // a spur starts at least this far from any store (14.4)
const DIRS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];   // N NE E SE S SW W NW
const DIR_NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const STEEP = { [T.MOUNTAIN]: 1, [T.GLACIER]: 1, [T.VOLCANIC]: 1 };
const SKIRT = { [T.FOREST]: 1, [T.JUNGLE]: 1, [T.WETLAND]: 1, [T.MESA]: 1 };

// ---------- ground classes ----------
export function isWater(i) { const t = grid[i]; if (t === T.OCEAN || t === T.COAST) return true; const rd = riverData && riverData[i]; return !!(rd && rd.lake); }
export function isSteep(i) { return !!STEEP[grid[i]]; }
export function isRiver(i) { const rd = riverData && riverData[i]; return !!(rd && !rd.lake); }
export function isWalkable(i) { return !isWater(i) && !isSteep(i); }

// Cost of entering a land tile (14.3). Infinity = never; water is routed as a bridge run, not per tile.
export function terrainCost(i) {
  if (isSteep(i)) return Infinity;
  if (road[i]) return 0.3;
  if (isRiver(i)) return 4.0;
  const t = grid[i];
  if (SKIRT[t]) return 1.6;
  if (t === T.HILLS) return 1.8;
  return 1.0;
}
const BRIDGE_COST = 6.0;

// Value noise, period 8 tiles, range 0..1: the meander field one board shares across its links (14.3).
export function makeNoise(rng, period = 8) {
  const gw = Math.ceil(W / period) + 2, gh = Math.ceil(H / period) + 2;
  const lat = new Float32Array(gw * gh);
  for (let k = 0; k < lat.length; k++) lat[k] = rng();
  const sm = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / period, fy = y / period, x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = sm(fx - x0), ty = sm(fy - y0);
    const a = lat[y0 * gw + x0], b = lat[y0 * gw + x0 + 1], c = lat[(y0 + 1) * gw + x0], d = lat[(y0 + 1) * gw + x0 + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

// ---------- A* for one link (14.3) ----------
class Heap {
  constructor() { this.k = []; this.v = []; }
  push(key, val) { const k = this.k, v = this.v; k.push(key); v.push(val); let i = k.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; } }
  pop() { const k = this.k, v = this.v, top = v[0]; const lk = k.pop(), lv = v.pop(); if (k.length) { k[0] = lk; v[0] = lv; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < k.length && k[l] < k[m]) m = l; if (r < k.length && k[r] < k[m]) m = r; if (m === i) break; [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m; } } return top; }
  get size() { return this.k.length; }
}

function hasOtherRoadBeside(i, from) {
  const x = i % W, y = (i / W) | 0;
  for (let d = 0; d < 8; d++) { const nx = x + DIRS[d][0], ny = y + DIRS[d][1]; if (!inb(nx, ny)) continue; const j = idx(nx, ny); if (j !== from && road[j]) return true; }
  return false;
}

// Route from tile a to tile b over land, hills and bridges. m = meander strength for this link (0..3), noise = the
// board's noise field. Returns the path as tile indices (a..b inclusive, bridge tiles included) or null.
// Bridge rule: from a land tile, a straight run of at most BRIDGE_MAX water tiles in one of the 8 directions that
// lands on walkable ground is one edge (cost 6 per water tile, 0.3 where a bridge already stands); it cannot turn.
// Doubling penalty (+2) applies to a land tile that is not itself road but has a road tile beside it other than the
// one being extended, so a new road does not run parallel to an old one; an existing road is shared at 0.3.
export function routeLink(a, b, m, noise) {
  const N = W * H;
  const g = new Float64Array(N).fill(Infinity), parent = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const via = new Map();   // node -> the water tiles crossed to reach it (bridge edges only)
  const bx = b % W, by = (b / W) | 0;
  const H_PER_TILE = 0.3 * 1.41 / Math.SQRT2;   // a diagonal road step costs 0.3 x 1.41 over sqrt(2) of distance: keep the heuristic under it
  const h = i => { const dx = (i % W) - bx, dy = ((i / W) | 0) - by; return H_PER_TILE * Math.sqrt(dx * dx + dy * dy); };
  const open = new Heap();
  g[a] = 0; open.push(h(a), a);
  while (open.size) {
    const c = open.pop();
    if (done[c]) continue; done[c] = 1;
    if (c === b) break;
    const cx = c % W, cy = (c / W) | 0;
    for (let d = 0; d < 8; d++) {
      const dx = DIRS[d][0], dy = DIRS[d][1], diag = (dx && dy) ? 1.41 : 1;
      let nx = cx + dx, ny = cy + dy;
      if (!inb(nx, ny)) continue;
      let n = idx(nx, ny), cost = 0, crossed = null;
      if (isWater(n)) {
        // a bridge run: straight on until land, at most BRIDGE_MAX water tiles
        crossed = [];
        let ok = false;
        for (let k = 0; k < BRIDGE_MAX; k++) {
          cost += (road[n] ? 0.3 : BRIDGE_COST) * diag + m * noise(nx, ny);
          crossed.push(n);
          nx += dx; ny += dy;
          if (!inb(nx, ny)) break;
          n = idx(nx, ny);
          if (!isWater(n)) { ok = isWalkable(n); break; }
        }
        if (!ok) continue;
      }
      const tc = terrainCost(n);
      if (tc === Infinity) continue;
      cost += tc * diag + m * noise(nx, ny) + (!road[n] && hasOtherRoadBeside(n, c) ? 2 : 0);
      const ng = g[c] + cost;
      if (ng < g[n]) { g[n] = ng; parent[n] = c; if (crossed) via.set(n, crossed); else via.delete(n); open.push(ng + h(n), n); }
    }
  }
  if (!done[b]) return null;
  const path = [];
  for (let n = b; n !== -1; n = parent[n]) { path.push(n); const cr = via.get(n); if (cr) for (let k = cr.length - 1; k >= 0; k--) path.push(cr[k]); }
  return path.reverse();
}

export function layRoad(path) { for (const i of path) road[i] = 1; }

// ---------- stores (14.1) ----------
function biomeWord(i) { const n = TNAME[grid[i]] || 'Wild'; return n.charAt(0) + n.slice(1).toLowerCase(); }

export function storeCandidate(i) {
  if (!isWalkable(i) || isRiver(i) || road[i]) return false;
  const x = i % W, y = (i / W) | 0;
  let ok = 0;
  for (let d = 0; d < 8; d++) { const nx = x + DIRS[d][0], ny = y + DIRS[d][1]; if (inb(nx, ny) && isWalkable(idx(nx, ny))) ok++; }
  return ok >= 6;
}

// One store in quadrant q (0 NW, 1 NE, 2 SW, 3 SE): 200 random tiles inside the quadrant's margin, the first that
// qualifies (a uniform pick among qualifying tiles). null when the quadrant offers none.
export function placeStoreIn(q, rng, taken) {
  const qx = q & 1, qy = q >> 1, hw = W >> 1, hh = H >> 1;
  const x0 = qx * hw + STORE_MARGIN, x1 = (qx + 1) * hw - STORE_MARGIN, y0 = qy * hh + STORE_MARGIN, y1 = (qy + 1) * hh - STORE_MARGIN;
  if (x1 <= x0 || y1 <= y0) return null;
  for (let t = 0; t < 200; t++) {
    const x = x0 + Math.floor(rng() * (x1 - x0)), y = y0 + Math.floor(rng() * (y1 - y0)), i = idx(x, y);
    if (taken && taken.has(i)) continue;
    if (storeCandidate(i)) return { x, y, i, q };
  }
  return null;
}

function nameStores(stores) {
  stores.forEach((s, k) => { s.name = biomeWord(s.i) + ' ' + POSTS[k % POSTS.length]; });
}

// ---------- the spine (14.2) ----------
function kruskal(stores, order) {
  const parent = stores.map((_, k) => k);
  const find = k => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
  const tree = [];
  for (const [a, b] of order) { const ra = find(a), rb = find(b); if (ra !== rb) { parent[ra] = rb; tree.push([a, b]); } }
  return tree;
}
export function planSpine(stores, rng) {
  const pairs = [];
  for (let a = 0; a < stores.length; a++) for (let b = a + 1; b < stores.length; b++) pairs.push([a, b]);
  const dist = ([a, b]) => Math.hypot(stores[a].x - stores[b].x, stores[a].y - stores[b].y);
  let order;
  if (rng() < 0.20) { order = pairs.slice(); for (let k = order.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [order[k], order[j]] = [order[j], order[k]]; } }
  else { order = pairs.map(p => [p, dist(p) * (0.75 + 0.5 * rng())]).sort((u, v) => u[1] - v[1]).map(u => u[0]); }
  const links = kruskal(stores, order);
  const r = rng(), extra = r < 0.35 ? 1 : (r < 0.50 ? 2 : 0);
  const unused = pairs.filter(p => !links.some(l => l[0] === p[0] && l[1] === p[1]));
  for (let k = 0; k < extra && unused.length; k++) links.push(unused.splice(Math.floor(rng() * unused.length), 1)[0]);
  return links;
}

// ---------- spurs (14.4) ----------
function nearestWhere(fromI, pred) {
  const fx = fromI % W, fy = (fromI / W) | 0;
  let best = -1, bd = Infinity;
  for (let i = 0; i < W * H; i++) { if (!pred(i)) continue; const dx = (i % W) - fx, dy = ((i / W) | 0) - fy, d = dx * dx + dy * dy; if (d > 0 && d < bd) { bd = d; best = i; } }
  return best;
}
function besideAny(i, pred) { const x = i % W, y = (i / W) | 0; for (let d = 0; d < 8; d++) { const nx = x + DIRS[d][0], ny = y + DIRS[d][1]; if (inb(nx, ny) && pred(idx(nx, ny))) return true; } return false; }
const isLakeTile = i => { const rd = riverData && riverData[i]; return !!(rd && rd.lake); };
const isSeaTile = i => grid[i] === T.OCEAN || grid[i] === T.COAST;
const isPeakTile = i => grid[i] === T.MOUNTAIN;

export function spurTarget(startI, rng) {
  const r = rng() * 10;   // weights 3 / 2 / 2 / 3
  if (r < 3) return nearestWhere(startI, i => isWalkable(i) && !road[i] && besideAny(i, isLakeTile));
  if (r < 5) return nearestWhere(startI, i => isWalkable(i) && !road[i] && besideAny(i, isPeakTile));
  if (r < 7) return nearestWhere(startI, i => isWalkable(i) && !road[i] && besideAny(i, isSeaTile));
  const sx = startI % W, sy = (startI / W) | 0;
  for (let t = 0; t < 50; t++) {
    const d = 10 + Math.floor(rng() * 16), ang = rng() * Math.PI * 2;
    const x = Math.round(sx + Math.cos(ang) * d), y = Math.round(sy + Math.sin(ang) * d);
    if (inb(x, y) && isWalkable(idx(x, y)) && !road[idx(x, y)]) return idx(x, y);
  }
  return -1;
}

function landmarkAt(i) {
  const kind = besideAny(i, j => isLakeTile(j) || isSeaTile(j) || isRiver(j)) ? 'pool' : (SKIRT[grid[i]] ? 'dead tree' : 'cairn');
  return { x: i % W, y: (i / W) | 0, kind, name: biomeWord(i) + ' ' + kind };
}

// ---------- signposts (14.5) ----------
function roadNeighbours(i) { const x = i % W, y = (i / W) | 0, out = []; for (let d = 0; d < 8; d++) { const nx = x + DIRS[d][0], ny = y + DIRS[d][1]; if (inb(nx, ny) && road[idx(nx, ny)]) out.push([d, idx(nx, ny)]); } return out; }

// The nearest store down each branch out of tile i, by road distance, as "N: Tundra Depot 41 - E: Savanna Post 17".
// A branch whose first tile is a store is the store you stand beside, not a destination. A store is named once, by
// the branch that reaches it soonest (a diagonal or doubled road touches several neighbours of one tile).
export function signpostText(i, stores) {
  const storeAt = new Map(stores.map((s, k) => [s.i, k]));
  const best = new Map();   // store name -> [dir, dist]
  const around = roadNeighbours(i);
  for (const [d, n] of around) {
    if (storeAt.has(n)) continue;
    // Roads are 8-connected, so a branch's first tile touches its neighbours diagonally; each branch is searched with
    // the signpost and the other branches' first tiles walled off, or every branch would report the same store.
    const dist = new Int32Array(W * H).fill(-1); dist[i] = 0;
    for (const [, m] of around) dist[m] = 0;
    dist[n] = 1;
    const q = [n];
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      if (storeAt.has(c)) { const name = stores[storeAt.get(c)].name; if (!best.has(name) || dist[c] < best.get(name)[1]) best.set(name, [d, dist[c]]); break; }
      for (const [, j] of roadNeighbours(c)) if (dist[j] < 0) { dist[j] = dist[c] + 1; q.push(j); }
    }
  }
  return [...best.entries()].sort((u, v) => u[1][0] - v[1][0]).map(([name, [d, dist]]) => DIR_NAMES[d] + ': ' + name + ' ' + dist).join(' - ');
}

export function placeSignposts(stores) {
  const tiles = new Set();
  for (let i = 0; i < W * H; i++) if (road[i] && roadNeighbours(i).length >= 3) tiles.add(i);
  for (const s of stores) {
    const rn = roadNeighbours(s.i).map(p => p[1]).filter(j => !stores.some(o => o.i === j));
    if (rn.length) { s.door = { x: rn[0] % W, y: (rn[0] / W) | 0 }; tiles.add(rn[0]); }
    else s.door = { x: s.x, y: s.y };
  }
  for (const s of stores) tiles.delete(s.i);
  return [...tiles].sort((u, v) => u - v).map(i => ({ x: i % W, y: (i / W) | 0, text: signpostText(i, stores) }));
}

// ---------- landmasses: which stores stand on an island (the test for a bridge that mattered) ----------
// Only the sea divides landmasses here: mountains and lakes split walkable ground too, but a store behind a ridge
// is not on an island. Returns the component id per tile (-1 at sea) and the size of each component.
const isSea = i => grid[i] === T.OCEAN || grid[i] === T.COAST;
export function landmassMap() {
  const id = new Int32Array(W * H).fill(-1), sizes = []; let next = 0;
  for (let s = 0; s < W * H; s++) {
    if (id[s] >= 0 || isSea(s)) continue;
    const q = [s]; id[s] = next;
    for (let h = 0; h < q.length; h++) { const c = q[h], x = c % W, y = (c / W) | 0; for (let d = 0; d < 8; d++) { const nx = x + DIRS[d][0], ny = y + DIRS[d][1]; if (!inb(nx, ny)) continue; const j = idx(nx, ny); if (id[j] < 0 && !isSea(j)) { id[j] = next; q.push(j); } } }
    sizes.push(q.length); next++;
  }
  id.sizes = sizes;
  return id;
}

// ---------- flora off the roads (critic note, step 1) ----------
// Plants standing where a road or a store now lies are removed, and the eight tiles around a store are cleared once.
export function clearRoadFlora(stores) {
  const clear = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (road[i]) clear[i] = 1;
  for (const s of stores) { clear[s.i] = 1; for (let d = 0; d < 8; d++) { const nx = s.x + DIRS[d][0], ny = s.y + DIRS[d][1]; if (inb(nx, ny)) clear[idx(nx, ny)] = 1; } }
  let w = 0, removed = 0;
  for (let k = 0; k < flora.length; k++) { const f = flora[k]; if (!f) continue; if (clear[idx(f.x, f.y)]) { removed++; continue; } flora[w++] = f; }
  flora.length = w;
  return removed;
}

// ---------- layout: stores, spine, spurs, signposts, landmarks (14) ----------
class Reroll extends Error {}

export function layoutBoard(rng, opts = {}) {
  const noise = makeNoise(rng);
  let stores = null, links = null, repicks = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!stores) {
      stores = [];
      for (let q = 0; q < 4; q++) { const s = placeStoreIn(q, rng); if (!s) throw new Reroll('quadrant ' + q + ' has no room for a store'); stores.push(s); }
    }
    road.fill(0);
    for (const s of stores) road[s.i] = 1;
    const plan = planSpine(stores, rng);
    links = [];
    let failed = -1;
    for (const [a, b] of plan) {
      const m = rng() * 3;
      const path = routeLink(stores[a].i, stores[b].i, m, noise);
      if (!path) {   // re-pick the store on the smaller landmass: that is the one the sea cut off
        const lm = landmassMap();
        failed = lm.sizes[lm[stores[a].i]] < lm.sizes[lm[stores[b].i]] ? a : b;
        break;
      }
      layRoad(path);
      links.push({ a, b, m: +m.toFixed(2), tiles: path.length, bridge: path.filter(isWater).length });
    }
    if (failed < 0) break;
    if (++repicks > 3) throw new Reroll('a store could not be joined to the road after 3 re-picks');
    const again = placeStoreIn(stores[failed].q, rng, new Set(stores.map(s => s.i)));
    if (!again) throw new Reroll('no second site in quadrant ' + stores[failed].q);
    stores[failed] = again; links = null;
  }
  if (!links) throw new Reroll('no road layout');
  nameStores(stores);
  // spurs
  const spurs = [], landmarks = [];
  const nSpurs = opts.spurs === undefined ? Math.floor(rng() * 11) : opts.spurs;
  for (let k = 0; k < nSpurs; k++) {
    const starts = [];
    for (let i = 0; i < W * H; i++) if (road[i] && !isWater(i) && stores.every(s => Math.max(Math.abs(s.x - i % W), Math.abs(s.y - ((i / W) | 0))) >= SPUR_STORE_GAP)) starts.push(i);
    if (!starts.length) break;
    const start = starts[Math.floor(rng() * starts.length)];
    const target = spurTarget(start, rng);
    if (target < 0) continue;
    const path = routeLink(start, target, 1 + rng() * 2, noise);
    if (!path || path.length < 2) continue;
    let laid = path.slice(1, 1 + SPUR_MAX_LEN);
    while (laid.length && isWater(laid[laid.length - 1])) laid.pop();   // the cap must not leave a road ending in the sea
    if (!laid.length) continue;
    layRoad(laid);
    const end = laid[laid.length - 1];
    const spur = { tiles: laid.length, landmark: null };
    if (rng() < 0.30 && isWalkable(end) && !stores.some(s => s.i === end)) { const lm = landmarkAt(end); landmarks.push(lm); spur.landmark = lm.name; }
    spurs.push(spur);
  }
  const signposts = placeSignposts(stores);
  return { stores, links, spurs, signposts, landmarks, repicks };
}

// ---------- genesis and life (15.2) ----------
function plantOrigin(x, y) {
  const i = idx(x, y);
  grid[i] = T.VOLCANIC; volcActive[i] = 1; volcAge[i] = 0;
  volcLife[i] = Math.max(20, Math.round(WORLD.gammaA * WORLD.gammaTheta));
  elev[i] = WORLD.H0;
}
function plantOrigins(S, rng) {
  const n = S.origins[0] + Math.floor(rng() * (S.origins[1] - S.origins[0] + 1));
  if (n === 1) { plantOrigin(W >> 1, H >> 1); return 1; }
  const placed = [], margin = W >> 3, gap = W >> 2;
  for (let k = 0; k < n; k++) {
    for (let t = 0; t < 60; t++) {
      const x = margin + Math.floor(rng() * (W - 2 * margin)), y = margin + Math.floor(rng() * (H - 2 * margin));
      if (placed.every(p => Math.hypot(p[0] - x, p[1] - y) >= gap)) { placed.push([x, y]); plantOrigin(x, y); break; }
    }
  }
  return placed.length;
}

function seedLife() {
  const land = Math.round(landCoverage() * W * H);
  seedFloraCluster(Math.round(land / 40));
  seedFaunaGroup('herbivore', Math.round(land / 100));
  seedFaunaGroup('carnivore', Math.max(2, Math.round(land / 300)));
  if (CFG.scavengersEnabled) seedFaunaGroup('scavenger', Math.max(1, Math.round(land / 600)));
  if (CFG.omnivoreEnabled) seedFaunaGroup('omnivore', Math.max(1, Math.round(land / 400)));
  if (CFG.apexEnabled) seedFaunaGroup('apex', Math.max(1, Math.round(land / 1200)));
}

function addSprings(S, rng) {
  const n = S.springs[0] + Math.floor(rng() * (S.springs[1] - S.springs[0] + 1));
  let placed = 0;
  for (let k = 0; k < n; k++) {
    let best = -1, bestE = 4.5;
    for (let t = 0; t < 400; t++) { const i = Math.floor(rng() * W * H); if (isWalkable(i) && !isRiver(i) && elev[i] > bestE) { bestE = elev[i]; best = i; } }
    if (best >= 0) { addSpring(best % W, (best / W) | 0); placed++; }
  }
  return placed;
}

// Pick the two start stores: diagonal quadrants first (15.3), then the doorsteps, then the fog around them.
function chooseStarts(board, rng) {
  const byQ = q => board.stores.findIndex(s => s.q === q);
  const pair = rng() < 0.5 ? [byQ(0), byQ(3)] : [byQ(1), byQ(2)];
  if (rng() < 0.5) pair.reverse();
  board.starts = pair.map(k => ({ store: k, x: board.stores[k].door.x, y: board.stores[k].door.y }));
  board.fog = newFog(W * H);
  for (const st of board.starts) { board.stores[st.store].revealed = true; revealSquare(board, st.x, st.y, SIGHT_HALF); }
}

export const BOARD_VERSION = 1;

// The whole build (15.2 steps 1-8). onProgress({phase, ...}) is called every few ticks; phases: land, life, roads.
// Throws if three boards in a row cannot be laid out (re-rolls take seed+1, recorded in board.rerolls).
export function buildBoard(opts, onProgress) {
  const setting = opts.setting || 'continent', size = opts.size || 96, settleTicks = opts.settleTicks === undefined ? 300 : opts.settleTicks;
  const S = SETTINGS[setting];
  if (!S) throw new Error('unknown board setting ' + setting);
  let seed = (opts.seed === undefined || opts.seed === null) ? Math.floor(Math.random() * 2147483647) : (opts.seed | 0);
  const t0 = Date.now();
  for (let roll = 0; roll < 3; roll++, seed++) {
    const rng = mulberry32((seed ^ 0x6B79D3A1) >>> 0);
    const target = opts.target || S.target(rng());
    setWorldSize(size);
    Object.assign(CFG, DEFAULT_CFG, S.cfg, { maxLandCap: target, ecoActive: false });
    initWorld(seed);
    applyElevationIntensity();
    const origins = plantOrigins(S, rng);
    let ticks = 0;
    while (landCoverage() < target) {
      step(); ticks++;
      if (onProgress && ticks % 25 === 0) onProgress({ phase: 'land', land: landCoverage(), target, setting });
      if (ticks > 60000) throw new Error('genesis stalled at ' + (landCoverage() * 100).toFixed(1) + '% land');
    }
    const tLand = Date.now();
    CFG.maxLandCap = landCoverage() - 1e-6;                      // freeze: no new land, erosion goes on
    generateRivers();
    const springs = addSprings(S, rng);
    computeAridity(); applyClimate(); reclassTerrain();
    CFG.ecoActive = true;
    seedLife();
    for (let k = 0; k < settleTicks; k++) { step(); if (onProgress && k % 25 === 0) onProgress({ phase: 'life', tick: k, of: settleTicks, setting }); }
    for (const f of fauna) if (f) f.prefElev = clamp(elev[idx(f.x, f.y)] || 0, 0, 10);
    const tLife = Date.now();
    if (onProgress) onProgress({ phase: 'roads', setting });
    let laid;
    try { laid = layoutBoard(rng); }
    catch (e) { if (e instanceof Reroll && roll < 2) { if (onProgress) onProgress({ phase: 'reroll', why: e.message, setting }); continue; } throw e; }
    const removed = clearRoadFlora(laid.stores);
    const board = {
      v: BOARD_VERSION, setting, seed, size, target: +target.toFixed(4), land: +landCoverage().toFixed(4), ticks, origins, springs,
      rerolls: roll, stores: laid.stores.map(s => ({ x: s.x, y: s.y, i: s.i, q: s.q, name: s.name, door: s.door, revealed: false })),
      links: laid.links, spurs: laid.spurs, signposts: laid.signposts, landmarks: laid.landmarks, repicks: laid.repicks, floraCleared: removed,
      ms: { land: tLand - t0, life: tLife - tLand, roads: Date.now() - tLife },
    };
    chooseStarts(board, rng);
    delete board._roadDist;   // fog.js's cache: the page rebuilds it; it must not ride through postMessage or into a save
    return board;
  }
  throw new Error('no board could be laid out in three rolls');
}
