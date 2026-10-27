// Ketch'em growth and evolution (mechanics sec. 20): XP from time, following, catches, feeding and exposure; a growth
// level moves the creature's REAL genome (its type axis toward the ideal, size, tolerance); when a preference crosses
// one of the sim's species buckets the species key changes and that is the evolution: a new Almanac entry linked to
// the old one, which the first evolver names. Pure over the player records and K; the page loop calls growthTick.
import { T, grid, tick, idx, speciesKey, getSpeciesName, fauna, makeFauna } from '../sim.js';
import { onStore } from './encounter.js';
import { elementalType, levelOf, populationOf, prefBucket } from './rules.js';
import { almanacEntry, fx, learnSpecies } from './encounter.js';
// An evolved species still waiting for its name from this player (the HUD keeps asking until it is named or gone).
function pendingUnnamed(K, p) { if (!p.namingSpecies) return false; const c = (p.party || []).find(x => x.id === p.namingSpecies) || (K.cabinet || []).find(x => x.id === p.namingSpecies); if (!c) { p.namingSpecies = null; return false; } return !almanacEntry(K, c).nickname; }

export const XP_PARTY = 1, XP_FOLLOW = 2, XP_PERIOD = 100, XP_PLANT = 1, XP_RARE_PLANT = 5, XP_MEAT_PER_LEVEL = 3, XP_EXPOSURE = 10, EXPOSURE_TICKS = 500;
export function xpFor(G) { return 10 * G * G; }   // XP to reach growth level G
const AXIS_FIELD = { Dune: 'prefArid', Marsh: 'prefArid', Ember: 'prefTemp', Frost: 'prefTemp', Sun: 'prefSL', Shade: 'prefSL', Peak: 'prefElev', Vale: 'prefElev' };
const AXIS_HIGH = { Dune: true, Marsh: false, Ember: true, Frost: false, Sun: true, Shade: false, Peak: true, Vale: false };
// Exposure: the biomes a type calls its own (20.1): 500 ticks carried through them is the evolution stone.
export const HOME_BIOMES = {
  Dune: [T.DESERT, T.MESA, T.STEPPE], Marsh: [T.WETLAND, T.JUNGLE], Ember: [T.VOLCANIC, T.DESERT], Frost: [T.ARCTIC, T.GLACIER, T.TUNDRA],
  Sun: [T.SAVANNA, T.DESERT, T.STEPPE], Shade: [T.FOREST, T.JUNGLE], Peak: [T.MOUNTAIN, T.HILLS], Vale: [T.WETLAND, T.PLAINS],
};

export function growthLevel(c) { return c.growthLevel || 0; }
export function growthXP(c) { return c.growthXP || 0; }
export function xpToNext(c) { return xpFor(growthLevel(c) + 1) - growthXP(c); }

function players(K) { const out = []; if (K.kevin) out.push(K.kevin); if (K.root && K.root.party && !K.root.away) out.push(K.root); return out; }

// Add XP and apply every growth level it buys. Returns the events: [{ kind: 'grow' | 'evolve', ... }].
export function addXP(K, p, c, amount, why) {
  if (!c || !(amount > 0)) return [];
  c.growthXP = growthXP(c) + amount;
  const events = [];
  while (c.growthXP >= xpFor(growthLevel(c) + 1)) {
    const before = speciesKey(c), oldName = getSpeciesName(c);
    c.growthLevel = growthLevel(c) + 1;
    moveGenome(c);
    events.push({ kind: 'grow', creature: c, level: c.growthLevel, why });
    const after = speciesKey(c);
    if (after !== before) events.push(evolve(K, p, c, before, oldName));
  }
  return events;
}
// One growth level on the genome (20.2).
export function moveGenome(c) {
  let typ = elementalType(c).typ;
  if (typ === 'Plain') {   // it picks the axis it already leans most on (a tie goes to dryness); from dead centre four levels make a type
    let best = null, bd = -1;
    for (const [field, hi, lo] of [['prefArid', 'Dune', 'Marsh'], ['prefTemp', 'Ember', 'Frost'], ['prefSL', 'Sun', 'Shade'], ['prefElev', 'Peak', 'Vale']]) {
      const v = c[field] === undefined ? 5 : c[field], d = Math.abs(v - 5);
      if (d > bd) { bd = d; best = v >= 5 ? hi : lo; }
    }
    typ = best;
  }
  const field = AXIS_FIELD[typ], high = AXIS_HIGH[typ];
  const v = c[field] === undefined ? 5 : c[field];
  c[field] = high ? Math.min(10, v + 0.5) : Math.max(0, v - 0.5);
  c.size = Math.min(2.2, (c.size === undefined ? 1 : c.size) + 0.04);
  c.tolerance = Math.min(6.0, (c.tolerance || 0) + 0.1);
  delete c._speciesName;   // the sim caches the binomial on the record; a moved genome may be a different species
}
// The species key changed: a new Almanac entry linked to the old species; the evolver's owner names it (20.3).
function evolve(K, p, c, oldKey, oldName) {
  const e = almanacEntry(K, c);
  const old = K.almanac.species[oldKey];
  if (!e.evolvedFrom) e.evolvedFrom = (old && (old.nickname || old.scientific)) || oldName || ('an unnamed ' + c.type + ' line');
  if (old) { old.variants = old.variants || []; if (!old.variants.includes('evolved')) old.variants.push('evolved'); }
  learnSpecies(e, c); if (!e.seen) e.seen = 1; if (!e.caught) e.caught = 1;   // the evolver is the first of its kind, seen and in hand
  if (!e.nickname && !pendingUnnamed(K, p)) p.namingSpecies = c.id;   // the first evolver names the new species; an earlier unnamed one keeps its turn
  fx(K, 'evolve', { len: 24, id: c.id, x: p.x, y: p.y, name: e.scientific || '' });
  return { kind: 'evolve', creature: c, from: e.evolvedFrom, to: e.scientific || speciesKey(c), named: !!e.nickname };
}

// Per tick: time in the party (1 per 100 ticks), following (2), exposure to its own type's biome (10 per 500).
export function growthTick(K) {
  const out = [];
  for (const p of players(K)) {
    const here = grid[idx(p.x, p.y)];
    for (const c of p.party || []) {
      const following = p.follower === c.id;
      c.partyTicks = (c.partyTicks || 0) + 1;
      if (c.partyTicks >= XP_PERIOD) { c.partyTicks = 0; out.push(...addXP(K, p, c, following ? XP_FOLLOW : XP_PARTY, following ? 'following' : 'time')); }
      const typ = elementalType(c).typ, home = HOME_BIOMES[typ];
      if (home && home.includes(here)) { c.biomeTicks = (c.biomeTicks || 0) + 1; if (c.biomeTicks >= EXPOSURE_TICKS) { c.biomeTicks = 0; out.push(...addXP(K, p, c, XP_EXPOSURE, 'exposure')); } }
    }
  }
  return out;
}
// Every party creature present at a catch gains the caught creature's level (20.1).
export function catchXP(K, p, caught, level) {
  const L = level || levelOf(caught, populationOf(caught, fauna, speciesKey) + 1);   // the caught one has left the wild count already
  const out = [];
  for (const c of p.party || []) if (c !== caught) out.push(...addXP(K, p, c, L, 'catch'));
  return out;
}
// Feed a party creature a plant from the pack (grazer, omnivore) or another party creature (meat eaters).
export function feed(K, p, which, what) {
  const w = String(which || '').toLowerCase();
  const c = (p.party || []).find(x => (x.name ? x.name.toLowerCase() === w : x.type === w));
  if (!c) return { ok: false, text: 'no "' + which + '" in the party' };
  if (!what || String(what).toLowerCase() === 'plant') {
    if (!(c.type === 'herbivore' || c.type === 'omnivore')) return { ok: false, text: (c.name || c.type) + ' does not eat plants' };
    const k = (p.pack || []).findIndex(x => !x.potion); if (k < 0) return { ok: false, text: 'no plant in the pack' };
    const f = p.pack.splice(k, 1)[0];
    const rare = (f.gen || 0) >= 10 || [f.prefArid, f.prefTemp, f.prefSL].some(v => v !== undefined && (v <= 1 || v >= 9));
    const ev = addXP(K, p, c, rare ? XP_RARE_PLANT : XP_PLANT, 'plant');
    return { ok: true, text: '"' + (c.name || c.type) + '" eats a ' + (rare ? 'rare ' : '') + 'plant (+' + (rare ? XP_RARE_PLANT : XP_PLANT) + ' XP)' + eventsText(ev), events: ev };
  }
  if (!(c.type === 'carnivore' || c.type === 'apex' || c.type === 'scavenger' || c.type === 'omnivore')) return { ok: false, text: (c.name || c.type) + ' does not eat meat' };
  const mw = String(what).toLowerCase();
  const m = (p.party || []).find(x => x !== c && (x.name ? x.name.toLowerCase() === mw : x.type === mw));
  if (!m) return { ok: false, text: 'no "' + what + '" in the party to feed it' };
  const L = levelOf(m, populationOf(m, fauna, speciesKey));
  p.party = p.party.filter(x => x !== m); if (p.follower === m.id) { p.follower = null; p.followerAt = null; } if (p.naming === m.id) p.naming = null; if (p.namingSpecies === m.id) p.namingSpecies = null;
  const ev = addXP(K, p, c, XP_MEAT_PER_LEVEL * L, 'meat');
  return { ok: true, text: '"' + (c.name || c.type) + '" eats "' + (m.name || m.type) + '" (+' + XP_MEAT_PER_LEVEL * L + ' XP)' + eventsText(ev), events: ev };
}
export function eventsText(events) {
  return events.map(e => e.kind === 'grow' ? '; growth level ' + e.level : '; EVOLVED from ' + e.from + ' into ' + e.to + (e.named ? '' : ': name the species')).join('');
}
// ---------- the pen (step 9, the Breeder): two of yours, a fee, an offspring in the cabinet ----------
export const BREED_COOLDOWN = 2000, BREED_FEE_BASE = 20, BREED_FEE_PER_LEVEL = 5;
export function breedFee(a, b) { const L = c => levelOf(c, populationOf(c, fauna, speciesKey)); return BREED_FEE_BASE + BREED_FEE_PER_LEVEL * (L(a) + L(b)); }
// A creature of the player's by id (the panel), by name, or, unnamed, by type; `not` keeps two picks distinct.
function mine(K, p, which, not) {
  const w = String(which || '').toLowerCase(), all = (p.party || []).concat(K.cabinet || []);
  if (/^\d+$/.test(w)) return all.find(x => x.id === +w && x !== not) || null;
  return all.find(x => x !== not && (x.name ? x.name.toLowerCase() === w : x.type === w)) || null;
}
// The offspring's genome: each preference the parents' midpoint with a small drift from the board's stream, size
// and tolerance the mean, the colour from one parent, vivid half the time if either parent is, a generation on.
export function offspringGenome(a, b, rng) {
  const drift = () => (rng() + rng() + rng() - 1.5) * 0.6;   // roughly normal, sd ~0.3, like the sim's mutation magnitude
  const mid = f => ((a[f] === undefined ? 5 : a[f]) + (b[f] === undefined ? 5 : b[f])) / 2;
  // A preference stays inside any bucket both parents share, so two parents of one species breed true (20.3).
  const clamp10 = (v, f) => { const ba = prefBucket(a[f] === undefined ? 5 : a[f]), bb = prefBucket(b[f] === undefined ? 5 : b[f]); if (ba === bb) return Math.max(ba * 2.5, Math.min(ba === 3 ? 10 : ba * 2.5 + 2.49, v)); return Math.max(0, Math.min(10, v)); };
  const col = rng() < 0.5 ? a : b;
  const vivid = (a.vivid || b.vivid) ? rng() < 0.5 : rng() < 0.02;
  return { prefArid: clamp10(mid('prefArid') + drift(), 'prefArid'), prefTemp: clamp10(mid('prefTemp') + drift(), 'prefTemp'), prefSL: clamp10(mid('prefSL') + drift(), 'prefSL'), prefElev: clamp10(mid('prefElev') + drift(), 'prefElev'),
    tolerance: Math.max(1, Math.min(6, ((a.tolerance || 3) + (b.tolerance || 3)) / 2 + drift() * 0.3)), size: Math.max(0.5, Math.min(2.2, ((a.size || 1) + (b.size || 1)) / 2 + drift() * 0.1)),
    hue: col.hue, sat: col.sat, val: col.val, vivid, lineageId: a.lineageId || a.id, gen: Math.max(a.gen || 0, b.gen || 0) + 1 };
}
export function breed(K, p, aName, bName) {
  if (!onStore(K, p)) return { ok: false, text: 'the pen is at a store' };
  const a = mine(K, p, aName), b = mine(K, p, bName, a);
  if (!a || !b) return { ok: false, text: 'no "' + (a ? bName : aName) + '" in the party or the cabinet' + (a && String(aName).toLowerCase() === String(bName).toLowerCase() ? ' (two different creatures)' : '') };
  if (a === b) return { ok: false, text: 'two different creatures' };
  for (const c of [a, b]) if (c.bornAt !== undefined && !(c.growthLevel >= 1)) return { ok: false, text: '"' + (c.name || c.type) + '" is a newborn: it breeds once it has grown a level' };
  if (a.type !== b.type) return { ok: false, text: 'a ' + a.type + ' and a ' + b.type + ' do not breed' };
  for (const c of [a, b]) if (c.bredAt !== undefined && tick - c.bredAt < BREED_COOLDOWN) return { ok: false, text: '"' + (c.name || c.type) + '" bred ' + (tick - c.bredAt) + ' ticks ago; ' + (BREED_COOLDOWN - (tick - c.bredAt)) + ' to wait' };
  const fee = breedFee(a, b);
  if (p.wallet < fee) return { ok: false, text: 'the fee is ' + fee + ' coins (you have ' + p.wallet + ')' };
  p.wallet -= fee; a.bredAt = tick; b.bredAt = tick;
  const child = makeFauna(p.x, p.y, a.type, offspringGenome(a, b, K.rng));
  child.age = 0; child.energy = child.maxEnergy; child.bornAt = tick; child.by = p.id; child.parents = [a.name || a.type, b.name || b.type]; delete child._speciesName;
  K.cabinet.push(child);
  const e = almanacEntry(K, child); e.variants = e.variants || []; if (!e.variants.includes('bred')) e.variants.push('bred'); learnSpecies(e, child);
  const seen = K.seenIds || (K.seenIds = {}); if (!seen[child.id]) { seen[child.id] = 1; e.seen++; } e.caught++;   // a newborn is seen and in hand
  if (p.naming) (p.namingQueue || (p.namingQueue = [])).push(child.id); else p.naming = child.id;   // a pending catch name keeps its turn
  fx(K, 'bred', { len: 12, x: p.x, y: p.y });
  return { ok: true, text: 'bred "' + (a.name || a.type) + '" and "' + (b.name || b.type) + '" for ' + fee + ' coins: a young ' + child.type + ' L' + levelOf(child, populationOf(child, fauna, speciesKey)) + ' ' + elementalType(child).typ + ' in the cabinet. name it', child, fee };
}
export function breedHook(a, b) { return { a, b, note: 'use breed(K, p, aName, bName)' }; }
// A creature's growth line for cards and looks: "G2 40/90".
export function growthText(c) { return 'G' + growthLevel(c) + ' ' + growthXP(c) + '/' + xpFor(growthLevel(c) + 1); }
export { prefBucket };
