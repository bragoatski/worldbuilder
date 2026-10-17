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
    const text = v.perceive(st);
    const lines = text.split('\n');
    const g = lines.indexOf('Ground (north is up, you are @):');
    const rows = lines.slice(g + 1, g + 2 + 2 * v.SIGHT);
    expect(rows).toHaveLength(2 * v.SIGHT + 1);
    rows.forEach(r => expect(r).toHaveLength(2 * v.SIGHT + 1));
    expect(rows[v.SIGHT][v.SIGHT]).toBe('@');
    expect(rows[0][v.SIGHT]).toBe('M');           // the mountain 4 north is inside the square
  });

  it('does not see a creature one tile outside its sight', () => {
    sim.fauna.push(sim.makeFauna(16 + v.SIGHT + 1, 16, 'herbivore'));
    expect(v.perceive(st)).toContain('No creatures in sight.');
    sim.fauna.push(sim.makeFauna(16 + v.SIGHT, 16, 'herbivore'));
    expect(v.perceive(st)).toContain('Creatures in sight (1):');
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
    expect(v.walkFrom(st, 'E', 2)).toContain('Stopped by open ocean');
    expect(st.x).toBe(23);
  });

  it('stops after one step onto steep ground', () => {
    st.y = 13;
    expect(v.walkFrom(st, 'N', 3)).toContain('Steep ground');
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
    expect(v.arrivalText(st)).toContain('The world has run 1 ticks since you left');
    st.leftTick = null;
    expect(v.arrivalText(st)).not.toContain('since you left');
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
    expect(v.plantAt(st2)).toContain('Nothing roots in water');
  });

  it('does not mistake an unrelated plant that reused its id for its own', () => {
    v.plantAt(st);
    const mine = st.planted[0];
    sim.flora.length = 0;                                   // Root's plant died...
    const imposter = sim.makeFlora(mine.x, mine.y, null);   // ...and after a load an unrelated plant got its id
    imposter.id = mine.id; sim.flora.push(imposter);
    expect(v.arrivalText(st)).toContain('1 things you have planted, 0 still live');
  });

  it('names a place once per tile, trimmed to 40 characters', () => {
    v.namePlace(st, 'first');
    v.namePlace(st, '  a   very long name that keeps on going past the limit  ');
    expect(st.places).toHaveLength(1);
    expect(st.places[0].name.length).toBeLessThanOrEqual(40);
    expect(v.namePlace(st, '   ')).toContain('needs at least one word');
  });

  it('hears a point exactly in sight and only as a bearing beyond it', () => {
    expect(v.pointText(st, 18, 15)).toBe('Kevin points at the tile 1N 2E of you.');
    expect(v.pointText(st, 30, 2)).toMatch(/^Kevin points far off to the northeast, about 14 tiles away\.$/);
  });
});
