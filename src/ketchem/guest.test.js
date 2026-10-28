import { describe, it, expect } from 'vitest';

// A guest in the second seat (mechanics 25): sits on the second doorstep, keeps their own belongings apart from
// Root's, is refused while Root plays, acts in the world as the second player, and survives a save and load.
const sim = await import('../sim.js');
const F = await import('./fog.js');
const C = await import('./controls.js');
const E = await import('./encounter.js');
const M = await import('./market.js');
const Gst = await import('./guest.js');
const Gr = await import('./growth.js');
const Snd = await import('./sound.js');

const at = (x, y) => sim.idx(x, y);
function world() {
  sim.setWorldSize(32); sim.initWorld(777); sim.CFG.riverAccumThreshold = 1e9; sim.CFG.ecoActive = true;
  for (let i = 0; i < 32 * 32; i++) { const x = i % 32, y = (i / 32) | 0; const main = x >= 2 && x <= 25 && y >= 2 && y <= 29; sim.grid[i] = main ? sim.T.PLAINS : sim.T.OCEAN; sim.elev[i] = main ? 1 : 0; sim.volcActive[i] = 0; }
  sim.generateRivers(); for (let i = 0; i < 32 * 32; i++) sim.riverData[i] = null;
  sim.flora.length = 0; sim.fauna.length = 0; sim.road.fill(0);
  const stores = [{ x: 2, y: 24, i: at(2, 24), q: 0, name: 'A', door: { x: 3, y: 24 }, revealed: true }, { x: 18, y: 24, i: at(18, 24), q: 1, name: 'B', door: { x: 17, y: 24 }, revealed: false },
    { x: 2, y: 4, i: at(2, 4), q: 2, name: 'C', door: { x: 3, y: 4 }, revealed: true }, { x: 20, y: 4, i: at(20, 4), q: 3, name: 'D', door: { x: 19, y: 4 }, revealed: false }];
  const K = { seed: 1, stores, signposts: [], landmarks: [], fog: F.newFog(32 * 32), starts: [{ store: 0, x: 3, y: 24 }, { store: 1, x: 17, y: 24 }] };
  K.kevin = E.initPlayer(C.newPlayer(12, 12), 'kevin');
  E.initEncounters(K); M.initStores(K); K.rng = () => 0.001;
  return K;
}
function put(type, x, y) { const f = sim.makeFauna(x, y, type, null); f.energy = f.maxEnergy * 0.9; sim.fauna.push(f); return f; }

describe('the second seat (25)', () => {
  it('a guest sits on the second doorstep with nothing, and Root\'s belongings wait apart', () => {
    const K = world();
    K.root = E.initPlayer(C.newPlayer(5, 5), 'root'); K.root.wallet = 77; K.root.away = true;
    const r = Gst.seatGuest(K, false, 'Sam');
    expect(r.ok).toBe(true); expect(Gst.guestSeated(K)).toBe(true);
    expect(K.root.display).toBe('Sam'); expect([K.root.x, K.root.y]).toEqual([17, 24]); expect(K.root.wallet).toBe(0);
    expect(K.rootStash.wallet).toBe(77);
    K.root.wallet = 40;
    Gst.unseatGuest(K);
    expect(Gst.guestSeated(K)).toBe(false); expect(K.root.wallet).toBe(77); expect(K.root.away).toBe(true); expect(K.guestStash.wallet).toBe(40);
    Gst.seatGuest(K, false, 'Sam'); expect(K.root.wallet).toBe(40);   // the guest's own things come back
  });
  it('is refused while Root plays, and twice', () => {
    const K = world();
    expect(Gst.seatGuest(K, true).ok).toBe(false);
    K.root = E.initPlayer(C.newPlayer(5, 5), 'root'); K.root.away = false;
    expect(Gst.seatGuest(K, false).ok).toBe(false);
    K.root.away = true; expect(Gst.seatGuest(K, false).ok).toBe(true); expect(Gst.seatGuest(K, false).ok).toBe(false);
  });
  it('the guest is a player in the world: creatures notice them, they catch, and Kevin can give to them', () => {
    const K = world(); Gst.seatGuest(K, false, 'Sam'); const g = K.root;
    g.x = 12; g.y = 14;
    const f = put('herbivore', 13, 14);
    expect(E.throwStone(K, g, f, 'Amber').caught).toBe(true); expect(g.party).toHaveLength(1); expect(g.naming).toBe(f.id);
    expect(E.nameCatch(K, g, 'Pip').ok).toBe(true);
    K.kevin.x = 12; K.kevin.y = 13; K.kevin.wallet = 10;
    expect(M.give(K, K.kevin, 'coins', 4).ok).toBe(true); expect(g.wallet).toBe(4);
  });
  it('a bait owner hears who missed by name', () => {
    const K = world(); Gst.seatGuest(K, false, 'Sam'); const g = K.root; g.x = 12; g.y = 14;
    const pet = put('herbivore', 30, 30); sim.fauna.splice(sim.fauna.indexOf(pet), 1); pet.name = 'Bait'; K.kevin.party.push(pet);
    K.kevin.x = 12; K.kevin.y = 12;
    expect(E.placeBait(K, K.kevin, 'stake', 'S', 'Bait').ok).toBe(true);
    const wolf = put('carnivore', 12, 15); const b = K.baits[0]; b.creatureId = wolf.id; K.aw[wolf.id] = { state: 'calm', until: 0, enc: {}, baitId: b.id, feeding: 'meat' }; wolf.held = true;
    K.rng = () => 0.999; E.throwStone(K, g, wolf, 'Amber');
    expect((K.news || []).some(n => n.pid === 'kevin' && /Sam missed/.test(n.text))).toBe(true);
  });
});

describe('Root and a guest never share a player (critic 2026-10-26)', () => {
  it('a creature Root staked comes back to Root, not to the guest who sat down after', () => {
    const K = world();
    K.root = E.initPlayer(C.newPlayer(12, 14), 'root');
    const pet = put('herbivore', 30, 30); sim.fauna.splice(sim.fauna.indexOf(pet), 1); pet.name = 'Bait'; K.root.party.push(pet);
    expect(E.placeBait(K, K.root, 'stake', 'S', 'Bait').ok).toBe(true);
    K.root.away = true;
    Gst.seatGuest(K, false, 'Sam'); const g = K.root;
    expect(g.id).toBe('guest');
    E.placeBait(K, g, 'plant', 'N', null);   // the guest's own bait clears only the guest's baits
    expect(K.baits.some(b => b.by === 'root' && b.payload && b.payload.name === 'Bait')).toBe(true);
    expect(g.party).toHaveLength(0);
    for (const b of K.baits) if (b.by === 'root') b.until = sim.tick;   // Root's stake rots
    E.encounterTick(K); sim.step(); E.encounterTick(K);
    expect(K.rootStash.party.map(c => c.name)).toContain('Bait'); expect(g.party).toHaveLength(0);
  });
  it('news for Root waits for Root; the guest hears only their own', () => {
    const K = world(); K.root = E.initPlayer(C.newPlayer(12, 14), 'root'); K.root.away = true;
    E.news(K, 'root', 'for Root'); Gst.seatGuest(K, false, 'Sam'); E.news(K, 'guest', 'for Sam');
    expect(E.drainNews(K, K.root.id)).toEqual(['for Sam']); expect(E.drainNews(K, 'root')).toEqual(['for Root']);
  });
  it('a name in a waiting record is still taken', () => {
    const K = world(); K.root = E.initPlayer(C.newPlayer(12, 14), 'root'); K.root.away = true;
    const ash = put('herbivore', 30, 30); sim.fauna.splice(sim.fauna.indexOf(ash), 1); ash.name = 'Ash'; K.root.party.push(ash);
    Gst.seatGuest(K, false, 'Sam'); const g = K.root; g.x = 12; g.y = 14;
    const f = put('herbivore', 13, 14); expect(E.throwStone(K, g, f, 'Amber').caught).toBe(true);
    expect(E.nameCatch(K, g, 'Ash').ok).toBe(false);
  });
});

describe('the guest link leaves nothing behind (critic 2026-10-27)', () => {
  it('a guest who played from another screen sits down at this keyboard next time', () => {
    const K = world(); Gst.seatGuest(K, false, 'Sam'); K.root.remote = '482913';
    Gst.unseatGuest(K); expect(K.guestStash.remote).toBeUndefined();
    Gst.seatGuest(K, false, 'Sam'); expect(K.root.remote).toBeUndefined();
  });
});

describe('what a guest hears (25, 26)', () => {
  it('a growl in the guest\'s sight sounds for them once, and not for Kevin far away', () => {
    const K = world(); Gst.seatGuest(K, false, 'Sam'); const g = K.root; g.x = 20; g.y = 20; K.kevin.x = 3; K.kevin.y = 3;
    K.fx = [{ kind: 'pulse', x: 21, y: 20, start: sim.tick }];
    expect(Snd.soundsDue(K, [K.kevin], new WeakSet())).toEqual([]);
    const done = new WeakSet();
    expect(Snd.soundsDue(K, [g], done)).toEqual(['growl']); expect(Snd.soundsDue(K, [g], done)).toEqual([]);
  });
  it('this screen hears for Kevin and a guest playing here, not for a guest on another screen', () => {
    const K = world(); Gst.seatGuest(K, false, 'Sam');
    expect(Snd.screenListeners(K)).toEqual([K.kevin, K.root]);
    K.root.remote = '123456'; expect(Snd.screenListeners(K)).toEqual([K.kevin]);
  });
  it('a throw waits for its wobbles before it sounds', () => {
    const K = world(); Gst.seatGuest(K, false, 'Sam'); const g = K.root; g.x = 20; g.y = 20;
    K.fx = [{ kind: 'throw', to: { x: 21, y: 20 }, wobbles: 3, caught: true, start: sim.tick }];
    const done = new WeakSet();
    expect(Snd.soundsDue(K, [g], done)).toEqual([]);   // still in the air: kept for a later look
    K.fx[0].start = sim.tick - 42; expect(Snd.soundsDue(K, [g], done)).toEqual(['click']);
  });
});

describe('a name for a guest on a pad (25.1)', () => {
  it('a species nickname offer is unused, fits 16 letters, and is accepted', () => {
    const K = world(); Gst.seatGuest(K, false, 'Sam'); const g = K.root;
    K.almanac.species.x = { nickname: 'New herbivore 1', type: 'herbivore', seen: 1, caught: 0, bestLevel: 1 };
    expect(E.freeSpeciesName(K, 'herbivore')).toBe('New herbivore 2');
    const s = E.freeSpeciesName(K, 'scavenger'); expect(s.length).toBeLessThanOrEqual(16); expect(s).toMatch(/ 1$/);
    const f = put('herbivore', 30, 30); sim.fauna.splice(sim.fauna.indexOf(f), 1); g.party.push(f); g.namingSpecies = f.id;
    expect(E.nameSpecies(K, g, E.freeSpeciesName(K, 'herbivore')).ok).toBe(true);
  });
  it('is the first "<Type> N" nobody holds, counting both waiting records and bait payloads, and it names the catch', () => {
    const K = world(); K.root = E.initPlayer(C.newPlayer(5, 5), 'root'); K.root.away = true;
    const mk = name => { const f = put('herbivore', 30, 30); sim.fauna.splice(sim.fauna.indexOf(f), 1); f.name = name; return f; };
    K.root.party.push(mk('Herbivore 1'));   // Root's, waiting
    Gst.seatGuest(K, false, 'Sam'); const g = K.root; g.x = 12; g.y = 14;
    K.kevin.party.push(mk('herbivore 2'));   // case does not make a name free
    expect(E.freeName(K, 'Herbivore')).toBe('Herbivore 3');
    const f = put('herbivore', 13, 14); expect(E.throwStone(K, g, f, 'Amber').caught).toBe(true);
    expect(E.nameCatch(K, g, E.freeName(K, 'Herbivore')).ok).toBe(true); expect(f.name).toBe('Herbivore 3');
    expect(E.freeName(K, 'Herbivore')).toBe('Herbivore 4');
  });
});

// Guest parity (2026-10-27): bait, give, feed and the Almanac, run as the guest through the same functions Kevin's keys use.
describe('the guest baits, gives, feeds and reads the Almanac', () => {
  const plant = () => ({ type: 'grass', gen: 0 });
  it('a plant bait and a scatter belong to the guest and cost the guest\'s plants', () => {
    const K = world(); Gst.seatGuest(K, false, 'Sam'); const g = K.root; g.x = 12; g.y = 14;
    g.pack.push(plant(), plant(), plant(), plant());
    expect(E.placeBait(K, g, 'plant', 'N', null).ok).toBe(true);
    expect(K.baits).toHaveLength(1); expect(K.baits[0].by).toBe('guest'); expect(g.pack).toHaveLength(3);
    expect(E.placeBait(K, g, 'scatter', 'E', null).ok).toBe(true);   // one bait per player: the scatter replaces the plant
    expect(K.baits.filter(b => b.by === 'guest')).toHaveLength(3); expect(g.pack).toHaveLength(0);
    expect(E.placeBait(K, g, 'plant', '', null).text).toBe('no plant in the pack');
  });
  it('a creature the guest staked comes back to the guest after a seat swap, never to Root', () => {
    const K = world();
    K.root = E.initPlayer(C.newPlayer(5, 5), 'root'); K.root.away = true;
    Gst.seatGuest(K, false, 'Sam'); const g = K.root; g.x = 12; g.y = 14;
    const pet = put('herbivore', 30, 30); sim.fauna.splice(sim.fauna.indexOf(pet), 1); pet.name = 'Bait'; g.party.push(pet);
    expect(E.placeBait(K, g, 'stake', 'S', null).ok).toBe(true); expect(g.party).toHaveLength(0);
    Gst.unseatGuest(K);   // the guest gets up; Root's record is back in the seat
    expect(K.root.id).toBe('root');
    for (const b of K.baits) b.until = sim.tick;   // the stake rots with nobody feeding
    E.encounterTick(K); sim.step(); E.encounterTick(K);
    expect(K.guestStash.party.map(c => c.name)).toContain('Bait'); expect(K.root.party).toHaveLength(0);
    Gst.seatGuest(K, false, 'Sam'); expect(K.root.party.map(c => c.name)).toEqual(['Bait']);
  });
  it('meat bait sets down the guest\'s first party creature beside them, not on their tile', () => {
    const K = world(); Gst.seatGuest(K, false, 'Sam'); const g = K.root; g.x = 12; g.y = 14;
    const pet = put('herbivore', 30, 30); sim.fauna.splice(sim.fauna.indexOf(pet), 1); pet.name = 'Snack'; g.party.push(pet);
    expect(E.placeBait(K, g, 'meat', '', null).ok).toBe(false);
    expect(E.placeBait(K, g, 'meat', 'W', null).ok).toBe(true);
    expect(K.baits[0]).toMatchObject({ by: 'guest', kind: 'meat', x: 11, y: 14 }); expect(K.baits[0].payload.name).toBe('Snack');
  });
  it('the guest gives to Kevin through the words of the question and the command line', () => {
    const K = world(); Gst.seatGuest(K, false, 'Sam'); const g = K.root; g.x = 12; g.y = 13;
    g.wallet = 20; g.stones.geode = 2; g.pack.push(plant());
    const kStart = { wallet: K.kevin.wallet, geode: K.kevin.stones.geode, pack: K.kevin.pack.length };
    expect(M.giveSaid(K, g, 'coins 5').ok).toBe(true); expect(g.wallet).toBe(15); expect(K.kevin.wallet).toBe(kStart.wallet + 5);
    expect(M.giveSaid(K, g, ' Geode 2 ').ok).toBe(true); expect(g.stones.geode).toBe(0); expect(K.kevin.stones.geode).toBe(kStart.geode + 2);
    expect(M.giveSaid(K, g, 'plant').ok).toBe(true); expect(K.kevin.pack).toHaveLength(kStart.pack + 1);
    const pip = put('herbivore', 30, 30); sim.fauna.splice(sim.fauna.indexOf(pip), 1); pip.name = 'Pip'; g.party.push(pip);
    expect(M.giveSaid(K, g, 'Pip').ok).toBe(true); expect(K.kevin.party).toContain(pip); expect(g.party).toHaveLength(0);
    expect(M.giveSaid(K, g, 'coins 500').ok).toBe(false);
    g.x = 20; expect(M.giveSaid(K, g, 'coins 1').text).toBe('not adjacent');
  });
  it('the guest feeds their own party creature, and the XP is theirs', () => {
    const K = world(); Gst.seatGuest(K, false, 'Sam'); const g = K.root;
    const goat = put('herbivore', 30, 30); sim.fauna.splice(sim.fauna.indexOf(goat), 1); goat.name = 'Goat'; g.party.push(goat);
    const wolf = put('carnivore', 30, 30); sim.fauna.splice(sim.fauna.indexOf(wolf), 1); wolf.name = 'Wolf'; g.party.push(wolf);
    g.pack.push(plant());
    const xp0 = goat.growthXP || 0;
    const r = Gr.feedSaid(K, g, 'Goat'); expect(r.ok).toBe(true); expect(goat.growthXP).toBeGreaterThan(xp0); expect(g.pack).toHaveLength(0);
    expect(Gr.feedSaid(K, g, 'Wolf').text).toMatch(/does not eat plants/);
    expect(Gr.feedSaid(K, g, 'Wolf, Goat').ok).toBe(true); expect(g.party.map(c => c.name)).toEqual(['Wolf']);
    expect(Gr.feedSaid(K, K.kevin, 'Wolf').ok).toBe(false);   // Kevin cannot feed the guest's creature
  });
  it('the Almanac reads bearings from the guest, and its text names the species and places', () => {
    const K = world(); Gst.seatGuest(K, false, 'Sam'); const g = K.root; g.x = 12; g.y = 14;
    const f = put('herbivore', 13, 14); expect(E.throwStone(K, g, f, 'Amber').caught).toBe(true);
    const A = M.almanacLists(K, g), Ak = M.almanacLists(K, K.kevin);
    expect(A.species.length).toBeGreaterThan(0); expect(A.species.some(e => e.caught >= 1)).toBe(true);
    expect(A.stores.map(s => s.bearing)).not.toEqual(Ak.stores.map(s => s.bearing));
    const t = M.almanacText(K, g);   // what a guest on another screen reads
    expect(t).toMatch(/^Almanac: \d+ species, 3\/4 stores found/); expect(t).toMatch(/\(herbivore\): seen \d+, caught 1/); expect(t).toContain('store A at 2,24 ');
  });
});
