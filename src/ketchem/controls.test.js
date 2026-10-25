import { describe, it, expect, beforeEach } from 'vitest';

// Movement on a Ketch'em board (src/ketchem/controls.js) and the Ketch'em lines of Root's look. The hand-built 32x32
// world of board.test.js: mainland x 2..19 / y 2..29, a mountain wall at x 10 (y 2..20), a river down x 6, an island
// at x 26..29 / y 10..15 across 6 tiles of sea, a lake at (14..15, 26..27); plus a road along y 24 from a store at
// (2,24) to one at (18,24), a branch down x 12 to a store at (12,29), and a bridge east from (19,12) to the island.
const sim = await import('../sim.js');
const B = await import('./board.js');
const F = await import('./fog.js');
const C = await import('./controls.js');
const v = await import('../visit.js');

const RIVER = () => ({ entryDir: 0, exitDir: 4, volume: 2, lake: false, sourcePool: false, estuary: false, curveOffset: 0, poolSize: 0 });
const LAKE = () => ({ entryDir: -1, exitDir: -1, volume: 1, lake: true, sourcePool: false, estuary: false, curveOffset: 0, poolSize: 0.5 });
const at = (x, y) => sim.idx(x, y);

function world() {
  sim.setWorldSize(32);
  sim.initWorld(777);
  sim.CFG.riverAccumThreshold = 1e9;
  for (let i = 0; i < 32 * 32; i++) {
    const x = i % 32, y = (i / 32) | 0;
    const main = x >= 2 && x <= 19 && y >= 2 && y <= 29, isle = x >= 26 && x <= 29 && y >= 10 && y <= 15;
    sim.grid[i] = (main || isle) ? sim.T.PLAINS : sim.T.OCEAN; sim.elev[i] = (main || isle) ? 1 : 0; sim.volcActive[i] = 0;
  }
  for (let y = 2; y <= 20; y++) { sim.grid[at(10, y)] = sim.T.MOUNTAIN; sim.elev[at(10, y)] = 9; }   // high, so a sim step's reclassification keeps the wall
  sim.generateRivers();
  for (let i = 0; i < 32 * 32; i++) sim.riverData[i] = null;
  for (let y = 2; y <= 29; y++) sim.riverData[at(6, y)] = RIVER();
  for (const [x, y] of [[14, 26], [15, 26], [14, 27], [15, 27]]) sim.riverData[at(x, y)] = LAKE();
  sim.flora.length = 0; sim.fauna.length = 0; sim.road.fill(0);
  for (let x = 2; x <= 18; x++) sim.road[at(x, 24)] = 1;
  for (let y = 24; y <= 29; y++) sim.road[at(12, y)] = 1;
  for (let x = 19; x <= 26; x++) sim.road[at(x, 12)] = 1;
  const stores = [{ x: 2, y: 24, i: at(2, 24), q: 0, name: 'A', revealed: true }, { x: 18, y: 24, i: at(18, 24), q: 1, name: 'B', revealed: false }, { x: 12, y: 29, i: at(12, 29), q: 3, name: 'C', revealed: false }];
  const signposts = B.placeSignposts(stores);
  const K = { stores, signposts, landmarks: [{ x: 15, y: 20, kind: 'cairn', name: 'Grassland cairn' }], fog: F.newFog(32 * 32), starts: [{ store: 0, x: 3, y: 24 }, { store: 1, x: 17, y: 24 }], kevin: null, root: null };
  return K;
}

describe('the ground table (12)', () => {
  beforeEach(() => world());
  it('reads stride and blocks from the tile', () => {
    expect(C.groundOf(at(8, 24))).toEqual({ kind: 'road', stride: 4 });
    expect(C.groundOf(at(8, 20))).toEqual({ kind: 'open', stride: 2 });
    expect(C.groundOf(at(6, 20))).toEqual({ kind: 'river', stride: 2 });
    expect(C.groundOf(at(10, 5))).toEqual({ kind: 'steep', stride: 1 });
    expect(C.groundOf(at(22, 20))).toEqual({ kind: 'water', stride: 1 });
    expect(C.groundOf(at(14, 26)).kind).toBe('blocked');
    sim.grid[at(8, 8)] = sim.T.VOLCANIC; expect(C.groundOf(at(8, 8)).why).toBe('volcanic rock');
    sim.grid[at(8, 8)] = sim.T.PLAINS; sim.volcActive[at(8, 8)] = 1; expect(C.groundOf(at(8, 8)).why).toBe('an active vent');
  });
});

describe('Kevin on the keys (22.1)', () => {
  let K;
  beforeEach(() => { K = world(); K.kevin = C.newPlayer(3, 24); });

  it('allows 4 road tiles in one window, then is winded until the window turns', () => {
    const p = K.kevin;
    for (let k = 0; k < 4; k++) expect(C.tryStep(K, p, 1, 0).ok).toBe(true);
    expect(C.tryStep(K, p, 1, 0)).toMatchObject({ ok: false, why: 'winded' });
    for (let k = 0; k < C.WINDOW_TICKS; k++) sim.step();
    expect(C.tryStep(K, p, 1, 0).ok).toBe(true);
    expect([p.x, p.y]).toEqual([8, 24]);
  });

  it('allows 2 tiles on open land and mixes the costs', () => {
    const p = K.kevin; p.x = 12; p.y = 14;
    expect(C.tryStep(K, p, 1, 0).ok).toBe(true); expect(C.tryStep(K, p, 1, 0).ok).toBe(true);
    expect(C.tryStep(K, p, 1, 0).ok).toBe(false);          // 2 open tiles fill the window
    for (let k = 0; k < C.WINDOW_TICKS; k++) sim.step();
    expect(C.tryStep(K, p, 0, -1).ok).toBe(true);          // open: half the window
    expect(C.tryStep(K, p, 0, -1).ok).toBe(true);          // open: the other half
    expect(C.tryStep(K, p, 0, -1).ok).toBe(false);
  });

  it('is stopped by a lake, the edge and volcanic rock, with the reason', () => {
    const p = K.kevin; p.x = 13; p.y = 26;
    expect(C.tryStep(K, p, 1, 0)).toMatchObject({ ok: false, why: 'a lake' });
    p.x = 0; p.y = 24; expect(C.tryStep(K, p, -1, 0).why).toBe('the edge of the world');
  });

  it('takes a boat off the shore and leaves it on landing', () => {
    const p = K.kevin; p.x = 19; p.y = 20;
    expect(C.tryStep(K, p, 1, 0)).toMatchObject({ ok: true, kind: 'water' }); expect(p.boat).toBe(true);
    expect(C.tryStep(K, p, 1, 0).ok).toBe(false);                 // at sea: one tile per window
    for (let k = 0; k < C.WINDOW_TICKS; k++) sim.step();
    p.x = 25; p.y = 13; expect(C.tryStep(K, p, 1, 0).ok).toBe(true); expect(p.boat).toBe(false);   // the island
  });

  it('Shift walks a whole stride and stops at steep ground', () => {
    const p = K.kevin; p.x = 3; p.y = 24;
    expect(C.strideStep(K, p, 1, 0)).toBe(4); expect([p.x, p.y]).toEqual([7, 24]);
    for (let k = 0; k < C.WINDOW_TICKS; k++) sim.step();
    p.x = 8; p.y = 21; expect(C.strideStep(K, p, 1, 0)).toBe(2);   // open land: 2
    for (let k = 0; k < C.WINDOW_TICKS; k++) sim.step();
    p.x = 9; p.y = 10; expect(C.strideStep(K, p, 1, 0)).toBe(1); expect(p.x).toBe(10);   // onto the mountain, then stop
  });

  it('clears the fog around every step, for the save', () => {
    const p = K.kevin;
    expect(F.revealedCount(K.fog, 32 * 32)).toBe(0);
    C.tryStep(K, p, 1, 0);
    expect(F.isRevealed(K.fog, at(8, 28))).toBe(1); expect(F.isRevealed(K.fog, at(9, 24))).toBe(0);
  });

  it('E reads the signpost, the store, the landmark or nothing', () => {
    const p = K.kevin;
    expect(C.interact(K, p)).toEqual({ kind: 'signpost', text: 'E: C 13' });
    p.x = 2; expect(C.interact(K, p).kind).toBe('store');
    p.x = 15; p.y = 20; expect(C.interact(K, p)).toEqual({ kind: 'landmark', text: 'Grassland cairn' });
    p.x = 8; expect(C.interact(K, p).text).toBe('nothing here');
  });
});

describe('Root walks the table (12, 22.4)', () => {
  let K, st;
  beforeEach(() => { K = world(); st = v.newVisitState(); st.x = 17; st.y = 24; });

  it('strides 4 on a road, 2 on open land, 1 at sea by boat, and stops on steep ground', () => {
    expect(C.legWalk(K, st, 'W', 4)).toBe('walked 4W'); expect(st.x).toBe(13);
    st.x = 8; st.y = 21; expect(C.legWalk(K, st, 'E', 4)).toBe('walked 2/4E, stride'); expect(st.x).toBe(10);   // open land: two tiles spend the stride
    st.x = 8; st.y = 20; expect(C.legWalk(K, st, 'N', 2)).toBe('walked 2N');
    st.x = 9; st.y = 10; expect(C.legWalk(K, st, 'E', 2)).toBe('walked 1/2E, steep'); expect(st.x).toBe(10);
  });

  it('a route follows the ground leg by leg and reports the boat', () => {
    st.x = 3; st.y = 24;
    expect(C.routeWalk(K, st, '8E')).toBe('walked 4E 4E'); expect(st.x).toBe(11);
    st.x = 19; st.y = 20;
    expect(C.routeWalk(K, st, '2E')).toBe('walked 1E (boat) 1E (boat)'); expect(st.boat).toBe(true);   // at sea: one tile a leg
    st.x = 8; st.y = 21; expect(C.routeWalk(K, st, '4E')).toBe('walked 2E 2E'); expect(st.x).toBe(12);  // open land: two a leg
    st.x = 13; st.y = 26;
    expect(C.routeWalk(K, st, '2E')).toBe('walked 0/2E, blocked: a lake');
  });

  it('the look carries the game: = and S in the ground row, the signpost, found stores and Kevin', () => {
    K.kevin = C.newPlayer(14, 24);
    const text = v.perceive(st, K);
    const rows = text.split('\n').slice(1, 10).map(r => r.split('  ')[0]);
    expect(rows[4]).toBe('====@SgOO');                              // road west, Root, store B, shore, sea
    expect(text).toMatch(/^signpost here: W: C 9$/m);              // B's doorstep: C down the road (one diagonal) is nearer than A
    expect(text).not.toMatch(/^store "B"/m);                        // B is not revealed yet
    K.stores[1].revealed = true;
    expect(v.perceive(st, K)).toMatch(/^store "B" 1E/m);
    expect(v.perceive(st, K)).toMatch(/^Kevin 3W$/m);
    K.kevin.boat = true;
    expect(v.perceive(st, K)).toMatch(/^Kevin 3W \(boat\)$/m);
  });

  it('a look without a board is unchanged', () => {
    expect(v.perceive(st)).not.toMatch(/=|signpost|Kevin/);
  });
});
