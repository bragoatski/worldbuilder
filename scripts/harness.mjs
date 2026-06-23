// Measurement harness: run the simulation headless across N seeds and report
// ecosystem outcomes (extinction rate, population trajectories, oscillation, variance).
// This is the CLI form of the gate AND the instrument for tuning ecosystem balance:
// change a parameter, re-run, compare the numbers instead of eyeballing one animation.
//
// Usage:  node scripts/harness.mjs [--seeds=8] [--warmup=400] [--ticks=1500]
//                                  [--herb=24] [--carn=8] [--flora=40] [--sample=50]
//                                  [--traj]   (print per-seed trajectory rows)
//
// Per-seed reproducibility note: terrain is seeded, but the ecology still uses raw
// Math.random(), so a given seed's ecology differs run to run. The aggregate stats
// below are therefore distributions over independent runs - robust to that. Making the
// ecology deterministic is an open product decision (see STATUS.md).

import { installDomStub } from './headless-dom.mjs';
installDomStub();
const sim = await import('../src/main.js');

function parseArgs() {
  // Defaults aim for a DEVELOPED world: terrain genesis is slow, so ~3k warmup ticks
  // are needed before there is enough land/flora to measure ecology on. A full run is a
  // few minutes; scale --seeds / --warmup down for a quick smoke check.
  const o = { seeds: 5, warmup: 3000, ticks: 1000, herb: 24, carn: 8, flora: 40, sample: 50, traj: false };
  for (const a of process.argv.slice(2)) {
    const m = /^--([a-z]+)(?:=(.+))?$/.exec(a);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'traj') o.traj = true;
    else if (k in o && v !== undefined) o[k] = Number(v);
  }
  return o;
}

function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function stdev(a) { const m = mean(a); return a.length ? Math.sqrt(mean(a.map((x) => (x - m) ** 2))) : 0; }
function pad(s, n) { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); }
function herbCount() { return sim.fauna.filter((f) => f && f.type === 'herbivore').length; }
function carnCount() { return sim.fauna.filter((f) => f && f.type === 'carnivore').length; }

function runOne(seed, o) {
  sim.initWorld(seed);
  for (let i = 0; i < o.warmup; i++) sim.step();          // grow land + flora
  sim.seedFloraCluster(o.flora);
  sim.seedFaunaGroup('herbivore', o.herb);
  sim.seedFaunaGroup('carnivore', o.carn);

  let minFauna = Infinity, maxFauna = 0, extinctAt = null;
  const traj = [];
  for (let i = 0; i < o.ticks; i++) {
    sim.step();
    const fa = sim.fauna.length;
    if (fa < minFauna) minFauna = fa;
    if (fa > maxFauna) maxFauna = fa;
    if (fa === 0 && extinctAt === null) extinctAt = i + 1;
    if (o.traj && i % o.sample === 0) traj.push([sim.tick, sim.flora.length, herbCount(), carnCount()]);
  }
  return {
    seed, land: sim.landCoverage(), flora: sim.flora.length,
    herb: herbCount(), carn: carnCount(), fauna: sim.fauna.length,
    minFauna: minFauna === Infinity ? 0 : minFauna, maxFauna, extinctAt, traj,
  };
}

const o = parseArgs();
console.log(`\nWorldbuilder measurement harness`);
console.log(`seeds=${o.seeds} warmup=${o.warmup} ticks=${o.ticks} seed-fauna=${o.herb}H/${o.carn}C flora=${o.flora}\n`);

const t0 = Date.now();
const rows = [];
for (let s = 0; s < o.seeds; s++) {
  const r = runOne(1000 + s * 101, o);
  rows.push(r);
  const status = r.fauna === 0 ? `EXTINCT @${r.extinctAt}` : `alive (${r.herb}H/${r.carn}C)`;
  console.log(`  seed ${pad(r.seed, 5)} land ${pad((r.land * 100).toFixed(1) + '%', 7)} flora ${pad(r.flora, 5)} fauna ${pad(r.fauna, 4)} [min ${pad(r.minFauna, 4)} max ${pad(r.maxFauna, 4)}]  ${status}`);
  if (o.traj) for (const [tk, fl, h, c] of r.traj) console.log(`        t=${pad(tk, 6)} flora ${pad(fl, 5)} herb ${pad(h, 4)} carn ${pad(c, 4)}`);
}

const extinct = rows.filter((r) => r.fauna === 0);
const survived = rows.filter((r) => r.fauna > 0);
const finalFauna = rows.map((r) => r.fauna);
const finalFlora = rows.map((r) => r.flora);
const osc = rows.map((r) => r.maxFauna - r.minFauna);

console.log(`\n  ---- summary over ${o.seeds} runs (${((Date.now() - t0) / 1000).toFixed(1)}s) ----`);
console.log(`  extinction rate   ${(extinct.length / rows.length * 100).toFixed(0)}%  (${extinct.length}/${rows.length})`);
if (extinct.length) console.log(`  mean time-to-extinction  ${Math.round(mean(extinct.map((r) => r.extinctAt)))} ticks`);
console.log(`  final fauna       mean ${mean(finalFauna).toFixed(1)}  sd ${stdev(finalFauna).toFixed(1)}  range ${Math.min(...finalFauna)}..${Math.max(...finalFauna)}`);
if (survived.length) console.log(`  final fauna (survivors only)  mean ${mean(survived.map((r) => r.fauna)).toFixed(1)}`);
console.log(`  final flora       mean ${mean(finalFlora).toFixed(1)}  sd ${stdev(finalFlora).toFixed(1)}`);
console.log(`  fauna oscillation mean ${mean(osc).toFixed(1)} (max-min within a run)\n`);
