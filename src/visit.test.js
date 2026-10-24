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

  it('a first arrival prefers ground with room over a nearer speck', () => {
    sim.grid[sim.idx(26, 26)] = sim.T.PLAINS;              // a one-tile islet right off the main land's corner
    expect(v.arrivalTile(27, 27)).toEqual({ x: 26, y: 26 });   // nearest
    const roomy = v.arrivalTile(27, 27, true);
    expect(roomy.x).toBeLessThanOrEqual(23);              // on the main land instead
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

describe('visit: a friend and a field guide', () => {
  let st;
  beforeEach(() => { st = world(); });

  it('befriends only a creature within one tile, and names it', () => {
    sim.fauna.push(sim.makeFauna(16 + 2, 16, 'herbivore'));
    expect(v.befriend(st, 'Pip')).toBe('no creature within reach (1 tile)');
    sim.fauna.push(sim.makeFauna(17, 15, 'herbivore'));
    expect(v.befriend(st, 'Pip')).toBe('befriended H 1N1E as "Pip"');
    expect(v.perceive(st)).toMatch(/H "Pip" 1N1E /);
    expect(v.befriend(st, '  ')).toBe('a friend needs a name');
  });

  it('a friend drifts back toward Root, one tile per tick, never into the sea', () => {
    const f = sim.makeFauna(17, 16, 'herbivore'); sim.fauna.push(f);
    v.befriend(st, 'Pip');
    st.x = 21;                                            // Root walks off 4 tiles east
    v.companionTick(st);
    expect([f.x, f.y]).toEqual([18, 16]);                 // one step closer
    v.companionTick(st);
    expect([f.x, f.y]).toEqual([19, 16]);                 // still 3 away: another step
    v.companionTick(st);
    expect([f.x, f.y]).toEqual([19, 16]);                 // within the follow gap now: stays put
    sim.grid[sim.idx(12, 16)] = sim.T.OCEAN;              // water between them
    st.x = 10; f.x = 14; f.y = 16;
    v.companionTick(st);
    expect(f.x).toBe(13);
    v.companionTick(st);
    expect(f.x).toBe(13);                                 // the next tile is sea: it waits rather than swim
  });

  it('notices once when a friend dies, and remembers its line', () => {
    const f = sim.makeFauna(17, 16, 'herbivore'); sim.fauna.push(f);
    v.befriend(st, 'Pip');
    sim.fauna.length = 0;
    expect(v.companionTick(st)).toBe('gone');
    expect(v.companionTick(st)).toBe(null);
    expect(v.arrivalText(st)).toMatch(/friend "Pip" \(H\): gone since t\d+, its line 0 living/);
  });

  it('a world started over forgets the friend', () => {
    const saved = { companion: { id: 3, lineageId: 3, type: 'herbivore', name: 'Pip' }, lastTick: 1000 };
    expect(v.adoptWorldState(saved, 10).st.companion).toBe(null);
    expect(v.adoptWorldState(saved, 2000).st.companion.name).toBe('Pip');
  });

  it('records only named species for the guide, once per species', () => {
    const young = sim.makeFauna(17, 16, 'herbivore'); sim.fauna.push(young);
    expect(v.sightings(st)).toEqual([]);                 // too young a lineage to have a name
    const old = sim.makeFauna(18, 16, 'herbivore', { ...young, gen: 5 });
    const twin = sim.makeFauna(19, 16, 'herbivore', { ...young, gen: 6 });
    sim.fauna.push(old, twin);
    const seen = v.sightings(st);
    expect(seen).toHaveLength(1);
    expect(seen[0].name).toBe(sim.getSpeciesName(old));
  });

  it('walks a whole route in one call, and stops at the first leg that cannot finish', () => {
    expect(v.walkPath(st, '2N2E')).toBe('walked 2N 2E');
    expect([st.x, st.y]).toEqual([18, 14]);
    st.x = 20; st.y = 16;
    expect(v.walkPath(st, '5E 1N')).toBe('walked 3E 0/2E, blocked: open ocean');
    expect([st.x, st.y]).toEqual([23, 16]);
    expect(v.walkPath(st, 'up')).toContain('no route');
  });
});

describe('visit: the Hand in Root\'s hands (Shaper and Sky)', () => {
  let st;
  beforeEach(() => { st = world(); });

  it('reads a bearing in sight as a tile, and refuses one beyond it', () => {
    expect(v.tileAtBearing(st, '')).toEqual({ x: 16, y: 16, where: 'here' });
    expect(v.tileAtBearing(st, '2N1E')).toEqual({ x: 17, y: 14, where: 'at 2N1E' });
    expect(v.tileAtBearing(st, '5S').error).toMatch(/out of sight/);
    expect(v.tileAtBearing(st, 'over there').error).toMatch(/no bearing/);
  });

  it('raises land out of the sea where the brush crosses the coast, and clamps the radius to the mode', () => {
    st.x = 23;                                                    // the east shore
    const r = v.shapeAt(24, 16, 'raise', 9, v.SHAPER_RADIUS_MAX, 'at 1E');
    expect(r).toMatch(/^raised r3 at 1E: \d+ tiles rose from the sea$/);
    expect(sim.grid[sim.idx(24, 16)]).not.toBe(sim.T.OCEAN);
    expect(v.shapeAt(16, 16, 'melt', 2, 3, 'here')).toMatch(/^no power/);
    expect(v.shapeAt(40, 40, 'raise', 2, 3, 'here')).toBe('nothing: beyond the edge');
  });

  it('sinks the ground under Root into the sea, which the page then walks it off', () => {
    const r = v.shapeAt(16, 16, 'sink', 3, 3, 'here');
    expect(r).toMatch(/^sank r3 here: \d+ tiles sank beneath the sea$/);
    expect(sim.grid[sim.idx(16, 16)]).toBe(sim.T.OCEAN);
    expect(v.arrivalTile(16, 16)).not.toBeNull();                 // there is still ground to step to
  });

  it('paints climate without moving the coast', () => {
    const before = sim.grid[sim.idx(16, 16)];
    expect(v.shapeAt(16, 16, 'rain', 2, 3, 'here')).toBe('rained r2 here');
    expect(v.shapeAt(16, 16, 'chill', 1, 3, 'at 0')).toBe('chilled r1 at 0');
    expect([sim.T.OCEAN, sim.T.COAST]).not.toContain(sim.grid[sim.idx(16, 16)]);
    expect(before).not.toBe(sim.T.OCEAN);
  });

  it('fire craters low ground as a meteor and refuses the open sea for springs and seeds', () => {
    sim.fauna.push(sim.makeFauna(16, 16, 'herbivore'));
    expect(v.emberAt(16, 16, 'here')).toMatch(/^meteor here: 1 creature killed$/);
    expect(v.springAt(2, 2, 'at 2,2')).toBe('nothing: open ocean');
    expect(v.seedAt(2, 2, 'at 2,2')).toBe('nothing at 2,2: open ocean');
    expect(v.emberAt(99, 99, 'at 99,99')).toBe('nothing: beyond the edge');
  });

  it('seeds plants on bare ground, in words', () => {
    sim.flora.length = 0;
    expect(v.seedAt(20, 20, 'at 2S')).toMatch(/^seeded \d+ plants at 2S$/);
    expect(sim.flora.length).toBeGreaterThan(0);
  });

  it('world events answer in counts', () => {
    expect(v.weatherEvent('bloom')).toMatch(/^bloom: \d+ plants sprang up$/);
    expect(v.weatherEvent('drought')).toMatch(/^drought: \d+ plants withered$/);
    expect(v.weatherEvent('fog')).toMatch(/^no weather/);
    expect(v.seaEvent('raise')).toMatch(/^sea rose: \d+ tiles? drowned$/);
    expect(v.seaEvent('sideways')).toMatch(/^no direction/);
  });

  it('marks every power for the Hand\'s undo, and a power that did nothing hands the mark back', () => {
    expect(sim.godCanUndo()).toBe(false);
    expect(v.seedAt(2, 2, 'at 2,2')).toMatch(/open ocean/);     // marked, then nothing happened: mark cancelled
    expect(sim.godCanUndo()).toBe(false);
    sim.flora.length = 0;
    expect(v.weatherEvent('drought')).toBe('drought: 0 plants withered');
    expect(sim.godCanUndo()).toBe(false);
    v.shapeAt(16, 16, 'warm', 1, 3, 'here');
    expect(sim.godCanUndo()).toBe(true);
    v.seedAt(2, 2, 'at 2,2');                                     // a no-op after a real act keeps the real act undoable
    expect(sim.godCanUndo()).toBe(true);
  });

  it('reads diagonal bearings and clamps a zero radius to one', () => {
    expect(v.tileAtBearing(st, '2NE')).toEqual({ x: 18, y: 14, where: 'at 2N2E' });
    expect(v.shapeAt(16, 16, 'rain', 0, 3, 'here')).toBe('rained r1 here');
  });
});

describe('visit: the sky\'s way of seeing', () => {
  let st;
  beforeEach(() => { st = world(); });

  it('surveys the whole world as a coarse grid with a census head and a ruler', () => {
    sim.fauna.push(sim.makeFauna(16, 16, 'carnivore'));
    const lines = v.survey(st).split('\n');
    const cell = Math.ceil(32 / v.SKY_CELLS);
    expect(lines[0]).toMatch(/^t\d+ 32x32 land \d+% plants \d+ H0 C1 O0 S0 A0 species \d+ · cell \d+$/);
    expect(lines[1]).toMatch(/^\s*x 0 /);
    const rows = lines.slice(2).filter(l => /^\s*\d+ {2}/.test(l));
    expect(rows).toHaveLength(Math.ceil(32 / cell));
    const [, g, l] = rows[0].trim().split(/\s{2}/);
    expect(g).toHaveLength(Math.ceil(32 / cell)); expect(l).toHaveLength(Math.ceil(32 / cell));
    expect(g[0]).toBe('O');                                      // the north-west corner is open sea
    expect(v.survey(st)).toContain('C');                         // the carnivore shows as its letter
    expect(v.survey(st).length).toBeLessThan(1200);
  });

  it('lists its names by tile and names a tile it is not standing on', () => {
    expect(v.namePlace(st, 'The Mountain', 16, 12)).toBe('named "The Mountain"');
    expect(v.survey(st)).toMatch(/named "The Mountain" 16,12$/);
    expect(v.namePlace(st, 'Nowhere', 99, 99)).toBe('nothing: beyond the edge');
  });

  it('zooms to any tile as a 9x9 look, and remembers the gaze', () => {
    const look = v.gazeAt(st, 10, 10);
    expect(look.split('\n')[0]).toMatch(/^t\d+ @10,10 /);
    expect([st.x, st.y]).toEqual([10, 10]);
    expect(v.gazeAt(st, 40, 2)).toMatch(/^nothing: beyond the edge/);
    expect(v.pointText(st, 3, 4, 'sky')).toBe('Kevin points at 3,4');
  });

  it('never lets a missing or garbage coordinate land on tile 0,0', () => {
    expect(v.tileArg({ x: 5 }).error).toMatch(/whole tile numbers/);
    expect(v.tileArg({ x: 'abc', y: 2 }).error).toMatch(/whole tile numbers/);
    expect(v.tileArg({ x: 1.5, y: 2 }).error).toMatch(/whole tile numbers/);
    expect(v.tileArg({ x: -1, y: 2 }).error).toMatch(/beyond the edge/);
    expect(v.tileArg({ x: 0, y: 0 })).toEqual({ x: 0, y: 0, where: 'at 0,0' });
    expect(v.gazeAt(st, undefined, 3)).toMatch(/whole tile numbers/);
    expect([st.x, st.y]).toEqual([16, 16]);
  });

  it('tells the sky its names and friend by tile, not by bearing', () => {
    v.namePlace(st, 'Far Rock', 9, 9);
    expect(v.arrivalText(st, 'sky')).toContain('"Far Rock" 9,9');
    expect(v.arrivalText(st)).toMatch(/"Far Rock" ~7 northwest/);
  });

  it('caps the survey\'s list of names', () => {
    for (let k = 0; k < v.SURVEY_NAMES + 3; k++) v.namePlace(st, 'P' + k, 8 + (k % 16), 8 + ((k / 16) | 0));
    const tail = v.survey(st).split('\n').pop();
    expect(tail).toMatch(/; \+3 older$/);
    expect(tail).not.toContain('"P0"');
  });
});

describe('visit: modes', () => {
  it('each mode has its own tool set, and the body never has the sky\'s reach', async () => {
    const m = await import('../visit/modes.mjs');
    expect(m.MODE_IDS).toEqual(['visitor', 'shaper', 'sky']);
    expect(m.verbsFor('visitor')).toEqual(['look', 'walk', 'plant', 'name_place', 'befriend', 'guide', 'say', 'listen', 'note', 'leave']);
    expect(m.verbsFor('shaper')).toEqual(expect.arrayContaining(['walk', 'shape', 'ember', 'spring', 'seed', 'leave']));
    expect(m.verbsFor('shaper')).not.toContain('weather');
    expect(m.verbsFor('sky')).toEqual(expect.arrayContaining(['survey', 'zoom', 'shape', 'weather', 'sea', 'name_place', 'leave']));
    expect(m.verbsFor('sky')).not.toContain('walk');
    expect(m.modeOf('god')).toBe('visitor');
    expect(m.modeOf('constructor')).toBe('visitor');
    expect(m.modeOf('__proto__')).toBe('visitor');
    for (const id of m.MODE_IDS) for (const t of m.toolsFor(id)) expect(t.inputSchema.type).toBe('object');
  });
});
