// Hero-world scan (one-off tooling, untracked): warm terrain + seed a full ecosystem + settle,
// across a spread of seeds, so we can pick a beautiful, ALREADY-LIVING default world to ship as
// the app's opening screen. Writes each candidate as the app's snapshot load-format JSON and
// prints a table of land% + per-tier populations. Balance-safe: uses only the normal step() loop.
//
// Run:  node scripts/hero-scan.mjs [warm] [settle] seedA seedB ...
import { writeFileSync, mkdirSync } from 'fs';
const sim = await import('../src/sim.js');

const argv = process.argv.slice(2);
const warm   = parseInt(argv[0] || '4500', 10);
const settle = parseInt(argv[1] || '1000', 10);
const seeds  = argv.slice(2).map(Number).filter(n => !isNaN(n));
if (!seeds.length) seeds.push(101,202,303,404,505,707,909,1234,2024,4242,7777,9091);

const t0 = Date.now();
const rows = [];
mkdirSync('public/hero', { recursive: true });

const PRESET = process.env.HERO_PRESET || '';
for (const seed of seeds) {
  if (PRESET) sim._applyPresetCfg(PRESET);
  // "Full" continent overrides (applied AFTER the preset so they win): max land, aggressive coastal fill.
  if (process.env.HERO_LANDCAP) sim.CFG.maxLandCap = +process.env.HERO_LANDCAP;
  if (process.env.HERO_COASTAL) sim.CFG.coastalSpreadBase = +process.env.HERO_COASTAL;
  if (process.env.HERO_VOLC)    sim.CFG.volcanoChancePerTile = +process.env.HERO_VOLC;
  sim.initWorld(seed);
  // 1) warm the terrain (genesis grows land only through step())
  let g = 0;
  for (let i = 0; i < warm; i++) { sim.step(); }
  const landAfterWarm = sim.landCoverage();
  // 2) seed flora, let it spread, then seed every fauna tier
  sim.seedFloraCluster(90);
  for (let i = 0; i < 200; i++) sim.step();
  sim.seedFaunaGroup('herbivore', 28);
  sim.seedFaunaGroup('carnivore', 8);
  sim.seedFaunaGroup('scavenger', 5);
  sim.seedFaunaGroup('apex', 3);
  sim.seedFaunaGroup('omnivore', 4);
  // 3) settle into a living, balanced state
  for (let i = 0; i < settle; i++) sim.step();

  const by = (t) => sim.fauna.filter(f => f && f.type === t).length;
  const row = {
    seed,
    land: +(sim.landCoverage() * 100).toFixed(1),
    landWarm: +(landAfterWarm * 100).toFixed(1),
    flora: sim.flora.length,
    herb: by('herbivore'), carn: by('carnivore'), scav: by('scavenger'),
    apex: by('apex'), omni: by('omnivore'),
    fauna: sim.fauna.length,
  };
  rows.push(row);
  const snap = sim.buildSnapshot();
  const path = `public/hero/hero-${seed}.json`;
  const json = JSON.stringify(snap);
  writeFileSync(path, json);
  console.log(`seed ${String(seed).padStart(5)} | land ${String(row.land).padStart(5)}% (warm ${row.landWarm}%) | flora ${String(row.flora).padStart(5)} | herb ${String(row.herb).padStart(3)} carn ${String(row.carn).padStart(3)} scav ${String(row.scav).padStart(3)} apex ${String(row.apex).padStart(3)} omni ${String(row.omni).padStart(3)} | ${(json.length/1024).toFixed(0)}KB -> ${path}`);
}

console.log('\n--- summary (sorted by a rough "teeming continent" score) ---');
const score = r => r.land*1.2 + Math.min(r.flora,3000)/60 + r.herb*2 + r.carn*3 + r.scav*2 + r.apex*4 + r.omni*3;
rows.sort((a,b) => score(b) - score(a));
for (const r of rows) console.log(`  seed ${String(r.seed).padStart(5)}  score ${score(r).toFixed(0).padStart(4)}  land ${r.land}%  flora ${r.flora}  fauna ${r.fauna} (h${r.herb} c${r.carn} s${r.scav} a${r.apex} o${r.omni})`);
console.log(`\ndone in ${((Date.now()-t0)/1000).toFixed(0)}s across ${seeds.length} seeds (warm ${warm}, settle ${settle})`);
