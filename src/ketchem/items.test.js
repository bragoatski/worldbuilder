import { describe, it, expect } from 'vitest';

// The item pass (mechanics 23): shards step a party creature toward a type and can evolve it; gear is bought once,
// worn, and survives a knock-down. Same hand-built world as market.test.js.
const sim = await import('../sim.js');
const F = await import('./fog.js');
const C = await import('./controls.js');
const E = await import('./encounter.js');
const M = await import('./market.js');
const R = await import('./rules.js');

const at = (x, y) => sim.idx(x, y);
function world() {
  sim.setWorldSize(32); sim.initWorld(777); sim.CFG.riverAccumThreshold = 1e9; sim.CFG.ecoActive = true;
  for (let i = 0; i < 32 * 32; i++) { const x = i % 32, y = (i / 32) | 0; const main = x >= 2 && x <= 25 && y >= 2 && y <= 29; sim.grid[i] = main ? sim.T.PLAINS : sim.T.OCEAN; sim.elev[i] = main ? 1 : 0; sim.volcActive[i] = 0; }
  sim.generateRivers(); for (let i = 0; i < 32 * 32; i++) sim.riverData[i] = null;
  sim.flora.length = 0; sim.fauna.length = 0; sim.road.fill(0);
  const stores = [{ x: 2, y: 24, i: at(2, 24), q: 0, name: 'A', door: { x: 3, y: 24 }, revealed: true }, { x: 18, y: 24, i: at(18, 24), q: 1, name: 'B', door: { x: 17, y: 24 }, revealed: false },
    { x: 2, y: 4, i: at(2, 4), q: 2, name: 'C', door: { x: 3, y: 4 }, revealed: true }, { x: 20, y: 4, i: at(20, 4), q: 3, name: 'D', door: { x: 19, y: 4 }, revealed: false }];
  const K = { seed: 1, stores, signposts: [], landmarks: [], fog: F.newFog(32 * 32), starts: [{ store: 0, x: 3, y: 24 }, { store: 1, x: 17, y: 24 }] };
  K.kevin = E.initPlayer(C.newPlayer(12, 12), 'kevin'); K.root = E.initPlayer(C.newPlayer(13, 12), 'root');
  E.initEncounters(K); M.initStores(K); K.rng = () => 0.001;
  return K;
}
function put(type, x, y) { const f = sim.makeFauna(x, y, type, null); f.energy = f.maxEnergy * 0.9; sim.fauna.push(f); return f; }
function caught(K, p, type, name, prefs = {}) { const f = put(type, 30, 30); Object.assign(f, prefs); sim.fauna.splice(sim.fauna.indexOf(f), 1); f.name = name; p.party.push(f); return f; }
function onStore(K, p, k = 0) { p.x = K.stores[k].x; p.y = K.stores[k].y; }

describe('shards (23)', () => {
  it('the four stores stock all eight shards between them, two each, priced by the type\'s rarity', () => {
    const K = world(), all = new Set();
    for (const s of K.stores) { const sh = Object.keys(s.stock.potions).filter(n => / Shard$/.test(n)); expect(sh).toHaveLength(2); sh.forEach(n => all.add(n)); }
    expect(all.size).toBe(8);
    expect(M.POTIONS['Ember Shard'].price).toBe(100); expect(M.POTIONS['Sun Shard'].price).toBe(30); expect(M.POTIONS['Peak Shard'].price).toBe(70);
  });
  it('a shard moves the creature one step toward its type and is spent', () => {
    const K = world(), p = K.kevin;
    const c = caught(K, p, 'herbivore', 'Tam', { prefArid: 5, prefTemp: 5, prefSL: 5, prefElev: 5 });
    p.pack.push({ potion: 'Ember Shard' });
    const r = M.usePotion(K, p, 'Ember Shard', c);
    expect(r.ok).toBe(true); expect(c.prefTemp).toBe(6); expect(p.pack).toHaveLength(0);
    p.pack.push({ potion: 'Frost Shard' }); M.usePotion(K, p, 'Frost Shard', c); expect(c.prefTemp).toBe(5);
  });
  it('crossing a species line is an evolution: a linked Almanac entry and the species to name', () => {
    const K = world(), p = K.kevin;
    const c = caught(K, p, 'herbivore', 'Tam', { prefArid: 5, prefTemp: 7.4, prefSL: 5, prefElev: 5 });
    E.noteSeen(K, c); const oldKey = sim.speciesKey(c);
    p.pack.push({ potion: 'Ember Shard' });
    const r = M.usePotion(K, p, 'Ember Shard', c);
    expect(sim.speciesKey(c)).not.toBe(oldKey); expect(r.text).toContain('EVOLVED');
    const e = K.almanac.species[sim.speciesKey(c)]; expect(e.evolvedFrom).toBeTruthy(); expect(e.seen).toBe(1);
    expect(p.namingSpecies).toBe(c.id); expect(R.elementalType(c).typ).toBe('Ember');
  });
  it('a shard wants a party creature, and is kept when there is none', () => {
    const K = world(), p = K.kevin; p.pack.push({ potion: 'Vale Shard' });
    expect(M.usePotion(K, p, 'Vale Shard', null).ok).toBe(false); expect(p.pack).toHaveLength(1);
  });
  it('a shard at the end of its axis says so', () => {
    const K = world(), p = K.kevin; const c = caught(K, p, 'herbivore', 'Max', { prefElev: 10 });
    p.pack.push({ potion: 'Peak Shard' }); expect(M.usePotion(K, p, 'Peak Shard', c).text).toContain('as far toward Peak');
  });
});

describe('gear (23)', () => {
  it('bought once, then worn; a second purchase is refused and costs nothing', () => {
    const K = world(), p = K.kevin; onStore(K, p); p.wallet = 1000;
    expect(M.buy(K, p, 'satchel').ok).toBe(true); expect(p.wallet).toBe(880); expect(M.wears(p, 'Satchel')).toBe(true);
    const again = M.buy(K, p, 'Satchel'); expect(again.ok).toBe(false); expect(p.wallet).toBe(880);
    expect(M.shopLists(K, p, K.stores[0]).buy.find(b => b.item === 'Satchel').owned).toBe(true);
  });
  it('the Satchel adds five pack slots', () => {
    const K = world(), p = K.kevin; const base = M.packCap(p); p.gear = { Satchel: true }; expect(M.packCap(p)).toBe(base + 5);
  });
  it('Trail Boots add a tile of stride on open ground, not on a road', () => {
    const K = world(), p = K.kevin; p.x = 10; p.y = 10;
    const walk = () => { let n = 0; p.spent = 0; p.windowStart = sim.tick; while (C.tryStep(K, p, 1, 0).ok) n++; return n; };
    expect(walk()).toBe(2);
    p.gear = { 'Trail Boots': true }; p.x = 10; expect(walk()).toBe(3);
    for (let x = 10; x < 20; x++) sim.road[sim.idx(x, 10)] = 1;
    p.x = 10; expect(walk()).toBe(4);
  });
  it('the Lucky Charm adds 5 to Amber and Geode odds, never to Obsidian or Amber on L10', () => {
    expect(R.oddsOf('Amber', 3, { charm: true }) - R.oddsOf('Amber', 3, {})).toBe(5);
    expect(R.oddsOf('Geode', 5, { charm: true }) - R.oddsOf('Geode', 5, {})).toBe(5);
    expect(R.oddsOf('Obsidian', 9, { charm: true })).toBe(100); expect(R.oddsOf('Amber', 10, { charm: true })).toBe(0);
    const K = world(), p = K.kevin; const f = put('herbivore', p.x + 1, p.y);
    const o0 = E.oddsFor(K, p, f, 'Amber'); p.gear = { 'Lucky Charm': true }; const o1 = E.oddsFor(K, p, f, 'Amber');
    expect(o1 === 99 ? o1 >= o0 : o1 - o0 === 5).toBe(true);
  });
  it('worn gear survives a knock-down; what is carried does not', () => {
    const K = world(), p = K.kevin; p.gear = { Satchel: true, 'Trail Boots': true }; p.pack.push({ potion: 'Ember Shard' }); p.wallet = 100;
    const pred = put('apex', p.x + 1, p.y); E.attack(K, pred, p);
    expect(p.gear).toEqual({ Satchel: true, 'Trail Boots': true }); expect(p.pack).toHaveLength(0); expect(p.wallet).toBe(50);
  });
  it('gear and shard names are not creature names', () => {
    const K = world(), p = K.kevin; const f = put('herbivore', p.x + 1, p.y); E.throwStone(K, p, f, 'Amber');
    for (const n of ['Satchel', 'trail boots', 'Lucky Charm', 'Ember Shard']) expect(E.nameCatch(K, p, n).ok, n).toBe(false);
  });
});

describe('critic on the item pass (2026-10-26)', () => {
  it('the Satchel\'s slots count for picking plants too', () => {
    const K = world(), p = K.kevin; p.gear = { Satchel: true };
    for (let k = 0; k < 12; k++) { const f = sim.makeFlora(p.x, p.y, null); sim.flora.push(f); expect(E.pickPlant(K, p).ok, 'pick ' + (k + 1)).toBe(true); }
    expect(p.pack).toHaveLength(12);
  });
  it('a shard-shaped creature earns no scarcity bonus: one shard is not a 10x sale', () => {
    const K = world(), p = K.kevin;
    for (let k = 0; k < 20; k++) put('carnivore', 3 + (k % 10), 3 + ((k / 10) | 0)).prefTemp = 5;
    const c = caught(K, p, 'carnivore', 'Wolf', { prefArid: 5, prefTemp: 7.4, prefSL: 5, prefElev: 5 });
    for (const f of sim.fauna) Object.assign(f, { prefArid: 5, prefTemp: 7.4, prefSL: 5, prefElev: 5, hue: c.hue, sat: c.sat, val: c.val, size: c.size, tolerance: c.tolerance, vivid: c.vivid });
    const before = M.creaturePrice(c);
    p.pack.push({ potion: 'Ember Shard' }); M.usePotion(K, p, 'Ember Shard', c);
    expect(c.shaped).toBe(true);
    expect(M.creaturePrice(c)).toBeLessThan(before * 2.5);   // the type's own worth may rise; scarcity's x4 and +3 levels do not apply
    expect(R.populationRarity(R.populationOf(c, sim.fauna, sim.speciesKey)).reading).toBe('established');
  });
});

describe('the shaped mark is inherited (2026-10-26)', () => {
  it('a young one bred from a shaped parent is shaped too', () => {
    const K = world(), p = K.kevin; p.x = K.stores[0].x; p.y = K.stores[0].y; p.wallet = 1000;
    const a = caught(K, p, 'herbivore', 'Ann'), b = caught(K, p, 'herbivore', 'Ben');
    a.shaped = true;
    const G = { breed: null };
    return import('./growth.js').then(Gm => { const r = Gm.breed(K, p, 'Ann', 'Ben'); expect(r.ok).toBe(true); expect(r.child.shaped).toBe(true); void G; void b; });
  });
});
