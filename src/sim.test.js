import { describe, it, expect } from 'vitest';
import { installDomStub } from '../scripts/headless-dom.mjs';

installDomStub();

const sim = await import('./main.js');

describe('in-page assertions (headless)', () => {
  it('every assertion passes after a fresh world init', () => {
    sim.initWorld(12345);
    const { pass, fail, out } = sim.runAssertions();
    // Surface the full assertion log if anything is red.
    expect(fail, '\n' + out.join('\n')).toBe(0);
    expect(pass).toBeGreaterThan(40);
  });

  it('is deterministic for a fixed seed (terrain)', () => {
    sim.initWorld(777);
    const landA = sim.landCoverage();
    sim.initWorld(777);
    const landB = sim.landCoverage();
    expect(landB).toBe(landA);
  });

  // Step 1 of the balance plan: the ecology RNG (eRng) is now seeded, so a fixed seed
  // reproduces the same ECOLOGY run, not just the terrain. Warm up, seed fauna, run, and
  // assert two identical-seed runs land on identical flora/fauna counts.
  it('is deterministic for a fixed seed (ecology)', () => {
    function run() {
      sim.initWorld(2024);
      for (let i = 0; i < 600; i++) sim.step();
      sim.seedFloraCluster(20);
      sim.seedFaunaGroup('herbivore', 12);
      sim.seedFaunaGroup('carnivore', 4);
      for (let i = 0; i < 200; i++) sim.step();
      return { flora: sim.flora.length, fauna: sim.fauna.length };
    }
    const a = run();
    const b = run();
    expect(b).toEqual(a);
  }, 30000);

  // Step 2 of the balance plan: snapshot/restore lets the harness warm the slow terrain ONCE and
  // replay the ecology window many times. The contract that makes that valid is determinism THROUGH
  // the snapshot: restoring one snapshot, seeding, and running must give identical results every time
  // (restoreState re-seeds both RNG streams from the stored seed). Warm once, snapshot, then restore
  // + seed + run twice and assert the flora/fauna/herb/carn counts match.
  it('is deterministic through a snapshot (warm once, replay twice)', () => {
    sim.initWorld(31337);
    for (let i = 0; i < 350; i++) sim.step();
    const snap = sim.snapshotState();
    function replay() {
      sim.restoreState(snap);
      sim.seedFloraCluster(20);
      sim.seedFaunaGroup('herbivore', 12);
      sim.seedFaunaGroup('carnivore', 4);
      for (let i = 0; i < 120; i++) sim.step();
      const herb = sim.fauna.filter((f) => f && f.type === 'herbivore').length;
      const carn = sim.fauna.filter((f) => f && f.type === 'carnivore').length;
      return { flora: sim.flora.length, fauna: sim.fauna.length, herb, carn };
    }
    const a = replay();
    const b = replay();
    expect(b).toEqual(a);
  }, 30000);

  // The browser runs `T` after the sim has developed land, not on a fresh ocean. Exercise
  // the assertions in that state so world-state-dependent flakiness (erosion luck, the biome
  // at a probed tile) is caught here rather than only showing up in the live page.
  it('every assertion passes on a developed world too', () => {
    sim.initWorld(424242);
    for (let i = 0; i < 300; i++) sim.step();
    const { fail, out } = sim.runAssertions();
    expect(fail, '\n' + out.join('\n')).toBe(0);
  }, 30000);
});

// Rivers: the hydrology rewrite (priority-flood -> D8 flow -> accumulation -> threshold) must produce
// dendritic rivers that reach the sea BY CONSTRUCTION, with no orphaned basin stubs. Warming real
// terrain to a river-bearing land coverage (~6000 ticks) is far too slow for a unit test, so we paint
// a deterministic synthetic continent (a noisy cone with one deliberate pit) and assert the structural
// invariants directly on it. grid/elev are live module bindings; mutating them in place after
// initWorld paints the surface generateRivers reads.
describe('rivers (hydrology pipeline)', () => {
  const DX = [0, 1, 1, 1, 0, -1, -1, -1], DY = [-1, -1, 0, 1, 1, 1, 0, -1];

  function paintSyntheticContinent() {
    sim.initWorld(2024); // allocates grid/elev at W*H and fixes the RNG seed
    const W = sim.W, H = sim.H, T = sim.T, grid = sim.grid, elev = sim.elev;
    const cx = W / 2, cy = H / 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let e = 9 - 0.26 * Math.hypot(x - cx, y - cy);           // cone: high centre -> coast
      // Several octaves of sine so the surface is fractal/channelized (a smooth cone gives sheet
      // flow = 2D blobs; real terrain concentrates flow into dendritic valleys).
      e += 2.2 * Math.sin(x * 0.19 + 1.3) * Math.sin(y * 0.17 + 0.7);
      e += 1.4 * Math.sin(x * 0.33 - 0.5) * Math.cos(y * 0.29 + 2.1);
      e += 0.9 * Math.sin(x * 0.61 + y * 0.43);
      e += 0.5 * Math.cos(x * 0.83 - y * 0.71);
      const dp = Math.hypot(x - 34, y - 44);                   // one deliberate pit -> a lake
      if (dp < 6) e -= 4.0 * (1 - dp / 6);
      if (e < 0) e = 0;
      elev[i] = e;
      grid[i] = e < 0.6 ? T.OCEAN : T.PLAINS;
    }
    for (let x = 0; x < W; x++) { grid[x] = T.OCEAN; grid[(H - 1) * W + x] = T.OCEAN; } // sea border = outlet
    for (let y = 0; y < H; y++) { grid[y * W] = T.OCEAN; grid[y * W + W - 1] = T.OCEAN; }
  }

  it('builds a connected dendritic network, no basin stubs, with a lake', () => {
    paintSyntheticContinent();
    // Pin the DESIGN threshold here (independent of the gameplay default): the synthetic continent is a
    // high-relief cone that is far more blob-prone than the real low-relief terrain, where the shipped
    // default (6) stays dendritic across the land range (verify with scripts/river-diag.mjs). This test
    // validates the PIPELINE STRUCTURE (dendritic, reaches sea, no stubs, a lake), not the density tuning.
    sim.CFG.riverAccumThreshold = 14;
    sim.generateRivers();
    const rd = sim.riverData, grid = sim.grid, W = sim.W, H = sim.H, T = sim.T;
    const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    let river = 0, lake = 0, deadEnd = 0, reachFail = 0;
    for (let i = 0; i < W * H; i++) {
      const r = rd[i]; if (!r) continue;
      river++; if (r.lake) lake++;
      if (r.exitDir < 0 && !r.lake && !r.estuary) deadEnd++;          // a river that flows nowhere
      const x = i % W, y = (i / W) | 0;
      let px = x, py = y, steps = 0, ok = false;                       // walk exitDir to a valid terminus
      while (steps <= W + H) {
        const cur = rd[py * W + px];
        if (!cur || cur.lake || cur.estuary) { ok = true; break; }
        if (cur.exitDir < 0) { ok = false; break; }
        const nx = px + DX[cur.exitDir], ny = py + DY[cur.exitDir];
        if (!inb(nx, ny)) { ok = true; break; }
        if (grid[ny * W + nx] === T.OCEAN) { ok = true; break; }
        px = nx; py = ny; steps++;
      }
      if (!ok) reachFail++;
    }
    // Dendritic = lines, not 2D area-fill. Count fully-river 2x2 blocks (excluding lakes): rare on a
    // dendritic network, common on a blob.
    let solid = 0;
    for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
      const a = rd[y * W + x], b = rd[y * W + x + 1], c = rd[(y + 1) * W + x], d2 = rd[(y + 1) * W + x + 1];
      if (a && b && c && d2 && !a.lake && !b.lake && !c.lake && !d2.lake) solid++;
    }
    expect(river).toBeGreaterThan(20);          // a real network formed (vs the old ~7 stubs)
    expect(reachFail).toBe(0);                  // every river reaches the sea, a lake, or the map edge
    expect(deadEnd).toBe(0);                    // no orphaned dead-end basin stubs
    expect(lake).toBeGreaterThan(0);            // the pit filled into a lake (the overflow feature)
    expect(solid).toBeLessThan(river * 0.12);   // few solid 2x2 blocks -> dendritic lines, not blobs
  });

  it('is deterministic for a fixed surface', () => {
    const fingerprint = () => {
      paintSyntheticContinent();
      sim.generateRivers();
      return sim.riverData.map((r) => (r ? `${r.entryDir},${r.exitDir},${r.volume},${r.lake ? 1 : 0}` : '.')).join('|');
    };
    expect(fingerprint()).toBe(fingerprint());
  });
});

// Chronicle (the world's memory): a pure, headless-safe event log driven from step(). Two properties
// matter. (1) The pure helpers behave: the milestone ladder only advances, and chronicleNote appends a
// well-formed event. (2) The chronicle is DETERMINISTIC through the engine: replaying one snapshot twice
// must produce a byte-identical event sequence (it is derived purely from seeded sim state). The render
// (renderChronicle) is gate-blind DOM and is verified in the browser, not here.
describe('chronicle (the world\'s memory)', () => {
  it('milestone ladder only advances past the previous rung', () => {
    expect(sim._crossLadder([50, 100, 200], 150, 0)).toBe(100);
    expect(sim._crossLadder([50, 100, 200], 40, 0)).toBe(0);
    expect(sim._crossLadder([50, 100, 200], 250, 0)).toBe(200);
    expect(sim._crossLadder([50, 100, 200], 80, 50)).toBe(50);   // 80 clears no NEW rung
    expect(sim._crossLadder([50, 100, 200], 120, 50)).toBe(100);
  });

  it('chronicleNote appends a well-formed event, and initWorld clears the log', () => {
    sim.initWorld(99);
    expect(sim.chronicle.events.length).toBe(0); // pure initWorld starts with an empty chronicle
    const e = sim.chronicleNote('test', 'hello world', '#abcdef');
    expect(sim.chronicle.events.length).toBe(1);
    expect(e.kind).toBe('test');
    expect(e.text).toBe('hello world');
    expect(e.color).toBe('#abcdef');
    expect(typeof e.tick).toBe('number');
  });

  it('is deterministic through a snapshot (replay twice -> identical event sequence)', () => {
    sim.initWorld(31337);
    for (let i = 0; i < 600; i++) sim.step();
    const snap = sim.snapshotState();
    function replay() {
      sim.restoreState(snap);
      sim.seedFloraCluster(40);
      sim.seedFaunaGroup('herbivore', 24);
      sim.seedFaunaGroup('carnivore', 8);
      for (let i = 0; i < 250; i++) sim.step();
      return sim.chronicle.events.map((e) => `${e.tick}|${e.kind}|${e.text}`);
    }
    const a = replay();
    const b = replay();
    expect(b).toEqual(a);
    // The chronicle actually observed the seeded life, and every event is well-formed.
    expect(sim.chronicle.records.peakHerb).toBeGreaterThan(0);
    const kinds = new Set(['milestone', 'arrival', 'extinct', 'crash', 'vivid', 'record', 'lineage', 'terrain', 'god', 'scenario']);
    for (const e of sim.chronicle.events) {
      expect(e.tick).toBeLessThanOrEqual(sim.tick);
      expect(kinds.has(e.kind)).toBe(true);
      expect(e.text.length).toBeGreaterThan(0);
    }
  }, 30000);
});

// Evolution visibility (chunk 2): the heritable cosmetic SIZE gene + lineage ids. Two properties matter.
// (1) The genes are well-formed + heritable: every creature carries a finite size in [0.5,2.2] and a
// positive integer lineageId; kin share a lineage; the size gene drifts off the founder default of 1.0
// through reproduction. (2) The genes are BALANCE-SAFE: they live on a separate cosmetic RNG stream and
// are never read by the sim, so the ecology trajectory is deterministic and identical through a snapshot
// replay (the render + follow camera are gate-blind DOM, verified in the browser).
describe('evolution visibility (size gene + lineage)', () => {
  function warmAndSeed(seed, herb, carn, ticks) {
    sim.initWorld(seed);
    for (let i = 0; i < 600; i++) sim.step();
    sim.seedFloraCluster(40);
    sim.seedFaunaGroup('herbivore', herb);
    sim.seedFaunaGroup('carnivore', carn);
    for (let i = 0; i < ticks; i++) sim.step();
    return sim.fauna.filter((f) => f);
  }

  it('every creature carries a valid size gene and a lineage id', () => {
    const living = warmAndSeed(4242, 24, 8, 400);
    expect(living.length).toBeGreaterThan(0);
    for (const f of living) {
      expect(Number.isFinite(f.size)).toBe(true);
      expect(f.size).toBeGreaterThanOrEqual(0.5);
      expect(f.size).toBeLessThanOrEqual(2.2);
      expect(Number.isInteger(f.lineageId)).toBe(true);
      expect(f.lineageId).toBeGreaterThan(0);
    }
  }, 30000);

  it('lineages are shared by kin and the size gene diversifies through reproduction', () => {
    // Isolate this chunk-2 inheritance mechanic from the chunk-7/8 trophic tiers: scavengers + apex compete for
    // the pop cap and reshuffle the eRng stream, which for this specific seed suppresses reproduction inside the
    // 500t window (aggregate reproduction is healthy - the harness shows tens of fauna over 1000t). The size-gene
    // / lineage-kin behavior under test is independent of those tiers, so measure it with both off.
    let living;
    try {
      sim.CFG.scavengersEnabled = false;
      sim.CFG.apexEnabled = false;
      living = warmAndSeed(909090, 30, 8, 500);
    } finally {
      sim.CFG.scavengersEnabled = true; // restore the shipped defaults
      sim.CFG.apexEnabled = true;
    }
    expect(living.some((f) => f.gen > 0)).toBe(true); // descendants exist
    const counts = {};
    for (const f of living) counts[f.lineageId] = (counts[f.lineageId] || 0) + 1;
    expect(Object.values(counts).some((c) => c > 1)).toBe(true); // a lineage has living kin
    expect(living.some((f) => Math.abs(f.size - 1.0) > 1e-6)).toBe(true); // size drifted off 1.0
    expect(sim.chronicle.records.peakSize).toBeGreaterThanOrEqual(1.0); // chronicle tracked it
  }, 30000);

  it('is balance-safe: ecology + cosmetic genes are identical through a snapshot replay', () => {
    sim.initWorld(31337);
    for (let i = 0; i < 600; i++) sim.step();
    const snap = sim.snapshotState();
    function replay() {
      sim.restoreState(snap);
      sim.seedFloraCluster(40);
      sim.seedFaunaGroup('herbivore', 24);
      sim.seedFaunaGroup('carnivore', 8);
      for (let i = 0; i < 250; i++) sim.step();
      // fingerprint the ECOLOGY state (position/energy) AND the cosmetic genes (size/lineage) together
      return sim.fauna
        .filter((f) => f)
        .map((f) => `${f.id}:${f.x},${f.y}:${f.energy.toFixed(3)}:${f.size.toFixed(4)}:${f.lineageId}`);
    }
    const a = replay();
    const b = replay();
    expect(b).toEqual(a);
    expect(a.length).toBeGreaterThan(0);
  }, 30000);
});

// God powers (chunk 3, pillar D): deliberate interventions (land brush + meteor / drought / bloom). Each
// mutates the world and logs a 'god' event to the Chronicle so the act has a visible consequence. These
// are BEHAVIOR-touching, but they are only ever fired from the UI - never from step() - so they sit
// outside the measured ecology loop. The step-determinism / balance-safe evidence is the unchanged
// chunk-1/2 snapshot-replay tests above PLUS the harness before/after being byte-identical (interventions
// never run in the harness). Here the gate covers each intervention's pure core does what it claims.
describe('god powers (chunk 3, pillar D)', () => {
  it('the land brush raises ocean into land and lowers land back into ocean', () => {
    sim.initWorld(7); // a fresh world is essentially all ocean (land forms only through step())
    const i = 40 * sim.W + 40;
    expect(sim.grid[i]).toBe(sim.T.OCEAN);
    const c0 = sim.landCoverage();
    sim.brushTerrain(40, 40, +1); // raise
    expect(sim.landCoverage()).toBeGreaterThan(c0);
    expect(sim.grid[i]).not.toBe(sim.T.OCEAN);
    const c1 = sim.landCoverage();
    sim.brushTerrain(40, 40, -1); // lower the same disc back under the sea
    expect(sim.landCoverage()).toBeLessThan(c1);
    expect(sim.grid[i]).toBe(sim.T.OCEAN);
  });

  it('a meteor wipes out life in its blast radius and records the strike', () => {
    sim.initWorld(2024);
    for (let k = 0; k < 600; k++) sim.step();
    sim.seedFaunaGroup('herbivore', 40);
    const before = sim.chronicle.events.length;
    const target = sim.fauna.find((f) => f);
    const tx = target.x,
      ty = target.y;
    const killed = sim.meteorStrike(tx, ty); // explicit target -> deterministic (no eRng target pick)
    expect(killed).toBeGreaterThan(0);
    const R = sim.CFG.meteorRadius;
    for (const f of sim.fauna) if (f) expect(Math.hypot(f.x - tx, f.y - ty)).toBeGreaterThan(R + 0.5);
    expect(sim.grid[ty * sim.W + tx]).toBe(sim.T.OCEAN); // impact centre is an ocean crater
    expect(sim.chronicle.events.length).toBeGreaterThan(before);
    const last = sim.chronicle.events[sim.chronicle.events.length - 1];
    expect(last.kind).toBe('god');
    expect(last.text).toContain('meteor');
  }, 20000);

  it('a drought withers flora and records the event', () => {
    sim.initWorld(555);
    for (let k = 0; k < 600; k++) sim.step();
    sim.seedFloraCluster(300);
    const before = sim.flora.length;
    expect(before).toBeGreaterThan(0);
    const withered = sim.droughtEvent();
    expect(withered).toBeGreaterThan(0);
    expect(sim.flora.length).toBe(before - withered);
    const last = sim.chronicle.events[sim.chronicle.events.length - 1];
    expect(last.kind).toBe('god');
    expect(last.text).toContain('drought');
  }, 20000);

  it('a bloom carpets the world with new flora and records the event', () => {
    sim.initWorld(777);
    for (let k = 0; k < 600; k++) sim.step(); // develop land so flora has somewhere to root
    const before = sim.flora.length;
    const sprang = sim.bloomEvent();
    expect(sprang).toBeGreaterThan(0);
    expect(sim.flora.length).toBe(before + sprang);
    const last = sim.chronicle.events[sim.chronicle.events.length - 1];
    expect(last.kind).toBe('god');
    expect(last.text).toContain('bloom');
  }, 20000);
});

// Shareable worlds (chunk 4, thread 3): a world is fully determined at genesis by seed + CFG (terrain +
// ecology are deterministic from the seeded streams; WORLD is re-derived from the seed), so a compact
// "world code" reproduces it. Three properties matter. (1) The recipe round-trips: build -> encode ->
// decode -> build is byte-identical, and only NON-DEFAULT CFG keys ride along. (2) Applying a code
// reproduces the SAME evolving world (deterministic replay). (3) The decoder is robust to untrusted URL
// input (bad version / missing seed rejected; unknown or wrong-typed CFG keys ignored). The copy buttons +
// address-bar reflection are gate-blind DOM, verified in the browser.
describe('shareable worlds (world-code permalink)', () => {
  it('the recipe round-trips through encode/decode and carries only non-default CFG', () => {
    // applyWorldCode({cfg:{}}) resets CFG to defaults (prior tests leave CFG mutated) then inits a clean world.
    sim.applyWorldCode({ v: 1, seed: 12345, cfg: {} });
    const codeDefault = sim.buildWorldCode();
    expect(codeDefault.seed).toBe(12345);
    expect(codeDefault.v).toBe(1);
    expect(Object.keys(codeDefault.cfg).length).toBe(0); // a default world encodes to an empty diff

    sim.CFG.floraSpawnChance = 0.05; // two deliberate off-default tweaks
    sim.CFG.maxLandCap = 0.5;
    const tuned = sim.buildWorldCode();
    expect(tuned.cfg.floraSpawnChance).toBe(0.05);
    expect(tuned.cfg.maxLandCap).toBe(0.5);
    const decoded = sim.decodeWorldCode(sim.encodeWorldCode(tuned));
    expect(decoded).toEqual(tuned); // base64url round-trip is lossless
  });

  it('applying a world code reproduces the same evolving world', () => {
    sim.initWorld(31337);
    sim.CFG.maxLandCap = 0.6; // a tuned world so the CFG diff is actually exercised
    const code = sim.encodeWorldCode(sim.buildWorldCode());
    function fingerprint() {
      sim.applyWorldCode(sim.decodeWorldCode(code));
      expect(sim._seed).toBe(31337); // the seed came back
      expect(sim.CFG.maxLandCap).toBe(0.6); // the tuned CFG came back
      for (let i = 0; i < 300; i++) sim.step();
      return sim.landCoverage();
    }
    const a = fingerprint();
    const b = fingerprint();
    expect(b).toBe(a); // same recipe -> same world, twice
  }, 30000);

  it('applyWorldCode resets to defaults before layering the diff', () => {
    sim.initWorld(1);
    sim.CFG.maxLandCap = 0.42; // a leftover tweak the next code does NOT mention
    sim.applyWorldCode({ v: 1, seed: 2, cfg: { floraSpawnChance: 0.033 } });
    expect(sim.CFG.floraSpawnChance).toBe(0.033); // the code's key applied
    expect(sim.CFG.maxLandCap).toBe(0.9); // the leftover was reset to the default (not carried over)
    expect(sim._seed).toBe(2);
  });

  it('rejects malformed codes and ignores unknown / wrong-typed CFG keys (untrusted input)', () => {
    expect(() => sim.applyWorldCode(null)).toThrow();
    expect(() => sim.applyWorldCode({ v: 999, seed: 1 })).toThrow(); // unsupported version
    expect(() => sim.applyWorldCode({ v: 1 })).toThrow(); // no seed
    sim.applyWorldCode({ v: 1, seed: 7, preset: 'not-a-preset', cfg: { notARealKey: 42, maxLandCap: 'big' } });
    expect(sim._seed).toBe(7);
    expect(sim.CFG.notARealKey).toBeUndefined(); // unknown key dropped
    expect(typeof sim.CFG.maxLandCap).toBe('number'); // wrong-typed value ignored -> stays the default number
  });

  it('the postcard names the world and embeds a permalink', () => {
    sim.initWorld(2024);
    for (let i = 0; i < 300; i++) sim.step();
    const pc = sim.worldPostcard();
    expect(pc).toContain('seed 2024');
    expect(pc).toContain('?w=');
    expect(sim.worldPermalink()).toContain('?w=');
  }, 20000);
});

// Scenarios + objectives (chunk 5, pillar E): named starting setups (preset + fixed seed + initial life)
// with a win/lose OBSERVER. Two halves, both balance-safe like chunks 3-4. (1) The OBSERVER
// (evaluateScenario) is a PURE reducer of the world's stats over time - it is the gate-testable core, so
// win/lose logic is proven headlessly. (2) The SETUP (applyScenarioDef) runs only from a button / permalink,
// never step(), and reuses the same initWorld re-genesis the preset selector uses, so the measured ecology
// loop is byte-identical (the harness before/after is the balance proof; here we prove the setup is
// deterministic + reproducible, which is also what makes a scenario shareable). The panel render is
// gate-blind DOM, verified in the browser.
describe('scenarios + objectives (chunk 5, pillar E)', () => {
  // --- the pure win/lose observer ---
  it('establish goal: reaches "won" only when every tier meets the target, then latches', () => {
    const def = { objective: { goal: 'establish', need: { flora: 800, herb: 60, carn: 20 } } };
    let st = { state: 'active', phase: 'reaching', establishedTick: null, progress: 0 };
    st = sim.evaluateScenario(def, { flora: 400, herb: 30, carn: 5 }, 100, st);
    expect(st.state).toBe('active');
    expect(st.progress).toBeGreaterThan(0);
    expect(st.progress).toBeLessThan(1);
    st = sim.evaluateScenario(def, { flora: 900, herb: 70, carn: 25 }, 200, st);
    expect(st.state).toBe('won');
    st = sim.evaluateScenario(def, { flora: 0, herb: 0, carn: 0 }, 300, st); // a later collapse
    expect(st.state).toBe('won'); // terminal states latch
  });

  it('endure goal: establishes, holds for the duration, then wins', () => {
    const def = { objective: { goal: 'endure', establish: { flora: 100, herb: 20, carn: 5 }, floor: { herb: 1 }, duration: 1000 } };
    let st = { state: 'active', phase: 'establishing', establishedTick: null, progress: 0 };
    st = sim.evaluateScenario(def, { flora: 10, herb: 2, carn: 0 }, 50, st); // warming up: never a loss
    expect(st).toMatchObject({ state: 'active', phase: 'establishing' });
    st = sim.evaluateScenario(def, { flora: 150, herb: 30, carn: 8 }, 500, st); // establish -> clock starts
    expect(st).toMatchObject({ state: 'active', phase: 'holding', establishedTick: 500 });
    st = sim.evaluateScenario(def, { flora: 150, herb: 30, carn: 8 }, 1000, st); // halfway through the hold
    expect(st.state).toBe('active');
    expect(st.progress).toBeCloseTo(0.5, 5);
    st = sim.evaluateScenario(def, { flora: 150, herb: 30, carn: 8 }, 1500, st); // duration elapsed -> won
    expect(st.state).toBe('won');
  });

  it('endure goal: a drop below the floor AFTER establishment is a loss (and latches)', () => {
    const def = { objective: { goal: 'endure', establish: { flora: 100, herb: 20 }, floor: { herb: 1 }, duration: 1000 } };
    let st = { state: 'active', phase: 'establishing', establishedTick: null, progress: 0 };
    st = sim.evaluateScenario(def, { flora: 150, herb: 30 }, 500, st); // establish
    expect(st.phase).toBe('holding');
    st = sim.evaluateScenario(def, { flora: 150, herb: 0 }, 700, st); // grazers wiped out
    expect(st.state).toBe('lost');
    st = sim.evaluateScenario(def, { flora: 150, herb: 50 }, 800, st); // a later recovery
    expect(st.state).toBe('lost'); // stays lost
  });

  // --- setup: arming, determinism (== shareability), clearing ---
  it('applyScenarioDef warms terrain, seeds initial life, arms the objective, and reproduces the same world', () => {
    function start() {
      sim.applyScenarioDef(sim.SCENARIOS.balance);
      const herb = sim.fauna.filter((f) => f && f.type === 'herbivore').length;
      const carn = sim.fauna.filter((f) => f && f.type === 'carnivore').length;
      return { seed: sim._seed, tick: sim.tick, flora: sim.flora.length, herb, carn };
    }
    const a = start();
    expect(sim.activeScenario).toBeTruthy();
    expect(sim.activeScenario.def.id).toBe('balance');
    expect(sim.activeScenario.status.state).toBe('active');
    expect(a.seed).toBe(2024); // the scenario's fixed seed
    expect(sim.landCoverage()).toBeGreaterThan(0.005); // terrain was warmed to a small starting landmass (grows during play)
    expect(a.herb).toBeGreaterThan(0); // initial grazers were seeded onto land
    expect(a.carn).toBeGreaterThan(0); // initial predators too
    const b = start();
    expect(b).toEqual(a); // same scenario -> byte-identical starting world (deterministic + shareable)
    sim.clearScenario();
    expect(sim.activeScenario).toBeNull();
  }, 90000);

  it('a scenario is a shareable permalink: the world code carries the id and re-arms the objective', () => {
    sim.applyScenarioDef(sim.SCENARIOS.iceage);
    const code = sim.buildWorldCode();
    expect(code.scen).toBe('iceage');
    expect(code.seed).toBe(1888);
    const decoded = sim.decodeWorldCode(sim.encodeWorldCode(code));
    expect(decoded.scen).toBe('iceage'); // survives the base64url round-trip
    function fingerprint() {
      sim.applyWorldCode(decoded); // trusted built-in scenario -> rebuilt from our own def
      expect(sim.activeScenario.def.id).toBe('iceage');
      expect(sim._seed).toBe(1888);
      const herb = sim.fauna.filter((f) => f && f.type === 'herbivore').length;
      return { land: sim.landCoverage(), flora: sim.flora.length, herb };
    }
    const a = fingerprint();
    const b = fingerprint();
    expect(b).toEqual(a); // the scenario link reproduces the same starting world
  }, 90000);

  it('is balance-safe: a scenario run replays identically (the observer never touches fauna/flora/RNG)', () => {
    function run() {
      sim.applyScenarioDef(sim.SCENARIOS.balance);
      for (let i = 0; i < 300; i++) sim.step(); // scenarioSample runs every 10 ticks throughout
      return sim.fauna
        .filter((f) => f)
        .map((f) => `${f.id}:${f.x},${f.y}:${f.energy.toFixed(3)}:${f.size.toFixed(4)}`);
    }
    const a = run();
    const b = run();
    expect(b).toEqual(a);
    expect(a.length).toBeGreaterThan(0);
    // A plain world code clears the scenario, so scenarioSample reverts to a no-op on a sandbox world.
    sim.applyWorldCode({ v: 1, seed: 1, cfg: {} });
    expect(sim.activeScenario).toBeNull();
  }, 90000);
});

// Speciation (chunk 6, pillar C): lineage drift becomes NAMED, DIVERGING species. Two halves. (1) The pure
// CENSUS/KEY core buckets living fauna by the genome signature generateSpeciesName keys its binomial on
// (tier + hue + climate-pref buckets), so one signature is 1:1 with one name - gate-testable on synthetic
// genomes without a slow world. (2) The step-path OBSERVER (speciesSample) registers a species once it is
// established and narrates births/extinctions into the Chronicle; it is read-only (no eRng, no fauna
// mutation), so like chronicleSample the measured ecology loop is byte-identical (the harness before/after is
// the balance proof; here we prove it round-trips deterministically through a snapshot). The panel is
// gate-blind DOM. Reproductive isolation (mate choice) is deliberately NOT here - a separate harness-gated
// experiment (roadmap: tracking + naming first).
describe('speciation (chunk 6, pillar C)', () => {
  it('the pure census buckets fauna by genome signature and names each species (1:1 with the key)', () => {
    const list = [
      { type: 'herbivore', hue: 40, prefArid: 3, prefTemp: 6, gen: 7, size: 1.0, vivid: 0 },
      { type: 'herbivore', hue: 45, prefArid: 3, prefTemp: 6, gen: 5, size: 1.6, vivid: 1 }, // same buckets -> same species
      { type: 'herbivore', hue: 40, prefArid: 8, prefTemp: 6, gen: 6, size: 1.0, vivid: 0 }, // different aridity bucket -> a distinct species
    ];
    const c = sim.speciesCensus(list);
    expect(c.length).toBe(2); // two distinct species
    expect(c[0].pop).toBe(2); // sorted by population desc
    expect(c[1].pop).toBe(1);
    expect(c[0].maxGen).toBe(7); // most-evolved member's generation
    expect(c[0].maxSize).toBeCloseTo(1.6, 5); // largest member
    expect(c[0].vivid).toBe(1);
    expect(typeof c[0].name).toBe('string');
    expect(c[0].name.length).toBeGreaterThan(0);
    expect(c[0].name).not.toBe(c[1].name); // different signature -> different binomial
    // the two same-bucket members would resolve to the same key/name
    expect(sim.speciesKey(list[0])).toBe(sim.speciesKey(list[1]));
    expect(sim.speciesKey(list[0])).not.toBe(sim.speciesKey(list[2]));
  });

  it('speciesKey is stable within a bucket and changes at a bucket boundary', () => {
    const base = { type: 'herbivore', hue: 40, prefArid: 3.0, prefTemp: 6.0 };
    const within = { type: 'herbivore', hue: 49, prefArid: 4.4, prefTemp: 7.4 }; // same floor buckets
    const across = { type: 'herbivore', hue: 60, prefArid: 3.0, prefTemp: 6.0 }; // hue crosses 20 -> new genus bucket
    expect(sim.speciesKey(within)).toBe(sim.speciesKey(base));
    expect(sim.speciesKey(across)).not.toBe(sim.speciesKey(base));
    // tier is part of the signature: a carnivore is never the same species as a herbivore
    expect(sim.speciesKey({ ...base, type: 'carnivore' })).not.toBe(sim.speciesKey(base));
  });

  it('the registry reducer records divergence, extinction (latching), and re-emergence', () => {
    const reg = sim.newSpeciesRegistry();
    const A = { key: 'herbivore|2|1|2', type: 'herbivore', name: 'Aurpyr aridoides', pop: 8, maxGen: 4, maxSize: 1, vivid: 0 };
    // (1) an established species (>= min gen & pop) diverges -> one 'diverged' event, registered
    let ev = sim.updateSpeciesRegistry([A], reg, 100);
    expect(reg.everCount).toBe(1);
    expect(ev.map((e) => e.kind)).toEqual(['species']);
    expect(ev[0].text).toContain('diverged');
    expect(reg.byKey[A.key].firstTick).toBe(100);

    // (2) below the establishment floor -> not registered, no event
    ev = sim.updateSpeciesRegistry([A, { key: 'carnivore|10|0|1', type: 'carnivore', name: 'Cc dd', pop: 2, maxGen: 9, maxSize: 1, vivid: 0 }], reg, 110);
    expect(reg.everCount).toBe(1); // the pop-2 carnivore is too small
    expect(ev.length).toBe(0);
    expect(reg.byKey[A.key].peakPop).toBe(8);

    // (3) the species vanishes entirely -> extinct + latches (no repeat event)
    ev = sim.updateSpeciesRegistry([], reg, 200);
    expect(ev.length).toBe(1);
    expect(ev[0].text).toContain('extinct');
    expect(reg.byKey[A.key].extinct).toBe(true);
    expect(reg.byKey[A.key].extinctTick).toBe(200);
    ev = sim.updateSpeciesRegistry([], reg, 210);
    expect(ev.length).toBe(0); // stays extinct silently

    // (4) it re-establishes -> re-emerges (not a second 'diverged'), everCount unchanged
    ev = sim.updateSpeciesRegistry([{ ...A, pop: 12, maxGen: 6 }], reg, 300);
    expect(ev.length).toBe(1);
    expect(ev[0].text).toContain('re-emerged');
    expect(reg.everCount).toBe(1);
    expect(reg.byKey[A.key].extinct).toBe(false);
    expect(reg.byKey[A.key].peakPop).toBe(12);
  });
});

// Trophic depth: the SCAVENGER tier (chunk 7, SHIPPED default-ON). A detritivore that eats CARRION (dead-fauna
// corpses) - the trophic addition least likely to break the C2 balance because it adds no predation pressure
// on the living tiers, only harvests the death flux. Chunk 6 shipped it default-OFF (untuned it starved at 0%
// persistence); chunk 7's take-2 tuning (carrionMaxAge 300, scavengerEatGain 35, ring-2-4 carrion scent, a
// carrion-dependent immigration rescue) made it viable + balance-neutral (harness --scav=12 == C2 with
// scavenger-persistence 100%), so it ships ON. Three gate properties matter: (1) the shipped DEFAULT is ON;
// (2) with the flag OFF it is byte-identical (no carrion created, no scavenger code runs) - the --scav=0 harness
// run == C2 is the balance proof; (3) the code is CORRECT + DETERMINISTIC when on (carrion created on death and
// consumed, and a run replays identically - snapshot/replay-safe, no stray Math.random).
describe('trophic depth: scavenger (chunk 7, shipped default-on)', () => {
  it('the shipped default is ON', () => {
    expect(sim.CFG.scavengersEnabled).toBe(true);
  });
  it('flag OFF is byte-identical: fauna die but no carrion is created and no scavenger arises', () => {
    try {
      sim.CFG.scavengersEnabled = false;
      sim.initWorld(555);
      for (let i = 0; i < 700; i++) sim.step();
      sim.seedFloraCluster(40); sim.seedFaunaGroup('herbivore', 30); sim.seedFaunaGroup('carnivore', 10);
      for (let i = 0; i < 300; i++) sim.step(); // deaths happen, but with the flag off no corpse is dropped
      expect(sim.carrion.length).toBe(0);
      expect(sim.fauna.some((f) => f && f.type === 'scavenger')).toBe(false);
    } finally {
      sim.CFG.scavengersEnabled = true; // restore the shipped default (CFG is a persistent global)
    }
  }, 60000);

  it('flag ON: fauna deaths drop carrion that scavengers consume, and the run is deterministic', () => {
    function run() {
      sim.CFG.scavengersEnabled = true;
      sim.initWorld(2024);
      for (let i = 0; i < 1200; i++) sim.step();
      sim.seedFloraCluster(40);
      sim.seedFaunaGroup('herbivore', 40);
      sim.seedFaunaGroup('carnivore', 12);
      sim.seedFaunaGroup('scavenger', 12);
      let maxCarrion = 0, ateSeen = false;
      for (let i = 0; i < 700; i++) {
        sim.step();
        if (sim.carrion.length > maxCarrion) maxCarrion = sim.carrion.length;
        // a scavenger above its start energy can only have gotten there by eating carrion (its sole food)
        if (sim.fauna.some((f) => f && f.type === 'scavenger' && f.energy > sim.CFG.scavengerStartEnergy)) ateSeen = true;
      }
      const fp = sim.fauna.filter((f) => f).map((f) => `${f.id}:${f.type}:${f.x},${f.y}:${f.energy.toFixed(2)}`);
      return { maxCarrion, ateSeen, fp };
    }
    let a, b;
    try {
      a = run();
      b = run();
    } finally {
      sim.CFG.scavengersEnabled = true; // restore the shipped default (CFG is a persistent global)
    }
    expect(a.maxCarrion).toBeGreaterThan(0); // deaths dropped corpses onto the map
    expect(a.ateSeen).toBe(true); // scavengers fed on them (gained energy above their start)
    expect(b.fp).toEqual(a.fp); // scavenger behavior is deterministic (no stray Math.random -> snapshot-safe)
  }, 120000);
});

// Trophic depth take 3: the APEX predator tier (chunk 8, SHIPPED default-ON). A 4th-level predator that hunts
// the MID-tier consumers (carnivores + scavengers). The HARDER trophic addition - it stacks a level on the
// fragile carnivore tier - so it was built default-off and flipped on only after the A/B cleared the bar: harness
// --scav=12 --apex=8 @ 12 seeds is neutral-to-BETTER than the chunk-7 baseline (extinction 0%, carn-persistence
// 75%->83%, scav 100%, cap-hits 0) with apex-persistence 100% (rescue-sustained, mean ~3.7). Gate properties:
// (1) the shipped default is ON; (2) with the flag OFF no apex ever arises (nothing seeds it + the rescue is
// guarded) so the apex code never runs - byte-identical; (3) when on, an apex gains energy above its start ONLY
// by killing prey, and a run replays identically.
describe('trophic depth: apex predator (chunk 8, shipped default-on)', () => {
  it('the shipped default is ON', () => {
    expect(sim.CFG.apexEnabled).toBe(true);
  });
  it('flag OFF is byte-identical: no apex ever arises, even with mid-tier prey present', () => {
    try {
      sim.CFG.apexEnabled = false;
      sim.initWorld(777);
      for (let i = 0; i < 700; i++) sim.step();
      sim.seedFloraCluster(40); sim.seedFaunaGroup('herbivore', 30); sim.seedFaunaGroup('carnivore', 10);
      for (let i = 0; i < 300; i++) sim.step();
      expect(sim.fauna.some((f) => f && f.type === 'apex')).toBe(false);
    } finally {
      sim.CFG.apexEnabled = true; // restore the shipped default
    }
  }, 60000);
  it('flag ON: apex hunt mid-tier prey (gain energy above start) and the run is deterministic', () => {
    function run() {
      sim.CFG.apexEnabled = true;
      sim.initWorld(2024);
      for (let i = 0; i < 1200; i++) sim.step();
      sim.seedFloraCluster(40);
      sim.seedFaunaGroup('herbivore', 40);
      sim.seedFaunaGroup('carnivore', 16);
      sim.seedFaunaGroup('apex', 10);
      let ateSeen = false;
      for (let i = 0; i < 700; i++) {
        sim.step();
        // an apex above its start energy can only have gotten there by killing prey (its sole food)
        if (sim.fauna.some((f) => f && f.type === 'apex' && f.energy > sim.CFG.apexStartEnergy)) ateSeen = true;
      }
      const fp = sim.fauna.filter((f) => f).map((f) => `${f.id}:${f.type}:${f.x},${f.y}:${f.energy.toFixed(2)}`);
      return { ateSeen, fp };
    }
    let a, b;
    try {
      a = run();
      b = run();
    } finally {
      sim.CFG.apexEnabled = true; // restore the shipped default (CFG is a persistent global)
    }
    expect(a.ateSeen).toBe(true); // apex fed on mid-tier prey (gained energy above their start)
    expect(b.fp).toEqual(a.fp); // apex behavior is deterministic (no stray Math.random -> snapshot-safe)
  }, 120000);
});
