// Season-drift probe: a FAST diagnostic (no ecology) for what enabling Seasonal Tilt does to the
// climate FIELDS over time. The harness measures the ecological OUTCOME; this isolates the cause.
//
// It warms terrain to a chosen land fraction, then runs with seasons on and prints, over time, the
// mean temperature + aridity over land plus the seasonal-mod magnitude and how often genesis is
// resetting the fields. Two things to look for:
//   1. DRIFT: do mean temp / aridity wander monotonically (the non-zero-mean waveform integrated onto
//      the fields) rather than oscillate around a fixed baseline?
//   2. REGIME: at low land (frequent genesis -> frequent computeTemperature reset) seasons should be
//      nearly inert; at high land (rare genesis) the accumulation should be large.
//
// Usage:  node scripts/season-probe.mjs [--warmup=3000] [--ticks=6000] [--every=500]
//                                       [--seasonlen=2000] [--intensity=1] [--seed=1000] [--off]
//   --off : run the same window with seasons OFF (control - fields should hold steady).

import { installDomStub } from './headless-dom.mjs';
installDomStub();
const sim = await import('../src/main.js');

function parseArgs() {
  const o = { warmup: 3000, ticks: 6000, every: 500, seasonlen: 2000, intensity: 1, seed: 1000, off: false };
  for (const a of process.argv.slice(2)) {
    const m = /^--([a-z]+)(?:=(.+))?$/.exec(a);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'off') o.off = true;
    else if (k in o && v !== undefined) o[k] = Number(v);
  }
  return o;
}
const o = parseArgs();

// mean/min/max of a field over LAND tiles only (ocean temp/aridity is not ecologically meaningful)
function landStats(field) {
  const W = sim.W, H = sim.H, T = sim.T, grid = sim.grid;
  let n = 0, sum = 0, mn = Infinity, mx = -Infinity;
  for (let i = 0; i < W * H; i++) {
    if (grid[i] === T.OCEAN) continue;
    const v = field[i]; n++; sum += v;
    if (v < mn) mn = v; if (v > mx) mx = v;
  }
  return { mean: n ? sum / n : 0, min: mn === Infinity ? 0 : mn, max: mx === -Infinity ? 0 : mx };
}

console.log(`\nSeason-drift probe  seed=${o.seed} warmup=${o.warmup} ticks=${o.ticks} ` +
  `seasonlen=${o.seasonlen} intensity=${o.intensity} seasons=${o.off ? 'OFF (control)' : 'ON'}`);

// Warm terrain with climate off (clean baseline).
sim.CFG.seasonalTilt = false; sim.CFG.anomalies = false; sim.CFG.volcanoAsh = false;
sim.initWorld(o.seed);
for (let i = 0; i < o.warmup; i++) sim.step();

const baseT = landStats(sim.tempField), baseA = landStats(sim.aridity);
console.log(`  after warmup: land ${(sim.landCoverage() * 100).toFixed(1)}%  ` +
  `temp mean ${baseT.mean.toFixed(2)} [${baseT.min.toFixed(1)}..${baseT.max.toFixed(1)}]  ` +
  `arid mean ${baseA.mean.toFixed(2)} [${baseA.min.toFixed(1)}..${baseA.max.toFixed(1)}]`);

// Now enable seasons (unless --off) and run the window, sampling the fields.
sim.CFG.climateSeasonLength = o.seasonlen;
sim.CFG.climateIntensity = o.intensity;
sim.CFG.seasonalTilt = !o.off;

console.log(`  ${'tick'.padEnd(8)}${'land%'.padEnd(8)}${'phase'.padEnd(7)}` +
  `${'Tmean'.padEnd(8)}${'Tmin'.padEnd(7)}${'Tmax'.padEnd(7)}${'Amean'.padEnd(8)}${'Amin'.padEnd(7)}${'Amax'.padEnd(7)}`);
for (let i = 0; i <= o.ticks; i++) {
  if (i % o.every === 0) {
    const ts = landStats(sim.tempField), as = landStats(sim.aridity);
    const phase = o.seasonlen > 0 ? ((sim.tick % o.seasonlen) / o.seasonlen) : 0;
    console.log(`  ${String(i).padEnd(8)}${(sim.landCoverage() * 100).toFixed(1).padEnd(8)}` +
      `${(phase * 100).toFixed(0).padEnd(7)}` +
      `${ts.mean.toFixed(2).padEnd(8)}${ts.min.toFixed(1).padEnd(7)}${ts.max.toFixed(1).padEnd(7)}` +
      `${as.mean.toFixed(2).padEnd(8)}${as.min.toFixed(1).padEnd(7)}${as.max.toFixed(1).padEnd(7)}`);
  }
  if (i < o.ticks) sim.step();
}
console.log('');
