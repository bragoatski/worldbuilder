// Ketch'em movement for both players (mechanics sec. 12 and 22.1): the stride table, the tick-window budget that
// makes a held key visibly faster on a road, boats on water, Root's leg walk with the same table instead of a flat
// stride, and E to read what you stand on. Pure over the sim's arrays and the board K; the page wires the keys.
import { T, grid, riverData, road, volcActive, idx, inb, tick } from '../sim.js';
import { revealSquare, SIGHT_HALF } from './fog.js';

export const WINDOW_TICKS = 6;        // the stride budget refills every this many ticks (22.1)
export const PATH_MAX = 9;            // tiles one walk(path) may cover (as a visitor's walk)
const STEEP = { [T.MOUNTAIN]: 1, [T.GLACIER]: 1 };

// What the ground under tile i means for a walker: its stride (tiles per window / per leg) or why it is closed.
export function groundOf(i) {
  if (volcActive[i]) return { kind: 'blocked', why: 'an active vent' };
  const t = grid[i];
  if (t === T.VOLCANIC) return { kind: 'blocked', why: 'volcanic rock' };
  if (road[i]) return { kind: 'road', stride: 4 };       // before the lake: a road over a lake is a bridge
  const rd = riverData && riverData[i];
  if (rd && rd.lake) return { kind: 'blocked', why: 'a lake' };
  if (t === T.OCEAN || t === T.COAST) return { kind: 'water', stride: 1 };
  if (STEEP[t]) return { kind: 'steep', stride: 1 };
  if (rd) return { kind: 'river', stride: 2 };
  return { kind: 'open', stride: 2 };
}

export function newPlayer(x, y) { return { x, y, boat: false, spent: 0, windowStart: tick, trail: [], msg: null, msgUntil: 0 }; }

// One tile for a player (Kevin) or a body (Root's visit state). With budget on, a tile costs 1/stride of the
// window, so a window allows 4 road tiles, 2 on open land, 1 at sea or on steep ground. Reveals the fog around the
// new position. Returns { ok, why, kind }.
export function tryStep(K, p, dx, dy, budget = true) {
  const nx = p.x + dx, ny = p.y + dy;
  if (!inb(nx, ny)) return { ok: false, why: 'the edge of the world' };
  const i = idx(nx, ny), g = groundOf(i);
  if (g.kind === 'blocked') return { ok: false, why: g.why };
  if (budget) {
    if (tick - p.windowStart >= WINDOW_TICKS || tick < p.windowStart) { p.spent = 0; p.windowStart = tick; }
    const cost = 1 / g.stride;
    if (p.spent + cost > 1 + 1e-9) return { ok: false, why: 'winded', kind: g.kind };
    p.spent += cost;
  }
  p.x = nx; p.y = ny; p.boat = g.kind === 'water';
  if (p.trail) { p.trail.push([nx, ny]); if (p.trail.length > 400) p.trail.shift(); }
  if (K && K.fog) revealSquare(K, nx, ny, SIGHT_HALF);
  return { ok: true, kind: g.kind };
}

// Shift + direction: a whole stride in one press, as many tiles as the ground you start on allows, stopping at
// steep ground, a block or an empty budget. Returns the tiles moved.
export function strideStep(K, p, dx, dy) {
  const n = groundOf(idx(p.x, p.y)).stride || 1;
  let moved = 0;
  for (let s = 0; s < n; s++) {
    const r = tryStep(K, p, dx, dy);
    if (!r.ok) break;
    moved++;
    if (r.kind === 'steep') break;
  }
  return moved;
}

const DIRS = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] };

// Root's walk: one leg of up to `steps` tiles (at most 4) on one stride budget, the same rule as Kevin's window:
// each tile costs by its own ground, so a leg is 4 road tiles, 2 on open land, 1 at sea by boat; steep ground stops
// it after one tile. Results: `walked 4E`, `walked 2/4E, stride`, `walked 1/2N, steep`, `walked 0/2E, blocked: a
// lake`, plus `, by boat` when the leg ends at sea.
export function leg(K, st, dir, steps) {
  dir = String(dir || '').toUpperCase();
  const d = DIRS[dir];
  if (!d) return { error: 'no direction "' + dir + '" (N NE E SE S SW W NW)' };
  const n = Math.max(1, Math.min(4, steps | 0 || 1));
  st.spent = 0; st.windowStart = tick;
  let moved = 0, why = '';
  for (let s = 0; s < n; s++) {
    const r = tryStep(K, st, d[0], d[1], true);
    if (!r.ok) { why = r.why === 'winded' ? ', stride' : ', blocked: ' + r.why; break; }
    moved++;
    if (r.kind === 'steep') { why = ', steep'; break; }   // always said, so a route stops on the mountain whatever the leg length
  }
  return { dir, n, moved, why, boat: !!(moved && st.boat) };
}
function legText(r) { return (r.moved === r.n ? r.moved + r.dir : r.moved + '/' + r.n + r.dir) + r.why + (r.boat ? ', by boat' : ''); }
export function legWalk(K, st, dir, steps) {
  const r = leg(K, st, dir, steps);
  return r.error || 'walked ' + legText(r);
}

export function parseRoute(path) {
  const legs = [], re = /(\d*)\s*(NE|NW|SE|SW|N|E|S|W)/gi;
  let m, total = 0;
  while ((m = re.exec(String(path || ''))) && total < PATH_MAX) {
    const n = Math.min(m[1] ? parseInt(m[1], 10) : 1, PATH_MAX - total);
    if (n > 0) { legs.push([m[2].toUpperCase(), n]); total += n; }
  }
  return legs;
}

// A route like "8E2N" walked as a run of legs, each on its own stride budget (so "8E" on a road is `4E 4E`, on open
// land `2E 2E 2E 2E`); stops at the first leg that steep ground or a block cuts short.
export function routeWalk(K, st, path) {
  const legs = parseRoute(path);
  if (!legs.length) return 'no route in "' + path + '" (like 3N2E1NW)';
  const done = [];
  for (const [dir, n] of legs) {
    let left = n;
    while (left > 0) {
      const r = leg(K, st, dir, Math.min(4, left));
      left -= r.moved;
      if (r.why && r.why !== ', stride') { done.push(legText(r)); return 'walked ' + done.join(' '); }
      if (!r.moved) { done.push(legText(r)); return 'walked ' + done.join(' '); }
      done.push(r.moved + dir + (r.boat ? ' (boat)' : ''));
    }
  }
  return 'walked ' + done.join(' ');
}

// E: what is under the player. Stores open in a later step; for now the store names itself.
export function interact(K, p) {
  const s = K.stores.find(o => o.x === p.x && o.y === p.y);
  if (s) return { kind: 'store', text: s.name + ' (the store opens in a later step)' };
  const sp = K.signposts.find(o => o.x === p.x && o.y === p.y);
  if (sp) return { kind: 'signpost', text: sp.text || 'no stores this way' };
  const l = (K.landmarks || []).find(o => o.x === p.x && o.y === p.y);
  if (l) return { kind: 'landmark', text: l.name };
  return { kind: 'nothing', text: p.boat ? 'open water' : 'nothing here' };
}

// Bearings for the look lines: "2N1E" from (sx, sy) to (x, y).
export function bearingTo(sx, sy, x, y) {
  const dx = x - sx, dy = y - sy;
  if (!dx && !dy) return 'here';
  return (dy ? Math.abs(dy) + (dy < 0 ? 'N' : 'S') : '') + (dx ? Math.abs(dx) + (dx < 0 ? 'W' : 'E') : '');
}

// The Ketch'em lines of a look from (sx, sy) with sight half-width h: signposts, revealed stores and the other
// player in sight. Pure; perceive() appends them.
export function lookLines(K, sx, sy, h, who) {
  const inSight = o => Math.abs(o.x - sx) <= h && Math.abs(o.y - sy) <= h;
  const out = [];
  const posts = K.signposts.filter(inSight).sort((a, b) => Math.max(Math.abs(a.x - sx), Math.abs(a.y - sy)) - Math.max(Math.abs(b.x - sx), Math.abs(b.y - sy)));
  if (posts.length) out.push('signpost ' + bearingTo(sx, sy, posts[0].x, posts[0].y) + ': ' + (posts[0].text || 'no stores this way'));
  const stores = K.stores.filter(s => s.revealed && inSight(s));
  if (stores.length) out.push('store ' + stores.map(s => '"' + s.name + '" ' + bearingTo(sx, sy, s.x, s.y)).join(', '));
  const other = who === 'root' ? K.kevin : K.root;
  if (other && !other.away && inSight(other)) out.push((who === 'root' ? 'Kevin ' : 'Root ') + bearingTo(sx, sy, other.x, other.y) + (other.boat ? ' (boat)' : ''));
  return out;
}
