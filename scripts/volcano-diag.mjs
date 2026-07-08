// Headless volcano-emergence diagnostic + rate calibration. Two modes:
//   node scripts/volcano-diag.mjs peaks <nSeeds> <warmup> <startSeed>   -> current peak-elevation reality
//   node scripts/volcano-diag.mjs births <nSeeds> <ticks> <rate> <startSeed> -> births/session at a birth rate
// Kevin's ask: an elev-10 volcano should emerge once in a while, not every map and not never. Mode 'peaks'
// proves mountains never reach the 9.95 promotion gate on their own; mode 'births' calibrates volcanoBirthRate.
const sim = await import('../src/sim.js');

const mode = process.argv[2] || 'births';

if (mode === 'peaks') {
  const nSeeds = parseInt(process.argv[3] || '8', 10);
  const warmup = parseInt(process.argv[4] || '6000', 10);
  const startSeed = parseInt(process.argv[5] || '1000', 10);
  sim.CFG.volcanoBirthRate = 0; // measure the natural ceiling, birth feature off
  console.log(`peaks probe | ${nSeeds} seeds | warmup ${warmup} | rate 0`);
  console.log('seed        land%   maxElev   #>=9.5  peaks');
  const maxElevs = [];
  for (let s = 0; s < nSeeds; s++) {
    const seed = startSeed + s * 101;
    sim.initWorld(seed);
    for (let i = 0; i < warmup; i++) sim.step();
    let maxE = 0, n95 = 0;
    for (let i = 0; i < sim.grid.length; i++) {
      if (sim.grid[i] === sim.T.OCEAN) continue;
      const e = sim.elev[i] || 0; if (e > maxE) maxE = e; if (e >= 9.5) n95++;
    }
    maxElevs.push(maxE);
    console.log(`${String(seed).padStart(8)}  ${(sim.landCoverage() * 100).toFixed(1).padStart(5)}   ${maxE.toFixed(3).padStart(6)}   ${String(n95).padStart(5)}   ${String(sim.volcanoCenters.length).padStart(4)}`);
  }
  maxElevs.sort((a, b) => a - b);
  console.log(`max-elev across seeds: min ${maxElevs[0].toFixed(2)} | median ${maxElevs[maxElevs.length >> 1].toFixed(2)} | max ${maxElevs[maxElevs.length - 1].toFixed(2)}`);
} else {
  const nSeeds = parseInt(process.argv[3] || '16', 10);
  const ticks = parseInt(process.argv[4] || '5000', 10);
  const rate = parseFloat(process.argv[5] || String(sim.CFG.volcanoBirthRate));
  const startSeed = parseInt(process.argv[6] || '1000', 10);
  sim.CFG.volcanoBirthRate = rate;
  console.log(`births probe | ${nSeeds} seeds | ${ticks} ticks/session | rate ${rate} | checkEvery ${sim.CFG.volcanoBirthCheckEvery}`);
  console.log('seed        land%   births   firstAt');
  let mapsWith = 0, totalBirths = 0;
  const counts = [];
  for (let s = 0; s < nSeeds; s++) {
    const seed = startSeed + s * 101;
    sim.initWorld(seed);
    let firstAt = 0;
    for (let i = 0; i < ticks; i++) { const before = sim.volcanoCenters.length; sim.step(); if (!firstAt && sim.volcanoCenters.length > before) firstAt = sim.tick; }
    const births = sim.volcanoCenters.length;
    counts.push(births); totalBirths += births; if (births > 0) mapsWith++;
    console.log(`${String(seed).padStart(8)}  ${(sim.landCoverage() * 100).toFixed(1).padStart(5)}   ${String(births).padStart(5)}   ${String(firstAt || '-').padStart(6)}`);
  }
  console.log('---');
  console.log(`maps with >=1 volcano birth: ${mapsWith}/${nSeeds} (${(mapsWith / nSeeds * 100).toFixed(0)}%)`);
  console.log(`mean births/session: ${(totalBirths / nSeeds).toFixed(2)} | total ${totalBirths}`);
}
