// Flora distribution + balance A/B at a chosen land regime.
//
// Why this exists: the standard `npm run measure` protocol warms to ~24% land, where the world is
// uniformly wet (no deserts, everything near coast) - so the flora "cluster on water / rare in desert"
// levers are invisible there. The user's "flora overrun everything" is a HIGH-LAND phenomenon (default
// maxLandCap is 0.90). This script warms each seed/variant to a high-land regime and measures.
//
// Each variant is warmed WITH its own CFG active, because flora DISTRIBUTION is established over the whole
// run: a short window from a shared snapshot cannot redistribute the ~18k plants grown under uniform rules
// (placement biases only NEW plants; the dominant dynamic is local spread + adaptation). Terrain depends
// only on the seed (sRng), independent of ecology CFG, so per-seed the terrain is identical across
// variants - a fair same-terrain comparison (cost: one warmup per variant per seed).
//
// For each variant it reports the flora-distribution block (coverage, aridity selectivity vs land,
// desert share, near-water share) AND the headline balance metrics (extinction, carnivore-persistence,
// phase-lag, cap-hits, min floors). Edit VARIANTS to sweep knobs.
//
// Usage: node scripts/flora-ab.mjs [--seeds=4] [--warmup=6000] [--ticks=1500] [--herb=24] [--carn=8] [--flora=40]

import { installDomStub } from './headless-dom.mjs';
installDomStub();
const sim = await import('../src/main.js');

function parseArgs() {
  const o = { seeds: 4, warmup: 6000, ticks: 1500, herb: 24, carn: 8, flora: 40, sample: 5 };
  for (const a of process.argv.slice(2)) {
    const m = /^--([a-z]+)(?:=(.+))?$/.exec(a);
    if (m && m[1] in o && m[2] !== undefined) o[m[1]] = Number(m[2]);
  }
  return o;
}
const o = parseArgs();

// ---- the variants to compare (same snapshot, only these CFG keys differ) ----
// `base` is the shipped uniform placement (floraWaterWeight 0). Edit freely between runs.
// 'pre-change/C2' = old shipped baseline (all new mechanisms OFF). 'v3-shipped' = {} uses the new shipped
// CFG defaults (maturity-thinning + water/desert clustering). Both run the SAME draw-stable code => clean A/B.
const VARIANTS = [
  { name: 'pre-change/C2', cfg: { floraSpreadBase: 0.07, floraPerTileMax: 4, floraSpawnChance: 0.012, floraWaterWeight: 0, floraMoisturePenalty: 0, floraWaterDistK: 0, floraWaterDistPenalty: 0, floraLandThin: 0 } },
  { name: 'v3-shipped', cfg: {} },
];
// Every CFG key any variant touches (reset to shipped default before applying each variant).
const TOUCHED = [...new Set(VARIANTS.flatMap((v) => Object.keys(v.cfg)))];
const DEFAULTS = {};
for (const k of TOUCHED) DEFAULTS[k] = sim.CFG[k];

// ---- helpers ----
function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function pad(s, n) { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); }
const herbCount = () => sim.fauna.filter((f) => f && f.type === 'herbivore').length;
const carnCount = () => sim.fauna.filter((f) => f && f.type === 'carnivore').length;

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
function phaseLag(herb, carn, maxLag) {
  let bestLag = 0, bestCorr = -Infinity;
  for (let L = -maxLag; L <= maxLag; L++) {
    const h = [], c = [];
    for (let t = 0; t < herb.length; t++) { const tc = t + L; if (tc < 0 || tc >= carn.length) continue; h.push(herb[t]); c.push(carn[tc]); }
    if (h.length < 8) continue;
    const r = pearson(h, c);
    if (r > bestCorr) { bestCorr = r; bestLag = L; }
  }
  return { lag: bestLag, corr: bestCorr };
}

// Flora distribution against the habitable-land baseline (selectivity is only legible vs what's available).
function floraDistribution() {
  const W = sim.W, H = sim.H, T = sim.T, grid = sim.grid, arid = sim.aridity, rd = sim.riverData;
  const isWater = (i) => grid[i] === T.OCEAN || grid[i] === T.COAST || (rd && rd[i]);
  const nearWater = (x, y) => {
    const i = y * W + x;
    if (rd && rd[i]) return true;
    if (x > 0 && isWater(i - 1)) return true;
    if (x < W - 1 && isWater(i + 1)) return true;
    if (y > 0 && isWater(i - W)) return true;
    if (y < H - 1 && isWater(i + W)) return true;
    return false;
  };
  let landN = 0, landAridSum = 0, landDesert = 0, landNearW = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, g = grid[i];
    if (g === T.OCEAN || g === T.MOUNTAIN || g === T.VOLCANIC) continue;
    landN++; landAridSum += arid[i] || 0;
    if (g === T.DESERT) landDesert++;
    if (nearWater(x, y)) landNearW++;
  }
  const tiles = new Set();
  let fAridSum = 0, fDesert = 0, fNearW = 0, fN = 0;
  for (const f of sim.flora) {
    if (!f) continue;
    const i = f.y * W + f.x;
    tiles.add(i); fN++; fAridSum += arid[i] || 0;
    if (grid[i] === T.DESERT) fDesert++;
    if (nearWater(f.x, f.y)) fNearW++;
  }
  return {
    total: fN, coverage: landN ? tiles.size / landN : 0,
    floraArid: fN ? fAridSum / fN : 0, landArid: landN ? landAridSum / landN : 0,
    floraDesertPct: fN ? fDesert / fN : 0, landDesertPct: landN ? landDesert / landN : 0,
    floraNearWaterPct: fN ? fNearW / fN : 0, landNearWaterPct: landN ? landNearW / landN : 0,
  };
}

// Measure one variant from the restored snapshot: seed flora+fauna, run the window, collect metrics.
function measureVariant(v) {
  for (const k of TOUCHED) sim.CFG[k] = DEFAULTS[k];
  for (const k in v.cfg) sim.CFG[k] = v.cfg[k];

  sim.seedFloraCluster(o.flora);
  sim.seedFaunaGroup('herbivore', o.herb);
  sim.seedFaunaGroup('carnivore', o.carn);

  const cap = sim.CFG.faunaMaxPop;
  const herbS = [], carnS = [];
  let extinctAt = null, capHits = 0, minHerb = Infinity, minCarn = Infinity;
  for (let i = 0; i < o.ticks; i++) {
    sim.step();
    const fa = sim.fauna.length;
    if (fa >= cap) capHits++;
    if (fa === 0 && extinctAt === null) extinctAt = i + 1;
    if (i % o.sample === 0) {
      const h = herbCount(), c = carnCount();
      herbS.push(h); carnS.push(c);
      if (h < minHerb) minHerb = h;
      if (c < minCarn) minCarn = c;
    }
  }
  const pl = phaseLag(herbS, carnS, Math.min(60, (herbS.length / 2) | 0));
  return {
    land: sim.landCoverage(), herb: herbCount(), carn: carnCount(), fauna: sim.fauna.length,
    extinctAt, capHits, minHerb: minHerb === Infinity ? 0 : minHerb, minCarn: minCarn === Infinity ? 0 : minCarn,
    phaseLagTicks: pl.lag * o.sample, phaseCorr: pl.corr, dist: floraDistribution(),
  };
}

// ---- run ----
console.log(`\nFlora A/B  seeds=${o.seeds} warmup=${o.warmup} ticks=${o.ticks} seed-fauna=${o.herb}H/${o.carn}C flora=${o.flora}`);
console.log(`variants: ${VARIANTS.map((v) => v.name).join(', ')}\n`);

const t0 = Date.now();
const acc = VARIANTS.map(() => []); // per-variant rows across seeds
for (let s = 0; s < o.seeds; s++) {
  const seed = 1000 + s * 101;
  for (let vi = 0; vi < VARIANTS.length; vi++) {
    // Distribution can only be measured if flora GROWS under the variant CFG, so warm WITH it active
    // (a short window from a uniform snapshot can't redistribute ~18k established plants). Terrain
    // depends only on the seed (sRng), so it is identical across variants - a fair same-terrain compare.
    for (const k of TOUCHED) sim.CFG[k] = DEFAULTS[k];
    for (const k in VARIANTS[vi].cfg) sim.CFG[k] = VARIANTS[vi].cfg[k];
    sim.initWorld(seed);
    for (let i = 0; i < o.warmup; i++) sim.step();
    acc[vi].push(measureVariant(VARIANTS[vi]));
    console.log(`  seed ${seed} [${VARIANTS[vi].name}] land ${(sim.landCoverage() * 100).toFixed(1)}%`);
  }
}

console.log(`\n  ---- per-variant aggregate over ${o.seeds} seeds (${((Date.now() - t0) / 1000).toFixed(1)}s) ----`);
for (let vi = 0; vi < VARIANTS.length; vi++) {
  const rows = acc[vi];
  const extinct = rows.filter((r) => r.fauna === 0).length;
  const carnAlive = rows.filter((r) => r.carn > 0).length;
  const lags = rows.filter((r) => r.phaseCorr > 0.3).map((r) => r.phaseLagTicks);
  const caps = rows.reduce((s, r) => s + r.capHits, 0);
  const d = (sel) => mean(rows.map((r) => r.dist[sel]));
  console.log(`\n  [${VARIANTS[vi].name}]`);
  console.log(`    balance:  extinction ${pad((extinct / rows.length * 100).toFixed(0) + '%', 4)}  carn-persist ${pad((carnAlive / rows.length * 100).toFixed(0) + '%', 4)}  phase-lag ${lags.length ? (mean(lags) >= 0 ? '+' : '') + mean(lags).toFixed(0) + 't' : 'n/a'}  cap-hits ${caps}  minHerb ${mean(rows.map((r) => r.minHerb)).toFixed(0)}  minCarn ${mean(rows.map((r) => r.minCarn)).toFixed(1)}  fauna ${mean(rows.map((r) => r.fauna)).toFixed(0)}`);
  console.log(`    flora:    total ${d('total').toFixed(0)}  coverage ${(d('coverage') * 100).toFixed(1)}%  arid ${d('floraArid').toFixed(2)}/${d('landArid').toFixed(2)}(land)  desert ${(d('floraDesertPct') * 100).toFixed(1)}%/${(d('landDesertPct') * 100).toFixed(1)}%(land)  nearWater ${(d('floraNearWaterPct') * 100).toFixed(1)}%/${(d('landNearWaterPct') * 100).toFixed(1)}%(land)`);
}
console.log('');
