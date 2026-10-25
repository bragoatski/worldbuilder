'use strict';
// Root's visit: the assistant walks this world as a body, through a door that carries only its senses.
// The pure cores below (perceive / walkFrom / plantAt / bearing / pointText) are DOM-free and gate-tested.
// bootVisit() is the browser shell: on a locally served page with the relay running (visit/relay.mjs, started by
// the dev server) it adds a "Call Root" toggle. The game runs as normal until Kevin calls Root in; then the relay
// launches Root's session and carries its actions here. Kevin's own tools keep working, and anything he does
// reaches Root only if Root can see it.
import {
  CFG, T, TNAME, W, H, _seed, chronicleNote, speciesKey, elev, aridity, fauna, flora, getSpeciesName, grid, idx, inb,
  makeFlora, riverData, road, seasonPhase, seasonWave, tempField, tick, volcActive,
  addSpring, bloomEvent, brushClimateRaw, brushTerrainRaw, droughtEvent, emberStrike, godCancelMark, godMark, landCoverage,
  seedLifeAt, settleClimate, settleTerrain, shiftSeaLevel,
} from './sim.js';
import { MODES, MODE_IDS, DEFAULT_MODE, modeOf } from '../visit/modes.mjs';
import { legWalk, routeWalk, lookLines, bearingTo } from './ketchem/controls.js';
import { revealSquare, SIGHT_HALF } from './ketchem/fog.js';

export const SIGHT = 4;            // Root sees a (2*SIGHT+1)^2 square around itself, nothing more
export const MAX_STRIDE = 3;       // tiles per walk call
export const PLANTS_PER_VISIT = 5;

// One glyph per biome (TNAME order). ASCII so the view costs few tokens.
const GLYPH = ['O', 'o', 'g', 'F', 'h', 'M', 'd', 'w', 'J', 'a', 's', 'V', 'G', 't', 'v', 'm'];
const STEEP = [T.MOUNTAIN, T.GLACIER, T.VOLCANIC];
const DIRS = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] };
const CREATURE = { apex: 'A', carnivore: 'C', omnivore: 'O', scavenger: 'S', herbivore: 'H' };
const CREATURE_RANK = ['apex', 'carnivore', 'omnivore', 'scavenger', 'herbivore'];

export const TRAIL_MAX = 400;      // footsteps kept for Kevin's map

export function newVisitState() {
  return { x: -1, y: -1, places: [], planted: [], plantsThisVisit: 0, trail: [], leftTick: null, companion: null };
}

function isWaterAt(i) {
  if (grid[i] === T.OCEAN || grid[i] === T.COAST) return true;
  const rd = riverData && riverData[i];
  return !!(rd && rd.lake);
}

function blockedAt(x, y) {
  if (!inb(x, y)) return 'the edge of the world';
  const i = idx(x, y);
  if (grid[i] === T.OCEAN) return 'open ocean';
  if (grid[i] === T.COAST) return 'shallow sea';
  if (riverData && riverData[i] && riverData[i].lake) return 'a lake';
  if (volcActive[i]) return 'an active vent, too hot to cross';
  return null;
}

// The standable tile closest to (cx,cy), default the world's centre: where Root first arrives, and where it
// steps to if the ground under it has gone (the sea rose while it was away).
// roomy: a first arrival wants ground with room to move, not the nearest speck: score = standable tiles in sight
// minus distance from (cx,cy). Without it (the sea took Root's tile), simply the nearest standable tile.
export function arrivalTile(cx = W >> 1, cy = H >> 1, roomy = false) {
  let best = -1, bestScore = -Infinity;
  for (let i = 0; i < W * H; i++) {
    const x = i % W, y = (i / W) | 0;
    if (blockedAt(x, y) || STEEP.includes(grid[i])) continue;
    const d = Math.hypot(x - cx, y - cy);
    let score = -d;
    if (roomy) {
      let room = 0;
      for (let dy = -SIGHT; dy <= SIGHT; dy++) for (let dx = -SIGHT; dx <= SIGHT; dx++) if (inb(x + dx, y + dy) && !blockedAt(x + dx, y + dy)) room++;
      score = room - d * 0.75;
    }
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best < 0 ? null : { x: best % W, y: (best / W) | 0 };
}

export function bearing(dx, dy) {
  if (dx === 0 && dy === 0) return 'here';
  const parts = [];
  if (dy) parts.push(Math.abs(dy) + (dy < 0 ? 'N' : 'S'));
  if (dx) parts.push(Math.abs(dx) + (dx > 0 ? 'E' : 'W'));
  return parts.join('');
}

function compass(dx, dy) {
  const a = Math.atan2(-dy, dx) * 180 / Math.PI; // 0 = east, 90 = north
  const names = ['east', 'northeast', 'north', 'northwest', 'west', 'southwest', 'south', 'southeast'];
  return names[((Math.round(a / 45) % 8) + 8) % 8];
}

function tempWord(v) { return v < 2 ? 'freezing' : v < 4 ? 'cold' : v < 6 ? 'mild' : v < 8 ? 'warm' : 'hot'; }
function aridWord(v) { return v < 2 ? 'wet' : v < 4 ? 'damp' : v < 6 ? 'moderate' : v < 8 ? 'dry' : 'parched'; }

// Season as one token-cheap word: warm / cold / mid, with + warming or - cooling. Empty when seasons are off.
function seasonCode() {
  if (!CFG.seasonalTilt) return '';
  const p = seasonPhase(), w = seasonWave(p), next = seasonWave((p + 0.02) % 1);
  return (w > 0.5 ? 'warm' : w < -0.5 ? 'cold' : 'mid') + (next > w + 1e-6 ? '+' : next < w - 1e-6 ? '-' : '');
}

// A plant Root put in the ground. Ids alone are not enough: a load resets the id counter, so an id can come back
// on an unrelated plant. Root's mark rides in the save with the plant; plants never move.
function findPlanted(p) { return flora.find(q => q && q.id === p.id && q.byRoot && q.x === p.x && q.y === p.y); }

function liveFloraAt(x, y) {
  let n = 0;
  for (let k = 0; k < flora.length; k++) { const f = flora[k]; if (f && f.x === x && f.y === y) n++; }
  return n;
}

export const FOLLOW_GAP = 2;     // a companion drifts back toward Root when it is further than this

// The one creature Root has befriended, if it is still alive in this world. Matched on id, lineage and type: ids can
// come back on an unrelated creature after a load, the other two make that a non-issue.
export function findCompanion(st) {
  const c = st.companion;
  if (!c || c.goneTick != null) return null;
  return fauna.find(f => f && f.id === c.id && f.lineageId === c.lineageId && f.type === c.type) || null;
}

// Living members of a lineage: what a companion leaves behind once it is gone.
export function lineCount(lineageId) {
  let n = 0;
  for (let k = 0; k < fauna.length; k++) if (fauna[k] && fauna[k].lineageId === lineageId) n++;
  return n;
}

function creatureCode(f, sx, sy, st) {
  const e = f.maxEnergy ? f.energy / f.maxEnergy : 0.5;
  const a = f.maxAge ? f.age / f.maxAge : 0;
  const size = f.size >= 1.7 ? 'huge ' : f.size >= 1.3 ? 'big ' : f.size <= 0.75 ? 'small ' : '';
  const sp = getSpeciesName(f);
  const c = st && st.companion;
  const mine = c && c.goneTick == null && f.id === c.id && f.lineageId === c.lineageId ? ' "' + c.name + '"' : '';
  return (CREATURE[f.type] || '?') + mine + ' ' + bearing(f.x - sx, f.y - sy) + ' ' + size + (a < 0.2 ? 'young' : a > 0.8 ? 'old' : 'adult') +
    ' ' + (e < 0.25 ? 'starving' : e < 0.5 ? 'hungry' : 'fed') + (sp ? ' (' + sp + ')' : '');
}

// What Root perceives from where it stands: its square and nothing beyond it, in the terse code whose key is in
// Root's visit brief (visit/briefs/common.md). Each row is ground, two spaces, life; north up. Kept short on purpose: every
// look stays in Root's context for the rest of the visit and is re-read on every later step.
// K (a Ketch'em board) adds the game's glyphs (= road, S store) and lines (signpost, stores found, Kevin).
export function perceive(st, K = null) {
  const sx = st.x, sy = st.y, i0 = idx(sx, sy);
  const head = ['t' + tick, seasonCode(), '@' + sx + ',' + sy, TNAME[grid[i0]].toLowerCase(), 'e' + elev[i0].toFixed(1),
    tempWord(tempField[i0]), aridWord(aridity[i0]), K && st.boat ? 'boat' : ''].filter(Boolean).join(' ');
  const storeAt = K ? new Set(K.stores.map(s => idx(s.x, s.y))) : null;
  const byTile = new Map();
  for (let k = 0; k < fauna.length; k++) {
    const f = fauna[k];
    if (!f || Math.abs(f.x - sx) > SIGHT || Math.abs(f.y - sy) > SIGHT) continue;
    const key = f.y * W + f.x;
    if (!byTile.has(key)) byTile.set(key, []);
    byTile.get(key).push(f);
  }
  const rows = [];
  let plantTiles = 0, plants = 0;
  for (let dy = -SIGHT; dy <= SIGHT; dy++) {
    let g = '', l = '';
    for (let dx = -SIGHT; dx <= SIGHT; dx++) {
      const x = sx + dx, y = sy + dy;
      if (dx === 0 && dy === 0) { g += '@'; l += '@'; continue; }
      if (!inb(x, y)) { g += 'x'; l += ' '; continue; }
      const i = idx(x, y), rd = riverData && riverData[i];
      g += volcActive[i] ? '*' : storeAt && storeAt.has(i) ? 'S' : K && road[i] ? '=' : rd && rd.lake ? 'L' : rd ? '~' : GLYPH[grid[i]];
      const here = byTile.get(i);
      if (here) {
        let top = here[0];
        for (const f of here) if (CREATURE_RANK.indexOf(f.type) < CREATURE_RANK.indexOf(top.type)) top = f;
        l += CREATURE[top.type] || '?';
      } else {
        const n = isWaterAt(i) ? 0 : liveFloraAt(x, y);
        if (n) { plantTiles++; plants += n; }
        l += n ? String(Math.min(n, 9)) : '.';
      }
    }
    rows.push(g + '  ' + l);   // two spaces, not a symbol: a '|' got read as terrain
  }
  const out = [head, ...rows];
  const creatures = [];
  byTile.forEach(list => list.forEach(f => creatures.push(f)));
  creatures.sort((a, b) => Math.max(Math.abs(a.x - sx), Math.abs(a.y - sy)) - Math.max(Math.abs(b.x - sx), Math.abs(b.y - sy)));
  if (creatures.length) {
    out.push(creatures.slice(0, 8).map(f => creatureCode(f, sx, sy, st)).join('; ') +
      (creatures.length > 8 ? '; +' + (creatures.length - 8) + ' more' : ''));
  }
  const tail = ['plants ' + plants + '/' + plantTiles];
  const mine = st.planted.filter(p => Math.abs(p.x - sx) <= SIGHT && Math.abs(p.y - sy) <= SIGHT);
  if (mine.length) {
    tail.push('mine ' + mine.map(p => { const f = findPlanted(p); return bearing(p.x - sx, p.y - sy) + ' ' + (f ? Math.round(f.health * 100) + '%' : 'gone'); }).join(', '));
  }
  const friend = findCompanion(st);
  if (friend && (Math.abs(friend.x - sx) > SIGHT || Math.abs(friend.y - sy) > SIGHT)) tail.push('"' + st.companion.name + '" out of sight');
  const near = st.places.filter(p => Math.abs(p.x - sx) <= SIGHT && Math.abs(p.y - sy) <= SIGHT);
  if (near.length) tail.push('named ' + near.map(p => '"' + p.name + '" ' + bearing(p.x - sx, p.y - sy)).join(', '));
  out.push(tail.join(' · '));
  if (K) out.push(...lookLines(K, sx, sy, SIGHT, 'root'));
  return out.join('\n');
}

// Root's sense of its own history on arrival: its named places (roughly where) and how its plantings fared.
// Bearings, not maps: it has to walk to see them.
// The sky reads tiles, not bearings from a body it does not have.
export function arrivalText(st, mode = 'visitor') {
  const sky = mode === 'sky';
  const out = [];
  if (st.leftTick != null && tick > st.leftTick) out.push('since you left: ' + (tick - st.leftTick) + ' ticks');
  if (st.places.length) {
    out.push('named: ' + st.places.map(p => {
      if (sky) return '"' + p.name + '" ' + p.x + ',' + p.y;
      const dx = p.x - st.x, dy = p.y - st.y, d = Math.max(Math.abs(dx), Math.abs(dy));
      return '"' + p.name + '" ' + (d === 0 ? 'here' : '~' + d + ' ' + compass(dx, dy));
    }).join('; '));
  }
  if (st.planted.length) out.push('planted ' + st.planted.length + ', alive ' + st.planted.filter(p => findPlanted(p)).length);
  const c = st.companion;
  if (c) {
    const f = findCompanion(st);
    if (!f && c.goneTick == null) c.goneTick = tick;
    out.push('friend "' + c.name + '" (' + (CREATURE[c.type] || '?') + (c.species ? ' ' + c.species : '') + '): ' +
      (f ? 'alive ' + (sky ? 'at ' + f.x + ',' + f.y : bearing(f.x - st.x, f.y - st.y)) : 'gone since t' + c.goneTick) + ', its line ' + lineCount(c.lineageId) + ' living');
  }
  return out.join('\n');
}

// A sky tool's tile: both coordinates must be given as whole numbers inside the world. Nothing defaults to 0,0.
export function tileArg(a) {
  const x = a && a.x, y = a && a.y;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return { error: 'give x and y as whole tile numbers (the world is ' + W + 'x' + H + ')' };
  if (!inb(x, y)) return { error: 'nothing: beyond the edge (the world is ' + W + 'x' + H + ')' };
  return { x, y, where: 'at ' + x + ',' + y };
}

export function walkFrom(st, dir, steps) {
  dir = String(dir || '').toUpperCase();
  const d = DIRS[dir];
  if (!d) return 'no direction "' + dir + '" (N NE E SE S SW W NW)';
  const n = Math.max(1, Math.min(MAX_STRIDE, steps | 0 || 1));
  let moved = 0, why = '';
  for (let s = 0; s < n; s++) {
    const nx = st.x + d[0], ny = st.y + d[1];
    const b = blockedAt(nx, ny);
    if (b) { why = ', blocked: ' + b; break; }
    st.x = nx; st.y = ny; moved++;
    if (!st.trail) st.trail = [];
    st.trail.push([nx, ny]); if (st.trail.length > TRAIL_MAX) st.trail.shift();
    if (STEEP.includes(grid[idx(nx, ny)]) && s < n - 1) { why = ', steep'; break; }
  }
  return 'walked ' + (moved === n ? moved + dir : moved + '/' + n + dir) + why;
}

export const PATH_MAX = 9;      // tiles one walk(path) may cover

// A route like "3N2E1NW" walked in one call (one reply instead of several). Legs longer than a stride are split;
// the route stops at the first leg that cannot finish, so Root never walks blind past an obstacle.
export function walkPath(st, path) {
  const legs = [];
  const re = /(\d*)\s*(NE|NW|SE|SW|N|E|S|W)/gi;
  let m, total = 0;
  while ((m = re.exec(String(path || ''))) && total < PATH_MAX) {
    const n = Math.min(m[1] ? parseInt(m[1], 10) : 1, PATH_MAX - total);
    if (n > 0) { legs.push([m[2].toUpperCase(), n]); total += n; }
  }
  if (!legs.length) return 'no route in "' + path + '" (like 3N2E1NW)';
  const done = [];
  for (const [dir, n] of legs) {
    for (let left = n; left > 0; left -= MAX_STRIDE) {
      const want = Math.min(MAX_STRIDE, left);
      const r = walkFrom(st, dir, want);
      if (r !== 'walked ' + want + dir) { done.push(r.replace(/^walked /, '')); return 'walked ' + done.join(' '); }
      done.push(want + dir);
    }
  }
  return 'walked ' + done.join(' ');
}

export function plantAt(st) {
  if (st.plantsThisVisit >= PLANTS_PER_VISIT) return 'no seeds left (' + PLANTS_PER_VISIT + ' per visit)';
  const i = idx(st.x, st.y);
  if (isWaterAt(i)) return 'nothing roots in water';
  if (road[i]) return 'nothing roots in a road';
  if (liveFloraAt(st.x, st.y) >= (CFG.floraPerTileMax || 4)) return 'ground full of plants';
  const f = makeFlora(st.x, st.y, null);
  f.byRoot = true;
  flora.push(f);
  st.plantsThisVisit++;
  st.planted.push({ id: f.id, x: st.x, y: st.y, tick });
  return 'planted (' + (PLANTS_PER_VISIT - st.plantsThisVisit) + ' seeds left)';
}

// Befriend the nearest creature within one tile and name it. One companion at a time: a new one releases the old.
export function befriend(st, raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!name) return 'a friend needs a name';
  let best = null, bestD = 2;
  for (let k = 0; k < fauna.length; k++) {
    const f = fauna[k];
    if (!f) continue;
    const d = Math.max(Math.abs(f.x - st.x), Math.abs(f.y - st.y));
    if (d < bestD) { best = f; bestD = d; }
  }
  if (!best) return 'no creature within reach (1 tile)';
  const prev = st.companion && st.companion.goneTick == null ? st.companion.name : null;
  st.companion = { id: best.id, lineageId: best.lineageId, type: best.type, name, species: getSpeciesName(best) || null, since: tick, goneTick: null };
  chronicleNote('terrain', 'Root befriends a ' + best.type + ' and calls it ' + name + '.', '#e8a838');
  return 'befriended ' + (CREATURE[best.type] || '?') + ' ' + bearing(best.x - st.x, best.y - st.y) + ' as "' + name + '"' +
    (prev ? ' ("' + prev + '" goes its own way)' : '');
}

// One sim tick of companionship: a companion further than FOLLOW_GAP drifts one tile toward Root, if it can stand
// there. It still eats, breeds, starves and dies by the world's rules; following Root can cost it food.
// Returns 'gone' the first tick the companion is found dead, so the page can tell Root once.
export function companionTick(st) {
  const c = st.companion;
  if (!c || c.goneTick != null) return null;
  const f = findCompanion(st);
  if (!f) { c.goneTick = tick; return 'gone'; }
  const dx = st.x - f.x, dy = st.y - f.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) <= FOLLOW_GAP) return null;
  const nx = f.x + Math.sign(dx), ny = f.y + Math.sign(dy);
  if (!blockedAt(nx, ny)) { f.x = nx; f.y = ny; }
  return null;
}

// Named species in sight, for Root's field guide. The sim names a species only once its lineage is a few
// generations deep (SPECIES_MIN_GEN); a name is a pure function of the genome, so it is the same in every world.
export function sightings(st) {
  const out = new Map();
  for (let k = 0; k < fauna.length; k++) {
    const f = fauna[k];
    if (!f || Math.abs(f.x - st.x) > SIGHT || Math.abs(f.y - st.y) > SIGHT) continue;
    const name = getSpeciesName(f);
    if (!name) continue;
    const key = speciesKey(f);
    if (!out.has(key)) out.set(key, { key, name, type: f.type, biome: TNAME[grid[idx(f.x, f.y)]].toLowerCase() });
  }
  return [...out.values()];
}

export function namePlace(st, raw, x = st.x, y = st.y) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name) return 'a name needs a word';
  if (!inb(x, y)) return 'nothing: beyond the edge';
  st.places = st.places.filter(p => !(p.x === x && p.y === y));
  st.places.push({ name, x, y, tick });
  chronicleNote('terrain', 'Root names a place: ' + name + '.', '#e8a838');
  return 'named "' + name + '"';
}

// Root's memory of one world (seed + size), as saved by the relay. A world run again from the same seed keeps the
// names Root gave its ground (terrain is seeded), but its plantings and footsteps belonged to the earlier run.
export function adoptWorldState(saved, nowTick) {
  const st = Object.assign(newVisitState(), saved || {});
  const restarted = !!saved && saved.lastTick != null && saved.lastTick > nowTick;
  if (restarted) { st.planted = []; st.trail = []; st.leftTick = null; st.companion = null; }
  delete st.lastTick;
  return { st, restarted };
}

// Kevin pointing at a tile, as Root would perceive it: exact if in sight, a bearing if not. From the sky, a tile.
export function pointText(st, px, py, mode = 'visitor') {
  if (mode === 'sky') return 'Kevin points at ' + px + ',' + py;
  const dx = px - st.x, dy = py - st.y;
  if (Math.abs(dx) <= SIGHT && Math.abs(dy) <= SIGHT) return 'Kevin points ' + (dx || dy ? bearing(dx, dy) : 'at you');
  return 'Kevin points far ' + compass(dx, dy) + ' ~' + Math.max(Math.abs(dx), Math.abs(dy));
}

// ===================== The Hand in Root's hands (Shaper and Sky modes) =====================
// Every power is the sim's own god power (the same code Kevin's Hand runs), marked for undo so Kevin can take it
// back with one click. Results are a few words; the caller adds a look where the mode gets one.
export const SHAPER_RADIUS_MAX = 3;   // a body shapes what it can see
export const SKY_RADIUS_MAX = 8;      // the sky shapes a region

// A bearing like "2N1E" within sight, as a tile. Empty or "here" is where Root stands.
export function tileAtBearing(st, at) {
  const s = String(at || '').trim().toUpperCase();
  if (!s || s === 'HERE') return { x: st.x, y: st.y, where: 'here' };
  const re = /(\d+)\s*(NE|NW|SE|SW|N|S|E|W)/g;
  let m, dx = 0, dy = 0, any = false;
  while ((m = re.exec(s))) {
    any = true;
    const n = parseInt(m[1], 10), d = DIRS[m[2]];
    dx += d[0] * n; dy += d[1] * n;
  }
  if (!any) return { error: 'no bearing in "' + at + '" (like 2N1E, or leave it out for here)' };
  if (Math.abs(dx) > SIGHT || Math.abs(dy) > SIGHT) return { error: 'out of sight: ' + at + ' (you see ' + SIGHT + ' tiles each way)' };
  return { x: st.x + dx, y: st.y + dy, where: 'at ' + bearing(dx, dy) };
}

const POWER = { raise: ['earth', 1, 'raised'], sink: ['earth', -1, 'sank'], rain: ['moist', 1, 'rained'], parch: ['moist', -1, 'parched'],
  warm: ['temp', 1, 'warmed'], chill: ['temp', -1, 'chilled'] };

// The brush: a soft disc of land or climate change. Terrain re-settles (climate, biomes) after every act, so the
// world Root sees next is already the consequence.
export function shapeAt(x, y, power, radius, maxR, where) {
  const p = POWER[String(power || '').toLowerCase()];
  if (!p) return 'no power "' + power + '" (raise sink rain parch warm chill)';
  if (!inb(x, y)) return 'nothing: beyond the edge';
  const R = Math.max(1, Math.min(maxR, radius == null ? 2 : radius | 0));
  godMark();
  if (p[0] === 'earth') {
    const r = brushTerrainRaw(x, y, p[1], R);
    settleTerrain();
    chronicleNote('god', 'Root ' + p[2] + ' the land.', '#e8a838');
    const tail = r.crossed ? ': ' + r.crossed + ' tile' + (r.crossed === 1 ? '' : 's') + (p[1] > 0 ? ' rose from the sea' : ' sank beneath the sea') : '';
    return p[2] + ' r' + R + ' ' + where + tail;
  }
  brushClimateRaw(x, y, p[1], R, undefined, p[0]);
  settleClimate();
  return p[2] + ' r' + R + ' ' + where;
}

export function emberAt(x, y, where) {
  if (!inb(x, y)) return 'nothing: beyond the edge';
  const prev = godMark();
  const r = emberStrike(x, y);
  if (!r) { godCancelMark(prev); return 'nothing ' + where; }
  if (r.kind === 'volcano') return 'volcano opened ' + where;
  return 'meteor ' + where + (r.killed ? ': ' + r.killed + ' creature' + (r.killed === 1 ? '' : 's') + ' killed' : '');
}

export function springAt(x, y, where) {
  if (!inb(x, y)) return 'nothing: beyond the edge';
  if (grid[idx(x, y)] === T.OCEAN) return 'nothing: open ocean';
  const prev = godMark();
  if (addSpring(x, y)) return 'spring opened ' + where;
  godCancelMark(prev);
  return 'nothing ' + where + ': a spring is already here';
}

export function seedAt(x, y, where) {
  if (!inb(x, y)) return 'nothing: beyond the edge';
  const prev = godMark();
  const r = seedLifeAt(x, y);
  if (!r) { godCancelMark(prev); return 'nothing ' + where + ': ' + (grid[idx(x, y)] === T.OCEAN ? 'open ocean' : 'ground too steep'); }
  const what = r.kind === 'flora' ? 'plant' : r.kind === 'herbivore' ? 'grazer' : 'predator';
  return 'seeded ' + r.count + ' ' + what + (r.count === 1 ? '' : 's') + ' ' + where;
}

export function weatherEvent(kind) {
  kind = String(kind || '').toLowerCase();
  if (kind !== 'drought' && kind !== 'bloom') return 'no weather "' + kind + '" (drought, bloom)';
  const prev = godMark();
  const n = kind === 'drought' ? droughtEvent() : bloomEvent();
  if (!n) godCancelMark(prev);   // nothing withered or sprang: Kevin's own last act stays undoable
  return kind === 'drought' ? 'drought: ' + n + ' plants withered' : 'bloom: ' + n + ' plants sprang up';
}

export function seaEvent(direction) {
  const dir = direction === 'raise' ? 1 : direction === 'lower' ? -1 : 0;
  if (!dir) return 'no direction "' + direction + '" (raise, lower)';
  godMark();
  const n = shiftSeaLevel(dir);
  return dir > 0 ? 'sea rose: ' + n + ' tile' + (n === 1 ? '' : 's') + ' drowned' : 'sea fell: ' + n + ' tile' + (n === 1 ? '' : 's') + ' uncovered';
}

// ===================== The sky's way of seeing =====================
export const SKY_CELLS = 16;   // the world is summarised as at most this many cells across

// The whole world at once, coarse: one glyph per cell for the commonest ground, one for how much lives there.
// Kept to about a thousand characters: the sky looks often and every survey stays in Root's context.
export function survey(st) {
  const cell = Math.ceil(Math.max(W, H) / SKY_CELLS);
  const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
  const ground = [], river = new Uint8Array(cols * rows), plants = new Uint32Array(cols * rows);
  const beasts = new Uint32Array(cols * rows), top = new Int8Array(cols * rows).fill(-1);
  for (let c = 0; c < cols * rows; c++) ground.push(new Uint16Array(GLYPH.length));
  const cellOf = (x, y) => ((x / cell) | 0) + ((y / cell) | 0) * cols;
  for (let i = 0; i < W * H; i++) {
    const c = cellOf(i % W, (i / W) | 0);
    ground[c][grid[i]]++;
    if (riverData && riverData[i]) river[c] = 1;
  }
  let alive = 0;
  for (let k = 0; k < flora.length; k++) { const f = flora[k]; if (f) { alive++; plants[cellOf(f.x, f.y)]++; } }
  const census = { herbivore: 0, carnivore: 0, omnivore: 0, scavenger: 0, apex: 0 }, species = new Set();
  for (let k = 0; k < fauna.length; k++) {
    const f = fauna[k]; if (!f) continue;
    const c = cellOf(f.x, f.y), rank = CREATURE_RANK.indexOf(f.type);
    beasts[c]++;
    if (top[c] < 0 || rank < top[c]) top[c] = rank;
    if (f.type in census) census[f.type]++;
    const sp = getSpeciesName(f); if (sp) species.add(sp);
  }
  const head = ['t' + tick, seasonCode(), W + 'x' + H, 'land ' + Math.round(landCoverage() * 100) + '%', 'plants ' + alive,
    'H' + census.herbivore, 'C' + census.carnivore, 'O' + census.omnivore, 'S' + census.scavenger, 'A' + census.apex,
    'species ' + species.size, '· cell ' + cell].filter(Boolean).join(' ');
  const pad = String(H).length;
  const out = [head, ' '.repeat(pad) + '  x ' + Array.from({ length: cols }, (_, c) => c * cell).join(' ')];
  for (let r = 0; r < rows; r++) {
    let g = '', l = '';
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c, counts = ground[k];
      let best = 0;
      for (let b = 1; b < counts.length; b++) if (counts[b] > counts[best]) best = b;
      g += river[k] && best !== T.OCEAN ? '~' : GLYPH[best];
      if (top[k] >= 0) l += CREATURE[CREATURE_RANK[top[k]]];
      else { const n = plants[k] + beasts[k] * 3; l += n ? String(Math.min(9, 1 + Math.floor(Math.log2(n)))) : '0'; }
    }
    out.push(String(r * cell).padStart(pad) + '  ' + g + '  ' + l);
  }
  if (st.places.length) {   // the newest few: this line rides in every survey, so it must not grow without bound
    const recent = st.places.slice(-SURVEY_NAMES);
    out.push('named ' + recent.map(p => '"' + p.name + '" ' + p.x + ',' + p.y).join('; ') + (st.places.length > recent.length ? '; +' + (st.places.length - recent.length) + ' older' : ''));
  }
  return out.join('\n');
}
export const SURVEY_NAMES = 12;

// A 9x9 look centred on any tile, for the sky. The gaze is kept so Kevin sees where Root is looking.
export function gazeAt(st, x, y) {
  const t = tileArg({ x, y });
  if (t.error) return t.error;
  st.x = t.x; st.y = t.y;
  return perceive(st);
}

// ===================== Browser shell (gate-blind) =====================
const RELAY = 'http://127.0.0.1:7796';
const VISIT_SPEED = 6;    // while Root is here, the world runs no faster than this between its moves
let V = null;             // the page's side of a visit: { st, key, here, phase, said, retired, points, ... }

export function visitDraw(ctx, PIX) {
  if (!V || !V.here) return;
  const st = V.st, now = Date.now(), sky = V.mode === 'sky';
  ctx.save();
  const tr = sky ? [] : (st.trail || []);
  for (let k = 0; k < tr.length; k++) {           // footsteps fade with age
    ctx.fillStyle = 'rgba(232,168,56,' + (0.08 + 0.32 * k / tr.length).toFixed(3) + ')';
    ctx.fillRect(tr[k][0] * PIX + PIX * 0.35, tr[k][1] * PIX + PIX * 0.35, PIX * 0.3, PIX * 0.3);
  }
  // A body's sight is a solid square; the sky's gaze (where it last zoomed) is a dashed one.
  ctx.strokeStyle = 'rgba(232,168,56,0.55)'; ctx.lineWidth = Math.max(1, PIX / 4);
  if (sky) ctx.setLineDash([PIX, PIX]);
  ctx.strokeRect((st.x - SIGHT) * PIX, (st.y - SIGHT) * PIX, (2 * SIGHT + 1) * PIX, (2 * SIGHT + 1) * PIX);
  ctx.setLineDash([]);
  const font = Math.max(9, PIX * 1.6);
  ctx.font = font + 'px "JetBrains Mono",monospace'; ctx.textBaseline = 'bottom';
  for (const p of st.places) {
    ctx.fillStyle = '#e8a838'; ctx.fillRect(p.x * PIX + PIX * 0.3, p.y * PIX + PIX * 0.3, PIX * 0.4, PIX * 0.4);
    ctx.fillStyle = 'rgba(8,11,16,0.75)'; const w = ctx.measureText(p.name).width;
    ctx.fillRect(p.x * PIX + PIX, p.y * PIX - font, w + 6, font + 2);
    ctx.fillStyle = '#f3d9a4'; ctx.fillText(p.name, p.x * PIX + PIX + 3, p.y * PIX + 1);
  }
  const cx = (st.x + 0.5) * PIX, cy = (st.y + 0.5) * PIX, r = Math.max(3, PIX * 0.9);
  const friend = sky ? null : findCompanion(st);
  if (friend) {   // Kevin sees the companion: an amber ring and its name
    const fx = (friend.x + 0.5) * PIX, fy = (friend.y + 0.5) * PIX;
    ctx.beginPath(); ctx.arc(fx, fy, Math.max(3, PIX * 0.85), 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.2, PIX / 4); ctx.strokeStyle = '#e8a838'; ctx.stroke();
    ctx.fillStyle = '#f3d9a4'; ctx.fillText(st.companion.name, fx + PIX, fy - PIX * 0.4);
  }
  if (!sky) {   // the body: an amber dot. The sky has none; its words float at its gaze.
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#e8a838'; ctx.fill(); ctx.lineWidth = Math.max(1.5, PIX / 3); ctx.strokeStyle = '#ffffff'; ctx.stroke();
  }
  if (V.said && V.said.until > now) {
    const text = V.said.text.length > 60 ? V.said.text.slice(0, 57) + '...' : V.said.text;
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillRect(cx - w / 2 - 5, cy - r - font - 8, w + 10, font + 6);
    ctx.fillStyle = '#10141c'; ctx.fillText(text, cx - w / 2, cy - r - 4);
  }
  ctx.restore();
}

function panel() {
  const el = document.createElement('div');
  el.id = 'visitPanel';
  el.hidden = true;
  el.innerHTML = '<div class="vp-head"><span class="vp-dot"></span><span id="vpStatus"></span><span id="vpTok"></span>' +
    '<button type="button" id="vpClose" aria-label="Hide">&times;</button></div>' +
    '<div id="vpLog"></div>' +
    '<form id="vpForm"><input id="vpInput" autocomplete="off" placeholder="Say something to Root"/></form>' +
    '<div class="vp-hint"><span>Shift+click the map to point</span><button type="button" id="vpHelpBtn">how this works</button></div>' +
    '<div id="vpHelp" hidden><ul>' +
    '<li><b>Modes.</b> Each is its own game. <i>Visitor</i>: a body with nine tiles of sight. <i>Shaper</i>: the same body, plus the Hand where it stands. <i>Sky</i>: no body, the whole world coarsely, the Hand anywhere. <i>Ketch&rsquo;em</i>: co-op on a fogged board; you move with WASD or the arrows (Shift for a full stride, E to read a signpost or a store, V to follow Root). Pick one when you press Call Root.</li>' +
    '<li><b>Talk.</b> Type above. Root hears you the next time it acts or stops to listen.</li>' +
    '<li><b>Point.</b> Shift+click the map. Inside the amber square Root sees exactly where; outside it, only a direction and a distance. The Sky hears the tile.</li>' +
    '<li><b>The square</b> is everything a body can see. Your Hand powers work as always, but a body only notices what happens inside it. The Sky&rsquo;s dashed square is where it last zoomed.</li>' +
    '<li><b>On the map,</b> faint amber dots are Root&rsquo;s footsteps and amber flags are places it has named. Root remembers them in this world, even if you start it over from the same seed.</li>' +
    '<li><b>Undo.</b> Anything Root shapes is one act in the Hand&rsquo;s undo, like your own strokes.</li>' +
    '<li><b>Model.</b> The launch card picks what Root runs on: Sonnet (default, much cheaper), Opus, or Haiku (cheapest).</li>' +
    '<li><b>Speed</b> drops while Root is here so the world is calm between its moves, and comes back when it leaves.</li>' +
    '<li><b>A visit</b> has no time limit. Root leaves when it wants to and writes a field note, or press <i>Send Root home</i> and it says goodbye first.</li>' +
    '<li><b>Cost.</b> The faint number up top is tokens this visit has used; a quiet line marks each million.</li>' +
    '<li><b>Friend.</b> Root can befriend one creature beside it and name it. It follows Root (ringed on the map) and still lives or dies by the world&rsquo;s rules; its family line is tracked across visits.</li>' +
    '<li><b>Field guide.</b> Every named species Root sees goes into its guide, kept across all worlds.</li>' +
    '<li>It is Root, with its memory, not a character. Ask it anything.</li>' +
    '</ul></div>';
  const css = document.createElement('style');
  css.textContent = '#visitPanel{position:fixed;right:16px;bottom:16px;width:min(340px,calc(100vw - 32px));z-index:50;' +
    'background:var(--bg-panel);border:1px solid var(--border-hi);border-radius:8px;color:var(--fg);font:12px/1.45 "JetBrains Mono",monospace;}' +
    '#visitPanel[hidden]{display:none;}' +
    '#visitPanel .vp-head{display:flex;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--border);color:var(--fg-dim);}' +
    '#vpStatus{flex:1;}' +
    '#vpTok{color:var(--fg-faint);font-size:11px;font-variant-numeric:tabular-nums;}' +
    '#vpClose{background:none;border:0;color:var(--fg-faint);font:16px/1 inherit;cursor:pointer;padding:0 2px;}' +
    '#vpClose:hover{color:var(--fg);}' +
    '.vp-dot{width:9px;height:9px;border-radius:50%;background:var(--fg-faint);flex:none;}' +
    '.root-here .vp-dot{background:#e8a838;box-shadow:0 0 0 2px #fff3;}' +
    '.root-coming .vp-dot{background:#e8a838;animation:vpPulse 1.2s ease-in-out infinite;}' +
    '@keyframes vpPulse{50%{opacity:.25;}}' +
    '#vpLog{max-height:30vh;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:6px;}' +
    '#vpLog:empty{display:none;}' +
    '#vpLog .r{color:#f3d9a4;} #vpLog .k{color:var(--fg);} #vpLog .s{color:var(--fg-faint);}' +
    '#vpForm{padding:8px 10px 4px;} #vpInput{width:100%;box-sizing:border-box;background:var(--bg-input);color:var(--fg);' +
    'border:1px solid var(--border);border-radius:6px;padding:7px 8px;font:inherit;}' +
    '#visitPanel .vp-hint{display:flex;justify-content:space-between;gap:8px;padding:0 10px 8px;color:var(--fg-faint);font-size:11px;}' +
    '#vpHelpBtn{background:none;border:0;padding:0;color:var(--fg-faint);font:inherit;cursor:pointer;text-decoration:underline dotted;}' +
    '#vpHelpBtn:hover,#vpHelpBtn[aria-expanded="true"]{color:var(--fg-dim);}' +
    '#vpHelp{border-top:1px solid var(--border);padding:8px 10px 10px;color:var(--fg-dim);font-size:11px;}' +
    '#vpHelp ul{margin:0;padding-left:14px;display:flex;flex-direction:column;gap:5px;} #vpHelp b{color:var(--fg);font-weight:600;}' +
    '#rootCall{display:inline-flex;align-items:center;gap:7px;margin-left:auto;margin-right:8px;padding:6px 11px;border-radius:7px;' +
    'background:transparent;border:1px solid var(--border-hi);color:var(--fg-dim);font:600 12px/1 inherit;cursor:pointer;white-space:nowrap;}' +
    '#rootCall:hover{background:rgba(255,255,255,.05);color:var(--fg);}' +
    '#rootCall.root-here{border-color:#e8a83866;color:#f3d9a4;}' +
    '#rootCall:disabled{cursor:default;opacity:.7;}' +
    '#rootModel{background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--fg);' +
    'font:12px/1 inherit;padding:5px 6px;cursor:pointer;}' +
    '#rootModel option{background:var(--bg-panel);color:var(--fg);}' +
    // The launch card: which Root comes, on which model.
    '#rootLaunch{position:fixed;z-index:60;width:min(360px,calc(100vw - 32px));background:var(--bg-panel);border:1px solid var(--border-hi);' +
    'border-radius:10px;padding:12px;color:var(--fg);font:12px/1.45 "JetBrains Mono",monospace;box-shadow:0 12px 32px rgba(0,0,0,.45);}' +
    '#rootLaunch[hidden]{display:none;}' +
    '#rootLaunch .rl-title{color:var(--fg-dim);font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px 2px;}' +
    '#rootLaunch .rl-card{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;align-items:start;padding:8px 10px;margin-bottom:6px;' +
    'border:1px solid var(--border);border-radius:8px;cursor:pointer;}' +
    '#rootLaunch .rl-card:hover{border-color:var(--border-hi);background:rgba(255,255,255,.03);}' +
    '#rootLaunch .rl-card.on{border-color:#e8a83899;background:rgba(232,168,56,.07);}' +
    '#rootLaunch .rl-card input{margin:3px 0 0;accent-color:#e8a838;grid-row:span 2;}' +
    '#rootLaunch .rl-card b{font-weight:600;color:var(--fg);} #rootLaunch .rl-card span{color:var(--fg-dim);font-size:11px;}' +
    '#rootLaunch .rl-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;color:var(--fg-dim);}' +
    '#rootLaunch .rl-row[hidden]{display:none;}' +   // the author rule above would beat the hidden attribute
    '#rootLaunch .rl-actions{justify-content:flex-end;}' +
    '#rootLaunch button{border-radius:7px;padding:7px 12px;font:600 12px/1 inherit;cursor:pointer;border:1px solid var(--border-hi);background:transparent;color:var(--fg-dim);}' +
    '#rootLaunch button:hover{color:var(--fg);background:rgba(255,255,255,.05);}' +
    '#rootLaunch #rlBegin{background:#e8a838;border-color:#e8a838;color:#10141c;} #rootLaunch #rlBegin:hover{background:#f3c35c;}';
  document.head.appendChild(css);
  document.body.appendChild(el);
  const btn = el.querySelector('#vpHelpBtn'), help = el.querySelector('#vpHelp');
  const show = open => {
    help.hidden = !open; btn.setAttribute('aria-expanded', String(open));
    try { localStorage.setItem('wb.visitHelp', open ? '1' : '0'); } catch { /* storage blocked: still works */ }
  };
  let open = false;
  try { open = localStorage.getItem('wb.visitHelp') === '1'; } catch { /* default closed */ }
  show(open);
  btn.addEventListener('click', () => show(help.hidden));
  el.querySelector('#vpClose').addEventListener('click', () => { el.hidden = true; });
  return el;
}

// The toggle in the top bar: Call Root / Send Root home.
function callButton(onClick) {
  const b = document.createElement('button');
  b.id = 'rootCall'; b.type = 'button';
  b.innerHTML = '<span class="vp-dot"></span><span id="rootCallLabel">Call Root</span>';
  b.setAttribute('data-tip', 'Root|Call Root into this world, or send it home');
  const mode = document.getElementById('modeToggle');
  if (mode && mode.parentNode) { mode.parentNode.insertBefore(b, mode); mode.style.marginLeft = '0'; }
  else { b.style.cssText = 'position:fixed;top:12px;right:16px;z-index:50;'; document.body.appendChild(b); }
  b.addEventListener('click', onClick);
  return b;
}

function remember(key, value) { try { localStorage.setItem(key, value); } catch { /* storage blocked: still works */ } }
function recall(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }

// The launch card under the button: which Root comes (its mode) and on which model. Each mode is its own game,
// so the choice is made in the open, every time, and the last choice is remembered.
function launchCard(onBegin) {
  const el = document.createElement('div');
  el.id = 'rootLaunch'; el.hidden = true;
  el.innerHTML = '<div class="rl-title">Call Root as</div>' +
    MODE_IDS.map(id => '<label class="rl-card" data-mode="' + id + '"><input type="radio" name="rootMode" value="' + id + '"><b>' +
      MODES[id].label + '</b><span>' + MODES[id].blurb + '</span></label>').join('') +
    '<div class="rl-row" id="rlBoardRow"><span>Board</span><span><select id="rlBoard" title="Which board to build"><option value="continent">Continent</option>' +
    '<option value="archipelago">Archipelago</option><option value="highlands">Highlands</option></select> ' +
    '<input id="rlSeed" type="text" inputmode="numeric" placeholder="seed" size="6" title="Board seed; empty rolls one"></span></div>' +
    '<div class="rl-row"><span>Model</span><select id="rootModel" title="Which model Root visits on"></select></div>' +
    '<div class="rl-row rl-actions"><button type="button" id="rlCancel">Cancel</button><button type="button" id="rlBegin">Begin</button></div>';
  document.body.appendChild(el);
  const boardRow = el.querySelector('#rlBoardRow'), boardSel = el.querySelector('#rlBoard'), seedInp = el.querySelector('#rlSeed');
  boardSel.value = recall('wb.ketchemBoard', 'continent');
  if (!boardSel.value) boardSel.value = 'continent';   // a stale stored value would leave the select empty
  boardSel.addEventListener('change', () => remember('wb.ketchemBoard', boardSel.value));
  seedInp.style.cssText = 'width:64px;background:var(--bg-input);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:4px 6px;font:inherit;';
  boardSel.style.cssText = 'background:var(--bg-input);border:1px solid var(--border);border-radius:6px;color:var(--fg);font:12px/1 inherit;padding:5px 6px;';
  const sel = el.querySelector('#rootModel');   // Sonnet by default: far cheaper per token than Opus, and the same Root
  [['sonnet', 'Sonnet'], ['opus', 'Opus'], ['haiku', 'Haiku']].forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); });
  sel.value = recall('wb.rootModel', 'sonnet');
  sel.addEventListener('change', () => remember('wb.rootModel', sel.value));
  const cards = [...el.querySelectorAll('.rl-card')];
  const pick = id => { cards.forEach(c => { const on = c.dataset.mode === id; c.classList.toggle('on', on); c.querySelector('input').checked = on; }); remember('wb.rootMode', id);
    boardRow.hidden = !MODES[id].board; };   // the board row shows for the game mode only
  pick(modeOf(recall('wb.rootMode', DEFAULT_MODE)));
  cards.forEach(c => { c.addEventListener('click', () => pick(c.dataset.mode)); c.querySelector('input').addEventListener('change', () => pick(c.dataset.mode)); });
  const close = () => { el.hidden = true; };
  el.querySelector('#rlCancel').addEventListener('click', close);
  el.querySelector('#rlBegin').addEventListener('click', () => {
    const on = el.querySelector('input:checked');
    const seed = seedInp.value.trim();
    close(); onBegin(on ? on.value : DEFAULT_MODE, sel.value, boardSel.value, /^\d+$/.test(seed) ? +seed : undefined);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.hidden) { close(); e.stopPropagation(); } });
  document.addEventListener('pointerdown', e => { if (!el.hidden && !el.contains(e.target) && !e.target.closest('#rootCall')) close(); });
  return {
    toggle(anchor) {
      if (!el.hidden) return close();
      const r = anchor.getBoundingClientRect();
      el.style.top = Math.round(r.bottom + 8) + 'px';
      el.style.right = Math.max(16, Math.round(window.innerWidth - r.right)) + 'px';
      el.hidden = false;
    },
    close,
  };
}

function logLine(cls, text) {
  const log = document.getElementById('vpLog'); if (!log) return;
  const d = document.createElement('div'); d.className = cls; d.textContent = text;
  log.appendChild(d); log.scrollTop = log.scrollHeight;
}

// One place that paints the button and the panel head from the visit's phase.
const PHASES = {
  idle:    { label: 'Call Root',          status: 'Root is not here',            cls: '' },
  coming:  { label: 'Root is on the way', status: 'Root is on the way',          cls: 'root-coming' },
  here:    { label: 'Send Root home',     status: 'Root is here',                cls: 'root-here' },
  leaving: { label: 'Root is leaving',    status: 'Root is saying goodbye',      cls: 'root-coming' },
  resting: { label: 'Root',               status: 'Another tab has Root now',    cls: '' },
};
function paint(phase, extra) {
  V.phase = phase;
  const p = PHASES[phase];
  const b = document.getElementById('rootCall'), lab = document.getElementById('rootCallLabel');
  if (b) { b.className = p.cls; b.disabled = phase === 'leaving' || phase === 'resting'; }
  if (lab) lab.textContent = p.label;
  const panelEl = document.getElementById('visitPanel');
  if (panelEl) panelEl.className = p.cls;
  const as = V.mode && phase !== 'idle' && phase !== 'resting' ? ' as ' + MODES[V.mode].label : '';
  const s = document.getElementById('vpStatus'); if (s) s.textContent = p.status + as + (extra ? ', ' + extra : '');
}

export const NO_GROUND = '\u0000no-ground';
const PAGE_ID = Math.random().toString(36).slice(2);   // the relay serves one live page; an older tab stands down
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Only a page served from this machine ever looks for the relay. The public site never probes the local network.
const LOCAL = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

async function post(path, body) {
  const r = await fetch(RELAY + path + (path.includes('?') ? '&' : '?') + 'page=' + PAGE_ID,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  if (r.status === 409) retire();
  return r.ok ? r.json() : null;
}

function retire() { if (!V.retired) { V.retired = true; paint('resting'); } }

function worldKey() { return 's' + _seed + '-' + W + 'x' + H; }

// hooks: { draw, screenToTile, canvas, getSpeed, setSpeed, onGodMark }
export function bootVisit(hooks) {
  if (!LOCAL) return;
  V = { st: newVisitState(), key: null, here: false, phase: 'idle', said: null, retired: false, points: [], speedBefore: null, mode: null };
  V.hooks = hooks;
  (async function start() {
    // The dev server starts the relay alongside itself, so give it a moment. No relay: the game is just the game.
    let ok = false;
    for (let k = 0; k < 8 && !ok; k++) {
      try { ok = (await fetch(RELAY + '/page/hello?page=' + PAGE_ID)).ok; } catch { await sleep(1000); }
    }
    if (!ok) return;
    panel();
    const summon = (mode, model) => {
      V.mode = mode;
      logLine('s', 'Calling Root as ' + MODES[mode].label + ' (' + model + ').');
      post('/page/summon', { model, mode }).then(r => {
        if (r && r.started) { V.departed = false; paint('coming'); showPanel(); }
        else logLine('s', r ? 'Root is already here or on the way.' : 'The relay did not answer.');
      }).catch(() => logLine('s', 'The relay is not running.'));
    };
    const card = launchCard((mode, model, setting, seed) => {
      // The game mode needs a board under both players: build one first if the page has none, then call Root.
      if (MODES[mode].board && hooks.ketchem) {
        const K = hooks.ketchem.board();
        if (!K) {
          showPanel(); logLine('s', 'Building a ' + setting + ' board first.');
          hooks.ketchem.start(setting, seed, ok => { if (ok) summon(mode, model); else logLine('s', 'The board did not build.'); });
          return;
        }
        logLine('s', 'Using the board already up (' + K.setting + ' ' + K.seed + '); reset the world for a different one.');
      }
      summon(mode, model);
    });
    const btn = callButton(() => {
      if (V.phase === 'idle') {
        card.toggle(btn);
      } else if (V.phase === 'coming' || V.phase === 'here') {
        card.close();
        post('/page/home').then(() => { paint('leaving'); logLine('s', 'You ask Root to head home.'); }).catch(() => {});
      }
    });
    paint('idle');
    wireInput(hooks);
    watchStatus();
    pump(hooks);
  })();
}

function showPanel() { const p = document.getElementById('visitPanel'); if (p) p.hidden = false; }

function wireInput(hooks) {
  document.getElementById('vpForm').addEventListener('submit', e => {
    e.preventDefault();
    const inp = document.getElementById('vpInput'), text = inp.value.trim();
    if (!text) return;
    inp.value = ''; logLine('k', 'You: ' + text);
    post('/page/kevin', { text: 'Kevin: "' + text + '"' }).catch(() => logLine('s', 'The relay is not running.'));
  });
  // Shift+click points while Root is here. Capture phase on window so the Hand (and the double-click zoom reset)
  // never see it. The point is worded when Root next hears it, from where Root stands THEN.
  ['pointerdown', 'mousedown', 'click', 'dblclick'].forEach(type => window.addEventListener(type, ev => {
    if (!ev.shiftKey || ev.target !== hooks.canvas || !V.here) return;
    ev.stopImmediatePropagation(); ev.preventDefault();
    if (type !== 'click') return;
    const t = hooks.screenToTile(ev.clientX, ev.clientY);
    if (!inb(t.x, t.y)) return;
    logLine('k', 'You point at (' + t.x + ',' + t.y + ').');
    V.points.push({ x: t.x, y: t.y, t: Date.now() });
    post('/page/kevin', { wake: true }).catch(() => {});
  }, true));
}

// The relay knows whether Root's session is starting, inside, or gone; the page follows it.
async function watchStatus() {
  for (;;) {
    await sleep(2000);
    if (V.retired) return;
    let s;
    try { s = await (await fetch(RELAY + '/page/status?page=' + PAGE_ID)).json(); } catch { continue; }
    if (!s.mine) { retire(); return; }
    if (V.here && !s.present) depart('Root has gone.');            // the session ended without leaving
    if (s.mode && s.running) V.mode = modeOf(s.mode);               // a session another tab started: follow its mode
    tally(s.tokens || 0);
    if (s.present && s.leaving) paint('leaving');
    else if (s.present) paint('here', s.left != null ? s.left + ' min left' : '');
    else if (s.running) paint(V.departed ? 'leaving' : 'coming');   // after leave, the session takes a moment to close
    else {
      if (V.phase === 'coming' && !V.departed) logLine('s', 'Root could not come through. The session transcript is in ~/root/visits.');
      paint('idle');
    }
  }
}

// The sky's st.x/st.y is a gaze, not a body: the saved position stays where the body last stood, so the next
// visitor does not wake on whatever tile the sky last looked at.
async function saveState() {
  if (V.retired || !V.key) return false;
  const pos = V.mode === 'sky' && V.body ? V.body : {};
  try { return !!(await post('/page/state?key=' + V.key, { ...V.st, ...pos, lastTick: tick })); } catch { return false; }
}

// Root's memory of one world (seed + size). A world run again from the same seed keeps the names Root gave its
// ground, but its plantings and footsteps belonged to the earlier run.
async function loadState(key) {
  let saved = null;
  try { const r = await fetch(RELAY + '/page/state?key=' + key); if (r.ok) saved = await r.json(); } catch { /* fresh */ }
  return adoptWorldState(saved, tick);
}

function standOnGround() {
  const st = V.st;
  if (inb(st.x, st.y) && !blockedAt(st.x, st.y)) return true;
  const t = inb(st.x, st.y) ? arrivalTile(st.x, st.y) : arrivalTile(W >> 1, H >> 1, true);
  if (!t) return false;
  st.x = t.x; st.y = t.y;
  return true;
}

async function arriveHere(mode) {
  V.mode = modeOf(mode);
  // The world itself must exist before anything is loaded under its key: a page still building its first world has no
  // grid yet (a survey of nothing threw on the first real Sky rehearsal), and its seed is not yet the world's.
  for (let k = 0; k < 160 && !grid; k++) { if (k === 0) logLine('s', 'Root is waiting for the world to form.'); await sleep(500); }
  if (!grid) return null;
  V.key = worldKey();
  const loaded = await loadState(V.key);
  V.st = loaded.st;
  V.st.plantsThisVisit = 0;
  if (V.mode === 'ketchem') {
    // The board must exist (the launch card builds one first); Root takes its own doorstep, the second start.
    const board = () => V.hooks.ketchem && V.hooks.ketchem.board();
    for (let k = 0; k < 160 && !board(); k++) { if (k === 0) logLine('s', 'Root is waiting for the board.'); await sleep(500); }
    const K = board();
    if (!K) return null;
    if (worldKey() !== V.key) { V.key = worldKey(); V.st = (await loadState(V.key)).st; V.st.plantsThisVisit = 0; }   // the board that landed is the world now
    const mine = K.starts[1], other = K.starts[0];
    V.st.x = mine.x; V.st.y = mine.y; V.st.boat = false;
    revealSquare(K, mine.x, mine.y, SIGHT_HALF);
    K.root = { x: mine.x, y: mine.y, boat: false };
    const post = K.signposts.find(p => p.x === mine.x && p.y === mine.y);
    V.here = true;
    V.speedBefore = null;   // the game runs in real time for both players: no visit slowdown
    paint('here'); showPanel();
    logLine('s', 'Root steps onto the doorstep of ' + K.stores[mine.store].name + '.');
    await saveState();
    return 'You stand on the doorstep of ' + K.stores[mine.store].name + '. Signpost: ' + ((post && post.text) || 'no stores this way') +
      '. Kevin starts at ' + K.stores[other.store].name + ', ' + bearingTo(mine.x, mine.y, other.x, other.y) + ' from here, beyond the fog.' +
      (arrivalText(V.st, V.mode) ? '\n' + arrivalText(V.st, V.mode) : '');
  }
  if (V.mode === 'sky') {
    V.body = inb(V.st.x, V.st.y) ? { x: V.st.x, y: V.st.y } : null;   // where the body last stood, kept for the next visitor
    V.st.x = W >> 1; V.st.y = H >> 1;    // the sky's gaze starts at the centre; it has no feet to find ground for
  } else {
    // A world still rising from the sea: wait for ground (the relay gives arrival 90 seconds).
    for (let k = 0; k < 160 && !standOnGround(); k++) { if (k === 0) logLine('s', 'Root is waiting for ground to rise.'); await sleep(500); }
    if (!standOnGround()) return null;
  }
  V.here = true;
  V.speedBefore = V.hooks.getSpeed();
  V.hooks.setSpeed(Math.min(V.speedBefore, VISIT_SPEED));
  paint('here'); showPanel();
  logLine('s', V.mode === 'sky' ? 'Root opens the sky.' : 'Root steps through the door' + (V.mode === 'shaper' ? ' with the Hand.' : '.'));
  await saveState();
  return (loaded.restarted ? 'You have been in this world before, but it has started over since. The names you gave its ground remain.\n' : '') +
    arrivalText(V.st, V.mode);
}

function depart(line) {
  if (!V.here) return;
  V.here = false; V.departed = true;
  V.st.leftTick = tick;
  const K = V.hooks.ketchem && V.hooks.ketchem.board();
  if (K) { K.root = null; if (K.cam === 'root') K.cam = 'kevin'; }   // no stale boat or camera on an empty doorstep
  if (V.speedBefore != null) { V.hooks.setSpeed(V.speedBefore); V.speedBefore = null; }
  logLine('s', line + (V.tokens ? ' (' + fmtTokens(V.tokens) + ' tokens so far)' : ''));
  V.hooks.draw();
  return saveState();
}

// The visit's cost, quietly: a faint running count in the panel head, and one log line per million tokens.
function fmtTokens(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n); }
function tally(n) {
  if (n < V.tokens) V.million = 0;       // a new session started counting from zero
  V.tokens = n;
  const el = document.getElementById('vpTok'); if (el) el.textContent = n ? fmtTokens(n) + ' tokens' : '';
  const m = Math.floor(n / 1e6);
  if (m > (V.million || 0)) { V.million = m; logLine('s', m + 'M tokens so far'); }
}

// Called by the page loop after every sim step while the game runs.
export function visitTick() {
  if (!V || !V.here || V.mode === 'sky') return;   // a friend follows a body, never the sky's gaze
  if (companionTick(V.st) === 'gone') { V.friendNews = '"' + V.st.companion.name + '" is gone (t' + tick + ')'; logLine('s', 'Root\'s friend ' + V.st.companion.name + ' is gone.'); saveState(); }
}

function friendNews() {
  if (!V.friendNews) return '';
  const n = '\n' + V.friendNews; V.friendNews = null; return n;
}

function heardPoints() {
  if (!V.points.length) return '';
  const now = Date.now();
  const lines = V.points.map(p => {
    const s = Math.round((now - p.t) / 1000);
    return pointText(V.st, p.x, p.y, V.mode) + (s >= 20 ? ' (' + (s < 90 ? s + ' seconds' : Math.round(s / 60) + ' minutes') + ' ago)' : '');
  });
  V.points = [];
  return '\n' + lines.join('\n');
}

async function pump(hooks) {
  setInterval(() => { if (V.here) saveState(); }, 60000);
  while (!V.retired) {
    let act;
    try {
      const r = await fetch(RELAY + '/page/poll?page=' + PAGE_ID);
      if (r.status === 409) { retire(); return; }
      if (!r.ok) throw new Error('relay ' + r.status);
      act = await r.json();
    } catch { await sleep(3000); continue; }
    if (!act || !act.id) continue;
    const a = act.args || {};
    let text, sighted = null;
    try {
      if (act.verb === 'arrive') {
        text = await arriveHere(a.mode);
        if (text === null) text = NO_GROUND;   // the relay turns this into "the world is not ready" and stays outside
      } else {
        let prefix = '';
        if (V.here && worldKey() !== V.key) {   // Kevin started a new world while Root stood in the old one
          await saveState();
          V.key = worldKey();
          const loaded = await loadState(V.key);
          V.st = Object.assign(loaded.st, { plantsThisVisit: V.st.plantsThisVisit });
          prefix = 'the world dissolves and re-forms: a different world\n';
        }
        const sky = V.mode === 'sky', game = V.mode === 'ketchem', body = !sky;
        const K = game && V.hooks.ketchem ? V.hooks.ketchem.board() : null;
        if (body && (!game || !K)) standOnGround();   // a Ketch'em body may be at sea in its boat; with the board gone it is a visitor again
        if (game && !K) prefix += 'the board is gone (the world was reset); you are a visitor here until a new board is built\n';
        const st = V.st;
        if (K) K.root = { x: st.x, y: st.y, boat: !!st.boat };
        // What a look is depends on the mode: a body sees its square, the sky sees the whole world coarsely.
        const look = () => (sky ? survey(st) : perceive(st, K)) + heardPoints() + friendNews();
        // A power's target: the sky names a tile, a body a bearing in sight (or where it stands).
        const target = () => sky ? tileArg(a) : tileAtBearing(st, a.at);
        // A body's power returns a look (it stands inside the change); the sky's returns the words alone.
        const did = fn => {
          const t = target();
          if (t.error) return t.error;
          const r = fn(t.x, t.y, t.where);
          logLine('s', 'Root: ' + r + '.');
          if (V.hooks.onGodMark) V.hooks.onGodMark();
          if (body) { standOnGround(); return r + '\n\n' + look(); }
          return r + heardPoints();
        };
        switch (act.verb) {
          case 'look': case 'survey': text = look(); sighted = sky ? null : sightings(st); break;
          case 'zoom': text = gazeAt(st, a.x, a.y) + heardPoints(); sighted = sightings(st); break;
          case 'walk':
            text = (K ? (a.path ? routeWalk(K, st, a.path) : legWalk(K, st, a.direction, a.steps)) : (a.path ? walkPath(st, a.path) : walkFrom(st, a.direction, a.steps)));
            if (K) K.root = { x: st.x, y: st.y, boat: !!st.boat };
            text += '\n\n' + perceive(st, K) + heardPoints() + friendNews(); sighted = sightings(st); break;
          case 'befriend': text = befriend(st, a.name); logLine('s', text.startsWith('befriended') ? 'Root ' + text + '.' : 'Root reaches for a friend: ' + text); await saveState(); break;
          case 'plant': text = plantAt(st); await saveState(); text += heardPoints(); break;
          case 'name_place': {
            const t = sky ? target() : { x: st.x, y: st.y };
            text = t.error || namePlace(st, a.name, t.x, t.y);
            if (!t.error) { logLine('s', 'Root named a place: ' + String(a.name || '')); await saveState(); }
            text += heardPoints(); break;
          }
          case 'shape': text = did((x, y, where) => shapeAt(x, y, a.power, a.radius, sky ? SKY_RADIUS_MAX : SHAPER_RADIUS_MAX, where)); await saveState(); break;
          case 'ember': text = did(emberAt); await saveState(); break;
          case 'spring': text = did(springAt); break;
          case 'seed': text = did(seedAt); break;
          case 'weather': text = weatherEvent(a.event); logLine('s', 'Root: ' + text + '.'); V.hooks.onGodMark && V.hooks.onGodMark(); text += heardPoints(); break;
          case 'sea': text = seaEvent(a.direction); logLine('s', 'Root: ' + text + '.'); V.hooks.onGodMark && V.hooks.onGodMark(); text += heardPoints(); break;
          case 'say': V.said = { text: String(a.text || ''), until: Date.now() + 15000 };
            logLine('r', 'Root: ' + String(a.text || '')); text = 'said' + heardPoints(); break;
          case 'leave': text = (await depart(sky ? 'Root closes the sky.' : 'Root leaves through the door.')) ? 'What you left in this world is kept.' : 'You leave.'; break;
          default: text = 'nothing happens ("' + act.verb + '" is not a thing you can do)';
        }
        text = prefix + text;
      }
    } catch (e) {
      // A failure in one action must never stop the loop, or every later call stalls until it times out.
      text = 'Something in the world went wrong (' + (e && e.message || e) + '). You are unharmed; try again.';
      logLine('s', 'Error handling ' + act.verb + ': ' + (e && e.message || e));
    }
    hooks.draw();
    await post('/page/result', { id: act.id, text, sighted, world: V.key, tick }).catch(() => {});
  }
}
