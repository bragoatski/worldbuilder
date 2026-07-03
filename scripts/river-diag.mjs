// Headless river-output diagnostic: warm terrain to one land level, then sweep riverAccumThreshold
// and report coverage + blobbiness (solid 2x2 river ratio - high = blobby sheets, low = dendritic lines).
// The render is gate-blind; this picks the threshold by data. Run:
//   node scripts/river-diag.mjs <seed> <warmup> <th1,th2,...>
const sim = await import('../src/sim.js');

const seed = parseInt(process.argv[2] || '202', 10);
const warmup = parseInt(process.argv[3] || '6000', 10);
const thresholds = (process.argv[4] || '14,10,8,6,4').split(',').map(Number);

sim.initWorld(seed);
for (let i = 0; i < warmup; i++) sim.step();
const W = sim.W, H = sim.H, cells = sim.grid.length;
console.log(`seed ${seed} | tick ${warmup} | land ${(sim.landCoverage() * 100).toFixed(1)}%`);
for (const th of thresholds) {
  sim.CFG.riverAccumThreshold = th;
  sim.generateRivers();
  const rd = sim.riverData;
  let river = 0, lake = 0, maxVol = 0;
  for (let i = 0; i < rd.length; i++) {
    if (!rd[i]) continue;
    if (rd[i].lake) lake++;
    else { river++; if (rd[i].volume > maxVol) maxVol = rd[i].volume; }
  }
  // Blobbiness: count fully-river (non-lake) 2x2 blocks. Dendritic = few; sheet/blob = many.
  let solid = 0;
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const a = rd[y * W + x], b = rd[y * W + x + 1], c = rd[(y + 1) * W + x], d = rd[(y + 1) * W + x + 1];
    if (a && b && c && d && !a.lake && !b.lake && !c.lake && !d.lake) solid++;
  }
  const ratio = river ? solid / river : 0;
  console.log(
    `  th ${String(th).padStart(2)} | river ${String(river).padStart(4)} (${(river / cells * 100).toFixed(1).padStart(4)}%) ` +
    `| lake ${String(lake).padStart(3)} | maxVol ${maxVol} | blob ${(ratio * 100).toFixed(1).padStart(4)}% ${ratio < 0.12 ? 'dendritic' : 'BLOBBY'}`
  );
}
