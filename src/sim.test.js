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
    const kinds = new Set(['milestone', 'arrival', 'extinct', 'crash', 'vivid', 'record', 'lineage', 'terrain', 'god']);
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
    const living = warmAndSeed(909090, 30, 8, 500);
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
