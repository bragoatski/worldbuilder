// Ketch'em board survey: build N boards of one setting headless and report what each one is like.
// Usage: node scripts/ketchem-boards.mjs [--setting=continent|archipelago|highlands] [--seeds=20] [--start=1] [--size=96]
// Per seed: ticks and seconds to the land target, land %, stores, links (bridge tiles over water), spurs, signposts,
// landmarks, flora cleared off the roads, whether a store stands on its own landmass (reached only by bridge), and
// the roads' terrain check (no road on mountain / glacier / volcanic). The step-3 acceptance numbers come from here.
const sim = await import('../src/sim.js');
const B = await import('../src/ketchem/board.js');

const o = { setting: 'continent', seeds: 20, start: 1, size: 96 };
for (const a of process.argv.slice(2)) { const m = /^--(\w+)=(.+)$/.exec(a); if (m) o[m[1]] = isNaN(+m[2]) ? m[2] : +m[2]; }

let islands = 0, worst = 0, totalMs = 0, badRoad = 0, rerolls = 0;
console.log(`setting=${o.setting} size=${o.size} seeds ${o.start}..${o.start + o.seeds - 1}`);
for (let seed = o.start; seed < o.start + o.seeds; seed++) {
  const t0 = Date.now();
  const K = B.buildBoard({ setting: o.setting, seed, size: o.size });
  const ms = Date.now() - t0; totalMs += ms; if (ms > worst) worst = ms;
  const lm = B.landmassMap();                       // sea-divided landmasses only (a ridge is not an island)
  const masses = new Set(K.stores.map(s => lm[s.i]));
  const island = masses.size > 1; if (island) islands++;
  const bigMasses = lm.sizes.filter(n => n >= 60).length;
  let steep = 0; for (let i = 0; i < sim.W * sim.H; i++) if (sim.road[i] && B.isSteep(i)) steep++;
  badRoad += steep; rerolls += K.rerolls;
  const bridges = K.links.reduce((s, l) => s + l.bridge, 0);
  console.log(`seed ${K.seed}${K.rerolls ? ' (rerolled ' + K.rerolls + ')' : ''}: ${K.ticks} ticks, ${(ms / 1000).toFixed(1)}s (land ${(K.ms.land / 1000).toFixed(1)} life ${(K.ms.life / 1000).toFixed(1)} roads ${(K.ms.roads / 1000).toFixed(1)}), land ${(K.land * 100).toFixed(1)}% of ${(K.target * 100).toFixed(0)}%, `
    + `${K.links.length} links (${bridges} bridge tiles), ${K.spurs.length} spurs, ${K.signposts.length} signposts, ${K.landmarks.length} landmarks, `
    + `flora cleared ${K.floraCleared}, flora ${sim.flora.length} fauna ${sim.fauna.length}, landmasses with stores ${masses.size} (${bigMasses} of 60+ tiles)${island ? ' ISLAND STORE' : ''}, road on steep ${steep}`);
  console.log('   stores: ' + K.stores.map(s => `${s.name} (${s.x},${s.y}) q${s.q}`).join('; ') + ' | starts: ' + K.starts.map(s => K.stores[s.store].name).join(' / '));
  if (K.signposts.length) console.log('   signpost: ' + K.signposts[0].text);
}
console.log(`summary: ${o.seeds} boards, mean ${(totalMs / o.seeds / 1000).toFixed(1)}s, worst ${(worst / 1000).toFixed(1)}s, island-store boards ${islands}, road tiles on steep ground ${badRoad}, rerolls ${rerolls}`);
