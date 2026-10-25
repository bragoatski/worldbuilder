// Ketch'em encounters (mechanics sec. 6, 7, 8, 9, 11): awareness, baits, throws, the predator's warning and attack,
// followers, stalkers, corrals. A pure core over the sim's arrays and the board K; the page and Root's door call it.
// Randomness draws on K's own stream (kRng), never the sim's, so the ecology stays the tuned one. Every function
// that acts returns { ok, text, ... } with the words Root reads; the page turns the same results into bubbles and
// animations (K.fx). Tick-driven work happens in encounterTick(K), called after every sim step while a board is up.
import { T, grid, riverData, fauna, flora, road, tick, idx, inb, mulberry32, speciesKey } from '../sim.js';
import { levelOf, populationOf, abilitiesOf, oddsOf, elementalType, genomeHash } from './rules.js';
import { groundOf, bearingTo } from './controls.js';

export const ENCOUNTER_RANGE = 6, ENCOUNTER_RESET = 100, ALERT_RANGE = { carnivore: 3, apex: 3 }, ALERT_DEFAULT = 2;
export const ALERT_CLEAR = 50, WARY_TICKS = 200, BOLT_TICKS = 4, FLEE_TICKS = 6, ATTACK_COOLDOWN = 50, HARDY_COOLDOWN = 500;
export const BAIT = {   // sec. 7
  plant:   { takers: ['herbivore', 'omnivore'], range: 4, feed: 20, odds: 'plant' },
  scatter: { takers: ['herbivore'], range: 6, feed: 20, odds: 'plant' },
  meat:    { takers: ['carnivore', 'apex', 'scavenger', 'omnivore'], range: 5, feed: 30, odds: 'meat' },
  stake:   { takers: ['carnivore', 'apex'], range: 5, feed: 30, odds: 'meat' },
};
export const BAIT_ROT = 60, PACK_CAP = 10, PARTY_CAP = 3, THROW_TICKS = 48;
export const STONE_KEY = { Amber: 'amber', Geode: 'geode', Obsidian: 'obsidian' };
const DIRS = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] };

// ---------- state on K ----------
export function initEncounters(K) {
  if (!K.aw) K.aw = {};
  if (!K.baits) K.baits = [];
  if (!K.fx) K.fx = [];
  if (!K.cabinet) K.cabinet = [];
  if (!K.almanac) K.almanac = { species: {}, places: { stores: [], landmarks: [] } };
  if (!K.rng) K.rng = mulberry32(((K.seed | 0) ^ 0x51ED1234 ^ (tick | 0)) >>> 0);
  if (!K.nextId) K.nextId = 1;
}
export function initPlayer(p, id) {
  if (id) p.id = id;
  if (!p.stones) p.stones = { amber: 10, geode: 0, obsidian: 0 };
  if (!p.stone) p.stone = 'Amber';
  if (!p.party) p.party = [];
  if (!p.pack) p.pack = [];
  if (p.follower === undefined) p.follower = null;
  if (p.wallet === undefined) p.wallet = 0;
  if (!p.effects) p.effects = [];
  return p;
}
function aw(K, f) { return K.aw[f.id] || (K.aw[f.id] = { state: 'calm', until: 0, enc: {} }); }
// Players present in the world: Kevin, and Root while it is inside (K.root stays between visits, marked away).
function players(K) { const out = []; if (K.kevin) out.push(['kevin', K.kevin]); if (K.root && K.root.party && !K.root.away) out.push(['root', K.root]); return out; }
function dist(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
function fx(K, kind, o) { K.fx.push({ kind, start: tick, ...o }); K.fxCount = K.fxCount || {}; K.fxCount[kind] = (K.fxCount[kind] || 0) + 1; }
// News for a player from tick-driven events (an attack that came when the pulses ran out): the page shows Kevin's as
// a bubble, Root's ride on its next result.
function news(K, pid, text) { (K.news || (K.news = [])).push({ pid, text, tick }); }
export function drainNews(K, pid) { if (!K.news) return []; const mine = K.news.filter(n => n.pid === pid); K.news = K.news.filter(n => n.pid !== pid); return mine.map(n => n.text); }
// Ground a wild creature can stand on: land that is not steep, not a lake, and not a bridge (a road over water is
// still water for a creature: the sim deletes fauna on an ocean tile).
function walkable(x, y) {
  if (!inb(x, y)) return false;
  const i = idx(x, y), t = grid[i];
  if (t === T.OCEAN || t === T.COAST || t === T.MOUNTAIN || t === T.GLACIER || t === T.VOLCANIC) return false;
  const rd = riverData && riverData[i]; if (rd && rd.lake) return false;
  return groundOf(i).kind !== 'blocked';
}
// The nearest tile a creature can stand on, from (x, y) outward (a player in a boat is over water).
function landNear(x, y) {
  for (let r = 0; r <= 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && walkable(x + dx, y + dy)) return [x + dx, y + dy];
  return null;
}
function ratio(f) { return f.maxEnergy ? f.energy / f.maxEnergy : 0.5; }
export function hungry(f) { return ratio(f) < 0.5; }
export function fed(f) { return ratio(f) >= 0.8; }
export function isPredator(f) { return f.type === 'carnivore' || f.type === 'apex'; }
export function findCreature(id) { return fauna.find(f => f && f.id === id) || null; }

// ---------- what a creature is (level, type, abilities) ----------
export function factsOf(f) {
  const N = populationOf(f, fauna, speciesKey);
  const L = levelOf(f, N);
  return { N, L, type: elementalType(f).typ, abilities: abilitiesOf(f, L).abilities };
}
// The party's abilities, strongest copy of each; a follower counts one strength higher (11.5).
export function partyAbilities(p) {
  const out = {};
  for (const c of p.party || []) {
    const L = levelOf(c, populationOf(c, fauna, speciesKey));
    for (const a of abilitiesOf(c, L).abilities) {
      const s = a.strength + (p.follower === c.id ? 1 : 0);
      if (!out[a.name] || out[a.name] < s) out[a.name] = Math.min(3, s);
    }
  }
  return out;
}
export function isStalker(f, L) { return L >= 7 && genomeHash(f) % 100 < 10; }

// ---------- corral (7, 11.5) ----------
export function corralFor(K, p, f) {
  const dx = f.x - p.x, dy = f.y - p.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return null;
  const ox = f.x + dx, oy = f.y + dy;   // the tile across the creature from the player
  for (const [, q] of players(K)) if (q !== p && q.x === ox && q.y === oy) return 'partner';
  if (p.follower && p.followerAt && p.followerAt.x === ox && p.followerAt.y === oy) return 'follower';
  return null;
}

// ---------- odds as the player sees them (8) ----------
export function oddsFor(K, p, f, stone = p.stone) {
  const a = aw(K, f), ab = partyAbilities(p);
  const bait = a.feeding ? BAIT[a.feeding].odds : null;
  const corral = corralFor(K, p, f);
  let o = oddsOf(stone, factsOf(f).L, { aw: a.baitId ? 'calm' : a.state === 'fled' ? 'wary' : a.state, en: ratio(f), bait, lureIII: ab.Lure === 3, dreadIII: ab.Dread === 3, corral: corral === 'partner' });
  if (corral === 'follower' && o > 0 && o < 100) o = Math.min(99, o + 5);   // never lifts Amber on L10, never touches Obsidian
  return o;
}
export function oddsVisible(K, p, f) { return dist(p, f) <= ((partyAbilities(p).Nose || 0) ? 4 : 2); }

// Root's creature line tail and Kevin's tag: ` L4 Dune fed 55%`, ` growls (3)`, ` feeding`, ` wary`, ` fled`.
export function creatureTag(K, p, f) {
  const a = aw(K, f), facts = factsOf(f);
  let s = ' L' + facts.L + ' ' + facts.type;
  if (a.state === 'growl') s += ' growls (' + (a.pulsesLeft || 0) + ')';
  else if (a.feeding) s += ' feeding';
  else if (a.state !== 'calm') s += ' ' + a.state;
  if (p && a.state !== 'fled' && oddsVisible(K, p, f) && !p.boat) s += ' ' + oddsFor(K, p, f) + '%';
  return s;
}

// ---------- targets ----------
export function targetsNear(K, p, range = 2) {
  return fauna.filter(f => f && dist(p, f) <= range && aw(K, f).state !== 'fled').sort((a, b) => dist(p, a) - dist(p, b));
}

// ---------- plants: pick and the pack ----------
export function pickPlant(K, p) {
  const cap = PACK_CAP + 5 * (partyAbilities(p).Pack || 0);
  if (p.pack.length >= cap) return { ok: false, text: 'pack full (' + cap + ')' };
  const k = flora.findIndex(f => f && f.x === p.x && f.y === p.y);
  if (k < 0) return { ok: false, text: 'no plant here' };
  const plant = flora.splice(k, 1)[0];
  p.pack.push(plant);
  return { ok: true, text: 'picked a plant (' + p.pack.length + '/' + cap + ')' };
}

// ---------- baits (7) ----------
function removeBait(K, b) { K.baits = K.baits.filter(x => x !== b); }
function releaseHold(K, f) { if (f) { f.held = false; const a = aw(K, f); delete a.baitId; delete a.feeding; delete a.feedUntil; } }
function dropBait(K, p, kind, x, y, payload) {
  const b = { id: K.nextId++, x, y, kind, by: p.id, until: tick + BAIT_ROT, creatureId: null, payload };
  K.baits.push(b); fx(K, 'baitDrop', { x, y, len: 6, baitKind: kind, from: { x: p.x, y: p.y } });
  return b;
}
// A creature coming back to its owner: the party if there is room, else the cabinet (shared storage at the stores).
function giveBack(K, p, c) { if (p.party.length < PARTY_CAP) p.party.push(c); else K.cabinet.push(c); }
// One active bait per player: a new one replaces the old (its plants are lost; a staked or set-down creature comes back).
function clearPlayerBaits(K, p) {
  for (const b of K.baits.filter(x => x.by === p.id)) {
    if ((b.kind === 'meat' || b.kind === 'stake') && b.payload) giveBack(K, p, b.payload);
    releaseHold(K, b.creatureId ? findCreature(b.creatureId) : null);
    removeBait(K, b);
  }
}
export function placeBait(K, p, kind, dir, which) {
  if (!BAIT[kind]) return { ok: false, text: 'no such bait (plant, scatter, meat, stake)' };
  if (p.boat) return { ok: false, text: 'no baiting from a boat' };
  const d = dir ? DIRS[String(dir).toUpperCase()] : [0, 0];
  if (!d) return { ok: false, text: 'no direction "' + dir + '"' };
  const x = p.x + d[0], y = p.y + d[1];
  if (!walkable(x, y)) return { ok: false, text: 'nothing can stand there' };
  if (kind === 'plant' || kind === 'scatter') {
    const need = kind === 'scatter' ? 3 : 1;
    if (p.pack.length < need) return { ok: false, text: need === 1 ? 'no plant in the pack' : 'scatter needs three plants' };
    if (kind === 'scatter' && (!d[0] && !d[1])) return { ok: false, text: 'scatter needs a direction' };
    clearPlayerBaits(K, p);
    const tiles = kind === 'plant' ? [[x, y]] : [1, 2, 3].map(k => [p.x + d[0] * k, p.y + d[1] * k]).filter(([tx, ty]) => walkable(tx, ty));
    if (!tiles.length) return { ok: false, text: 'no ground that way' };
    for (const [tx, ty] of tiles) dropBait(K, p, kind, tx, ty, p.pack.shift());
    return { ok: true, text: 'bait set ' + bearingTo(p.x, p.y, x, y) + (kind === 'scatter' ? ' (' + tiles.length + ' plants)' : '') };
  }
  if (!d[0] && !d[1]) return { ok: false, text: kind + ' bait goes on a tile beside you' };
  const k = (p.party || []).findIndex(c => (which && c.name && c.name.toLowerCase() === String(which).toLowerCase()) || (!which && true));
  if (k < 0) return { ok: false, text: which ? 'no "' + which + '" in the party' : 'the party is empty' };
  clearPlayerBaits(K, p);
  const c = p.party.splice(k, 1)[0];
  dropBait(K, p, kind, x, y, c);
  return { ok: true, text: (kind === 'stake' ? 'staked ' : 'set down ') + (c.name || c.type) + ' ' + bearingTo(p.x, p.y, x, y) };
}

function baitTick(K) {
  for (const b of K.baits.slice()) {
    const spec = BAIT[b.kind];
    const feeder = b.creatureId ? findCreature(b.creatureId) : null;
    if (b.creatureId && !feeder) { b.creatureId = null; b.until = tick + BAIT_ROT; }   // the feeder died or was caught
    if (!b.creatureId) {
      if (tick >= b.until) { removeBait(K, b); if ((b.kind === 'meat' || b.kind === 'stake') && b.payload) { const p = playerById(K, b.by); if (p) giveBack(K, p, b.payload); } continue; }
      // who comes: the nearest hungry taker in range that is free
      let best = null, bd = Infinity;
      for (const f of fauna) {
        if (!f || !spec.takers.includes(f.type) || fed(f) || f.held) continue;
        const a = aw(K, f); if (a.state === 'fled' || a.state === 'growl') continue;
        const d = dist(b, f); if (d <= spec.range && d < bd) { bd = d; best = f; }
      }
      if (!best) continue;
      b.creatureId = best.id; best.held = true; const a = aw(K, best); a.baitId = b.id; a.state = 'calm'; a.until = 0;
      fx(K, 'baitWalk', { id: best.id, bait: b.id });
      continue;
    }
    const a = aw(K, feeder);
    if (!a.feeding) {   // walking: 1 tile a tick straight at the bait
      if (feeder.x === b.x && feeder.y === b.y) { a.feeding = b.kind; a.feedUntil = tick + spec.feed; b.until = a.feedUntil; fx(K, 'feeding', { id: feeder.id, len: spec.feed }); continue; }
      const dx = Math.sign(b.x - feeder.x), dy = Math.sign(b.y - feeder.y);
      let moved = false;
      for (const [sx, sy] of [[dx, dy], [dx, 0], [0, dy]]) { if ((sx || sy) && walkable(feeder.x + sx, feeder.y + sy)) { feeder.x += sx; feeder.y += sy; moved = true; break; } }
      if (!moved) { releaseHold(K, feeder); b.creatureId = null; b.until = tick + BAIT_ROT; continue; }   // something in the way: it gives up, the bait waits for another
      if (feeder.x === b.x && feeder.y === b.y) { a.feeding = b.kind; a.feedUntil = tick + spec.feed; b.until = a.feedUntil; fx(K, 'feeding', { id: feeder.id, len: spec.feed }); }   // it starts eating the tick it arrives
      continue;
    }
    feeder.energy = Math.min(feeder.maxEnergy, feeder.energy + feeder.maxEnergy * 0.02);   // it eats
    if (tick >= a.feedUntil) {   // the meal ends
      if (b.kind === 'meat' || b.kind === 'stake') { feeder.energy = Math.min(feeder.maxEnergy, feeder.energy + 40); fx(K, 'eaten', { x: b.x, y: b.y, len: 8 }); }
      releaseHold(K, feeder); removeBait(K, b);
    }
  }
}
function playerById(K, id) { return id === 'kevin' ? K.kevin : K.root; }

// ---------- awareness (6) and the predator's warning (11) ----------
function pulsesFor(L, rng) { return L >= 10 ? 1 : L >= 8 ? 1 + (rng() < 0.5 ? 1 : 0) : L >= 7 ? 2 + (rng() < 0.5 ? 1 : 0) : L >= 6 ? 3 + (rng() < 0.5 ? 1 : 0) : 4 + (rng() < 0.5 ? 1 : 0); }
function stepAway(f, from) {
  const dx = Math.sign(f.x - from.x), dy = Math.sign(f.y - from.y);
  for (const [sx, sy] of [[dx, dy], [dx, 0], [0, dy], [dy, -dx], [-dy, dx]]) { if ((sx || sy) && walkable(f.x + sx, f.y + sy)) { f.x += sx; f.y += sy; return true; } }
  return false;
}
function nearestPlayer(K, f) { let best = null, bd = Infinity; for (const [id, p] of players(K)) { const d = dist(p, f); if (d < bd) { bd = d; best = [id, p, d]; } } return best; }
export function onStore(K, p) { return K.stores.some(s => s.x === p.x && s.y === p.y); }

function awarenessTick(K) {
  const rng = K.rng;
  const abCache = new Map();   // a party's abilities once per tick, not once per creature (the scan is O(fauna) each)
  const abilitiesOfPlayer = p => { if (!abCache.has(p)) abCache.set(p, partyAbilities(p)); return abCache.get(p); };
  for (const f of fauna) {
    if (!f) continue;
    const a = K.aw[f.id];
    const np = nearestPlayer(K, f);
    if (!a && (!np || np[2] > ENCOUNTER_RANGE)) continue;   // far from everyone and never met: nothing to do
    const st = aw(K, f);
    // encounters: one per player within 6 tiles, continuous; 100 ticks beyond 6 resets the fail count
    for (const [id, p] of players(K)) {
      const e = st.enc[id]; const d = dist(p, f);
      if (d <= ENCOUNTER_RANGE) { if (!e) st.enc[id] = { fails: 0, since: tick, last: tick }; else e.last = tick; }
      else if (e && tick - e.last > ENCOUNTER_RESET) delete st.enc[id];
    }
    if (st.state === 'fled') { if (st.flee) { if (st.flee.left-- > 0) { for (let k = 0; k < 2; k++) if (walkable(f.x + st.flee.dx, f.y + st.flee.dy)) { f.x += st.flee.dx; f.y += st.flee.dy; } } else { f.held = false; delete st.flee; } } continue; }
    if (st.bolt) {   // 1 tile a tick straight away from the thrower, or around what is in the way
      if (st.bolt.left-- > 0) {
        if (walkable(f.x + st.bolt.dx, f.y + st.bolt.dy)) { f.x += st.bolt.dx; f.y += st.bolt.dy; } else stepAway(f, st.bolt.from);
        fx(K, 'dust', { x: f.x, y: f.y, len: 4 });
      } else { delete st.bolt; f.held = false; }
      continue;
    }
    if (st.baitId) { st.state = 'calm'; continue; }   // walking to bait or feeding: calm, and the bait moves it (the bait rules say no bolt)
    const near = np ? np[2] : Infinity, p = np ? np[1] : null, pid = np ? np[0] : null;
    const ab = p ? abilitiesOfPlayer(p) : {};
    const facts = (near <= 4 || st.state !== 'calm') ? factsOf(f) : null;
    const alertRange = ALERT_RANGE[f.type] || ALERT_DEFAULT;
    // wary wears off; alert clears after 50 ticks with no player within 3
    if (st.state === 'wary' && tick >= st.until) { st.state = near <= alertRange ? 'alert' : 'calm'; st.until = tick + ALERT_CLEAR; }
    if (st.state === 'calm' && near <= alertRange && !(ab.Stalk >= 1)) { st.state = 'alert'; st.until = tick + ALERT_CLEAR; fx(K, 'alert', { id: f.id, len: 10 }); }
    if (st.state === 'alert' || st.state === 'wary') {   // wary behaves as alert once its bolt is over (sec. 6)
      if (st.state === 'alert') { if (near <= 3) st.until = tick + ALERT_CLEAR; else if (tick >= st.until) { st.state = 'calm'; continue; } }
      if (isPredator(f) && hungry(f) && near <= 1 && !(ab.Dread >= 1) && !onStore(K, p) && tick >= (st.cooldownUntil || 0) && !guarded(f, ab)) {
        st.state = 'growl'; st.target = pid; st.pulsesLeft = pulsesFor(facts.L, rng); st.nextPulse = tick; st.stalker = isStalker(f, facts.L); delete st.pursueUntil;
        f.held = true; fx(K, 'growl', { id: f.id }); continue;   // the first pulse comes this tick: N pulses span 10N ticks (11.2)
      }
      if (!(ab.Dread >= 2) && rng() < 0.30) stepAway(f, p);
      continue;
    }
    if (st.state === 'growl') {
      const tp = playerById(K, st.target) || p, tab = abilitiesOfPlayer(tp); const d = dist(tp, f);
      const fol = followerOf(tp); const backedDown = fol && levelOf(fol, populationOf(fol, fauna, speciesKey)) > facts.L;
      if (!hungry(f) || onStore(K, tp) || (tab.Dread >= 1) || backedDown || guarded(f, tab) || (K.root && tp === K.root && K.root.away)) { st.state = 'alert'; st.until = tick + ALERT_CLEAR; f.held = false; continue; }
      if (d > 3) {   // the player left its reach
        if (st.stalker && (st.pursueUntil || (st.pursueUntil = tick + 60)) > tick) { if ((tick - (st.pursueAt || 0)) >= 16 && stalkerStep(K, f, tp)) st.pursueAt = tick; if (tick >= st.nextPulse) { fx(K, 'pulse', { id: f.id, len: 10 }); st.nextPulse = tick + 10; } continue; }
        st.state = 'alert'; st.until = tick + ALERT_CLEAR; f.held = false; delete st.pursueUntil; continue;
      }
      if (tick >= st.nextPulse) {
        if (st.pulsesLeft > 0) { st.pulsesLeft--; fx(K, 'pulse', { id: f.id, len: 10 }); st.nextPulse = tick + 10; }
        else if (d <= 1) { const r = attack(K, f, tp); news(K, tp.id, r.text); }
        else { if (stepToward(f, tp)) st.nextPulse = tick + 10; else { st.state = 'alert'; st.until = tick + ALERT_CLEAR; f.held = false; } }
      }
      continue;
    }
    // calm: Lure pulls it one tile toward the player every 10 ticks
    if (st.state === 'calm' && ab.Lure && near <= 6 && near > 1 && tick % 10 === 0) stepToward(f, p);
  }
}
function guarded(f, ab) { if (!ab.Guard) return false; if (f.type === 'carnivore') return true; return ab.Guard >= 2 && f.type === 'apex'; }
function followerOf(p) { return p && p.follower ? (p.party || []).find(c => c.id === p.follower) : null; }
function stepToward(f, to) { const dx = Math.sign(to.x - f.x), dy = Math.sign(to.y - f.y); for (const [sx, sy] of [[dx, dy], [dx, 0], [0, dy]]) if ((sx || sy) && walkable(f.x + sx, f.y + sy) && !(to.x === f.x + sx && to.y === f.y + sy)) { f.x += sx; f.y += sy; return true; } return false; }
// A stalker will not step onto a road unless it is already on one, nor into the sea, nor onto a store (11.4).
function stalkerStep(K, f, to) {
  const onRoad = !!road[idx(f.x, f.y)];
  const dx = Math.sign(to.x - f.x), dy = Math.sign(to.y - f.y);
  for (const [sx, sy] of [[dx, dy], [dx, 0], [0, dy]]) {
    const x = f.x + sx, y = f.y + sy;
    if (!(sx || sy) || !walkable(x, y) || (road[idx(x, y)] && !onRoad) || K.stores.some(s => s.x === x && s.y === y)) continue;
    if (to.x === x && to.y === y) return true;
    f.x = x; f.y = y; return true;
  }
  return false;
}

// ---------- the attack (11.6) ----------
export function attack(K, f, p) {
  const st = aw(K, f), facts = factsOf(f), ab = partyAbilities(p);
  st.state = 'alert'; st.until = tick + ALERT_CLEAR; st.cooldownUntil = tick + ATTACK_COOLDOWN; f.held = false;
  if (ab.Hardy && tick >= (p.hardyAt || 0)) { p.hardyAt = tick + HARDY_COOLDOWN; fx(K, 'hardy', { x: p.x, y: p.y, len: 8 }); return { ok: true, text: (f.type) + ' attacks: Hardy absorbs it', taken: null }; }
  fx(K, 'attack', { id: f.id, x: p.x, y: p.y, len: 12 });
  const fol = followerOf(p);
  const level = c => levelOf(c, populationOf(c, fauna, speciesKey));
  let victim = null;
  if (fol && level(fol) < facts.L) victim = fol;
  else { const grazers = p.party.filter(c => c.type === 'herbivore').sort((a, b) => level(a) - level(b)); if (grazers.length) victim = grazers[0]; }
  if (victim) {
    p.party = p.party.filter(c => c !== victim); if (p.follower === victim.id) p.follower = null;
    f.energy = Math.min(f.maxEnergy, f.energy + 40);
    return { ok: true, text: f.type + ' attacks: "' + (victim.name || victim.type) + '" is taken', taken: victim };
  }
  // knocked down: half the wallet, everything else carried is lost; the animals go wild where it happened (on the
  // nearest ground a creature can stand on: the player may be in a boat)
  const lost = Math.ceil(p.wallet / 2); p.wallet = Math.floor(p.wallet / 2);
  const spot = landNear(p.x, p.y) || [f.x, f.y];
  for (const c of p.party) { c.held = false; c.x = spot[0]; c.y = spot[1]; fauna.push(c); const a = aw(K, c); a.state = 'wary'; a.until = tick + WARY_TICKS; }
  for (const pl of p.pack) { pl.x = spot[0]; pl.y = spot[1]; flora.push(pl); }
  p.party = []; p.pack = []; p.follower = null; p.followerAt = null; p.stones = { amber: 0, geode: 0, obsidian: 0 };
  const s = nearestStore(K, p.x, p.y);
  fx(K, 'knockdown', { x: p.x, y: p.y, len: 6, lost });
  p.x = s.door.x; p.y = s.door.y; p.boat = false; p.knockedDown = { at: tick, store: s.name, moved: true };   // moved: the page (Root's visit state) must follow
  return { ok: true, text: f.type + ' attacks: you wake at ' + s.name + ', ' + lost + ' coins lost, the pack and the party gone (the animals are wild again where it happened)', taken: null, knockedDown: true };
}
export function nearestStore(K, x, y) { let best = null, bd = Infinity; for (const s of K.stores) { const d = Math.max(Math.abs(s.x - x), Math.abs(s.y - y)); if (d < bd) { bd = d; best = s; } } return best; }

// ---------- the throw (8, 9) ----------
export function throwStone(K, p, f, stone = p.stone) {
  if (!f) return { ok: false, text: 'no target' };
  const key = STONE_KEY[stone]; if (!key) return { ok: false, text: 'no such stone' };
  if (!(p.stones[key] > 0)) return { ok: false, text: 'no ' + stone + ' left' };
  if (p.boat) return { ok: false, text: 'no throws from a boat' };
  if (dist(p, f) > 1) return { ok: false, text: f.type + ' is not adjacent' };
  if (groundOf(idx(f.x, f.y)).kind === 'water') return { ok: false, text: 'it is in the water' };
  const st = aw(K, f);
  if (st.state === 'fled') return { ok: false, text: 'it has fled' };
  const odds = oddsFor(K, p, f, stone), facts = factsOf(f);
  p.stones[key]--;
  const roll = Math.floor(K.rng() * 100) + 1;   // 1..100; caught when roll <= odds
  const caught = roll <= odds;
  const wobbles = caught ? 3 : (odds - roll <= 15 && roll - odds <= 15 ? 3 : 1 + (K.rng() < 0.5 ? 1 : 0));
  fx(K, 'throw', { from: { x: p.x, y: p.y }, to: { x: f.x, y: f.y }, len: THROW_TICKS, wobbles, caught, stone });
  const enc = st.enc[p.id] || (st.enc[p.id] = { fails: 0, since: tick, last: tick });
  if (caught) {
    const k = fauna.indexOf(f); if (k >= 0) fauna.splice(k, 1);
    f.held = false; f.caughtAt = tick; f.by = p.id;
    // a staked creature is recovered if its hunter is the one caught; a set-down one too (the meal never ended)
    for (const b of K.baits.filter(b => b.creatureId === f.id && (b.kind === 'stake' || b.kind === 'meat'))) { if (b.payload) { const owner = playerById(K, b.by); if (owner) giveBack(K, owner, b.payload); } removeBait(K, b); }
    delete K.aw[f.id];
    for (const b of K.baits.filter(b => b.creatureId === f.id)) { b.creatureId = null; b.until = tick + BAIT_ROT; }   // a plant bait it was eating waits for another
    const where = p.party.length < PARTY_CAP ? 'party' : 'cabinet';
    if (where === 'party') p.party.push(f); else K.cabinet.push(f);
    p.naming = f.id;
    const entry = almanacEntry(K, f); entry.caught++; entry.bestLevel = Math.max(entry.bestLevel, facts.L);
    return { ok: true, caught: true, text: 'caught ' + f.type + ' L' + facts.L + ' ' + facts.type + ' (' + where + '). name it', odds, roll, wobbles, where, creature: f, delay: THROW_TICKS };
  }
  enc.fails++;
  const dx = Math.sign(f.x - p.x), dy = Math.sign(f.y - p.y);
  let eaten = '';
  if (st.baitId) {   // a failed throw on a feeding creature: a plant bait is freed; a set-down or staked creature is eaten now (sec. 7)
    for (const b of K.baits.filter(b => b.creatureId === f.id)) {
      if ((b.kind === 'meat' || b.kind === 'stake') && b.payload) { f.energy = Math.min(f.maxEnergy, f.energy + 40); eaten = '; "' + (b.payload.name || b.payload.type) + '" is eaten'; fx(K, 'eaten', { x: b.x, y: b.y, len: 8 }); removeBait(K, b); }
      else { b.creatureId = null; b.until = tick + BAIT_ROT; }
    }
    releaseHold(K, f);
  }
  if (enc.fails >= 3) {
    st.state = 'fled'; st.flee = { dx: dx || (K.rng() < 0.5 ? 1 : -1), dy: dy || (K.rng() < 0.5 ? 1 : -1), left: FLEE_TICKS }; f.held = true;
    return { ok: true, caught: false, text: 'broke free' + eaten + '; ' + f.type + ' flees out of sight (three failed throws)', odds, roll, wobbles, delay: THROW_TICKS };
  }
  const pab = partyAbilities(p);
  const hungryPredator = isPredator(f) && hungry(f) && !(pab.Dread >= 1) && !onStore(K, p) && !guarded(f, pab) && tick >= (st.cooldownUntil || 0);   // "at once", but one strike per 50 ticks (11.6)
  if (hungryPredator) { const r = attack(K, f, p); return { ok: true, caught: false, text: 'broke free' + eaten + '; ' + r.text, odds, roll, wobbles, attack: r, delay: THROW_TICKS }; }
  st.state = 'wary'; st.until = tick + (pab.Stalk >= 2 ? WARY_TICKS / 2 : WARY_TICKS);
  st.bolt = { dx: dx || 0, dy: dy || 0, left: BOLT_TICKS, from: { x: p.x, y: p.y } }; f.held = true;
  return { ok: true, caught: false, text: 'broke free' + eaten + '; ' + f.type + ' bolts ' + (bearingTo(f.x, f.y, f.x + dx * 3, f.y + dy * 3) || 'away') + ', wary', odds, roll, wobbles, delay: THROW_TICKS };
}

// ---------- names and the Almanac (9 step 6, 18) ----------
export function almanacEntry(K, f) {
  const key = speciesKey(f);
  return K.almanac.species[key] || (K.almanac.species[key] = { seen: 0, caught: 0, bestLevel: 0, nickname: null, namedBy: null, firstSeen: { tick, x: f.x, y: f.y }, type: f.type });
}
export function noteSeen(K, f) { const e = almanacEntry(K, f); e.seen++; return e; }
const NAME_OK = /^[A-Za-z0-9' ]+$/;
export function nameCatch(K, p, raw, speciesNick) {
  const name = String(raw || '').trim().slice(0, 24);
  if (!name || !NAME_OK.test(name)) return { ok: false, text: 'a name is letters, digits, spaces and apostrophes, up to 24' };
  const c = p.naming ? (p.party.find(x => x.id === p.naming) || K.cabinet.find(x => x.id === p.naming)) : null;
  if (!c) return { ok: false, text: 'nothing to name' };
  c.name = name; p.naming = null;
  const e = almanacEntry(K, c);
  let text = '"' + name + '" it is';
  if (speciesNick) { const n = String(speciesNick).trim().slice(0, 16); if (NAME_OK.test(n)) { e.nickname = n; e.namedBy = p.id; text += '; the species is "' + n + '"'; } }
  else if (!e.nickname) text += ' (the species has no nickname yet: name <name> <species nickname>)';
  return { ok: true, text, creature: c };
}

// ---------- followers (11.5) ----------
export function follow(K, p, which) {
  const c = p.party.find(x => (x.name || '').toLowerCase() === String(which || '').toLowerCase()) || (which ? null : p.party[0]);
  if (!c) return { ok: false, text: which ? 'no "' + which + '" in the party' : 'the party is empty' };
  p.follower = c.id; p.followerAt = { x: p.x, y: p.y };
  return { ok: true, text: '"' + (c.name || c.type) + '" follows' };
}
export function recall(K, p) {
  if (!p.follower) return { ok: false, text: 'no follower out' };
  const c = followerOf(p); p.follower = null; p.followerAt = null;
  return { ok: true, text: '"' + (c ? c.name || c.type : 'it') + '" is back in its stone' };
}
function followerTick(K) {
  for (const [, p] of players(K)) {
    if (!p.follower) continue;
    if (!followerOf(p)) { p.follower = null; p.followerAt = null; continue; }
    if (!p.followerAt) p.followerAt = { x: p.x, y: p.y };
    const d = dist(p.followerAt, p);
    if (d > 1) { const dx = Math.sign(p.x - p.followerAt.x), dy = Math.sign(p.y - p.followerAt.y); p.followerAt.x += dx; p.followerAt.y += dy; }
    if (p.boat) { p.followerAt.x = p.x; p.followerAt.y = p.y; }   // it rides
  }
}

// ---------- the per-tick driver ----------
export function encounterTick(K) {
  initEncounters(K);
  baitTick(K);
  awarenessTick(K);
  followerTick(K);
  // forget records of the dead, and the fx that are over
  for (const id of Object.keys(K.aw)) if (!findCreature(+id)) delete K.aw[id];
  K.fx = K.fx.filter(e => e.len === undefined || tick - e.start < e.len + 2);
}

// The Almanac marks a creature seen when it enters a player's sight; called by the page per look.
export function markSeen(K, list) { for (const f of list) noteSeen(K, f); }
