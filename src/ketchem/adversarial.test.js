import { describe, it, expect } from 'vitest';

// The adversarial run of 2026-10-25: every blocker the critics proved, pinned. Same hand-built world as market.test.js.
const sim = await import('../sim.js');
const F = await import('./fog.js');
const C = await import('./controls.js');
const E = await import('./encounter.js');
const M = await import('./market.js');
const G = await import('./growth.js');

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
function put(type, x, y, energyRatio = 0.9) { const f = sim.makeFauna(x, y, type, null); f.energy = f.maxEnergy * energyRatio; sim.fauna.push(f); return f; }
function catchOne(K, p, type = 'herbivore') { const f = put(type, p.x + 1, p.y); const r = E.throwStone(K, p, f, 'Amber'); expect(r.caught).toBe(true); return f; }
function onStore(K, p) { p.x = K.stores[0].x; p.y = K.stores[0].y; }

describe('naming never strands (B1, B2, B5)', () => {
  it('a second catch waits its turn behind the first', () => {
    const K = world(), p = K.kevin;
    const a = catchOne(K, p), b = catchOne(K, p);
    expect(p.naming).toBe(a.id); expect(p.namingQueue).toEqual([b.id]);
    expect(E.nameCatch(K, p, 'Ann').ok).toBe(true); expect(p.naming).toBe(b.id);
    expect(E.nameCatch(K, p, 'Ben').ok).toBe(true); expect(a.name).toBe('Ann'); expect(b.name).toBe('Ben'); expect(p.naming).toBeNull();
  });
  it('a creature sold, given or taken by an attack leaves the prompts, and the queue moves up', () => {
    const K = world(), p = K.kevin;
    const a = catchOne(K, p), b = catchOne(K, p);
    onStore(K, p); expect(M.sell(K, p, a.id).ok).toBe(true);
    expect(p.naming).toBe(b.id); expect(p.namingQueue).toEqual([]);
    const pred = put('carnivore', p.x + 1, p.y, 0.1); p.x = 12; p.y = 12; pred.x = 13; pred.y = 12;
    E.attack(K, pred, p);   // takes the lowest grazer: b
    E.encounterTick(K);
    expect(p.party).toHaveLength(0); expect(p.naming).toBeNull();
    expect(E.nameCatch(K, p, 'Ghost').text).toBe('nothing to name');
  });
  it('boxing keeps the prompt; a knock-down keeps a cabinet creature\'s prompt', () => {
    const K = world(), p = K.kevin;
    const a = catchOne(K, p); onStore(K, p);
    expect(M.box(K, p, a.id, false).ok).toBe(true); expect(p.naming).toBe(a.id);
    p.x = 12; p.y = 12; const pred = put('apex', 13, 12, 0.1); E.attack(K, pred, p); E.encounterTick(K);
    expect(p.naming).toBe(a.id); expect(E.nameCatch(K, p, 'Boxed').ok).toBe(true);
  });
  it('feeding away the creature being named moves the queue up; a staked catch keeps its prompt', () => {
    const K = world(), p = K.kevin;
    const a = catchOne(K, p), b = catchOne(K, p), w = catchOne(K, p, 'carnivore');
    expect(p.naming).toBe(a.id); expect(p.namingQueue).toEqual([b.id, w.id]);
    expect(G.feed(K, p, 'carnivore', 'herbivore').ok).toBe(true);   // the first herbivore, a, is the meal
    E.encounterTick(K);
    expect(p.party).toHaveLength(2); expect(p.naming).toBe(b.id); expect(p.namingQueue).toEqual([w.id]);
    expect(E.placeBait(K, p, 'stake', 'E', null).ok).toBe(true);   // stakes the first party creature, b, still unnamed
    E.encounterTick(K); E.encounterTick(K);
    expect(p.party.map(c => c.id)).not.toContain(b.id); expect(p.naming).toBe(b.id);
  });
  it('an unnamed creature given away is the receiver\'s to name', () => {
    const K = world(), p = K.kevin, r = K.root;
    const a = catchOne(K, p); r.x = p.x + 1; r.y = p.y;
    expect(M.give(K, p, 'herbivore').ok).toBe(true);
    expect(p.naming).toBeNull(); expect(r.naming).toBe(a.id);
  });
  it('a species nickname already set is not overwritten by a later catch', () => {
    const K = world(), p = K.kevin;
    const first = catchOne(K, p); E.nameCatch(K, p, 'Pip', 'Hopper');
    const twin = sim.makeFauna(p.x + 1, p.y, 'herbivore', { prefArid: first.prefArid, prefTemp: first.prefTemp, prefSL: first.prefSL, prefElev: first.prefElev, hue: first.hue, sat: first.sat, val: first.val, tolerance: first.tolerance, size: first.size, vivid: first.vivid });   // the same species
    twin.energy = twin.maxEnergy; sim.fauna.push(twin); expect(sim.speciesKey(twin)).toBe(sim.speciesKey(first));
    expect(E.throwStone(K, p, twin, 'Amber').caught).toBe(true); const r = E.nameCatch(K, p, 'Tam', 'Zorp');
    expect(r.text).toContain('already "Hopper"');
    expect(Object.values(K.almanac.species).some(e => e.nickname === 'Zorp')).toBe(false);
  });
  it('store words are not names', () => {
    const K = world(), p = K.kevin; catchOne(K, p);
    for (const w of ['plants', 'plant 1', 'Amber', 'herbivore', 'Tonic', 'coins']) expect(E.nameCatch(K, p, w).ok, w).toBe(false);
  });
});

describe('the store acts on the creature you clicked (B3)', () => {
  it('two unnamed herbivores, one in the party and one in the cabinet: take the cabinet one, sell the right one', () => {
    const K = world(), p = K.kevin;
    const a = catchOne(K, p), b = catchOne(K, p); onStore(K, p);
    expect(M.box(K, p, b.id, false).ok).toBe(true);
    expect(M.box(K, p, 'herbivore', true).ok).toBe(true);   // by type: the cabinet is searched first when taking
    expect(p.party.map(c => c.id).sort()).toEqual([a.id, b.id].sort());
    M.box(K, p, b.id, false);
    const r = M.sell(K, p, b.id); expect(r.ok).toBe(true); expect(K.cabinet).toHaveLength(0); expect(p.party[0]).toBe(a);
  });
});

describe('sleep and flight (B4, B5)', () => {
  it('a sleeper keeps its hold when its bait is cleared', () => {
    const K = world(), p = K.kevin; p.x = 12; p.y = 12;
    p.pack.push({ potion: 'Slumber' });
    const f = put('herbivore', 13, 12);
    expect(M.usePotion(K, p, 'Slumber', f).ok).toBe(true); expect(f.held).toBe(true);
    K.aw[f.id].baitId = 999;   // as if it had been eating a bait of Kevin's
    E.placeBait(K, p, 'plant', 'W', null); E.placeBait(K, p, 'plant', 'W', null);   // the second replaces the first and releases every hold of his
    expect(f.held).toBe(true); expect(K.aw[f.id].asleep).toBeGreaterThan(sim.tick);
  });
  it('Slumber does not bring back a creature that fled', () => {
    const K = world(), p = K.kevin; p.x = 12; p.y = 12;
    const f = put('herbivore', 13, 12); K.aw[f.id] = { state: 'fled', until: 0, enc: {} }; p.pack.push({ potion: 'Slumber' });
    const r = M.usePotion(K, p, 'Slumber', f); expect(r.ok).toBe(false); expect(p.pack).toHaveLength(1);
  });
  it('a bait kind that is a prototype key is refused', () => {
    const K = world(), p = K.kevin;
    for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(E.placeBait(K, p, k, 'E', null).ok, k).toBe(false);
    expect(() => E.encounterTick(K)).not.toThrow();
  });
});

describe('potions and give at the edges (R1, R2, R6, N3)', () => {
  it('Tonic applies the growth level at once', () => {
    const K = world(), p = K.kevin; const c = catchOne(K, p); E.nameCatch(K, p, 'Tam');
    p.pack.push({ potion: 'Tonic' }); const r = M.usePotion(K, p, 'Tonic', c);
    expect(r.ok).toBe(true); expect(G.growthLevel(c)).toBe(1); expect(r.text).toContain('growth level 1');
  });
  it('Decoy ignores a far target and uses the way you faced', () => {
    const K = world(), p = K.kevin; p.x = 12; p.y = 12; p.facing = [1, 0]; p.pack.push({ potion: 'Decoy' });
    const r = M.usePotion(K, p, 'Decoy', { x: 20, y: 20 }); expect(r.ok).toBe(true); expect(K.decoy.x).toBe(13); expect(K.decoy.y).toBe(12);
  });
  it('Homeward on a store is refused and kept', () => {
    const K = world(), p = K.kevin; onStore(K, p); p.pack.push({ potion: 'Homeward' });
    expect(M.usePotion(K, p, 'Homeward').ok).toBe(false); expect(p.pack).toHaveLength(1);
  });
  it('give refuses a negative or non-numeric amount', () => {
    const K = world(), p = K.kevin, r = K.root; r.x = p.x + 1; r.y = p.y; p.wallet = 10;
    expect(M.give(K, p, 'coins', -10).ok).toBe(false); expect(M.give(K, p, 'coins', NaN).ok).toBe(false); expect(p.wallet).toBe(10); expect(r.wallet).toBe(0);
  });
  it('F with no name lets the first party creature out', () => {
    const K = world(), p = K.kevin; const a = catchOne(K, p); E.nameCatch(K, p, 'First'); catchOne(K, p);
    expect(E.follow(K, p, null).ok).toBe(true); expect(p.follower).toBe(a.id);
  });
});
