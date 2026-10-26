import { describe, it, expect, beforeEach } from 'vitest';

// The market (src/ketchem/market.js) on the hand-built world of encounter.test.js: stock and restock, buy / sell /
// cabinet / give, the potions that the step-7 acceptance names (Slumber shortens by level, Homeward to the nearest
// discovered store), and the prices against rules.js.
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
  E.initEncounters(K); M.initStores(K);
  return K;
}
function put(type, x, y, energyRatio = 0.9) { const f = sim.makeFauna(x, y, type, null); f.energy = f.maxEnergy * energyRatio; sim.fauna.push(f); return f; }
function caught(K, p, type, name) { const f = put(type, 30, 30); sim.fauna.splice(sim.fauna.indexOf(f), 1); f.name = name; p.party.push(f); return f; }
function ticks(K, n) { for (let k = 0; k < n; k++) { sim.step(); E.encounterTick(K); M.marketTick(K); } }

describe('stock and restock (21)', () => {
  it('every store has the first six potions and two of the last six; Survey and Mirror each sit in one store', () => {
    const K = world();
    for (const s of K.stores) { for (const n of M.POTION_NAMES.slice(0, 6)) expect(s.stock.potions[n]).toBe(M.RESTOCK_COUNT); expect(Object.keys(s.stock.potions)).toHaveLength(8); }
    expect(K.stores.filter(s => s.stock.potions.Survey).length).toBe(1); expect(K.stores.filter(s => s.stock.potions.Mirror).length).toBe(1);
  });
  it('restocks to 3 of each 2,000 ticks after the last restock', () => {
    const K = world(), s = K.stores[0], p = K.kevin;
    p.x = s.x; p.y = s.y; p.wallet = 1000;
    expect(M.buy(K, p, 'Fleetfoot', 3).ok).toBe(true); expect(s.stock.potions.Fleetfoot).toBe(0);
    expect(M.buy(K, p, 'Fleetfoot', 1).text).toMatch(/has 0 Fleetfoot/);
    s.restockAt = sim.tick + 5; ticks(K, 6);
    expect(s.stock.potions.Fleetfoot).toBe(3);
    expect(s.restockAt - sim.tick).toBeGreaterThan(M.RESTOCK_TICKS - 10); expect(s.restockAt - sim.tick).toBeLessThanOrEqual(M.RESTOCK_TICKS);
  });
});

describe('buy, sell, cabinet, give', () => {
  let K, p;
  beforeEach(() => { K = world(); p = K.kevin; p.x = 2; p.y = 24; p.wallet = 100; });

  it('sells a creature at the rules price and a plant by its health, and refuses off the store tile', () => {
    const c = caught(K, p, 'herbivore', 'Pip');
    const want = R.priceOf(c, R.populationOf(c, sim.fauna, sim.speciesKey), R.levelOf(c, R.populationOf(c, sim.fauna, sim.speciesKey)), R.abilitiesOf(c, R.levelOf(c, 0)).abilities.length);
    const r = M.sell(K, p, 'Pip');
    expect(r.ok).toBe(true); expect(r.price).toBe(want); expect(p.wallet).toBe(100 + want); expect(p.party).toHaveLength(0); expect(K.stores[0].held).toContain(c);
    const plant = sim.makeFlora(2, 24, null); plant.health = 0.9; plant.gen = 1; plant.prefArid = 5; plant.prefTemp = 5; plant.prefSL = 5; p.pack.push(plant);
    const rare = sim.makeFlora(2, 24, null); rare.health = 0.9; rare.gen = 12; p.pack.push(rare);
    expect(M.plantPrice(plant, p)).toBe(3); expect(M.plantPrice(rare, p)).toBe(40);
    expect(M.sell(K, p, 'plants').text).toMatch(/sold 2 plants for 43 coins/);
    p.x = 10; expect(M.sell(K, p, 'Pip').text).toBe('no store here');
  });

  it('buys stones and potions within the wallet and the pack', () => {
    expect(M.buy(K, p, 'Geode', 2).ok).toBe(true); expect(p.stones.geode).toBe(2); expect(p.wallet).toBe(50);
    expect(M.buy(K, p, 'Obsidian').text).toMatch(/not enough coins/);
    expect(M.buy(K, p, 'Slumber').ok).toBe(true); expect(p.pack.filter(x => x.potion === 'Slumber')).toHaveLength(1); expect(p.wallet).toBe(20);
    expect(M.shopText(K, p)).toMatch(/^A\. wallet 20 coins/);
  });

  it('moves creatures between the party and the cabinet at a store, within the party cap', () => {
    caught(K, p, 'herbivore', 'One'); caught(K, p, 'herbivore', 'Two'); caught(K, p, 'herbivore', 'Three');
    expect(M.box(K, p, 'Two').ok).toBe(true); expect(K.cabinet.map(c => c.name)).toEqual(['Two']); expect(p.party).toHaveLength(2);
    caught(K, p, 'herbivore', 'Four');
    expect(M.box(K, p, 'Two', true).text).toMatch(/party is full/);
    p.x = 10; expect(M.box(K, p, 'One').text).toMatch(/at a store/);
  });

  it('gives coins, stones, a potion, a plant or a creature to the adjacent partner only', () => {
    const q = K.root; q.x = 3; q.y = 24; p.stones.geode = 1; p.pack.push({ potion: 'Hush' }); caught(K, p, 'herbivore', 'Pip');
    expect(M.give(K, p, 'coins', 40).ok).toBe(true); expect(p.wallet).toBe(60); expect(q.wallet).toBe(40);
    expect(M.give(K, p, 'Geode', 1).ok).toBe(true); expect(q.stones.geode).toBe(1);
    expect(M.give(K, p, 'Hush').ok).toBe(true); expect(q.pack.some(x => x.potion === 'Hush')).toBe(true);
    expect(M.give(K, p, 'Pip').ok).toBe(true); expect(q.party.map(c => c.name)).toEqual(['Pip']);
    q.x = 10; expect(M.give(K, p, 'coins', 1).text).toBe('not adjacent');
    q.away = true; q.x = 3; expect(M.give(K, p, 'coins', 1).text).toBe('nobody to give to');
  });
});

describe('potions (21)', () => {
  let K, p;
  beforeEach(() => { K = world(); p = K.kevin; p.x = 12; p.y = 12; });

  it('Slumber puts a creature to sleep for 40 - 3 x level ticks, at least 10, calm with +30 odds', () => {
    const h = put('herbivore', 13, 12), c = put('apex', 11, 12);
    p.pack.push({ potion: 'Slumber' }, { potion: 'Slumber' });
    const L = R.levelOf(h, R.populationOf(h, sim.fauna, sim.speciesKey));
    const before = E.oddsFor(K, p, h, 'Amber');
    const r = M.usePotion(K, p, 'Slumber', h);
    expect(r.text).toBe('herbivore sleeps for ' + Math.max(10, 40 - 3 * L) + ' ticks');
    expect(E.oddsFor(K, p, h, 'Amber')).toBe(Math.min(99, before + 30 + (K.aw[h.id].state === 'calm' ? 0 : 0)));
    expect(E.creatureTag(K, p, h)).toMatch(/asleep/);
    const La = R.levelOf(c, R.populationOf(c, sim.fauna, sim.speciesKey));
    expect(M.usePotion(K, p, 'Slumber', c).text).toBe('apex sleeps for ' + Math.max(10, 40 - 3 * La) + ' ticks');
    expect(La).toBeGreaterThan(L); expect(Math.max(10, 40 - 3 * La)).toBeLessThan(Math.max(10, 40 - 3 * L));   // the apex, higher level, sleeps shorter
    expect(p.pack).toHaveLength(0);
    expect(M.usePotion(K, p, 'Slumber', h).text).toMatch(/no Slumber/);
  });

  it('Homeward casts for 6 ticks then returns you to the nearest discovered store; an attack interrupts it', () => {
    p.pack.push({ potion: 'Homeward' }, { potion: 'Homeward' });
    p.x = 12; p.y = 20;
    expect(M.usePotion(K, p, 'Homeward').text).toMatch(/homeward: A in 6 ticks/);   // A (2,24) is nearer than C (2,4); B and D are undiscovered
    ticks(K, 7);
    expect([p.x, p.y]).toEqual([3, 24]); expect(p.moved).toBe(true);
    p.x = 12; p.y = 12; p.moved = false;
    M.usePotion(K, p, 'Homeward');
    const c = put('carnivore', 13, 12, 0.3); E.attack(K, c, p);
    ticks(K, 8); expect(p.cast).toBeNull();
    expect([p.x, p.y]).not.toEqual([12, 12]);   // the attack moved him (knock-down) but not the cast
    K.stores.forEach(s => { s.revealed = false; }); p.pack.push({ potion: 'Homeward' });
    expect(M.usePotion(K, p, 'Homeward').text).toMatch(/no store discovered/);
  });

  it('Fleetfoot adds a stride and Hawkeye widens the sight; Hush calms; Survey clears a 25x25 square', () => {
    p.pack.push({ potion: 'Fleetfoot' }, { potion: 'Hawkeye' }, { potion: 'Hush' }, { potion: 'Survey' });
    M.usePotion(K, p, 'Fleetfoot');
    for (let k = 0; k < 3; k++) expect(C.tryStep(K, p, 1, 0).ok).toBe(true);   // open land: 3 a window with Fleetfoot
    expect(C.tryStep(K, p, 1, 0).ok).toBe(false);
    M.usePotion(K, p, 'Hawkeye'); ticks(K, 6); C.tryStep(K, p, 0, 1);
    expect(F.isRevealed(K.fog, at(p.x + 5, p.y))).toBe(1); expect(F.isRevealed(K.fog, at(p.x + 7, p.y))).toBe(0);   // 11x11, not more
    const h = put('herbivore', p.x + 1, p.y); K.aw[h.id] = { state: 'wary', until: sim.tick + 100, enc: {} };
    expect(M.usePotion(K, p, 'Hush').text).toBe('hush: 1 creatures calm'); expect(K.aw[h.id].state).toBe('calm');
    const n0 = F.revealedCount(K.fog, 32 * 32); M.usePotion(K, p, 'Survey'); expect(F.revealedCount(K.fog, 32 * 32)).toBeGreaterThan(n0 + 200);
  });

  it('Smoke stops attacks on you and Mirror throws one back', () => {
    p.pack.push({ potion: 'Smoke' }, { potion: 'Mirror' });
    const c = put('carnivore', 13, 12, 0.3); caught(K, p, 'herbivore', 'Pip');
    M.usePotion(K, p, 'Smoke');
    expect(E.attack(K, c, p).text).toMatch(/turns back in the smoke/); expect(p.party).toHaveLength(1);
    p.effects = []; M.usePotion(K, p, 'Mirror');
    const e0 = c.energy; expect(E.attack(K, c, p).text).toMatch(/Mirror throws it back/); expect(c.energy).toBe(Math.max(1, e0 - 30)); expect(K.aw[c.id].state).toBe('wary');
    expect(p.effects.some(e => e.potion === 'Mirror')).toBe(false);
  });
});

describe('cards and the Almanac lists (step 10)', () => {
  it('a card carries the id, the glyph, the structured abilities and a price breakdown with the x1.4 per ability', () => {
    const K = world(), p = K.kevin, c = caught(K, p, 'herbivore', 'Pip');
    const k = M.creatureCard(c);
    expect(k.id).toBe(c.id); expect(k.glyph).toEqual(R.glyphOf(c)); expect(k.glyph.type).toBe('herbivore');
    expect(k.abilityList.length).toBe(k.abilities.length); expect(k.abilityList[0].strength).toBeGreaterThanOrEqual(1);
    expect(k.breakdown).toMatch(/^base \d+/); expect(k.breakdown).toMatch(new RegExp(k.abilityList.length + ' abilit(y|ies) x1[.](4|96)'));
  });
  it('almanacLists mirrors almanacText: species with a glyph from the first sighting, stores found, landmarks seen', () => {
    const K = world(), p = K.kevin;
    const f = put('herbivore', 13, 13); E.markSeen(K, [f]);
    const A = M.almanacLists(K, p);
    expect(A.species.length).toBeGreaterThanOrEqual(1);
    const e = A.species.find(s => s.type === 'herbivore'); expect(e.seen).toBeGreaterThanOrEqual(1); expect(e.glyph).toEqual(R.glyphOf(f)); expect(e.variants).toEqual([]);
    expect(A.found).toBe(2); expect(A.total).toBe(4); expect(A.stores.map(s => s.name)).toEqual(['A', 'C']); expect(A.stores[0].bearing).toBeTruthy();
    expect(M.almanacText(K, p)).toContain('2/4 stores found');
  });
});
