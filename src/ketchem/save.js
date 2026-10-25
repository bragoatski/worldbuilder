// Ketch'em saves (mechanics sec. 18): the whole game as one JSON record, version 1. The pure part (buildSave /
// applySave / export / import / migrations) is DOM-free and gate-tested; the IndexedDB slot store below runs only
// in a browser. The page mirrors every save to the relay (visit.js mirrorSave), which keeps ~/root/ketchem/slots.
import { CFG, DEFAULT_CFG, T, W, H, _seed, tick, grid, road, volcActive, volcAge, volcLife, volcanoRing, peakVolcano, volcanoCenters, coastTTL,
  ringDone, adjCooldown, hillDecayCount, biomeStability, biomeDesiredNext, reclassTerrain, buildSnapshot, applySnapshot } from '../sim.js';
import { newPlayer } from './controls.js';

export const SAVE_VERSION = 1;
// Migrations run in order from the file's version up to SAVE_VERSION: [{ to, up(data) }].
export const MIGRATIONS = [];

// Typed bytes as base64 (binary string in chunks: a 96x96 fog is 1,152 bytes, a road layer 9,216).
export function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); }
export function unb64(str) { const s = atob(str || ''), u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); return u8; }

// West-coast local time with an explicit offset (global rule: display local, compute UTC).
export function stamp(d = new Date()) {
  const off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-', a = Math.abs(off), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + sign + p(a / 60 | 0) + ':' + p(a % 60);
}

export function worldKey() { return 's' + _seed + '-' + W + 'x' + H; }

function activeVents() { const out = []; for (let i = 0; i < W * H; i++) if (volcActive[i]) out.push({ i, age: volcAge[i], life: volcLife[i] }); return out; }
function cfgDiff() { const d = {}; for (const k of Object.keys(DEFAULT_CFG)) if (CFG[k] !== DEFAULT_CFG[k]) d[k] = CFG[k]; return d; }
function playerRecord(id, p) {
  return { id, x: p.x, y: p.y, boat: !!p.boat, wallet: p.wallet || 0, stones: p.stones || { amber: 10, geode: 0, obsidian: 0 },
    pack: p.pack || [], party: p.party || [], follower: p.follower || null, effects: p.effects || [], knockedDown: p.knockedDown || null };
}

// The whole game in memory. slot = the record's name (the player's, default the seed).
export function buildSave(K, slot) {
  const now = stamp();
  if (!K.created) K.created = now;   // the game's birth sticks to the board, so every later record agrees
  return {
    version: SAVE_VERSION,
    meta: { slot: String(slot || K.seed), seed: K.seed, setting: K.setting, size: [W, H], created: K.created || now, lastSaved: now,
      ticksPlayed: tick - (K.tick0 || 0), worldKey: worldKey() },
    sim: buildSnapshot(),
    cfg: cfgDiff(),                        // the setting's knobs and the frozen land cap: buildSnapshot carries only the climate keys
    board: { target: K.target, land: K.land, ticks: K.ticks, origins: K.origins, springs: K.springs, rerolls: K.rerolls, links: K.links, spurs: K.spurs, repicks: K.repicks },
    road: b64(road),
    fog: b64(K.fog),
    vents: activeVents(),                  // the sim's JSON format forgets active volcanoes; a board's origins may still be live
    rings: b64(volcanoRing), peaks: b64(peakVolcano), centers: volcanoCenters.slice(),   // the cones: forgotten by the JSON format too, and they decide the biome of every ring tile
    coast: b64(new Uint8Array(coastTTL.buffer, coastTTL.byteOffset, coastTTL.byteLength)),   // shore tiles still turning to land (Int16 as bytes)
    genesis: { ringDone: b64(ringDone), adjCooldown: b64(new Uint8Array(adjCooldown.buffer, adjCooldown.byteOffset, adjCooldown.byteLength)),   // the terrain passes' bookkeeping, so the first tick after a load is the tick the world would have had
      hillDecay: b64(hillDecayCount), stability: b64(biomeStability), desired: b64(biomeDesiredNext) },
    stores: K.stores.map(s => ({ x: s.x, y: s.y, i: s.i, q: s.q, name: s.name, door: s.door, revealed: !!s.revealed, stock: s.stock || { amber: 0, geode: 0, obsidian: 0, potions: {} }, restockAt: s.restockAt || 0, held: s.held || [] })),
    signposts: K.signposts, landmarks: K.landmarks, starts: K.starts,
    cabinet: K.cabinet || [],
    players: [playerRecord('kevin', K.kevin || newPlayer(K.starts[0].x, K.starts[0].y))].concat(K.root ? [playerRecord('root', K.root)] : []),
    almanac: K.almanac || { species: {}, places: { stores: [], landmarks: [] } },
    baits: K.baits || [], encounters: K.encounters || {}, pulses: K.pulses || {},
  };
}

export function migrate(data) {
  if (!data || typeof data !== 'object' || !Number.isInteger(data.version)) throw new Error('not a Ketch\'em save');
  if (data.version > SAVE_VERSION) throw new Error('this save was made by a newer version of the game (save v' + data.version + ', game v' + SAVE_VERSION + ')');
  for (const m of MIGRATIONS) if (data.version < m.to) { data = m.up(data); data.version = m.to; }
  return data;
}

// Load a save into the sim and return the board K for the page. The species key and rarity are recomputed by the
// sim and the looks; fled creatures come back calm (the encounter state is not restored). Throws on a bad or newer file.
// Everything that could throw is decoded and checked here, before the live world is touched, so a damaged file
// leaves the tab's game as it was.
function decode(data) {
  if (!data.sim || !data.sim.meta || !data.meta || !Array.isArray(data.stores) || !data.fog || !Array.isArray(data.starts) || !data.starts[0]) throw new Error('the save is missing its world');
  const n = data.sim.meta.W * data.sim.meta.H;
  if (!(n > 0) || !Array.isArray(data.meta.size)) throw new Error('the save has no world size');
  const bytes = (s, want, what) => { const u = unb64(s); if (u.length !== want) throw new Error('the save\'s ' + what + ' does not fit its world'); return u; };
  const g = data.genesis || {};
  return {
    road: bytes(data.road, n, 'road layer'), fog: bytes(data.fog, (n + 7) >> 3, 'fog'),
    rings: data.rings ? bytes(data.rings, n, 'volcano rings') : null, peaks: data.peaks ? bytes(data.peaks, n, 'volcano peaks') : null,
    coast: data.coast ? bytes(data.coast, 2 * n, 'shore timers') : null,
    ringDone: g.ringDone ? bytes(g.ringDone, n, 'genesis bookkeeping') : null, adjCooldown: g.adjCooldown ? bytes(g.adjCooldown, 2 * n, 'genesis bookkeeping') : null,
    hillDecay: g.hillDecay ? bytes(g.hillDecay, n, 'genesis bookkeeping') : null, stability: g.stability ? bytes(g.stability, n, 'genesis bookkeeping') : null, desired: g.desired ? bytes(g.desired, n, 'genesis bookkeeping') : null,
  };
}

export function applySave(raw) {
  const data = migrate(raw);
  const d = decode(data);
  Object.assign(CFG, DEFAULT_CFG, data.cfg || {});
  applySnapshot(data.sim);
  road.set(d.road);
  if (d.ringDone) { ringDone.set(d.ringDone); adjCooldown.set(new Uint16Array(d.adjCooldown.buffer, d.adjCooldown.byteOffset, W * H)); hillDecayCount.set(d.hillDecay); biomeStability.set(d.stability); biomeDesiredNext.set(d.desired); }
  for (const v of data.vents || []) if (v.i >= 0 && v.i < W * H) { volcActive[v.i] = 1; volcAge[v.i] = v.age | 0; volcLife[v.i] = v.life | 0; }
  if (d.rings) { volcanoRing.set(d.rings); peakVolcano.set(d.peaks); volcanoCenters.length = 0; for (const c of data.centers || []) volcanoCenters.push(c); }
  if (d.coast) {
    const b = d.coast; coastTTL.set(new Int16Array(b.buffer, b.byteOffset, b.byteLength >> 1));
    // applySnapshot reclassified with the timers at zero, turning every shore tile into land; put the shore back
    const g0 = data.sim.grid;
    for (let i = 0; i < W * H; i++) if (g0[i] === T.COAST && coastTTL[i] > 0) grid[i] = T.COAST;
  }
  reclassTerrain();   // with the rings and the shore timers back, every tile classifies as it did at save time
  const K = {
    v: 1, setting: String(data.meta.setting), seed: Number(data.meta.seed) || 0, size: data.meta.size[0], slot: String(data.meta.slot || '').replace(/[^\w -]/g, '').replace(/^[^\w]+/, '').slice(0, 64) || null, created: data.meta.created,
    tick0: tick - (data.meta.ticksPlayed || 0),
    target: data.board && data.board.target, land: data.board && data.board.land, ticks: data.board && data.board.ticks,
    origins: data.board && data.board.origins, springs: data.board && data.board.springs, rerolls: data.board && data.board.rerolls,
    links: (data.board && data.board.links) || [], spurs: (data.board && data.board.spurs) || [], repicks: data.board && data.board.repicks,
    stores: data.stores.map(s => ({ ...s })), signposts: data.signposts || [], landmarks: data.landmarks || [], starts: data.starts || [],
    fog: d.fog, cabinet: data.cabinet || [], almanac: data.almanac, baits: data.baits || [], encounters: {}, pulses: data.pulses || {},
    kevin: null, root: null, cam: 'kevin',
  };
  for (const p of data.players || []) {
    const pl = Object.assign(newPlayer(p.x, p.y), { boat: !!p.boat, wallet: p.wallet || 0, stones: p.stones, pack: p.pack, party: p.party, follower: p.follower, effects: p.effects, knockedDown: p.knockedDown });
    if (p.id === 'kevin') K.kevin = pl; else if (p.id === 'root') K.root = { x: p.x, y: p.y, boat: !!p.boat, loaded: true };
  }
  if (!K.kevin && K.starts[0]) K.kevin = newPlayer(K.starts[0].x, K.starts[0].y);
  return K;
}

export function exportSave(data) { return JSON.stringify(data); }
export function importSave(text) { let d; try { d = JSON.parse(text); } catch { throw new Error('not JSON'); } return applySave(d); }

// ---------- the browser's slot store (IndexedDB 'ketchem', store 'slots' keyed by slot name) ----------
const DB = 'ketchem', STORE = 'slots';
function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB here'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'meta.slot' }); };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
function tx(mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    let req;
    try {
      const t = db.transaction(STORE, mode);
      req = fn(t.objectStore(STORE));
      t.oncomplete = () => { db.close(); resolve(req && req.result); };
      t.onerror = () => { db.close(); reject(t.error || new Error('the browser could not write the save')); };
      t.onabort = () => { db.close(); reject(t.error || new Error('the save was aborted (storage full?)')); };
    } catch (e) { db.close(); reject(e); }
  }));
}
export function putSlot(data) { return tx('readwrite', s => s.put(data)); }
export function getSlot(slot) { return tx('readonly', s => s.get(slot)); }
export function deleteSlot(slot) { return tx('readwrite', s => s.delete(slot)); }
export async function listSlots() {
  const all = (await tx('readonly', s => s.getAll())) || [];
  return all.map(d => ({ ...d.meta, players: (d.players || []).map(p => p.id + ':' + (p.wallet || 0)).join(' ') })).sort((a, b) => (a.lastSaved < b.lastSaved ? 1 : -1));
}
