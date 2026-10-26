import { describe, it, expect, beforeEach } from 'vitest';

// Growth and evolution (src/ketchem/growth.js) on the hand-built world: XP sources, growth levels moving the genome,
// and the evolution when a preference crosses a species bucket (the step-8 acceptance), plus the breeding hook.
const sim = await import('../sim.js');
const F = await import('./fog.js');
const C = await import('./controls.js');
const E = await import('./encounter.js');
const G = await import('./growth.js');
const R = await import('./rules.js');

const at = (x, y) => sim.idx(x, y);
function world() {
  sim.setWorldSize(32); sim.initWorld(777); sim.CFG.riverAccumThreshold = 1e9; sim.CFG.ecoActive = true;
  for (let i = 0; i < 32 * 32; i++) { const x = i % 32, y = (i / 32) | 0; const main = x >= 2 && x <= 25 && y >= 2 && y <= 29; sim.grid[i] = main ? sim.T.PLAINS : sim.T.OCEAN; sim.elev[i] = main ? 1 : 0; sim.volcActive[i] = 0; }
  sim.generateRivers(); for (let i = 0; i < 32 * 32; i++) sim.riverData[i] = null;
  sim.flora.length = 0; sim.fauna.length = 0; sim.road.fill(0);
  const K = { seed: 1, stores: [{ x: 2, y: 24, i: at(2, 24), q: 0, name: 'A', door: { x: 3, y: 24 }, revealed: true }], signposts: [], landmarks: [], fog: F.newFog(32 * 32), starts: [{ store: 0, x: 3, y: 24 }, { store: 0, x: 4, y: 24 }] };
  K.kevin = E.initPlayer(C.newPlayer(12, 12), 'kevin'); K.root = E.initPlayer(C.newPlayer(13, 12), 'root');
  E.initEncounters(K);
  return K;
}
function mine(K, p, type, name, prefs) {
  const f = sim.makeFauna(30, 30, type, null); sim.fauna.splice(sim.fauna.indexOf(f), 1); f.name = name; Object.assign(f, prefs || {}); p.party.push(f); return f;
}

describe('growth (20.1, 20.2)', () => {
  let K, p;
  beforeEach(() => { K = world(); p = K.kevin; });

  it('XP to reach a growth level is 10 x G squared', () => { expect([1, 2, 3, 4, 5].map(G.xpFor)).toEqual([10, 40, 90, 160, 250]); });

  it('time in the party pays 1 XP per 100 ticks, following 2', () => {
    const a = mine(K, p, 'herbivore', 'A'), b = mine(K, p, 'herbivore', 'B');
    p.follower = b.id;
    for (let k = 0; k < 100; k++) G.growthTick(K);
    expect(G.growthXP(a)).toBe(1); expect(G.growthXP(b)).toBe(2);
  });

  it('a growth level moves the type axis half a step toward the ideal, size +0.04, tolerance +0.1', () => {
    const c = mine(K, p, 'herbivore', 'C', { prefArid: 8, prefTemp: 5, prefSL: 5, prefElev: 5, size: 1, tolerance: 3 });   // Dune
    expect(R.elementalType(c).typ).toBe('Dune');
    const ev = G.addXP(K, p, c, 10, 'test');
    expect(ev.map(e => e.kind)).toEqual(['grow']); expect(c.growthLevel).toBe(1);
    expect(c.prefArid).toBe(8.5); expect(c.size).toBeCloseTo(1.04); expect(c.tolerance).toBeCloseTo(3.1);
    const plain = mine(K, p, 'herbivore', 'P', { prefArid: 5, prefTemp: 6, prefSL: 5, prefElev: 5 });   // Plain, leaning warm
    G.addXP(K, p, plain, 10, 'test'); expect(plain.prefTemp).toBe(6.5);
    G.addXP(K, p, plain, 30, 'test'); expect(plain.prefTemp).toBe(7); expect(R.elementalType(plain).typ).toBe('Ember');
  });

  it('feeding: a plant to a grazer, rare plants pay more, meat pays 3 per level of the creature fed', () => {
    const g = mine(K, p, 'herbivore', 'Goat'), c = mine(K, p, 'carnivore', 'Wolf'), snack = mine(K, p, 'herbivore', 'Snack');
    const plant = sim.makeFlora(12, 12, null); plant.gen = 1; plant.prefArid = 5; plant.prefTemp = 5; plant.prefSL = 5; p.pack.push(plant);
    const rare = sim.makeFlora(12, 12, null); rare.gen = 12; p.pack.push(rare);
    expect(G.feed(K, p, 'Wolf', 'plant').text).toMatch(/does not eat plants/);
    expect(G.feed(K, p, 'Goat').text).toMatch(/eats a plant \(\+1 XP\)/); expect(G.growthXP(g)).toBe(1);
    expect(G.feed(K, p, 'Goat').text).toMatch(/rare plant \(\+5 XP\)/); expect(G.growthXP(g)).toBe(6);
    const L = R.levelOf(snack, 0);
    expect(G.feed(K, p, 'Wolf', 'Snack').text).toMatch(new RegExp('eats "Snack" \\(\\+' + 3 * L + ' XP\\)'));
    expect(p.party).not.toContain(snack); expect(G.growthXP(c)).toBe(3 * L);
    expect(G.feed(K, p, 'Goat', 'Wolf').text).toMatch(/does not eat meat/);
  });

  it('being present at a catch pays the caught level; exposure to the home biome pays 10 per 500 ticks', () => {
    const a = mine(K, p, 'herbivore', 'A');
    const wild = sim.makeFauna(13, 12, 'herbivore', null); sim.fauna.push(wild);
    const L = R.levelOf(wild, R.populationOf(wild, sim.fauna, sim.speciesKey));
    G.catchXP(K, p, wild); expect(G.growthXP(a)).toBe(L);
    const frost = mine(K, p, 'herbivore', 'Snow', { prefTemp: 1.5, prefArid: 5, prefSL: 5, prefElev: 5 });
    expect(R.elementalType(frost).typ).toBe('Frost');
    for (let y = 10; y <= 14; y++) for (let x = 10; x <= 14; x++) sim.grid[at(x, y)] = sim.T.ARCTIC;
    for (let k = 0; k < 500; k++) G.growthTick(K);
    expect(G.growthXP(frost)).toBeGreaterThanOrEqual(10 + 5);   // exposure plus five periods of time
  });
});

describe('evolution (20.3)', () => {
  it('a creature fed across a species bucket edge becomes a new species: the Almanac links the entries and asks for a name', () => {
    const K = world(), p = K.kevin;
    const c = mine(K, p, 'herbivore', 'Edge', { prefArid: 7.3, prefTemp: 5, prefSL: 5, prefElev: 5 });   // bucket 2 (5..7.5); 7.5 is the edge
    const oldKey = sim.speciesKey(c); E.noteSeen(K, c); K.almanac.species[oldKey].nickname = 'Hopper';
    const before = R.prefBucket(c.prefArid);
    const ev = G.addXP(K, p, c, 10, 'test');
    expect(c.prefArid).toBe(7.8); expect(R.prefBucket(c.prefArid)).toBe(before + 1);
    expect(ev.map(e => e.kind)).toEqual(['grow', 'evolve']);
    const newKey = sim.speciesKey(c); expect(newKey).not.toBe(oldKey);
    expect(K.almanac.species[newKey].evolvedFrom).toBe('Hopper');
    expect(K.almanac.species[oldKey].variants).toContain('evolved');
    expect(p.namingSpecies).toBe(c.id);
    expect(c.name).toBe('Edge');                                   // the individual keeps its name
    expect(G.eventsText(ev)).toMatch(/EVOLVED from Hopper into .*: name the species/);
    expect(K.fx.some(e => e.kind === 'evolve')).toBe(true);
    expect(G.breedHook(c, c).note).toMatch(/step 9/);
  });

  it('an evolved species gets its own binomial, not the cached old one, and the Almanac text shows the link', async () => {
    const M = await import('./market.js');
    const K = world(), p = K.kevin;
    const c = mine(K, p, 'herbivore', 'Old', { prefArid: 7.3, prefTemp: 5, prefSL: 5, prefElev: 5, gen: 6 });   // old enough for the sim to name its line
    const oldName = sim.getSpeciesName(c); expect(oldName).toBeTruthy();
    E.noteSeen(K, c);
    const ev = G.addXP(K, p, c, 10, 'test');
    const e = ev.find(x => x.kind === 'evolve');
    expect(e.to).not.toBe(oldName); expect(e.from).toBe(oldName); expect(sim.getSpeciesName(c)).toBe(e.to);
    expect(M.almanacText(K, p)).toContain('evolved from ' + oldName);
    expect(E.nameCatch(K, p, 'Dusty').text).toBe('the new species is "Dusty"');
    expect(E.nameCatch(K, p, 'Again').text).toMatch(/no new species to name|nothing to name/);
  });
});
