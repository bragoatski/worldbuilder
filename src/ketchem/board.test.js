import { describe, it, expect, beforeEach } from 'vitest';

// The board rules (src/ketchem/board.js, fog.js). A hand-built 32x32 world keeps the road, bridge, store, signpost
// and fog tests fast and exact (as visit.test.js does): ocean everywhere, a mainland at x 2..19 / y 2..29 with a
// mountain wall at x 10 for y 2..20 (a gap at y 21..29) and a river down x 6; an island at x 26..29, y 10..15 with
// `gap` water tiles between (the mainland's east edge moves); a 2x2 lake at (14..15, 26..27). The last block builds
// the three real settings at 96x96.
const sim = await import('../sim.js');
const B = await import('./board.js');
const F = await import('./fog.js');
const v = await import('../visit.js');

const RIVER = () => ({ entryDir: 0, exitDir: 4, volume: 2, lake: false, sourcePool: false, estuary: false, curveOffset: 0, poolSize: 0 });
const LAKE = () => ({ entryDir: -1, exitDir: -1, volume: 1, lake: true, sourcePool: false, estuary: false, curveOffset: 0, poolSize: 0.5 });
const flat = () => 0;

function world(gap = 6) {
  sim.setWorldSize(32);
  sim.initWorld(777);
  sim.CFG.riverAccumThreshold = 1e9;          // generateRivers then allocates riverData with no river in it
  for (let i = 0; i < 32 * 32; i++) {
    const x = i % 32, y = (i / 32) | 0;
    const main = x >= 2 && x <= 25 - gap && y >= 2 && y <= 29, isle = x >= 26 && x <= 29 && y >= 10 && y <= 15;
    sim.grid[i] = (main || isle) ? sim.T.PLAINS : sim.T.OCEAN;
    sim.elev[i] = (main || isle) ? 1 : 0;
    sim.volcActive[i] = 0;
  }
  for (let y = 2; y <= 20; y++) sim.grid[sim.idx(10, y)] = sim.T.MOUNTAIN;
  sim.generateRivers();
  for (let i = 0; i < 32 * 32; i++) sim.riverData[i] = null;
  for (let y = 2; y <= 29; y++) sim.riverData[sim.idx(6, y)] = RIVER();
  for (const [x, y] of [[14, 26], [15, 26], [14, 27], [15, 27]]) sim.riverData[sim.idx(x, y)] = LAKE();
  sim.flora.length = 0; sim.fauna.length = 0; sim.road.fill(0);
}
const at = (x, y) => sim.idx(x, y);
const xy = i => [i % 32, (i / 32) | 0];

describe('board: routing one link (14.3)', () => {
  beforeEach(() => world());

  it('never crosses a mountain and bridges a river in its way', () => {
    const path = B.routeLink(at(4, 5), at(18, 5), 0, flat);
    expect(path).not.toBeNull();
    expect(path[0]).toBe(at(4, 5)); expect(path[path.length - 1]).toBe(at(18, 5));
    expect(path.some(i => B.isSteep(i))).toBe(false);
    for (const i of path) { const [x, y] = xy(i); if (x === 10) expect(y).toBeGreaterThanOrEqual(21); }   // through the gap
    expect(path.some(i => B.isRiver(i))).toBe(true);                                                     // a bridge over the river
    for (let k = 1; k < path.length; k++) { const [ax, ay] = xy(path[k - 1]), [bx, by] = xy(path[k]); expect(Math.max(Math.abs(ax - bx), Math.abs(ay - by))).toBe(1); }
  });

  it('reaches an island over a straight bridge of at most 12 water tiles', () => {
    const path = B.routeLink(at(18, 12), at(27, 12), 0, flat);
    expect(path).not.toBeNull();
    const water = path.filter(i => B.isWater(i));
    expect(water.length).toBeGreaterThan(0); expect(water.length).toBeLessThanOrEqual(B.BRIDGE_MAX);
    const [x0, y0] = xy(water[0]), [x1, y1] = xy(water[1]);
    for (let k = 1; k < water.length; k++) { const [ax, ay] = xy(water[k - 1]), [bx, by] = xy(water[k]); expect([bx - ax, by - ay]).toEqual([x1 - x0, y1 - y0]); }   // cannot turn
    const lm = B.landmassMap();
    expect(lm[at(18, 12)]).not.toBe(lm[at(27, 12)]);   // the store would be on its own landmass: reached only by the bridge
    B.layRoad(path);
    expect(sim.road[water[0]]).toBe(1);
  });

  it('gives up when the water is wider than a bridge can span', () => {
    world(13);                                   // mainland ends at x 12; water x 13..25
    expect(B.routeLink(at(11, 12), at(27, 12), 0, flat)).toBeNull();
    world(12);                                   // one tile narrower: exactly 12, a bridge fits
    expect(B.routeLink(at(11, 12), at(27, 12), 0, flat)).not.toBeNull();
  });

  it('shares an existing road instead of running beside it', () => {
    const first = B.routeLink(at(4, 25), at(18, 25), 0, flat);
    B.layRoad(first);
    const second = B.routeLink(at(4, 27), at(18, 27), 0, flat);
    const shared = second.filter(i => first.includes(i)).length;
    expect(shared).toBeGreaterThanOrEqual(8);
  });

  it('costs the terrain table', () => {
    expect(B.terrainCost(at(4, 4))).toBe(1.0);
    sim.grid[at(4, 4)] = sim.T.FOREST; expect(B.terrainCost(at(4, 4))).toBe(1.6);
    sim.grid[at(4, 4)] = sim.T.HILLS; expect(B.terrainCost(at(4, 4))).toBe(1.8);
    expect(B.terrainCost(at(6, 4))).toBe(4.0);                 // river
    sim.road[at(6, 4)] = 1; expect(B.terrainCost(at(6, 4))).toBe(0.3);   // an existing bridge
    expect(B.terrainCost(at(10, 4))).toBe(Infinity);           // mountain
    expect(B.isWater(at(14, 26))).toBe(true);                  // lake is water: bridged, never walked
  });
});

describe('board: stores and the spine (14.1, 14.2)', () => {
  beforeEach(() => world());

  it('places a store on open ground inside the quadrant margin, off rivers and mountainsides', () => {
    const rng = sim.mulberry32(5);
    for (let k = 0; k < 20; k++) {
      const s = B.placeStoreIn(0, rng);
      expect(s).not.toBeNull();
      expect(s.x).toBeGreaterThanOrEqual(6); expect(s.y).toBeGreaterThanOrEqual(6); expect(s.y).toBeLessThan(10);
      expect([7, 8]).toContain(s.x);      // x 6 is the river, x 9 has three mountain neighbours, x 10 is the wall
    }
    expect(B.placeStoreIn(1, rng)).toBeNull();   // quadrant 1 (x 16..31, y 0..15): island only, outside the margin
  });

  it('plans a spanning tree of 3 links, sometimes with 1 or 2 more', () => {
    const stores = [{ x: 4, y: 4 }, { x: 18, y: 4 }, { x: 4, y: 28 }, { x: 18, y: 28 }];
    const counts = new Set();
    for (let seed = 1; seed <= 40; seed++) {
      const links = B.planSpine(stores, sim.mulberry32(seed));
      counts.add(links.length);
      expect(links.length).toBeGreaterThanOrEqual(3); expect(links.length).toBeLessThanOrEqual(5);
      const parent = [0, 1, 2, 3], find = k => { while (parent[k] !== k) k = parent[k]; return k; };
      for (const [a, b] of links) parent[find(a)] = find(b);
      expect(new Set([0, 1, 2, 3].map(find)).size).toBe(1);   // connected
    }
    expect(counts.has(3)).toBe(true); expect(counts.has(4) || counts.has(5)).toBe(true);
  });
});

// A T junction: a road along y 24 from store A (2,24) to store B (18,24), and a branch down x 12 to store C (12,29).
function tJunction() {
  for (let x = 2; x <= 18; x++) sim.road[at(x, 24)] = 1;
  for (let y = 24; y <= 29; y++) sim.road[at(12, y)] = 1;
  return [{ x: 2, y: 24, i: at(2, 24), q: 0, name: 'A' }, { x: 18, y: 24, i: at(18, 24), q: 1, name: 'B' }, { x: 12, y: 29, i: at(12, 29), q: 3, name: 'C' }];
}

describe('board: signposts (14.5)', () => {
  beforeEach(() => world());

  it('names the nearest store down each branch with its road distance', () => {
    const stores = tJunction();
    expect(B.signpostText(at(12, 24), stores)).toBe('E: B 6 - S: C 5 - W: A 10');
    expect(B.signpostText(at(3, 24), stores)).toBe('E: C 13');       // A's doorstep: A itself is not a destination; C (13) is nearer than B (15) down the one road out
  });

  it('stands at every junction and every store doorstep', () => {
    const stores = tJunction();
    const posts = B.placeSignposts(stores);
    const where = posts.map(p => p.x + ',' + p.y);
    expect(where).toContain('12,24');
    expect(stores.map(s => s.door.x + ',' + s.door.y).sort()).toEqual(['12,28', '17,24', '3,24']);
    for (const s of stores) expect(where).toContain(s.door.x + ',' + s.door.y);
    for (const p of posts) { expect(sim.road[at(p.x, p.y)]).toBe(1); expect(stores.some(s => s.x === p.x && s.y === p.y)).toBe(false); }
  });
});

describe('fog (16)', () => {
  beforeEach(() => world());

  it('packs one bit per tile and clears a clipped square', () => {
    const K = { stores: [], fog: F.newFog(32 * 32) };
    expect(K.fog.length).toBe(128);
    F.revealSquare(K, 0, 0, 2);
    expect(F.revealedCount(K.fog, 32 * 32)).toBe(9);
    expect(F.isRevealed(K.fog, at(2, 2))).toBe(1); expect(F.isRevealed(K.fog, at(3, 2))).toBe(0);
    F.revealSquare(K, 16, 16, F.SIGHT_HALF);
    expect(F.revealedCount(K.fog, 32 * 32)).toBe(9 + 81);
  });

  it('reveals a store once a road leading to it is revealed within 12 road tiles', () => {
    const stores = tJunction().map(s => ({ ...s, revealed: false }));
    const K = { stores, fog: F.newFog(32 * 32) };
    // Roads are 8-connected: from C (12,29) the road runs up x 12 to (12,25), steps diagonally to (11,24), then west.
    F.revealSquare(K, 3, 24, 0);           // road distances: A 1, C 4 + 1 + 8 = 13, B 15
    expect(stores.map(s => s.revealed)).toEqual([true, false, false]);
    expect(F.isRevealed(K.fog, stores[0].i)).toBe(1);       // the store shows; its surroundings stay fogged
    expect(F.isRevealed(K.fog, at(2, 23))).toBe(0);
    F.revealSquare(K, 4, 24, 0);           // C 12, B 14
    expect(stores.map(s => s.revealed)).toEqual([true, false, true]);
    F.revealSquare(K, 5, 24, 0);           // B 13; C's revealed tile is 11 from B but a store tile is not a road sighting
    expect(stores[1].revealed).toBe(false);
    F.revealSquare(K, 6, 24, 0);           // B 12
    expect(stores[1].revealed).toBe(true);
  });
});

describe('flora and roads (critic note, step 1)', () => {
  beforeEach(() => world());

  it('clears plants from road tiles and around stores, nothing else', () => {
    const stores = tJunction();
    sim.flora.push(sim.makeFlora(8, 24, null), sim.makeFlora(17, 25, null), sim.makeFlora(8, 10, null));
    expect(B.clearRoadFlora(stores)).toBe(2);
    expect(sim.flora.length).toBe(1); expect([sim.flora[0].x, sim.flora[0].y]).toEqual([8, 10]);
  });

  it('the Hand seeds no plant on a road and Root plants none there', () => {
    const R = sim.CFG.seedRadius | 0;
    for (let y = 12 - R; y <= 12 + R; y++) for (let x = 14 - R; x <= 14 + R; x++) sim.road[at(x, y)] = 1;
    expect(sim.seedLifeAt(14, 12)).toBeNull();
    expect(sim.flora.length).toBe(0);
    sim.road.fill(0);
    expect(sim.seedLifeAt(14, 12)).not.toBeNull();
    sim.flora.length = 0;
    const st = v.newVisitState(); st.x = 14; st.y = 12; sim.road[at(14, 12)] = 1;
    expect(v.plantAt(st)).toBe('nothing roots in a road');
    expect(sim.flora.length).toBe(0);
  });
});

// The real thing: one board per setting at 96x96. Structure is asserted here; the time budget (under 20 s per board
// on this machine) is measured standalone by scripts/ketchem-boards.mjs, because vitest runs files in parallel and a
// loaded machine would make a tight timing assertion flaky. A loose ceiling still catches a pathological regression.
describe('board: the three settings build whole (15)', () => {
  for (const setting of B.SETTING_IDS) {
    it(setting + ' builds a connected, fogged, store-on-the-road board', () => {
      const t0 = Date.now();
      const K = B.buildBoard({ setting, seed: 11, size: 96 });
      const ms = Date.now() - t0;
      console.log(`${setting}: ${ms} ms, ${K.ticks} ticks, land ${(K.land * 100).toFixed(1)}% of ${(K.target * 100).toFixed(0)}%, links ${K.links.length}, spurs ${K.spurs.length}, signposts ${K.signposts.length}`);
      expect(ms).toBeLessThan(60000);
      expect(K.land).toBeGreaterThanOrEqual(K.target - 0.01);
      expect(K.stores).toHaveLength(4);
      expect(new Set(K.stores.map(s => s.q)).size).toBe(4);
      for (const s of K.stores) { expect(sim.road[s.i]).toBe(1); expect(B.isWalkable(s.i)).toBe(true); expect(sim.road[sim.idx(s.door.x, s.door.y)]).toBe(1); }
      // every store on one road network
      const seen = new Set([K.stores[0].i]), q = [K.stores[0].i];
      for (let h = 0; h < q.length; h++) { const c = q[h], x = c % 96, y = (c / 96) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (!sim.inb(nx, ny)) continue; const j = sim.idx(nx, ny); if (sim.road[j] && !seen.has(j)) { seen.add(j); q.push(j); } } }
      for (const s of K.stores) expect(seen.has(s.i)).toBe(true);
      for (let i = 0; i < 96 * 96; i++) if (sim.road[i]) expect(B.isSteep(i)).toBe(false);     // never over mountains
      for (const f of sim.flora) expect(sim.road[sim.idx(f.x, f.y)]).toBe(0);                 // no plant on a road
      expect(sim.flora.length).toBeGreaterThan(50); expect(sim.fauna.length).toBeGreaterThan(20);
      for (const f of sim.fauna) expect(f.prefElev).toBeCloseTo(Math.min(10, Math.max(0, sim.elev[sim.idx(f.x, f.y)] || 0)), 5);
      for (const p of K.signposts) expect(sim.road[sim.idx(p.x, p.y)]).toBe(1);
      for (const s of K.stores) expect(K.signposts.some(p => p.x === s.door.x && p.y === s.door.y)).toBe(true);
      // starts: two doorsteps in diagonal quadrants, revealed; the other two stores still hidden
      expect(K.starts).toHaveLength(2);
      expect(K.stores[K.starts[0].store].q + K.stores[K.starts[1].store].q).toBe(3);
      for (const st of K.starts) { expect(F.isRevealed(K.fog, sim.idx(st.x, st.y))).toBe(1); expect(K.stores[st.store].revealed).toBe(true); }
      const revealed = F.revealedCount(K.fog, 96 * 96);
      expect(revealed).toBeGreaterThanOrEqual(81); expect(revealed).toBeLessThanOrEqual(2 * 81 + 4);
      expect(sim.CFG.ecoActive).toBe(true);
      expect(sim.landCoverage()).toBeGreaterThan(sim.CFG.maxLandCap);   // frozen: no new land
    }, 120000);
  }
});
