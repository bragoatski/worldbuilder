import { describe, it, expect } from 'vitest';

// A guest in the second seat (mechanics 25): sits on the second doorstep, keeps their own belongings apart from
// Root's, is refused while Root plays, acts in the world as the second player, and survives a save and load.
const sim = await import('../sim.js');
const F = await import('./fog.js');
const C = await import('./controls.js');
const E = await import('./encounter.js');
const M = await import('./market.js');
const Gst = await import('./guest.js');

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
