// Measurement harness: run the simulation headless across N seeds and report ecosystem
// outcomes. This is the CLI form of the gate AND the instrument for tuning ecosystem balance:
// change a parameter, re-run, compare the numbers instead of eyeballing one animation.
//
// Usage:  node scripts/harness.mjs [--seeds=6] [--warmup=3000] [--ticks=1000]
//                                  [--herb=24] [--carn=8] [--flora=40] [--sample=5]
//                                  [--snapshot]      (warm terrain once per seed, replay from a snapshot)
//                                  [--repeat=1]      (measured windows per seed; with --snapshot the
//                                                     warmup is paid once, so this shows the runtime cut)
//                                  [--traj]          (print a coarse per-seed trajectory)
//                                  [--seasons]       (enable CFG.seasonalTilt - the climate A/B switch)
//                                  [--anomalies] [--volcano]  (the other two climate toggles)
//                                  [--seasonlen=N]   (CFG.climateSeasonLength; default 10000 - shorten to
//                                                     fit several full seasons inside --ticks)
//                                  [--intensity=N]   (CFG.climateIntensity multiplier; default 1.0)
//
// Climate A/B: warmup ALWAYS runs climate-off (a clean genesis baseline), then the climate toggles are
// applied just before the measured window, so the only difference vs the seasons-off baseline is the
// window's climate. This isolates the ecological effect of seasons from any warmup-path difference.
//
// The ecology is now seeded (eRng), so a seed reproduces the same run. The cycle-aware metrics below
// (phase lag, per-trophic period/amplitude, completed cycles, persistence, min floor, cap-hits,
// spatial dispersion) distinguish a healthy bounded predator-prey limit cycle from a crash-to-zero,
// which the old max-min "oscillation" could not. See docs/01 Design/Balance Proposal.md.
//
// Snapshot caveat: --snapshot re-seeds both RNG streams on restore (mulberry32 state is not readable),
// so fauna are seeded at a different RNG phase than a continuous run. Snapshot numbers are therefore
// their own internally-consistent baseline, NOT byte-equal to the non-snapshot baseline. A/B tuning
// within snapshot mode (same snapshot, only CFG differs) is still a clean comparison.

import { installDomStub } from './headless-dom.mjs';
installDomStub();
const sim = await import('../src/main.js');

function parseArgs() {
  // Defaults aim for a DEVELOPED world: terrain genesis is slow, so ~3k warmup ticks are needed
  // before there is enough land/flora to measure ecology on. Scale --seeds / --warmup down for a smoke check.
  const o = { seeds: 6, warmup: 3000, ticks: 1000, herb: 24, carn: 8, flora: 40, sample: 5,
    repeat: 1, snapshot: false, traj: false, scav: 0, apex: 0, omni: 0,
    seasons: false, anomalies: false, volcano: false, seasonlen: 10000, intensity: 1.0 };
  for (const a of process.argv.slice(2)) {
    const m = /^--([a-z]+)(?:=(.+))?$/.exec(a);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'traj') o.traj = true;
    else if (k === 'snapshot') o.snapshot = true;
    else if (k === 'seasons') o.seasons = true;
    else if (k === 'anomalies') o.anomalies = true;
    else if (k === 'volcano') o.volcano = true;
    else if (k in o && v !== undefined) o[k] = Number(v);
  }
  return o;
}

// ----- small stats helpers -----
function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function stdev(a) { const m = mean(a); return a.length ? Math.sqrt(mean(a.map((x) => (x - m) ** 2))) : 0; }
function pad(s, n) { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); }
function herbCount() { return sim.fauna.filter((f) => f && f.type === 'herbivore').length; }
function carnCount() { return sim.fauna.filter((f) => f && f.type === 'carnivore').length; }
function scavCount() { return sim.fauna.filter((f) => f && f.type === 'scavenger').length; }
function apexCount() { return sim.fauna.filter((f) => f && f.type === 'apex').length; }
function omniCount() { return sim.fauna.filter((f) => f && f.type === 'omnivore').length; }

// Pearson correlation of two equal-length series (0 if degenerate).
function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : 0;
}

// Phase lag (in SAMPLES) maximizing corr(herb[t], carn[t+L]). Positive L => carnivores peak AFTER prey,
// the signature of a real predator-prey cycle. Searches lags in [-maxLag, +maxLag].
function phaseLag(herb, carn, maxLag) {
  let bestLag = 0, bestCorr = -Infinity;
  for (let L = -maxLag; L <= maxLag; L++) {
    const h = [], c = [];
    for (let t = 0; t < herb.length; t++) {
      const tc = t + L;
      if (tc < 0 || tc >= carn.length) continue;
      h.push(herb[t]); c.push(carn[tc]);
    }
    if (h.length < 8) continue;
    const r = pearson(h, c);
    if (r > bestCorr) { bestCorr = r; bestLag = L; }
  }
  return { lag: bestLag, corr: bestCorr };
}

// Autocorrelation at lag L (samples).
function autocorr(x, L) {
  if (x.length - L < 8) return 0;
  return pearson(x.slice(0, x.length - L), x.slice(L));
}
// Dominant oscillation period (in SAMPLES): first positive local max of the autocorrelation after the
// zero-lag decay. 0 = no clear period (flatline or monotone).
function dominantPeriod(x, minLag, maxLag) {
  const acf = [];
  for (let L = 0; L <= maxLag; L++) acf.push(autocorr(x, L));
  for (let L = minLag; L < maxLag; L++) {
    if (acf[L] > acf[L - 1] && acf[L] >= acf[L + 1] && acf[L] > 0.1) return L;
  }
  return 0;
}
// Light moving-average smoothing (odd window).
function smooth(x, w) {
  const n = x.length, out = new Array(n), h = (w / 2) | 0;
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = -h; j <= h; j++) { const k = i + j; if (k >= 0 && k < n) { s += x[k]; c++; } }
    out[i] = s / c;
  }
  return out;
}
// Amplitude of a series: half the peak-to-trough range of the smoothed series.
function amplitude(x) {
  if (!x.length) return 0;
  const s = smooth(x, 5);
  let mn = Infinity, mx = -Infinity;
  for (const v of s) { if (v < mn) mn = v; if (v > mx) mx = v; }
  return (mx - mn) / 2;
}
// Completed cycles ~ count of oscillation peaks (local maxima above the series mean) on a smoothed series.
function peakCount(x) {
  const s = smooth(x, 5), m = mean(s);
  let peaks = 0;
  for (let i = 1; i < s.length - 1; i++) if (s[i] > s[i - 1] && s[i] >= s[i + 1] && s[i] > m) peaks++;
  return peaks;
}
// Amplitude trend: first-half vs second-half amplitude (growing => diverging toward a crash).
function ampTrend(x) {
  const h = (x.length / 2) | 0;
  return { first: amplitude(x.slice(0, h)), second: amplitude(x.slice(h)) };
}

// Spatial dispersion of herbivores (the herds Kevin wants to FRAGMENT into spaced groups), measured
// on the final state: count of occupied 8x8 grid buckets (more = more fragmented) and mean pairwise
// distance. Reads sim.fauna directly.
function herbDispersion() {
  const herbs = sim.fauna.filter((f) => f && f.type === 'herbivore');
  const B = 8, buckets = new Set();
  for (const f of herbs) buckets.add(((f.x / B) | 0) + '_' + ((f.y / B) | 0));
  let pts = herbs;
  const cap = 250;
  if (pts.length > cap) { const st = [], step = pts.length / cap; for (let i = 0; i < pts.length; i += step) st.push(pts[i | 0]); pts = st; }
  let sum = 0, cnt = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
    sum += Math.sqrt(dx * dx + dy * dy); cnt++;
  }
  return { clusters: buckets.size, meanDist: cnt ? sum / cnt : 0, n: herbs.length };
}

// Flora distribution diagnostic (the instrument for the "fewer / cluster on water / rare in desert"
// task). Measured on the final state against the LAND baseline so selectivity is legible: a metric is
// only meaningful relative to what is AVAILABLE (e.g. 3% of flora on desert when 30% of land is desert
// = strong avoidance). Reads sim.flora + the exported aridity/grid/riverData fields.
function floraDistribution() {
  const W = sim.W, H = sim.H, N = W * H, T = sim.T;
  const grid = sim.grid, arid = sim.aridity, rd = sim.riverData;
  const isWater = (i) => grid[i] === T.OCEAN || grid[i] === T.COAST || (rd && rd[i]);
  const nearWater = (x, y) => {
    const i = y * W + x;
    if (rd && rd[i]) return true; // a river/lake runs over this tile
    if (x > 0 && isWater(i - 1)) return true;
    if (x < W - 1 && isWater(i + 1)) return true;
    if (y > 0 && isWater(i - W)) return true;
    if (y < H - 1 && isWater(i + W)) return true;
    return false;
  };
  // Habitable land baseline = the placement-eligible set (excludes ocean/mountain/volcanic).
  let landN = 0, landAridSum = 0, landDesert = 0, landNearW = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, g = grid[i];
    if (g === T.OCEAN || g === T.MOUNTAIN || g === T.VOLCANIC) continue;
    landN++; landAridSum += arid[i] || 0;
    if (g === T.DESERT) landDesert++;
    if (nearWater(x, y)) landNearW++;
  }
  // Flora-occupied set (distinct tiles for coverage; per-plant for the share metrics).
  const tiles = new Set();
  let fAridSum = 0, fDesert = 0, fNearW = 0, fN = 0;
  for (const f of sim.flora) {
    if (!f) continue;
    const i = f.y * W + f.x;
    tiles.add(i); fN++;
    fAridSum += arid[i] || 0;
    if (grid[i] === T.DESERT) fDesert++;
    if (nearWater(f.x, f.y)) fNearW++;
  }
  return {
    coverage: landN ? tiles.size / landN : 0,        // distinct flora tiles / habitable land
    floraArid: fN ? fAridSum / fN : 0,                // mean aridity where flora actually is
    landArid: landN ? landAridSum / landN : 0,        // mean aridity of available land (reference)
    floraDesertPct: fN ? fDesert / fN : 0,            // share of flora sitting in desert
    landDesertPct: landN ? landDesert / landN : 0,    // share of land that IS desert (reference)
    floraNearWaterPct: fN ? fNearW / fN : 0,          // share of flora within 1 tile of water
    landNearWaterPct: landN ? landNearW / landN : 0,  // share of land within 1 tile of water (reference)
  };
}

// Warm the slow terrain genesis for a seed (no ecology seeded yet).
function warm(seed, o) {
  sim.initWorld(seed);
  for (let i = 0; i < o.warmup; i++) sim.step();
}

// Measure one ecology window. Assumes the world is already warmed (fresh init or restored snapshot).
// Seeds flora + fauna, runs o.ticks, captures the herb/carn/flora series, and computes the cycle metrics.
function measureWindow(seed, o) {
  sim.seedFloraCluster(o.flora);
  sim.seedFaunaGroup('herbivore', o.herb);
  sim.seedFaunaGroup('carnivore', o.carn);
  if (o.scav > 0) sim.seedFaunaGroup('scavenger', o.scav); // trophic-depth A/B: seed the detritivore tier
  if (o.apex > 0) sim.seedFaunaGroup('apex', o.apex);       // trophic-depth take-3 A/B: seed the apex predator tier
  if (o.omni > 0) sim.seedFaunaGroup('omnivore', o.omni);   // trophic-depth take-4 A/B: seed the omnivore tier

  const cap = sim.CFG.faunaMaxPop;
  const herbS = [], carnS = [], floraS = [];
  let minFauna = Infinity, maxFauna = 0, extinctAt = null;
  let minHerb = Infinity, minCarn = Infinity, capHits = 0;

  for (let i = 0; i < o.ticks; i++) {
    sim.step();
    const fa = sim.fauna.length;
    if (fa < minFauna) minFauna = fa;
    if (fa > maxFauna) maxFauna = fa;
    if (fa >= cap) capHits++;
    if (fa === 0 && extinctAt === null) extinctAt = i + 1;
    if (i % o.sample === 0) {
      const h = herbCount(), c = carnCount();
      herbS.push(h); carnS.push(c); floraS.push(sim.flora.length);
      if (h < minHerb) minHerb = h;
      if (c < minCarn) minCarn = c;
    }
  }

  const maxLag = Math.min(60, (herbS.length / 2) | 0);
  const minPer = 3, maxPer = (herbS.length / 2) | 0;
  const pl = phaseLag(herbS, carnS, maxLag);
  const herbPer = dominantPeriod(herbS, minPer, maxPer) * o.sample;
  const carnPer = dominantPeriod(carnS, minPer, maxPer) * o.sample;
  const herbTrend = ampTrend(herbS);
  const disp = herbDispersion();
  const fdist = floraDistribution();

  return {
    fdist,
    seed, land: sim.landCoverage(), flora: sim.flora.length,
    herb: herbCount(), carn: carnCount(), scav: scavCount(), apex: apexCount(), omni: omniCount(), carrion: sim.carrion.length, fauna: sim.fauna.length,
    minFauna: minFauna === Infinity ? 0 : minFauna, maxFauna, extinctAt,
    minHerb: minHerb === Infinity ? 0 : minHerb, minCarn: minCarn === Infinity ? 0 : minCarn,
    capHits,
    phaseLagTicks: pl.lag * o.sample, phaseCorr: pl.corr,
    herbPeriod: herbPer, carnPeriod: carnPer,
    herbAmp: amplitude(herbS), carnAmp: amplitude(carnS),
    cycles: peakCount(herbS),
    ampFirst: herbTrend.first, ampSecond: herbTrend.second,
    clusters: disp.clusters, meanDist: disp.meanDist,
    herbS, carnS, floraS,
  };
}

const o = parseArgs();
// Season length + intensity only bite when a toggle is on, but set them always so they are in effect
// the moment the window enables a toggle. The toggles themselves are flipped per-window (see below).
sim.CFG.climateSeasonLength = o.seasonlen;
sim.CFG.climateIntensity = o.intensity;
const anyClimate = o.seasons || o.anomalies || o.volcano;
function setClimateToggles(on) {
  sim.CFG.seasonalTilt = on && o.seasons;
  sim.CFG.anomalies = on && o.anomalies;
  sim.CFG.volcanoAsh = on && o.volcano;
}
setClimateToggles(false); // warmup baseline is always climate-off

const climateLabel = anyClimate
  ? `CLIMATE-ON [${[o.seasons && 'seasons', o.anomalies && 'anomalies', o.volcano && 'volcano'].filter(Boolean).join('+')}` +
    ` len=${o.seasonlen} intensity=${o.intensity}]`
  : 'climate-off (baseline)';
const scavLabel = o.scav > 0 ? `  SCAVENGERS-ON [seed ${o.scav}]` : '';
const apexLabel = o.apex > 0 ? `  APEX-ON [seed ${o.apex}]` : '';
const omniLabel = o.omni > 0 ? `  OMNIVORE-ON [seed ${o.omni}]` : '';
console.log(`\nWorldbuilder measurement harness  -  ${climateLabel}${scavLabel}${apexLabel}${omniLabel}`);
console.log(`seeds=${o.seeds} warmup=${o.warmup} ticks=${o.ticks} seed-fauna=${o.herb}H/${o.carn}C${o.scav > 0 ? '/' + o.scav + 'S' : ''}${o.apex > 0 ? '/' + o.apex + 'A' : ''}${o.omni > 0 ? '/' + o.omni + 'O' : ''} flora=${o.flora} sample=${o.sample}` +
  ` repeat=${o.repeat}${o.snapshot ? ' [snapshot]' : ''}\n`);

const t0 = Date.now();
let tWarm = 0, tMeasure = 0;
const rows = [];
for (let s = 0; s < o.seeds; s++) {
  const seed = 1000 + s * 101;
  let snap = null;
  if (o.snapshot) { const w0 = Date.now(); warm(seed, o); snap = sim.snapshotState(); tWarm += Date.now() - w0; }

  let r = null;
  for (let rep = 0; rep < o.repeat; rep++) {
    if (o.snapshot) { sim.restoreState(snap); }
    else { const w0 = Date.now(); warm(seed, o); tWarm += Date.now() - w0; }
    setClimateToggles(true);  // enable climate ONLY for the measured window
    sim.CFG.scavengersEnabled = o.scav > 0; // trophic-depth A/B: scavengers only in the measured window
    sim.CFG.apexEnabled = o.apex > 0;       // trophic take-3 A/B: apex only in the measured window
    sim.CFG.omnivoreEnabled = o.omni > 0;   // trophic take-4 A/B: omnivore only in the measured window
    const m0 = Date.now();
    r = measureWindow(seed, o);
    tMeasure += Date.now() - m0;
    setClimateToggles(false); // restore the clean warmup baseline for the next seed/rep
    sim.CFG.scavengersEnabled = false;
    sim.CFG.apexEnabled = false;
    sim.CFG.omnivoreEnabled = false;
  }
  rows.push(r); // metrics are deterministic across repeats; the last one represents the seed

  const status = r.fauna === 0 ? `EXTINCT @${r.extinctAt}` : `alive (${r.herb}H/${r.carn}C${o.scav > 0 ? '/' + r.scav + 'S' : ''}${o.apex > 0 ? '/' + r.apex + 'A' : ''}${o.omni > 0 ? '/' + r.omni + 'O' : ''})`;
  console.log(`  seed ${pad(r.seed, 5)} land ${pad((r.land * 100).toFixed(1) + '%', 7)} flora ${pad(r.flora, 5)} fauna ${pad(r.fauna, 4)} [min ${pad(r.minFauna, 4)} max ${pad(r.maxFauna, 4)}]  ${status}`);
  console.log(`        cycle: phase-lag ${pad((r.phaseLagTicks >= 0 ? '+' : '') + r.phaseLagTicks + 't', 6)} (r=${r.phaseCorr.toFixed(2)})  herb[per ${r.herbPeriod || '--'}t amp ${r.herbAmp.toFixed(0)}]  carn[per ${r.carnPeriod || '--'}t amp ${r.carnAmp.toFixed(0)}]  cycles ${r.cycles}`);
  console.log(`        floor: minHerb ${pad(r.minHerb, 4)} minCarn ${pad(r.minCarn, 4)}  amp-trend ${r.ampFirst.toFixed(0)}->${r.ampSecond.toFixed(0)}  disp: clusters ${pad(r.clusters, 3)} meanDist ${r.meanDist.toFixed(1)}  cap-hits ${r.capHits}`);
  const fd = r.fdist;
  console.log(`        flora-dist: coverage ${pad((fd.coverage * 100).toFixed(1) + '%', 6)} arid ${fd.floraArid.toFixed(1)}/${fd.landArid.toFixed(1)}(land)  desert ${(fd.floraDesertPct * 100).toFixed(1)}%/${(fd.landDesertPct * 100).toFixed(1)}%(land)  nearWater ${(fd.floraNearWaterPct * 100).toFixed(1)}%/${(fd.landNearWaterPct * 100).toFixed(1)}%(land)`);
  if (o.traj) {
    const stride = Math.max(1, (50 / o.sample) | 0);
    for (let i = 0; i < r.herbS.length; i += stride) {
      console.log(`        t=${pad((i * o.sample), 6)} flora ${pad(r.floraS[i], 5)} herb ${pad(r.herbS[i], 4)} carn ${pad(r.carnS[i], 4)}`);
    }
  }
}

// ----- aggregate summary -----
const extinct = rows.filter((r) => r.fauna === 0);
const survived = rows.filter((r) => r.fauna > 0);
const carnAlive = rows.filter((r) => r.carn > 0);
const finalFauna = rows.map((r) => r.fauna);
const finalFlora = rows.map((r) => r.flora);
const osc = rows.map((r) => r.maxFauna - r.minFauna);
const totalCapHits = rows.reduce((s, r) => s + r.capHits, 0);
const lagsCycling = rows.filter((r) => r.phaseCorr > 0.3).map((r) => r.phaseLagTicks); // only where coupling is real

console.log(`\n  ---- summary over ${o.seeds} runs (${((Date.now() - t0) / 1000).toFixed(1)}s) ----`);
console.log(`  extinction rate        ${(extinct.length / rows.length * 100).toFixed(0)}%  (${extinct.length}/${rows.length})`);
if (extinct.length) console.log(`  mean time-to-extinction  ${Math.round(mean(extinct.map((r) => r.extinctAt)))} ticks`);
console.log(`  carnivore-persistence  ${(carnAlive.length / rows.length * 100).toFixed(0)}%  (${carnAlive.length}/${rows.length})   <- the metric the headline hides`);
if (o.scav > 0) {
  const scavAlive = rows.filter((r) => r.scav > 0);
  console.log(`  scavenger-persistence  ${(scavAlive.length / rows.length * 100).toFixed(0)}%  (${scavAlive.length}/${rows.length})   final scav mean ${mean(rows.map((r) => r.scav)).toFixed(1)}  carrion mean ${mean(rows.map((r) => r.carrion)).toFixed(1)}`);
}
if (o.apex > 0) {
  const apexAlive = rows.filter((r) => r.apex > 0);
  console.log(`  apex-persistence       ${(apexAlive.length / rows.length * 100).toFixed(0)}%  (${apexAlive.length}/${rows.length})   final apex mean ${mean(rows.map((r) => r.apex)).toFixed(1)}`);
}
if (o.omni > 0) {
  const omniAlive = rows.filter((r) => r.omni > 0);
  console.log(`  omnivore-persistence   ${(omniAlive.length / rows.length * 100).toFixed(0)}%  (${omniAlive.length}/${rows.length})   final omni mean ${mean(rows.map((r) => r.omni)).toFixed(1)}`);
}
console.log(`  predator-prey phase lag  mean ${lagsCycling.length ? (mean(lagsCycling) >= 0 ? '+' : '') + mean(lagsCycling).toFixed(0) + 't' : 'n/a'} (carn peaks after prey when +, over ${lagsCycling.length} coupled seeds)`);
console.log(`  oscillation period     herb mean ${mean(rows.map((r) => r.herbPeriod)).toFixed(0)}t   carn mean ${mean(rows.map((r) => r.carnPeriod)).toFixed(0)}t`);
console.log(`  oscillation amplitude  herb mean ${mean(rows.map((r) => r.herbAmp)).toFixed(1)}   carn mean ${mean(rows.map((r) => r.carnAmp)).toFixed(1)}`);
console.log(`  completed cycles       mean ${mean(rows.map((r) => r.cycles)).toFixed(1)}  (peaks in herb series)`);
console.log(`  amplitude trend (herb) first ${mean(rows.map((r) => r.ampFirst)).toFixed(1)} -> second ${mean(rows.map((r) => r.ampSecond)).toFixed(1)}  (growing => diverging)`);
console.log(`  min floor              herb mean ${mean(rows.map((r) => r.minHerb)).toFixed(1)} (worst ${Math.min(...rows.map((r) => r.minHerb))})   carn mean ${mean(rows.map((r) => r.minCarn)).toFixed(1)} (worst ${Math.min(...rows.map((r) => r.minCarn))})`);
console.log(`  spatial dispersion     herbClusters mean ${mean(rows.map((r) => r.clusters)).toFixed(1)}   meanPairDist mean ${mean(rows.map((r) => r.meanDist)).toFixed(1)}`);
console.log(`  cap-hits (total)       ${totalCapHits}  (MUST be 0; a cap-hit is a failure)`);
console.log(`  final fauna            mean ${mean(finalFauna).toFixed(1)}  sd ${stdev(finalFauna).toFixed(1)}  range ${Math.min(...finalFauna)}..${Math.max(...finalFauna)}`);
if (survived.length) console.log(`  final fauna (survivors)  mean ${mean(survived.map((r) => r.fauna)).toFixed(1)}`);
console.log(`  final flora            mean ${mean(finalFlora).toFixed(1)}  sd ${stdev(finalFlora).toFixed(1)}`);
console.log(`  flora coverage         mean ${(mean(rows.map((r) => r.fdist.coverage)) * 100).toFixed(1)}%  (distinct flora tiles / habitable land)`);
console.log(`  flora mean aridity     ${mean(rows.map((r) => r.fdist.floraArid)).toFixed(2)}  vs land ${mean(rows.map((r) => r.fdist.landArid)).toFixed(2)}  (lower = wetter; gap = water-clustering)`);
console.log(`  flora in desert        ${(mean(rows.map((r) => r.fdist.floraDesertPct)) * 100).toFixed(1)}%  vs land ${(mean(rows.map((r) => r.fdist.landDesertPct)) * 100).toFixed(1)}% desert  (lower flora% = desert-avoidance)`);
console.log(`  flora near water       ${(mean(rows.map((r) => r.fdist.floraNearWaterPct)) * 100).toFixed(1)}%  vs land ${(mean(rows.map((r) => r.fdist.landNearWaterPct)) * 100).toFixed(1)}%  (higher flora% = water-clustering)`);
console.log(`  fauna oscillation      mean ${mean(osc).toFixed(1)} (max-min within a run)`);
if (o.snapshot || o.repeat > 1) {
  console.log(`  runtime split          warmup ${(tWarm / 1000).toFixed(1)}s  measured ${(tMeasure / 1000).toFixed(1)}s` +
    `${o.snapshot ? `  (snapshot: warmup paid once/seed across ${o.repeat} replays)` : `  (no snapshot: warmup paid every replay)`}`);
}
console.log('');
