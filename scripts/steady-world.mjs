// Steadiness of the default watch-it-grow world under CFG overrides (k=v args). Eight hero seeds, T ticks, sampled
// every 10 from tick 1500 (by when a herd has landed). Prints one MEAN line: how much of the time each tier is alive,
// how often the grazers die out, the tier means, the peaks, and how often the predators outnumber the grazers.
const sim = await import('../src/sim.js');
const args = process.argv.slice(2), kv = args.filter(a => a.includes('='));
const T = +(args.find(a => /^T\d+$/.test(a)) || 'T10000').slice(1);
const seeds = args.includes('VAL') ? [9, 42, 55, 88, 111, 256, 314] : [3, 7, 12, 23, 64, 144, 512, 808];   // VAL: the hero seeds the tuning never saw
const tot = { hAlive: 0, cAlive: 0, ext: 0, inv: 0, H: 0, C: 0, S: 0, A: 0, O: 0, maxA: 0, maxS: 0, maxAll: 0, hold: 0, cv: 0, fl: 0 };
for (const seed of seeds) {
  sim._applyPresetCfg('pangaea'); sim.CFG.maxLandCap = 0.87; sim.CFG.coastalSpreadBase = 0.02; sim.CFG.volcanoChancePerTile = 0.0002; sim.CFG.founderFloraMin = 200;
  for (const a of kv) { const [k, v] = a.split('='); if (!(k in sim.CFG)) throw new Error('no CFG.' + k); sim.CFG[k] = v === 'true' ? true : v === 'false' ? false : +v; }
  sim.initWorld(seed);
  let n = 0, hAlive = 0, cAlive = 0, ext = 0, hadH = false, inv = 0, hold = T; const sum = { H: 0, C: 0, S: 0, A: 0, O: 0 }; let maxA = 0, maxS = 0, maxAll = 0, h2 = 0;
  for (let t = 1; t <= T; t++) {
    sim.step();
    if (hold === T && sim.fauna.length >= 10) hold = t;
    if (t % 10 || t < 1500) continue;
    let H = 0, C = 0, S = 0, A = 0, O = 0;
    for (const f of sim.fauna) if (f) { if (f.type === 'herbivore') H++; else if (f.type === 'carnivore') C++; else if (f.type === 'scavenger') S++; else if (f.type === 'apex') A++; else O++; }
    n++; sum.H += H; sum.C += C; sum.S += S; sum.A += A; sum.O += O; h2 += H * H;
    if (H > 0) { hAlive++; hadH = true; } else if (hadH) { ext++; hadH = false; }
    if (C > 0) cAlive++;
    if (C + S + A > H) inv++;
    if (A > maxA) maxA = A; if (S > maxS) maxS = S; if (sim.fauna.length > maxAll) maxAll = sim.fauna.length;
  }
  const mH = sum.H / n, cv = mH > 0 ? Math.sqrt(Math.max(0, h2 / n - mH * mH)) / mH : 9;
  tot.hAlive += hAlive / n; tot.cAlive += cAlive / n; tot.ext += ext; tot.inv += inv / n; tot.hold += hold; tot.cv += cv; tot.fl += sim.flora.length;
  for (const k of 'HCSAO') tot[k] += sum[k] / n;
  tot.maxA = Math.max(tot.maxA, maxA); tot.maxS = Math.max(tot.maxS, maxS); tot.maxAll = Math.max(tot.maxAll, maxAll);
  if (args.includes('-v')) console.log(`  seed ${seed}: grazers ${(100 * hAlive / n) | 0}% carn ${(100 * cAlive / n) | 0}% ext ${ext} meanH ${mH.toFixed(0)} maxA ${maxA} maxS ${maxS}`);
}
const N = seeds.length, p = x => String((100 * x / N) | 0).padStart(3) + '%';
console.log(`${((args.includes('VAL') ? 'VAL ' : '') + 'T' + T + ' ' + (kv.join(' ') || 'baseline')).padEnd(110)} | grazers ${p(tot.hAlive)} carn ${p(tot.cAlive)} ext ${(tot.ext / N).toFixed(1)} preds>grazers ${p(tot.inv)} | mean H ${(tot.H / N).toFixed(0)} C ${(tot.C / N).toFixed(0)} S ${(tot.S / N).toFixed(0)} A ${(tot.A / N).toFixed(0)} O ${(tot.O / N).toFixed(0)} | cvH ${(tot.cv / N).toFixed(2)} peak A ${tot.maxA} S ${tot.maxS} all ${tot.maxAll} | hold ${(tot.hold / N) | 0} flora ${(tot.fl / N) | 0}`);
