import { describe, it, expect, beforeEach } from 'vitest';

// Encounters (src/ketchem/encounter.js) on the hand-built 32x32 world of controls.test.js, with creatures placed by
// hand and the board's own random stream pinned so a throw lands or misses on purpose. The step-6 acceptance
// scenarios are the first describe.
const sim = await import('../sim.js');
const B = await import('./board.js');
const F = await import('./fog.js');
const C = await import('./controls.js');
const E = await import('./encounter.js');

const RIVER = () => ({ entryDir: 0, exitDir: 4, volume: 2, lake: false, sourcePool: false, estuary: false, curveOffset: 0, poolSize: 0 });
const at = (x, y) => sim.idx(x, y);
const HIT = () => 0.001, MISS = () => 0.999;

function world() {
  sim.setWorldSize(32); sim.initWorld(777); sim.CFG.riverAccumThreshold = 1e9; sim.CFG.ecoActive = true;
  for (let i = 0; i < 32 * 32; i++) { const x = i % 32, y = (i / 32) | 0; const main = x >= 2 && x <= 25 && y >= 2 && y <= 29; sim.grid[i] = main ? sim.T.PLAINS : sim.T.OCEAN; sim.elev[i] = main ? 1 : 0; sim.volcActive[i] = 0; }
  sim.generateRivers(); for (let i = 0; i < 32 * 32; i++) sim.riverData[i] = null;
  for (let y = 2; y <= 29; y++) sim.riverData[at(6, y)] = RIVER();
  sim.flora.length = 0; sim.fauna.length = 0; sim.road.fill(0);
  for (let x = 2; x <= 18; x++) sim.road[at(x, 24)] = 1;
  const stores = [{ x: 2, y: 24, i: at(2, 24), q: 0, name: 'A', door: { x: 3, y: 24 }, revealed: true }, { x: 18, y: 24, i: at(18, 24), q: 1, name: 'B', door: { x: 17, y: 24 }, revealed: true }];
  const K = { seed: 1, stores, signposts: [], landmarks: [], fog: F.newFog(32 * 32), starts: [{ store: 0, x: 3, y: 24 }, { store: 1, x: 17, y: 24 }] };
  K.kevin = E.initPlayer(C.newPlayer(12, 12), 'kevin'); K.root = E.initPlayer(C.newPlayer(20, 12), 'root');
  E.initEncounters(K);
  return K;
}
function put(type, x, y, energyRatio = 0.9) { const f = sim.makeFauna(x, y, type, null); f.energy = f.maxEnergy * energyRatio; sim.fauna.push(f); return f; }
function ticks(K, n) { for (let k = 0; k < n; k++) { sim.step(); E.encounterTick(K); } }
const state = (K, f) => (K.aw[f.id] || { state: 'calm' }).state;

describe('step 6 acceptance', () => {
  let K;
  beforeEach(() => { K = world(); });

  it('a grazer is caught with Amber, joins the party, gets named, and the Almanac counts it', () => {
    const p = K.kevin, h = put('herbivore', 13, 12);
    const stonesBefore = p.stones.amber;
    K.rng = HIT;
    const r = E.throwStone(K, p, h, 'Amber');
    expect(r.ok && r.caught).toBe(true);
    expect(r.delay).toBe(E.THROW_TICKS);
    expect(sim.fauna).not.toContain(h); expect(p.party).toContain(h); expect(p.stones.amber).toBe(stonesBefore - 1);
    expect(E.nameCatch(K, p, 'Pip', 'Hopper').ok).toBe(true);
    expect(h.name).toBe('Pip'); expect(E.almanacEntry(K, h)).toMatchObject({ caught: 1, nickname: 'Hopper', namedBy: 'kevin' });
    expect(E.nameCatch(K, p, 'x').text).toMatch(/nothing to name/);
    expect(K.fx.some(e => e.kind === 'throw' && e.caught && e.wobbles === 3)).toBe(true);
  });

  it('a hungry predator growls, pulses, and attacks at once after a failed Geode, taking the lowest grazer', () => {
    const p = K.kevin, c = put('carnivore', 13, 12, 0.3);
    const g1 = put('herbivore', 30, 30), g2 = put('herbivore', 30, 31);
    sim.fauna.splice(sim.fauna.indexOf(g1), 1); sim.fauna.splice(sim.fauna.indexOf(g2), 1); p.party.push(g1, g2); g1.name = 'Low'; g2.name = 'High';
    p.stones.geode = 2;
    ticks(K, 1);
    expect(state(K, c)).toBe('growl');
    expect(K.aw[c.id].pulsesLeft).toBeGreaterThanOrEqual(1);
    expect(E.creatureTag(K, p, c)).toMatch(/growls \(\d\)/);
    K.rng = MISS;
    const r = E.throwStone(K, p, c, 'Geode');
    expect(r.ok && !r.caught).toBe(true);
    expect(r.attack).toBeTruthy(); expect(r.text).toMatch(/attacks: "(Low|High)" is taken/);
    expect(p.party).toHaveLength(1);
    expect(state(K, c)).toBe('alert');
  });

  it('a growl that runs out of pulses attacks; with no grazer the player is knocked down and the party goes wild at the spot', () => {
    const p = K.kevin, c = put('carnivore', 13, 12, 0.3);
    const o = put('omnivore', 30, 30); sim.fauna.splice(sim.fauna.indexOf(o), 1); p.party.push(o); o.name = 'Om';
    p.wallet = 121; p.pack.push(sim.makeFlora(12, 12, null)); p.stones.amber = 7;
    ticks(K, 1); expect(state(K, c)).toBe('growl');
    const pulses = K.aw[c.id].pulsesLeft;   // the first pulse fires on the tick after the growl begins
    for (let k = 0; k < 80 && !p.knockedDown; k++) ticks(K, 1);
    expect(p.knockedDown).toBeTruthy();
    expect([p.x, p.y]).toEqual([3, 24]);                      // the nearest store's doorstep (A at 2,24)
    expect(p.wallet).toBe(60); expect(p.party).toHaveLength(0); expect(p.pack).toHaveLength(0); expect(p.stones.amber).toBe(0);
    expect(sim.fauna).toContain(o); expect(Math.max(Math.abs(o.x - 12), Math.abs(o.y - 12))).toBeLessThanOrEqual(2); expect(state(K, o)).toBe('wary');   // wild again at the spot (the sim has moved it since)
    expect(K.fxCount.pulse).toBe(pulses); expect(K.fxCount.knockdown).toBe(1); expect(K.fxCount.attack).toBe(1);
  });

  it('a staked creature is recovered when its hunter is caught, and eaten when the meal ends', () => {
    const p = K.kevin;
    const bait = put('herbivore', 30, 30); sim.fauna.splice(sim.fauna.indexOf(bait), 1); p.party.push(bait); bait.name = 'Goat';
    const c = put('carnivore', 16, 12, 0.3);
    p.stones.geode = 1;
    expect(E.placeBait(K, p, 'stake', 'E', 'Goat').ok).toBe(true);
    expect(p.party).toHaveLength(0);
    ticks(K, 4);                                               // it walks 1 tile a tick to the stake at (13,12)
    expect([c.x, c.y]).toEqual([13, 12]); expect(K.aw[c.id].feeding).toBe('stake'); expect(c.held).toBe(true);
    expect(E.oddsFor(K, p, c, 'Geode')).toBe(E.oddsFor(K, p, c, 'Geode'));
    K.rng = HIT;
    const r = E.throwStone(K, p, c, 'Geode');
    expect(r.caught).toBe(true);
    expect(p.party.map(x => x.name)).toContain('Goat');         // recovered, beside the hunter it caught
    expect(p.party).toHaveLength(2); expect(p.party).toContain(c);
    // the other way: wait the meal out
    const K2 = world(); const q = K2.kevin; const b2 = put('herbivore', 30, 30); sim.fauna.splice(sim.fauna.indexOf(b2), 1); q.party.push(b2); b2.name = 'Goat2';
    const c2 = put('carnivore', 16, 12, 0.3);
    E.placeBait(K2, q, 'stake', 'E', 'Goat2');
    ticks(K2, 4 + E.BAIT.stake.feed + 1);
    expect(q.party).toHaveLength(0); expect(K2.baits).toHaveLength(0); expect(c2.held).toBe(false);
    expect(sim.fauna).not.toContain(b2);
  });

  it('a partner on the opposite side is a corral: +10, a follower opposite +5', () => {
    const p = K.kevin, q = K.root, h = put('herbivore', 13, 12, 0.9);
    const base = E.oddsFor(K, p, h, 'Amber');
    q.x = 14; q.y = 12;
    expect(E.corralFor(K, p, h)).toBe('partner');
    expect(E.oddsFor(K, p, h, 'Amber')).toBe(Math.min(99, base + 10));
    q.x = 20; q.y = 20;
    const fol = put('herbivore', 30, 30); sim.fauna.splice(sim.fauna.indexOf(fol), 1); p.party.push(fol); fol.name = 'Fo';
    expect(E.follow(K, p, 'Fo').ok).toBe(true); p.followerAt = { x: 14, y: 12 };
    expect(E.corralFor(K, p, h)).toBe('follower');
    expect(E.oddsFor(K, p, h, 'Amber')).toBe(Math.min(99, base + 5));
  });
});

describe('awareness, bait and the rest', () => {
  let K;
  beforeEach(() => { K = world(); });

  it('a creature goes alert when a player comes near, and calm again when left alone', () => {
    const h = put('herbivore', 14, 12);
    ticks(K, 1); expect(state(K, h)).toBe('alert'); expect(K.fx.some(e => e.kind === 'alert')).toBe(true);
    K.kevin.x = 2; K.kevin.y = 2; K.root.x = 2; K.root.y = 3;
    ticks(K, E.ALERT_CLEAR + 2); expect(state(K, h)).toBe('calm');
  });

  it('a failed throw makes it wary and bolt; three failures and it flees for good', () => {
    const p = K.kevin, h = put('herbivore', 13, 12);
    K.rng = MISS; p.stones.amber = 5;
    const r = E.throwStone(K, p, h, 'Amber');
    expect(r.text).toMatch(/bolts/); expect(state(K, h)).toBe('wary');
    ticks(K, E.BOLT_TICKS + 1);
    expect(h.x - 12).toBeGreaterThanOrEqual(3);                   // ran east, away from the thrower
    h.x = 13; h.y = 12; E.throwStone(K, p, h, 'Amber');
    h.x = 13; h.y = 12; const r3 = E.throwStone(K, p, h, 'Amber');
    expect(r3.text).toMatch(/flees/); expect(state(K, h)).toBe('fled');
    expect(E.throwStone(K, p, h, 'Amber').text).toMatch(/fled/);
    expect(E.targetsNear(K, p, 2)).not.toContain(h);
  });

  it('plant bait draws a hungry grazer, which feeds calm with better odds; a fed one ignores it; the bait rots', () => {
    const p = K.kevin; p.pack.push(sim.makeFlora(12, 12, null));
    const h = put('herbivore', 15, 12, 0.4), fedOne = put('herbivore', 14, 11, 0.95);
    expect(E.placeBait(K, p, 'plant', 'E').ok).toBe(true);
    for (let k = 0; k < 8 && !K.aw[h.id]?.feeding; k++) ticks(K, 1);   // the sim may nudge it once before the bait takes hold
    expect([h.x, h.y]).toEqual([13, 12]); expect(K.aw[h.id].feeding).toBe('plant');
    expect(fedOne.held).toBeFalsy();
    const odds = E.oddsFor(K, p, h, 'Amber');
    expect(E.creatureTag(K, p, h)).toMatch(/feeding/);
    expect(odds).toBeGreaterThan(E.oddsFor(K, p, fedOne, 'Amber'));
    ticks(K, E.BAIT.plant.feed + 1);
    expect(K.baits).toHaveLength(0); expect(h.held).toBe(false);
    p.pack.push(sim.makeFlora(12, 12, null));
    E.placeBait(K, p, 'plant', 'W'); sim.fauna.length = 0;
    ticks(K, E.BAIT_ROT + 1); expect(K.baits).toHaveLength(0);
  });

  it('scatter wants three plants and a direction; meat refuses an empty party; no baiting from a boat', () => {
    const p = K.kevin;
    expect(E.placeBait(K, p, 'scatter', 'E').text).toMatch(/three plants/);
    expect(E.placeBait(K, p, 'meat', 'E').text).toMatch(/party is empty/);
    p.boat = true; expect(E.placeBait(K, p, 'plant', 'E').text).toMatch(/boat/);
  });

  it('picks a plant from the tile into the pack, up to the cap', () => {
    const p = K.kevin;
    expect(E.pickPlant(K, p).text).toBe('no plant here');
    for (let k = 0; k < 12; k++) sim.flora.push(sim.makeFlora(12, 12, null));
    for (let k = 0; k < 10; k++) expect(E.pickPlant(K, p).ok).toBe(true);
    expect(E.pickPlant(K, p).text).toMatch(/pack full/);
    expect(sim.flora).toHaveLength(2);
  });

  it('a throw needs an adjacent target on land, a stone in hand, and no boat', () => {
    const p = K.kevin, h = put('herbivore', 15, 12);
    expect(E.throwStone(K, p, h, 'Amber').text).toMatch(/not adjacent/);
    h.x = 13; p.stones.amber = 0; expect(E.throwStone(K, p, h, 'Amber').text).toMatch(/no Amber left/);
    p.stones.amber = 1; p.boat = true; expect(E.throwStone(K, p, h, 'Amber').text).toMatch(/boat/);
  });

  it('a follower trails one tile behind and comes back when recalled', () => {
    const p = K.kevin, fol = put('herbivore', 30, 30); sim.fauna.splice(sim.fauna.indexOf(fol), 1); p.party.push(fol); fol.name = 'Fo';
    expect(E.recall(K, p).ok).toBe(false);
    expect(E.follow(K, p, 'Fo').text).toBe('"Fo" follows');
    p.x = 14; ticks(K, 1); expect(p.followerAt).toEqual({ x: 13, y: 12 });
    expect(E.recall(K, p).text).toMatch(/back in its stone/);
  });
});
