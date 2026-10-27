// Ketch'em rules: the pure functions of the game. Spec: docs/01 Design/Ketch'em Mechanics.md, sections 2, 3, 3b,
// 4, 5, 8 and 10. Every function here is a function of a creature's genome and state, N (living members of its
// species in this world) and the thrower's situation. No sim import, no RNG, no DOM: the worked examples in the
// mechanics file are the tests (rules.test.js). Sim creatures (makeFauna) are accepted as they are.

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Section 2: the trophic types, keyed by the sim's fauna.type. `word` is the game's name for it.
export const TROPHIC = {
  herbivore: { word: 'grazer',    low: 1, base: 10,  ability: 'Forager' },
  scavenger: { word: 'scavenger', low: 2, base: 20,  ability: 'Scrounge' },
  omnivore:  { word: 'omnivore',  low: 3, base: 30,  ability: 'Nose' },
  carnivore: { word: 'carnivore', low: 5, base: 60,  ability: 'Guard' },
  apex:      { word: 'apex',      low: 8, base: 150, ability: 'Dread' },
};

function trophic(f) {
  if (!Object.hasOwn(TROPHIC, f.type)) throw new Error('ketchem: unknown trophic type ' + f.type);
  return TROPHIC[f.type];
}

// Section 3 and 3b: the nine elemental types, their ability and their habitat rarity class.
export const TYPES = {
  Dune:  { axis: 'A', high: true,  ability: 'Waterless', cls: 'uncommon' },
  Marsh: { axis: 'A', high: false, ability: 'Wader',     cls: 'uncommon' },
  Ember: { axis: 'P', high: true,  ability: 'Firewalk',  cls: 'very rare' },
  Frost: { axis: 'P', high: false, ability: 'Furcoat',   cls: 'rare' },
  Sun:   { axis: 'S', high: true,  ability: 'Farsight',  cls: 'common' },
  Shade: { axis: 'S', high: false, ability: 'Stalk',     cls: 'uncommon' },
  Peak:  { axis: 'E', high: true,  ability: 'Climber',   cls: 'rare' },
  Vale:  { axis: 'E', high: false, ability: 'Rivergait', cls: 'uncommon' },
  Plain: { axis: null, high: null, ability: null,        cls: 'common' },
};
export const TYPE_CLASS_F = { common: 1.0, uncommon: 1.5, rare: 2.5, 'very rare': 4.0 };

// Axis order is the tie-break order (A, P, S, E). A creature from before the height axis has no prefElev: 5.
const AXES = [
  ['A', 'prefArid', 'Dune', 'Marsh'],
  ['P', 'prefTemp', 'Ember', 'Frost'],
  ['S', 'prefSL', 'Sun', 'Shade'],
  ['E', 'prefElev', 'Peak', 'Vale'],
];
function pref(f, field) { const p = f[field]; return (p === undefined || p === null) ? 5 : p; }

// The axis with the largest deviation from 5, if that deviation is at least 2; otherwise Plain.
// d is the distance to the type's ideal (0 or 10), c = 1 - d/5 the ideal closeness, tp = round(2c) the type points.
export function elementalType(f) {
  let best = null;
  for (const [axis, field, hi, lo] of AXES) {
    const p = pref(f, field), dev = p - 5, abs = Math.abs(dev);
    if (abs >= 2 && (!best || abs > best.abs)) best = { axis, p, abs, typ: dev > 0 ? hi : lo };
  }
  if (!best) return { typ: 'Plain', axis: null, d: null, c: 0, tp: 0 };
  const d = TYPES[best.typ].high ? 10 - best.p : best.p;
  const c = clamp(1 - d / 5, 0, 1);
  return { typ: best.typ, axis: best.axis, d, c, tp: Math.round(2 * c) };
}

// Section 3b: population rarity (N alive of this species, this world) and type rarity (fixed habitat class).
export const POPULATION_RARITY = [
  { max: 2,        reading: 'last of its kind', levelBonus: 3, priceF: 4.0 },
  { max: 5,        reading: 'endangered',       levelBonus: 2, priceF: 2.5 },
  { max: 12,       reading: 'scarce',           levelBonus: 1, priceF: 1.5 },
  { max: 30,       reading: 'established',      levelBonus: 0, priceF: 1.0 },
  { max: Infinity, reading: 'abundant',         levelBonus: 0, priceF: 0.8 },
];
export function populationRarity(N) {
  const n = Math.max(1, N | 0);     // the creature being read is itself alive
  return POPULATION_RARITY.find(r => n <= r.max);
}
export function typeRarity(typ) {
  const cls = TYPES[typ].cls;
  return { cls, priceF: TYPE_CLASS_F[cls] };
}
// Both together. Level uses populationF only; price uses the product.
export function rarity(N, typ) {
  const p = populationRarity(N), t = typeRarity(typ);
  return { N, reading: p.reading, levelBonus: p.levelBonus, populationF: p.priceF, cls: t.cls, typeF: t.priceF, priceF: p.priceF * t.priceF };
}
// N for a creature: living members of its species, by the sim's species key (pass sim.speciesKey). A creature a
// shard has shaped (23) reads as established at least: a species made in the hand with coins is not a wild rarity, so
// it earns no scarcity bonus to its level or its price (a 45-coin shard must not turn 67 coins into 638).
export const SHAPED_N = 13;
export function populationOf(f, list, keyFn) {
  const k = keyFn(f);
  let n = 0;
  for (const g of list) if (g && keyFn(g) === k) n++;
  return f && f.shaped ? Math.max(n, SHAPED_N) : n;
}

// Section 1: age and energy words follow the sim's look code (visit.js creatureCode, including its fallbacks).
export function ageWord(f) {
  const ag = f.maxAge ? f.age / f.maxAge : 0;
  return ag < 0.2 ? 'young' : ag > 0.8 ? 'old' : 'prime';
}
export function energyWord(f) {
  const en = f.maxEnergy ? f.energy / f.maxEnergy : 0.5;
  return en < 0.25 ? 'starving' : en < 0.5 ? 'hungry' : 'fed';
}
export function sizeTerm(sz) { return sz >= 1.6 ? 2 : sz >= 1.25 ? 1 : sz > 0.8 ? 0 : -1; }

// Section 4: L = clamp(1, 10, low(T) + tp + size + rarity + age).
export function levelTerms(f, N) {
  const terms = {
    low: trophic(f).low,
    tp: elementalType(f).tp,
    size: sizeTerm(f.size === undefined ? 1 : f.size),
    rarity: populationRarity(N).levelBonus,
    age: ageWord(f) === 'prime' ? 0 : -1,
  };
  const raw = terms.low + terms.tp + terms.size + terms.rarity + terms.age;
  return { L: clamp(raw, 1, 10), raw, terms };
}
export function levelOf(f, N) { return levelTerms(f, N).L; }

// Section 5.2: the genome hash that decides whether a qualified second ability is switched on. It runs over the
// SPECIES fields (type, hue bucket, the four pref buckets), the same buckets as the sim's speciesKey, so every member
// of a species at the same level agrees (5.2's promise) and two members differ in abilities only through size, vivid
// and tolerance, which shape the pool, not the roll. Evolution (a bucket change) re-rolls. FNV-1a, 32-bit.
// prefBucket must stay equal to sim.js prefBucket; rules.test.js checks the two agree.
export function prefBucket(p) { return Math.min(3, Math.floor((p || 0) / 2.5)); }
export function genomeString(f) {
  return [f.type, Math.floor((f.hue || 0) / 20), prefBucket(pref(f, 'prefArid')), prefBucket(pref(f, 'prefTemp')),
    prefBucket(pref(f, 'prefSL')), prefBucket(pref(f, 'prefElev'))].join('|');
}
export function genomeHash(f) {
  const s = genomeString(f);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

// Section 5.5: the sixteen, by family. Rule text per strength lives with the renderer and the Almanac.
export const ABILITIES = {
  Waterless: { family: 'elemental', of: 'Dune' },  Wader: { family: 'elemental', of: 'Marsh' },
  Firewalk:  { family: 'elemental', of: 'Ember' }, Furcoat: { family: 'elemental', of: 'Frost' },
  Farsight:  { family: 'elemental', of: 'Sun' },   Stalk: { family: 'elemental', of: 'Shade' },
  Climber:   { family: 'elemental', of: 'Peak' },  Rivergait: { family: 'elemental', of: 'Vale' },
  Forager: { family: 'trophic', of: 'herbivore' }, Scrounge: { family: 'trophic', of: 'scavenger' },
  Nose: { family: 'trophic', of: 'omnivore' },     Guard: { family: 'trophic', of: 'carnivore' },
  Dread: { family: 'trophic', of: 'apex' },
  Pack: { family: 'trait', of: 'size' }, Lure: { family: 'trait', of: 'vivid' }, Hardy: { family: 'trait', of: 'tolerance' },
};
export const STRENGTH = ['', 'I', 'II', 'III'];
function ability(name, strength) { return { name, family: ABILITIES[name].family, strength }; }
function strengthOfTp(tp) { return tp === 2 ? 3 : tp === 1 ? 2 : 1; }

// Section 5.2 and 5.3: the pool in priority order, the primary, and the second if the hash roll is under 10 x L.
// Every creature gets one (the trophic ability at I is the fallback); a one-entry pool never gives two.
export function abilitiesOf(f, L) {
  const t = trophic(f), e = elementalType(f), sz = f.size === undefined ? 1 : f.size, tol = f.tolerance || 0;
  const pool = [];
  if (e.typ !== 'Plain') pool.push(ability(TYPES[e.typ].ability, strengthOfTp(e.tp)));
  if (e.tp === 2) pool.push(ability(t.ability, 3));
  if (sz >= 1.25) pool.push(ability('Pack', sz >= 2.0 ? 3 : sz >= 1.6 ? 2 : 1));
  if (f.vivid) pool.push(ability('Lure', strengthOfTp(e.tp)));
  if (tol >= 5) pool.push(ability('Hardy', tol >= 6.0 ? 3 : tol >= 5.5 ? 2 : 1));
  if (!pool.length) pool.push(ability(t.ability, 1));
  const roll = genomeHash(f) % 100;
  const abilities = [pool[0]];
  if (pool.length > 1 && roll < 10 * L) abilities.push(pool[1]);
  return { abilities, pool, roll };
}

// Section 10: price = base(T) x levelF x rarityF x sizeF x abilityF x conditionF x elderF, rounded to a coin.
export const ABILITY_F = 1.4;      // per ability, regardless of strength (handoff default, mechanics 5.7)
export const ELDER_GEN = 8, ELDER_F = 1.5;
export const CONDITION_F = { starving: 0.6, hungry: 0.85, old: 0.7, young: 0.8 };
export function priceTerms(f, N, L, nAbilities) {
  const t = trophic(f), e = elementalType(f);
  if (L === undefined) L = levelOf(f, N);
  if (nAbilities === undefined) nAbilities = abilitiesOf(f, L).abilities.length;
  const r = rarity(N, e.typ), age = ageWord(f), en = energyWord(f);
  const terms = {
    base: t.base,
    levelF: Math.max(1, 1 + 0.3 * (L - t.low)),
    populationF: r.populationF,
    typeF: r.typeF,
    sizeF: Math.max(0.7, f.size === undefined ? 1 : f.size),
    abilityF: Math.pow(ABILITY_F, nAbilities),
    conditionF: (CONDITION_F[en] || 1) * (CONDITION_F[age] || 1),
    elderF: (f.gen || 0) >= ELDER_GEN ? ELDER_F : 1,
  };
  const price = Math.round(terms.base * terms.levelF * terms.populationF * terms.typeF * terms.sizeF
    * terms.abilityF * terms.conditionF * terms.elderF);
  return { price, terms, L, nAbilities };
}
export function priceOf(f, N, L, nAbilities) { return priceTerms(f, N, L, nAbilities).price; }

// Section 8: catch odds. Base by stone and level, then modifiers, clamped 1-99; Obsidian is always 100 and Amber
// on L10 stays 0. Modifiers: { aw: 'calm'|'alert'|'growl'|'wary'|'fled', en (energy ratio; omitted reads as fed),
// bait: 'plant'|'meat'|null, lureIII, corral, dreadIII }. Growl is an alert with a skull (section 6): -10 too. Dread
// III makes alert, growl and wary count 0 (it does not make the creature calm). A fled creature cannot be targeted;
// that is the encounter machine's rule, so oddsOf still answers for it.
export const STONES = {
  Amber:    { price: 5,   odds: [85, 65, 45, 30, 20, 12, 6, 3, 1, 0] },
  Geode:    { price: 25,  odds: [95, 95, 95, 80, 65, 50, 40, 30, 20, 10] },
  Obsidian: { price: 150, odds: null },
};
export const ODDS_MOD = { calm: 15, plantBait: 20, meatBait: 25, alert: -10, growl: -10, wary: -30, lureIII: 10, corral: 10, charm: 5 };
export function oddsOf(stone, L, m = {}) {
  if (!Object.hasOwn(STONES, stone)) throw new Error('ketchem: unknown stone ' + stone);
  const s = STONES[stone];
  if (!s.odds) return 100;
  const lvl = clamp(L | 0, 1, 10);
  if (stone === 'Amber' && lvl === 10) return 0;
  let o = s.odds[lvl - 1];
  const en = m.en === undefined ? 1 : m.en;
  if (m.aw === 'calm' && en >= 0.5) o += ODDS_MOD.calm;
  if (m.aw === 'alert' && !m.dreadIII) o += ODDS_MOD.alert;
  if (m.aw === 'growl' && !m.dreadIII) o += ODDS_MOD.growl;
  if (m.aw === 'wary' && !m.dreadIII) o += ODDS_MOD.wary;
  if (m.bait === 'plant') o += ODDS_MOD.plantBait;
  if (m.bait === 'meat') o += ODDS_MOD.meatBait;
  if (m.lureIII) o += ODDS_MOD.lureIII;
  if (m.corral) o += ODDS_MOD.corral;
  if (m.charm) o += ODDS_MOD.charm;   // the Lucky Charm (23): after the early returns, so Obsidian stays sure and Amber on L10 stays 0
  return clamp(o, 1, 99);
}

// What a card draws of a creature (the sim's shape rules, render.js drawCreatureShape): the genes the drawing reads.
// An Almanac entry keeps one from the first creature seen, so a species has a face after that creature is gone.
export function glyphOf(f) { return { type: f.type, hue: f.hue, sat: f.sat, val: f.val, size: f.size === undefined ? 1 : f.size, vivid: !!f.vivid }; }

// The whole card for one creature: what a look, a sell card or the Almanac shows.
export function cardOf(f, N) {
  const e = elementalType(f), lv = levelTerms(f, N), ab = abilitiesOf(f, lv.L), r = rarity(N, e.typ);
  const pr = priceTerms(f, N, lv.L, ab.abilities.length);
  return { type: e, L: lv.L, level: lv, abilities: ab.abilities, pool: ab.pool, roll: ab.roll, rarity: r,
    price: pr.price, priceTerms: pr.terms, age: ageWord(f), energy: energyWord(f), trophic: trophic(f).word };
}
