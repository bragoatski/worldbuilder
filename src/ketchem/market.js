// Ketch'em market (mechanics sec. 10, 21, the market section of the design, 18.2): the four stores' stock and
// restock, buy / sell / cabinet / give, the potions and their effects, and the Almanac. Pure over the sim's arrays and
// the board K, like encounter.js; the page and Root's door call it. Prices come from rules.js.
import { W, H, grid as gridRef, fauna, tick, speciesKey, getSpeciesName } from '../sim.js';
import { priceOf, priceTerms, levelOf, populationOf, abilitiesOf, elementalType, glyphOf, TYPES } from './rules.js';
import { STONE_KEY, PARTY_CAP, PACK_CAP, partyAbilities, onStore, hasEffect, isEgg, eggText } from './encounter.js';
import { revealSquare } from './fog.js';
import { bearingTo, GEAR_WEAR, gearLeft, wearGear } from './controls.js';
import { growthText, breedFee, homeStore, HATCH_TICKS, addXP, eventsText, applyShard } from './growth.js';

export const STONE_PRICE = { Amber: 5, Geode: 25, Obsidian: 150 };
export const RESTOCK_TICKS = 2000, RESTOCK_COUNT = 3;
// Section 21. kind: self | thrown | area | ground | creature | bait. The first six are in every store; the last six
// are spread two per store.
export const POTIONS = {
  Fleetfoot: { kind: 'self', price: 12, duration: 300, blurb: 'stride +1 on every ground for 300 ticks' },
  Hawkeye:   { kind: 'self', price: 15, duration: 300, blurb: 'sight 11x11 for 300 ticks' },
  Slumber:   { kind: 'thrown', price: 30, blurb: 'the creature sleeps (40 - 3 x level ticks, min 10): calm, no bolt, no attack, odds +30' },
  Hush:      { kind: 'area', price: 20, blurb: 'every creature within 4 tiles drops to calm' },
  Musk:      { kind: 'area', price: 25, duration: 100, blurb: 'creatures of one type within 8 tiles walk toward you for 100 ticks (predators L8+ ignore it)' },
  Smoke:     { kind: 'area', price: 35, duration: 200, blurb: 'predators within 5 tiles back off; nothing attacks you for 200 ticks' },
  Decoy:     { kind: 'ground', price: 20, duration: 60, blurb: 'a scent beside you that alert predators chase instead of you, 60 ticks' },
  Homeward:  { kind: 'self', price: 40, duration: 6, blurb: 'after a 6-tick cast you reappear at the nearest discovered store' },
  Tonic:     { kind: 'creature', price: 30, blurb: '+10 XP to a party creature' },
  Survey:    { kind: 'self', price: 50, blurb: 'clears the fog in a 25x25 square around you' },
  Spice:     { kind: 'bait', price: 8, blurb: 'your bait draws from twice as far and feeds twice as long' },
  Mirror:    { kind: 'self', price: 60, duration: 500, blurb: 'the next attack is reflected: the predator goes wary and loses 30 energy' },
};
const ALWAYS = Object.keys(POTIONS).slice(0, 6), SPREAD = Object.keys(POTIONS).slice(6);   // the potions' stock rule, before the shards join the table
// The item pass (sec. 23). Shards: one use on a party creature, a step toward one elemental type; they sit in the pack
// and on the P menu like a potion. Priced by how rare the type is (3b); each store stocks two of the eight.
export const SHARD_TYPES = ['Dune', 'Marsh', 'Ember', 'Frost', 'Sun', 'Shade', 'Peak', 'Vale'];
const SHARD_PRICE = { common: 30, uncommon: 45, rare: 70, 'very rare': 100 };
const AXIS_WORD = { A: ['drier', 'wetter'], P: ['warmer', 'colder'], S: ['sunnier', 'shadier'], E: ['higher', 'lower'] };
for (const t of SHARD_TYPES) POTIONS[t + ' Shard'] = { kind: 'creature', shard: t, price: SHARD_PRICE[TYPES[t].cls], blurb: 'a party creature leans ' + AXIS_WORD[TYPES[t].axis][TYPES[t].high ? 0 : 1] + ', one step toward ' + t + '; cross a species line and it evolves' };
export const POTION_NAMES = Object.keys(POTIONS);
// Gear: bought, worn, kept (a knock-down takes what is carried, not what is worn); every store sells it. One item per
// slot (buying into a full slot sells the old one back), most wears out (controls.GEAR_WEAR), and worn gear sells back.
export const GEAR = {
  Satchel: { price: 120, slot: 'pack', blurb: '+5 pack slots, worn for good' },
  Pannier: { price: 260, slot: 'pack', blurb: '+8 pack slots, worn for good' },
  'Trail Boots': { price: 180, slot: 'feet', wear: GEAR_WEAR['Trail Boots'], blurb: 'stride +1 on open ground (land and river banks), wears out after 2000 steps' },
  Waders: { price: 160, slot: 'feet', wear: GEAR_WEAR.Waders, blurb: 'stride +1 on rivers and marsh, wears out after 2000 steps' },
  'Lucky Charm': { price: 300, slot: 'charm', wear: GEAR_WEAR['Lucky Charm'], blurb: 'catch odds +5 with Amber and Geode, wears out after 40 throws' },
  'Quiet Bell': { price: 240, slot: 'charm', wear: GEAR_WEAR['Quiet Bell'], blurb: 'creatures notice you one tile later, wears out after 3000 ticks' },
};
export const GEAR_NAMES = Object.keys(GEAR);
export function wears(p, name) { return !!(p && p.gear && p.gear[name]); }
const WEAR_UNIT = { step: 'step', throw: 'throw', tick: 'tick' };
// Worn gear as the pack, the HUD and Root read it: "Trail Boots (1240 steps left)"; gear that never wears is its name.
export function gearLabel(p, name) { const w = GEAR[name].wear; if (!w) return name; const n = gearLeft(p, name); return name + ' (' + n + ' ' + WEAR_UNIT[w.per] + (n === 1 ? '' : 's') + ' left)'; }
// What the HUD redraws on: each worn item with what is left, to the nearest ten except for throws (a step or a tick is not worth a redraw).
export function gearSig(p) { return GEAR_NAMES.filter(n => wears(p, n)).map(n => [n, GEAR[n].wear ? (GEAR[n].wear.per === 'throw' ? gearLeft(p, n) : Math.ceil(gearLeft(p, n) / 10)) : 0]); }
// Half the price, scaled by what is left of it (no wear: half).
export function gearSellBack(p, name) { const w = GEAR[name].wear; return Math.floor(w ? GEAR[name].price / 2 * gearLeft(p, name) / w.max : GEAR[name].price / 2); }

// ---------- stock ----------
export function stockFor(storeIndex) {
  const potions = {};
  for (const n of ALWAYS) potions[n] = RESTOCK_COUNT;
  for (let k = 0; k < 2; k++) potions[SPREAD[(2 * storeIndex + k) % SPREAD.length]] = RESTOCK_COUNT;
  for (let k = 0; k < 2; k++) potions[SHARD_TYPES[(2 * storeIndex + k) % SHARD_TYPES.length] + ' Shard'] = RESTOCK_COUNT;   // four stores x two = all eight
  return potions;
}
export function initStores(K) {
  K.stores.forEach((s, k) => {
    if (!s.stock || !s.stock.potions || !Object.keys(s.stock.potions).length) s.stock = { potions: stockFor(k) };   // stones are never short: price is the gate, so only potions are counted
    for (const n of Object.keys(stockFor(k))) if (!(n in s.stock.potions)) s.stock.potions[n] = RESTOCK_COUNT;   // a save from before the shards stocks them at once
    if (!s.restockAt) s.restockAt = tick + RESTOCK_TICKS;
    if (!s.held) s.held = [];
  });
}
export function restockTick(K) {
  for (const s of K.stores) {
    if (!s.stock) continue;
    if (tick >= s.restockAt) { s.restockAt = tick + RESTOCK_TICKS; const k = K.stores.indexOf(s); for (const n of Object.keys(stockFor(k))) s.stock.potions[n] = RESTOCK_COUNT; }
  }
}
export function storeAt(K, p) { return K.stores.find(s => s.x === p.x && s.y === p.y) || null; }

// ---------- prices ----------
// A young one that has not yet grown a level sells for half (the pen's young: bornAt set, no growth level).
const isYoung = c => c.bornAt !== undefined && !(c.growthLevel >= 1);
export function creaturePrice(c) {
  const N = populationOf(c, fauna, speciesKey), L = levelOf(c, N);
  const price = priceOf(c, N, L, abilitiesOf(c, L).abilities.length);
  return isYoung(c) ? Math.floor(price / 2) : price;
}
// Plants: common 1-3 by health; rare (gen >= 10 or a preference within 1 of an extreme) 15-40 by health; Forager doubles.
export function plantPrice(f, p) {
  const prefs = [f.prefArid, f.prefTemp, f.prefSL].filter(v => v !== undefined);
  const rare = (f.gen || 0) >= 10 || prefs.some(v => v <= 1 || v >= 9);
  const h = f.health === undefined ? 1 : f.health;
  let price = rare ? (h < 0.5 ? 15 : h < 0.8 ? 25 : 40) : (h < 0.5 ? 1 : h < 0.8 ? 2 : 3);
  if (p && partyAbilities(p).Forager) price *= 2;
  return price;
}
// The price breakdown of 5.6: the base and every factor that is not 1, the abilities' x1.4 each always shown.
const n2 = v => String(Math.round(v * 100) / 100);
export function priceBreakdown(terms, nAbilities) {
  const fx = (k, v) => (Math.abs(v - 1) > 0.005 ? k + ' x' + n2(v) : '');
  return ['base ' + terms.base, fx('level', terms.levelF), fx('population', terms.populationF), fx('type', terms.typeF), fx('size', terms.sizeF),
    nAbilities + (nAbilities === 1 ? ' ability' : ' abilities') + ' x' + n2(terms.abilityF), fx('condition', terms.conditionF), fx('elder', terms.elderF)].filter(Boolean).join(' · ');
}
export function creatureCard(c) {
  const N = populationOf(c, fauna, speciesKey), L = levelOf(c, N), ab = abilitiesOf(c, L).abilities, pr = priceTerms(c, N, L, ab.length), egg = isEgg(c), young = isYoung(c);
  return { id: c.id, name: egg ? 'egg' : c.name || c.type, type: c.type, elemental: elementalType(c).typ, level: L, growth: egg ? 'egg, hatches in ' + Math.max(0, c.hatchAt - tick) + ' ticks' : growthText(c), abilities: ab.map(a => a.name + (a.strength > 1 ? ' ' + ['', 'I', 'II', 'III'][a.strength] : '')),
    abilityList: ab.map(a => ({ name: a.name, strength: a.strength })), price: young ? Math.floor(pr.price / 2) : pr.price, breakdown: priceBreakdown(pr.terms, ab.length) + (young ? ' · x0.5 young (not yet grown a level)' : ''), species: getSpeciesName(c) || '', glyph: glyphOf(c),
    egg, hatchIn: egg ? Math.max(0, c.hatchAt - tick) : 0 };
}

// ---------- the pack: plants and potions share its slots ----------
export function packCap(p) { return PACK_CAP + 5 * (partyAbilities(p).Pack || 0) + (wears(p, 'Satchel') ? 5 : 0) + (wears(p, 'Pannier') ? 8 : 0); }
export function packSummary(p) {
  const plants = (p.pack || []).filter(x => !x.potion).length, potions = {};
  for (const x of p.pack || []) if (x.potion) potions[x.potion] = (potions[x.potion] || 0) + 1;
  return { plants, potions, used: (p.pack || []).length, cap: packCap(p), gear: GEAR_NAMES.filter(n => wears(p, n)).map(n => gearLabel(p, n)) };
}
function takePotion(p, name) { const k = (p.pack || []).findIndex(x => x.potion === name); if (k < 0) return null; return p.pack.splice(k, 1)[0]; }

// ---------- the shop (text for Root; the panel reads the same lists) ----------
export function shopLists(K, p, s) {
  const buy = Object.keys(STONE_PRICE).map(n => ({ item: n, price: STONE_PRICE[n], left: Infinity }))
    .concat(Object.entries(s.stock.potions).filter(([name, n]) => n > 0 && POTIONS[name]).map(([name, n]) => ({ item: name, price: POTIONS[name].price, left: n, blurb: POTIONS[name].blurb })))
    .concat(GEAR_NAMES.map(n => ({ item: n, price: GEAR[n].price, left: Infinity, blurb: GEAR[n].blurb, gear: true, owned: wears(p, n) })));
  const sell = (p.party || []).filter(c => !isEgg(c)).map(c => ({ ...creatureCard(c), where: 'party' })).concat((K.cabinet || []).filter(c => !isEgg(c)).map(c => ({ ...creatureCard(c), where: 'cabinet' })));   // an egg cannot be sold
  const gearSell = GEAR_NAMES.filter(n => wears(p, n)).map(n => ({ item: n, label: gearLabel(p, n), price: gearSellBack(p, n) }));
  const plants = (p.pack || []).filter(x => !x.potion).map(f => ({ plant: true, gen: f.gen || 0, health: f.health, price: plantPrice(f, p) }));
  const mine = (p.party || []).concat(K.cabinet || []);
  return { store: s.name, wallet: p.wallet, buy, sell, gearSell, plants, box: (K.cabinet || []).map(c => creatureCard(c)), party: (p.party || []).map(c => creatureCard(c)),
    pen: mine.map(c => ({ ...creatureCard(c), id: c.id, cooldown: c.bredAt !== undefined ? Math.max(0, 2000 - (tick - c.bredAt)) : 0, newborn: isYoung(c) })),
    fee: (x, y) => { const A = mine.find(c => c.id === +x), B = mine.find(c => c.id === +y); return A && B ? breedFee(A, B, K, s) : 0; } };
}
export function shopText(K, p) {
  const s = storeAt(K, p); if (!s) return 'no store here';
  const L = shopLists(K, p, s);
  const out = [s.name + '. wallet ' + L.wallet + ' coins'];
  out.push('buy: ' + L.buy.filter(b => !b.gear).map(b => b.item + ' ' + b.price + (b.left === Infinity ? '' : ' (' + b.left + ')')).join(', '));
  out.push('gear (one item per slot, a new one swaps the old back to the store): ' + L.buy.filter(b => b.gear).map(b => b.item + ' ' + b.price + ' [' + GEAR[b.item].slot + ']' + (b.owned ? ' (worn)' : '')).join(', '));
  const sells = L.sell.map(c => '"' + c.name + '" L' + c.level + ' ' + c.elemental + ' ' + c.price + (c.where === 'cabinet' ? ' (cabinet)' : '') + (c.breakdown.includes('young') ? ' (young: half price)' : '')).concat(L.gearSell.map(g => g.label + ' (worn gear) ' + g.price));
  out.push('sell: ' + (sells.length ? sells.join(', ') : 'nothing'));
  if (L.plants.length) out.push('plants: ' + L.plants.map(x => x.price).join(' + ') + ' = ' + L.plants.reduce((a, x) => a + x.price, 0) + ' coins');
  out.push('cabinet: ' + (L.box.length ? L.box.map(c => c.egg ? 'egg (hatches in ' + c.hatchIn + ' ticks)' : '"' + c.name + '"').join(', ') : 'empty'));
  out.push('pen: breed <a> <b> (two of one type; fee 20 + 5 x their levels' + (homeStore(K, s) ? '' : ', x0.75 at this store') + '; each parent once per 2,000 ticks; the young one is an egg for ' + HATCH_TICKS + ' ticks, then half price until it has grown a level)');
  return out.join('\n');
}
export function buy(K, p, item, qty = 1) {
  const s = storeAt(K, p); if (!s) return { ok: false, text: 'no store here' };
  qty = Math.max(1, qty | 0);
  const stone = Object.keys(STONE_PRICE).find(n => n.toLowerCase() === String(item || '').toLowerCase());
  const potion = POTION_NAMES.find(n => n.toLowerCase() === String(item || '').toLowerCase());
  const gear = GEAR_NAMES.find(n => n.toLowerCase() === String(item || '').toLowerCase());
  if (gear) {   // one at a time: it is worn, not carried, and a worn item in its slot goes back to the store
    if (wears(p, gear)) return { ok: false, text: 'you already wear the ' + gear };
    const old = GEAR_NAMES.find(n => n !== gear && GEAR[n].slot === GEAR[gear].slot && wears(p, n)), back = old ? gearSellBack(p, old) : 0;
    if (p.wallet + back < GEAR[gear].price) return { ok: false, text: 'not enough coins (' + GEAR[gear].price + ' for the ' + gear + ', you have ' + p.wallet + (old ? ' and ' + back + ' for the ' + old + ' sold back' : '') + ')' };
    p.wallet += back - GEAR[gear].price; p.gear = p.gear || {}; if (old) delete p.gear[old];
    p.gear[gear] = GEAR[gear].wear ? { left: GEAR[gear].wear.max } : true;
    if (old) return { ok: true, text: 'swapped ' + old + ' for ' + gear + ' (' + old + ' sold back for ' + back + '; ' + p.wallet + ' left)' };
    return { ok: true, text: 'bought the ' + gear + ' for ' + GEAR[gear].price + ' coins and put it on (' + GEAR[gear].blurb.split(',')[0] + '; ' + p.wallet + ' left)' };
  }
  if (!stone && !potion) return { ok: false, text: 'the store does not sell "' + item + '"' };
  const price = (stone ? STONE_PRICE[stone] : POTIONS[potion].price) * qty;
  if (p.wallet < price) return { ok: false, text: 'not enough coins (' + price + ' for ' + qty + ' ' + (stone || potion) + ', you have ' + p.wallet + ')' };
  if (potion) {
    if ((s.stock.potions[potion] || 0) < qty) return { ok: false, text: 'the store has ' + (s.stock.potions[potion] || 0) + ' ' + potion };
    if ((p.pack || []).length + qty > packCap(p)) return { ok: false, text: 'pack full (' + packCap(p) + ')' };
    s.stock.potions[potion] -= qty; for (let k = 0; k < qty; k++) p.pack.push({ potion });
  } else p.stones[STONE_KEY[stone]] += qty;
  p.wallet -= price;
  return { ok: true, text: 'bought ' + qty + ' ' + (stone || potion) + ' for ' + price + ' coins (' + p.wallet + ' left)' };
}
// A creature by its id (a number: the panel's buttons), or by its name, or, unnamed, by its type ("herbivore"); the
// party first, then the cabinet, unless cabinetFirst (taking out of the cabinet).
function findMine(K, p, which, cabinetFirst = false) {
  const byId = typeof which === 'number';
  const w = byId ? which : String(which || '').toLowerCase();
  const is = byId ? (x => x.id === w) : (x => (x.name ? x.name.toLowerCase() === w : x.type === w));
  const lists = cabinetFirst ? [[K.cabinet || [], 'cabinet'], [p.party || [], 'party']] : [[p.party || [], 'party'], [K.cabinet || [], 'cabinet']];
  for (const egg of [false, true]) for (const [list, where] of lists) { const c = list.find(x => is(x) && isEgg(x) === egg); if (c) return { c, where }; }   // an egg matches by type only when nothing hatched does
  return null;
}
// A creature leaving the player's hands altogether: the naming prompts and the follower let go (pruneNaming in
// encounter.js does the same every tick; this keeps the reply exact).
function leaving(p, c) { if (p.naming === c.id) p.naming = (p.namingQueue || []).shift() || null; if (p.namingQueue) p.namingQueue = p.namingQueue.filter(id => id !== c.id); if (p.namingSpecies === c.id) p.namingSpecies = null; unfollow(p, c); }
function unfollow(p, c) { if (p.follower === c.id) { p.follower = null; p.followerAt = null; } }
export function sell(K, p, which) {
  const s = storeAt(K, p); if (!s) return { ok: false, text: 'no store here' };
  const pm = typeof which === 'number' ? null : /^plant (\d+)$/.exec(String(which || '').toLowerCase());
  if (pm) {   // one plant, the Nth in the pack
    const plants = (p.pack || []).filter(x => !x.potion), f = plants[+pm[1] - 1]; if (!f) return { ok: false, text: 'no plant ' + pm[1] };
    const coins = plantPrice(f, p); p.pack.splice(p.pack.indexOf(f), 1); p.wallet += coins;
    return { ok: true, text: 'sold a plant for ' + coins + ' coins (' + p.wallet + ')' };
  }
  if (typeof which === 'string' && which.toLowerCase() === 'plants') {   // a creature cannot be named "plants" (a reserved word), so this is always the pack
    const plants = (p.pack || []).filter(x => !x.potion); if (!plants.length) return { ok: false, text: 'no plants in the pack' };
    const coins = plants.reduce((a, f) => a + plantPrice(f, p), 0);
    p.pack = p.pack.filter(x => x.potion); p.wallet += coins;
    return { ok: true, text: 'sold ' + plants.length + ' plants for ' + coins + ' coins (' + p.wallet + ')' };
  }
  const gear = typeof which === 'string' ? GEAR_NAMES.find(n => n.toLowerCase() === which.trim().toLowerCase()) : null;   // gear names are reserved: never a creature
  if (gear) {
    if (!wears(p, gear)) return { ok: false, text: 'you do not wear the ' + gear };
    const coins = gearSellBack(p, gear); delete p.gear[gear]; p.wallet += coins;
    return { ok: true, text: 'sold the ' + gear + ' for ' + coins + ' coins (' + p.wallet + ')', price: coins };
  }
  const m = findMine(K, p, which); if (!m) return { ok: false, text: 'no "' + which + '" in the party or the cabinet' };
  if (isEgg(m.c)) return { ok: false, text: eggText(m.c) };
  const price = creaturePrice(m.c);
  leaving(p, m.c);
  if (m.where === 'party') p.party = p.party.filter(x => x !== m.c);
  else K.cabinet = K.cabinet.filter(x => x !== m.c);
  s.held.push(m.c); p.wallet += price;
  return { ok: true, text: 'sold "' + (m.c.name || m.c.type) + '" for ' + price + ' coins (' + p.wallet + ')', price };
}
// Cabinet: a party creature into storage, or one out of it, at a store.
export function box(K, p, which, take = false) {
  if (!onStore(K, p)) return { ok: false, text: 'the cabinet is at a store' };
  const m = findMine(K, p, which, take); if (!m) return { ok: false, text: 'no "' + which + '"' };
  if (isEgg(m.c)) return { ok: false, text: eggText(m.c) };
  if (take) {
    if (m.where !== 'cabinet') return { ok: false, text: '"' + which + '" is already in the party' };
    if (p.party.length >= PARTY_CAP) return { ok: false, text: 'the party is full (' + PARTY_CAP + ')' };
    K.cabinet = K.cabinet.filter(x => x !== m.c); p.party.push(m.c); return { ok: true, text: '"' + (m.c.name || m.c.type) + '" joins the party' };
  }
  if (m.where !== 'party') return { ok: false, text: '"' + which + '" is already in the cabinet' };
  p.party = p.party.filter(x => x !== m.c); unfollow(p, m.c);   // still owned: a pending name keeps its turn
  K.cabinet.push(m.c); return { ok: true, text: '"' + (m.c.name || m.c.type) + '" goes into the cabinet' };
}
// Give to the other player while adjacent: coins, a stone, a potion, a plant or a party creature.
export function give(K, p, what, amount) {
  const other = p === K.kevin ? K.root : K.kevin;
  if (!other || other.away || !other.party) return { ok: false, text: 'nobody to give to' };
  if (Math.max(Math.abs(other.x - p.x), Math.abs(other.y - p.y)) > 1) return { ok: false, text: 'not adjacent' };
  const w = String(what || '').toLowerCase(), n = amount === undefined ? 1 : amount | 0;
  if (!(n >= 1)) return { ok: false, text: 'how many? a whole number, 1 or more' };
  if (w === 'coins' || w === 'coin') { if (p.wallet < n) return { ok: false, text: 'not that many coins' }; p.wallet -= n; other.wallet += n; return { ok: true, text: 'gave ' + n + ' coins' }; }
  const stone = Object.keys(STONE_PRICE).find(s => s.toLowerCase() === w);
  if (stone) { const k = STONE_KEY[stone]; if (p.stones[k] < n) return { ok: false, text: 'not that many ' + stone }; p.stones[k] -= n; other.stones[k] += n; return { ok: true, text: 'gave ' + n + ' ' + stone }; }
  const potion = POTION_NAMES.find(s => s.toLowerCase() === w);
  if (potion) { if ((other.pack || []).length >= packCap(other)) return { ok: false, text: 'their pack is full' }; const it = takePotion(p, potion); if (!it) return { ok: false, text: 'no ' + potion + ' in the pack' }; other.pack.push(it); return { ok: true, text: 'gave a ' + potion }; }
  if (w === 'plant') { const k = (p.pack || []).findIndex(x => !x.potion); if (k < 0) return { ok: false, text: 'no plant in the pack' }; if ((other.pack || []).length >= packCap(other)) return { ok: false, text: 'their pack is full' }; other.pack.push(p.pack.splice(k, 1)[0]); return { ok: true, text: 'gave a plant' }; }
  const c = (p.party || []).find(x => (x.name ? x.name.toLowerCase() === w : x.type === w));
  if (c && isEgg(c)) return { ok: false, text: eggText(c) };
  if (c) { if (other.party.length >= PARTY_CAP) return { ok: false, text: 'their party is full' }; p.party = p.party.filter(x => x !== c); leaving(p, c); other.party.push(c);
    if (!c.name) { if (other.naming) (other.namingQueue || (other.namingQueue = [])).push(c.id); else other.naming = c.id; }   // an unnamed one is theirs to name now
    return { ok: true, text: 'gave "' + (c.name || c.type) + '"' }; }
  return { ok: false, text: 'nothing called "' + what + '" to give' };
}
// A give typed as words, as Kevin's G and the guest's H and command line take it: "coins 10", "Amber 2", "Tonic",
// "plant", "Pip". A number, if any, is the last word.
export function giveSaid(K, p, text) {
  const m = /^(.*?)(?:\s+(\d+))?$/.exec(String(text || '').trim());
  return give(K, p, m[1], m[2] ? +m[2] : undefined);
}

// ---------- potions (21) ----------
function effect(p, potion, duration) { p.effects = (p.effects || []).filter(e => e.potion !== potion); p.effects.push({ potion, until: tick + duration }); }
export { hasEffect };
export function effectsTick(K) {
  for (const p of [K.kevin, K.root]) {
    if (!p || !p.effects) continue;
    if (!p.away && p.gear && p.gear['Quiet Bell']) wearGear(K, p, 'Quiet Bell');   // the Bell wears a tick at a time while its wearer is on the board
    p.effects = p.effects.filter(e => e.until > tick);
    if (p.cast && tick >= p.cast.until) { const s = p.cast.store; p.x = s.door.x; p.y = s.door.y; p.boat = false; p.moved = true; p.cast = null; p.msg = 'you reappear at ' + s.name; p.msgUntil = Date.now() + 4000; }
  }
  if (K.decoy && tick >= K.decoy.until) K.decoy = null;
  if (K.musk && tick >= K.musk.until) K.musk = null;
}
// Use a potion from the pack. target: a creature (thrown / creature kinds), a direction for Decoy, a trophic type for
// Musk. Returns { ok, text }.
export function usePotion(K, p, name, target) {
  const potion = POTION_NAMES.find(n => n.toLowerCase() === String(name || '').toLowerCase());
  if (!potion) return { ok: false, text: 'no potion called "' + name + '"' };
  if (!(p.pack || []).some(x => x.potion === potion)) return { ok: false, text: 'no ' + potion + ' in the pack' };
  const spec = POTIONS[potion];
  if (spec.shard) {   // a shard on a party creature (23): one step toward its type, an evolution if a species line is crossed
    const c = target && target.id !== undefined ? (p.party || []).find(x => x.id === target.id) : null;
    if (!c) return { ok: false, text: potion + ' wants a party creature (by name)' };
    if (isEgg(c)) return { ok: false, text: eggText(c) };
    const r = applyShard(K, p, c, spec.shard); takePotion(p, potion);
    return { ok: true, text: r.text + eventsText(r.events) };
  }
  const aw = id => K.aw[id] || (K.aw[id] = { state: 'calm', until: 0, enc: {} });
  const near = r => fauna.filter(f => f && Math.max(Math.abs(f.x - p.x), Math.abs(f.y - p.y)) <= r);
  let text;
  switch (potion) {
    case 'Fleetfoot': case 'Hawkeye': case 'Mirror': effect(p, potion, spec.duration); text = potion + ' for ' + spec.duration + ' ticks'; if (potion === 'Hawkeye') revealSquare(K, p.x, p.y, 5); break;
    case 'Slumber': {
      if (!target || Math.max(Math.abs(target.x - p.x), Math.abs(target.y - p.y)) > 2) return { ok: false, text: 'Slumber wants a creature within 2 tiles' };
      if ((K.aw[target.id] || {}).state === 'fled') return { ok: false, text: 'it has fled you: Slumber will not bring it back' };   // the three-throw cap holds (8)
      const N = populationOf(target, fauna, speciesKey), L = levelOf(target, N), len = Math.max(10, 40 - 3 * L);
      const a = aw(target.id); a.state = 'calm'; a.asleep = tick + len; a.pulsesLeft = 0; delete a.bolt; target.held = true;
      text = target.type + ' sleeps for ' + len + ' ticks'; break;
    }
    case 'Hush': { let n = 0; for (const f of near(4)) { const a = aw(f.id); if (a.state === 'alert' || a.state === 'wary' || a.state === 'growl') { a.state = 'calm'; a.until = 0; f.held = !!a.baitId || !!a.asleep || !!a.bolt; n++; } } text = 'hush: ' + n + ' creatures calm'; break; }
    case 'Musk': { const type = String(target || '').toLowerCase(); if (!['herbivore', 'carnivore', 'omnivore', 'scavenger', 'apex'].includes(type)) return { ok: false, text: 'Musk wants a type: herbivore, carnivore, omnivore, scavenger, apex' }; K.musk = { pid: p.id, type, until: tick + spec.duration }; text = type + ' musk for ' + spec.duration + ' ticks'; break; }
    case 'Smoke': { effect(p, 'Smoke', spec.duration); let n = 0; for (const f of near(5)) if (f.type === 'carnivore' || f.type === 'apex') { const a = aw(f.id); if (a.state === 'growl') { a.state = 'alert'; a.until = tick + 50; f.held = false; delete a.pursueUntil; } if (!a.asleep && !a.baitId) { const dx = Math.sign(f.x - p.x), dy = Math.sign(f.y - p.y); for (const [sx, sy] of [[dx, dy], [dx, 0], [0, dy]]) if ((sx || sy) && canStand(f.x + sx, f.y + sy)) { f.x += sx; f.y += sy; n++; break; } } } text = 'smoke: ' + n + ' predators move away; nothing attacks you for ' + spec.duration + ' ticks'; break; }
    case 'Decoy': {   // a tile beside you (21): the target only if adjacent, else the way you last walked
      const adj = target && target.x !== undefined && Math.max(Math.abs(target.x - p.x), Math.abs(target.y - p.y)) <= 1; const d = adj ? target : p.facing ? { x: p.x + p.facing[0], y: p.y + p.facing[1] } : null; if (!d || (d.x === p.x && d.y === p.y)) return { ok: false, text: 'Decoy goes on a tile beside you (a bearing, or the way you last walked)' }; K.decoy = { x: d.x, y: d.y, until: tick + spec.duration }; text = 'decoy set ' + bearingTo(p.x, p.y, d.x, d.y); break; }
    case 'Homeward': {
      if (storeAt(K, p)) return { ok: false, text: 'you are at a store already' };
      const found = K.stores.filter(s => s.revealed); if (!found.length) return { ok: false, text: 'no store discovered yet' };
      let best = null, bd = Infinity; for (const s of found) { const d = Math.max(Math.abs(s.x - p.x), Math.abs(s.y - p.y)); if (d < bd) { bd = d; best = s; } }
      p.cast = { until: tick + spec.duration, store: best }; text = 'homeward: ' + best.name + ' in ' + spec.duration + ' ticks (an attack interrupts it)'; break;
    }
    case 'Tonic': { const c = target && target.id !== undefined ? (p.party || []).find(x => x.id === target.id) : null; if (!c) return { ok: false, text: 'Tonic wants a party creature (by name)' }; if (isEgg(c)) return { ok: false, text: eggText(c) }; const ev = addXP(K, p, c, 10, 'tonic'); text = '"' + (c.name || c.type) + '" +10 XP' + eventsText(ev); break; }   // the level applies at once (20.2)
    case 'Survey': revealSquare(K, p.x, p.y, 12); text = 'survey: the fog clears 25x25 around you'; break;
    case 'Spice': { const b = (K.baits || []).filter(x => x.by === p.id); if (!b.length) return { ok: false, text: 'no bait of yours to spice' }; for (const x of b) x.spiced = true; text = 'bait spiced'; break; }
    default: return { ok: false, text: potion + ' is not usable yet' };
  }
  takePotion(p, potion);
  return { ok: true, text };
}

// ---------- the Almanac (M) ----------
export function almanacText(K, p) {
  const out = [];
  const species = Object.entries(K.almanac.species);
  out.push('Almanac: ' + species.length + ' species, ' + K.stores.filter(s => s.revealed).length + '/4 stores found');
  for (const [key, e] of species) {
    const sci = e.scientific || 'unnamed ' + e.type + ' line'; void key;
    out.push((e.nickname ? '"' + e.nickname + '" ' : '') + sci + ' (' + e.type + '): seen ' + e.seen + ', caught ' + e.caught + ', best L' + e.bestLevel + (e.namedBy ? ', named by ' + e.namedBy : '') + (e.evolvedFrom ? ', evolved from ' + e.evolvedFrom : '') + (e.usual && e.usual.length ? ', usually ' + e.usual.join(' and ') : '') + (e.variants && e.variants.length ? ', ' + e.variants.join(', ') : ''));
  }
  for (const s of K.stores.filter(s => s.revealed)) out.push('store ' + s.name + ' at ' + s.x + ',' + s.y + (p ? ' ' + bearingTo(p.x, p.y, s.x, s.y) : ''));
  for (const l of K.landmarks || []) if (K.fog && isSeenTile(K, l)) out.push('landmark ' + l.name + ' at ' + l.x + ',' + l.y);
  return out.join('\n');
}
// The same Almanac as structured lists for the page's panel: species with their glyphs, the stores found, the
// landmarks seen.
export function almanacLists(K, p) {
  const at = o => (p ? bearingTo(p.x, p.y, o.x, o.y) : '');
  const species = Object.entries(K.almanac.species).map(([key, e]) => ({ key, nickname: e.nickname || null, scientific: e.scientific || null, type: e.type, seen: e.seen, caught: e.caught, bestLevel: e.bestLevel,
    namedBy: e.namedBy || null, evolvedFrom: e.evolvedFrom || null, variants: e.variants || [], usual: e.usual || [], glyph: e.glyph || null }));
  const stores = K.stores.filter(s => s.revealed).map(s => ({ name: s.name, x: s.x, y: s.y, bearing: at(s) }));
  const landmarks = (K.landmarks || []).filter(l => K.fog && isSeenTile(K, l)).map(l => ({ name: l.name, kind: l.kind, x: l.x, y: l.y, bearing: at(l) }));
  return { species, stores, landmarks, found: stores.length, total: K.stores.length };
}
function isSeenTile(K, t) { const i = t.y * W + t.x; return (K.fog[i >> 3] >> (i & 7)) & 1; }
export function marketTick(K) { restockTick(K); effectsTick(K); }
function canStand(x, y) { if (x < 0 || y < 0 || x >= W || y >= H) return false; const t = gridRef[y * W + x]; return t !== 0 && t !== 1 && t !== 5 && t !== 11 && t !== 12; }   // not ocean, coast, mountain, volcanic, glacier
