import { describe, it, expect, beforeEach } from 'vitest';

// Root's body rules (src/visit.js). A hand-built map keeps these fast and exact: ocean everywhere,
// one land rectangle at x 8..23, y 8..23, a mountain at (16,12), and Root standing at (16,16).
const sim = await import('./sim.js');
const v = await import('./visit.js');

function world() {
  sim.setWorldSize(32);
  sim.initWorld(4242);
  for (let i = 0; i < 32 * 32; i++) {
    const x = i % 32, y = (i / 32) | 0;
    sim.grid[i] = (x >= 8 && x <= 23 && y >= 8 && y <= 23) ? sim.T.PLAINS : sim.T.OCEAN;
    sim.volcActive[i] = 0;
    if (sim.riverData) sim.riverData[i] = null;
  }
  sim.grid[sim.idx(16, 12)] = sim.T.MOUNTAIN;
  sim.flora.length = 0; sim.fauna.length = 0;
  const st = v.newVisitState(); st.x = 16; st.y = 16;
  return st;
}

describe('visit: what Root perceives', () => {
  let st;
  beforeEach(() => { st = world(); });

  it('sees exactly its square, centred on itself', () => {
    const lines = v.perceive(st).split('\n');
    expect(lines[0]).toMatch(/^t\d+ @16,16 grassland /);     // head: tick, position, biome (seasons are off here)
    const rows = lines.slice(1, 2 + 2 * v.SIGHT).map(r => r.split('  '));
    expect(rows).toHaveLength(2 * v.SIGHT + 1);
    rows.forEach(([g, l]) => { expect(g).toHaveLength(2 * v.SIGHT + 1); expect(l).toHaveLength(2 * v.SIGHT + 1); });
    expect(rows[v.SIGHT][0][v.SIGHT]).toBe('@');
    expect(rows[0][0][v.SIGHT]).toBe('M');        // the mountain 4 north is inside the square
  });

  it('does not see a creature one tile outside its sight', () => {
    sim.fauna.push(sim.makeFauna(16 + v.SIGHT + 1, 16, 'herbivore'));
    expect(v.perceive(st)).not.toMatch(/^H /m);
    sim.fauna.push(sim.makeFauna(16 + v.SIGHT, 16, 'herbivore'));
    expect(v.perceive(st)).toMatch(/^H 4E /m);
  });
});

describe('visit: how Root moves', () => {
  let st;
  beforeEach(() => { st = world(); });

  it('walks up to three tiles and clamps longer strides', () => {
    v.walkFrom(st, 'E', 10);
    expect([st.x, st.y]).toEqual([16 + v.MAX_STRIDE, 16]);
  });

  it('is stopped by the sea at the shore', () => {
    st.x = 23;
    expect(v.walkFrom(st, 'E', 2)).toBe('walked 0/2E, blocked: open ocean');
    expect(st.x).toBe(23);
  });

  it('stops after one step onto steep ground', () => {
    st.y = 13;
    expect(v.walkFrom(st, 'N', 3)).toBe('walked 1/3N, steep');
    expect([st.x, st.y]).toEqual([16, 12]);
  });

  it('rejects a direction that is not a compass point, without moving', () => {
    expect(v.walkFrom(st, 'up', 1)).toContain('no direction');
    expect([st.x, st.y]).toEqual([16, 16]);
  });

  it('leaves a capped trail of footsteps for the map', () => {
    for (let k = 0; k < 3; k++) { v.walkFrom(st, 'E', 2); v.walkFrom(st, 'W', 2); }
    expect(st.trail).toHaveLength(12);
    expect(st.trail[st.trail.length - 1]).toEqual([16, 16]);
    for (let k = 0; k < v.TRAIL_MAX; k++) v.walkFrom(st, k % 2 ? 'E' : 'W', 1);
    expect(st.trail).toHaveLength(v.TRAIL_MAX);
  });

  it('steps to the nearest ground, not the centre, when the sea took its tile', () => {
    const a = v.arrivalTile(26, 20);
    expect(a).toEqual({ x: 23, y: 20 });
  });

  it('knows how long the world ran while it was away', () => {
    st.leftTick = sim.tick - 1;
    expect(v.arrivalText(st)).toContain('since you left: 1 ticks');
    st.leftTick = null;
    expect(v.arrivalText(st)).not.toContain('since you left');
  });

  it('keeps its names but not its plantings when a seed is run again from the start', () => {
    const saved = { x: 3, y: 4, places: [{ name: 'Ridge', x: 3, y: 4, tick: 900 }], planted: [{ id: 7, x: 3, y: 4, tick: 900 }],
      trail: [[3, 4]], leftTick: 1000, lastTick: 1000 };
    const later = v.adoptWorldState(saved, 1200);
    expect(later.restarted).toBe(false);
    expect(later.st.planted).toHaveLength(1);
    const again = v.adoptWorldState(saved, 50);
    expect(again.restarted).toBe(true);
    expect(again.st.places).toHaveLength(1);
    expect(again.st.planted).toHaveLength(0);
    expect(again.st.trail).toHaveLength(0);
    expect(v.adoptWorldState(null, 0).st.places).toEqual([]);
  });

  it('arrives on land nearest the centre', () => {
    const a = v.arrivalTile();
    expect(sim.grid[sim.idx(a.x, a.y)]).toBe(sim.T.PLAINS);
  });
});

describe('visit: what Root can do', () => {
  let st;
  beforeEach(() => { st = world(); });

  it('plants into the real flora list, five seeds per visit, never in water', () => {
    for (let k = 0; k < v.PLANTS_PER_VISIT; k++) { st.x = 10 + k; v.plantAt(st); }
    expect(st.planted).toHaveLength(v.PLANTS_PER_VISIT);
    expect(sim.flora.filter(f => f && st.planted.some(p => p.id === f.id))).toHaveLength(v.PLANTS_PER_VISIT);
    expect(v.plantAt(st)).toContain('no seeds left');
    const st2 = world(); st2.x = 2; st2.y = 2;
    expect(v.plantAt(st2)).toBe('nothing roots in water');
  });

  it('does not mistake an unrelated plant that reused its id for its own', () => {
    v.plantAt(st);
    const mine = st.planted[0];
    sim.flora.length = 0;                                   // Root's plant died...
    const imposter = sim.makeFlora(mine.x, mine.y, null);   // ...and after a load an unrelated plant got its id
    imposter.id = mine.id; sim.flora.push(imposter);
    expect(v.arrivalText(st)).toContain('planted 1, alive 0');
  });

  it('keeps a look short: one head line, nine rows, one tally', () => {
    sim.fauna.push(sim.makeFauna(17, 15, 'herbivore'));
    const text = v.perceive(st);
    expect(text.split('\n')).toHaveLength(1 + (2 * v.SIGHT + 1) + 2);   // head, rows, creatures, tally
    expect(text.length).toBeLessThan(400);
  });

  it('names a place once per tile, trimmed to 40 characters', () => {
    v.namePlace(st, 'first');
    v.namePlace(st, '  a   very long name that keeps on going past the limit  ');
    expect(st.places).toHaveLength(1);
    expect(st.places[0].name.length).toBeLessThanOrEqual(40);
    expect(v.namePlace(st, '   ')).toBe('a name needs a word');
  });

  it('hears a point exactly in sight and only as a bearing beyond it', () => {
    expect(v.pointText(st, 18, 15)).toBe('Kevin points 1N2E');
    expect(v.pointText(st, 30, 2)).toBe('Kevin points far northeast ~14');
  });
});
