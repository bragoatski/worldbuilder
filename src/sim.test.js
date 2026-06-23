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
