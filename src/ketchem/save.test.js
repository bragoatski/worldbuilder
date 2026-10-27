import { describe, it, expect, beforeEach } from 'vitest';

// The save record (src/ketchem/save.js) on a real small board: build, round-trip through JSON, apply, compare;
// the version refusal; migrations; base64. The IndexedDB store and the relay mirror are exercised in the browser
// rehearsal, not here.
const sim = await import('../sim.js');
const B = await import('./board.js');
const F = await import('./fog.js');
const C = await import('./controls.js');
const S = await import('./save.js');

let K;
beforeEach(() => {
  K = B.buildBoard({ setting: 'archipelago', seed: 7, size: 48, settleTicks: 40 });
  K.kevin = C.newPlayer(K.starts[0].x, K.starts[0].y); K.root = null; K.tick0 = sim.tick;
});

describe('save and load (18)', () => {
  it('round-trips the world, the board, the fog and the players through JSON', () => {
    C.tryStep(K, K.kevin, 1, 0, false); C.tryStep(K, K.kevin, 0, 1, false);   // move and reveal a little first
    K.root = { x: K.starts[1].x, y: K.starts[1].y, boat: false };
    for (let k = 0; k < 5; k++) sim.step();
    const before = S.buildSave(K, 'my game');
    const json = S.exportSave(before);
    expect(json.length).toBeLessThan(1.5e6);
    const grid0 = Array.from(sim.grid), elev0 = Array.from(sim.elev), road0 = Array.from(sim.road), fog0 = Array.from(K.fog);
    const flora0 = sim.flora.length, fauna0 = sim.fauna.length, cap0 = sim.CFG.maxLandCap, tick0 = sim.tick;
    sim.setWorldSize(32); sim.initWorld(1);                                  // a different world in the tab
    const K2 = S.importSave(json);
    expect(sim.W).toBe(48);
    expect(Array.from(sim.grid)).toEqual(grid0);
    expect(Array.from(sim.elev)).toEqual(elev0);
    expect(Array.from(sim.road)).toEqual(road0);
    expect(Array.from(K2.fog)).toEqual(fog0);
    expect(sim.flora.length).toBe(flora0); expect(sim.fauna.length).toBe(fauna0);
    expect(sim.CFG.maxLandCap).toBe(cap0); expect(sim.CFG.ecoActive).toBe(true);
    expect(sim.tick).toBe(tick0);
    expect(K2.slot).toBe('my game'); expect(K2.setting).toBe('archipelago'); expect(K2.seed).toBe(K.seed);
    expect(K2.stores.map(s => s.name)).toEqual(K.stores.map(s => s.name));
    expect(K2.stores.map(s => s.revealed)).toEqual(K.stores.map(s => s.revealed));
    expect(K2.signposts).toEqual(K.signposts); expect(K2.landmarks).toEqual(K.landmarks); expect(K2.starts).toEqual(K.starts);
    expect([K2.kevin.x, K2.kevin.y, K2.kevin.boat]).toEqual([K.kevin.x, K.kevin.y, false]);
    expect(K2.root).toMatchObject({ x: K.starts[1].x, y: K.starts[1].y, loaded: true });
    expect(K2.tick0).toBe(K.tick0);
    // a second save of the loaded game describes the same world
    const again = S.buildSave(K2, 'my game');
    expect(again.sim.grid).toEqual(before.sim.grid); expect(again.road).toBe(before.road); expect(again.fog).toBe(before.fog);
    expect(again.meta.ticksPlayed).toBe(before.meta.ticksPlayed);
  });

  it('refuses a save from a newer version, with a message, and leaves the world alone', () => {
    const data = S.buildSave(K, 'x'); data.version = S.SAVE_VERSION + 1;
    const grid0 = Array.from(sim.grid);
    expect(() => S.applySave(data)).toThrow(/newer version/);
    expect(Array.from(sim.grid)).toEqual(grid0);
    expect(() => S.applySave({ hello: 1 })).toThrow(/not a Ketch'em save/);
    expect(() => S.importSave('{nope')).toThrow(/not JSON/);
  });

  it('runs migrations in order from the file version', () => {
    const data = S.buildSave(K, 'x'); data.version = 0; data.old = true;
    S.MIGRATIONS.push({ to: 1, up: d => { d.migrated = (d.migrated || 0) + 1; delete d.old; return d; } });
    try {
      const m = S.migrate(JSON.parse(JSON.stringify(data)));
      expect(m.version).toBe(1); expect(m.migrated).toBe(1); expect(m.old).toBeUndefined();
      const same = S.migrate(JSON.parse(JSON.stringify({ ...data, version: 1 })));
      expect(same.migrated).toBeUndefined();
    } finally { S.MIGRATIONS.pop(); }
  });

  it('packs bytes as base64 and back', () => {
    const u8 = new Uint8Array(20000); for (let i = 0; i < u8.length; i++) u8[i] = (i * 31) & 255;
    expect(Array.from(S.unb64(S.b64(u8)))).toEqual(Array.from(u8));
    expect(S.unb64('').length).toBe(0);
  });

  it('stamps local time with an explicit offset', () => {
    expect(S.stamp(new Date(2026, 9, 25, 13, 5, 9))).toMatch(/^2026-10-25T13:05:09[+-]\d\d:\d\d$/);
  });

  it('the fog revealed count survives the trip', () => {
    const n = F.revealedCount(K.fog, 48 * 48);
    const K2 = S.applySave(JSON.parse(S.exportSave(S.buildSave(K, 'f'))));
    expect(F.revealedCount(K2.fog, 48 * 48)).toBe(n);
  });
});

describe('carried creatures keep their ids after a load (adversarial run 2026-10-25)', () => {
  it('the next wild birth after a load never reuses the id of a creature in the cabinet or a party', () => {
    const kid = sim.makeFauna(K.kevin.x, K.kevin.y, 'herbivore', null);   // the newest id, carried, not in the fauna list
    K.cabinet = [kid]; const pet = sim.makeFauna(K.kevin.x, K.kevin.y, 'carnivore', null); K.kevin.party = [pet];
    expect(sim.fauna.some(f => f && f.id === kid.id)).toBe(false);
    const json = S.exportSave(S.buildSave(K, 'ids'));
    sim.setWorldSize(32); sim.initWorld(1);
    const K2 = S.importSave(json);
    const born = sim.makeFauna(1, 1, 'herbivore', null);
    expect(born.id).toBeGreaterThan(pet.id); expect(born.id).toBeGreaterThan(kid.id);
    expect(K2.cabinet[0].id).toBe(kid.id); expect(K2.kevin.party[0].id).toBe(pet.id);
  });
});

describe('sightings survive a load (finishing pass 2026-10-26)', () => {
  it('the seen ids of creatures still in the world come back; the dead are dropped', () => {
    const live = sim.fauna.find(Boolean);
    K.seenIds = { [live.id]: 1, 99999999: 1 };
    const K2 = S.importSave(S.exportSave(S.buildSave(K, 'seen')));
    expect(K2.seenIds[live.id]).toBe(1); expect(K2.seenIds[99999999]).toBeUndefined();
  });
});

describe('a damaged sightings list (critic 2026-10-26)', () => {
  it('loads as empty instead of throwing after the world changed', () => {
    const rec = S.buildSave(K, 'bad'); rec.seenIds = 'oops';
    const K2 = S.applySave(JSON.parse(JSON.stringify(rec)));
    expect(K2.seenIds).toEqual({});
  });
});
