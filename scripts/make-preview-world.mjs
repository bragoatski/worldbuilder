// Warm terrain headless and serialize to the app's load format, so the browser can load a developed
// world instantly (no in-browser warmup) for the gate-blind river visual verify. One-off tooling.
// Run: node scripts/make-preview-world.mjs <seed> <warmup>
import { writeFileSync, mkdirSync } from 'fs';
const sim = await import('../src/sim.js');

const seed = parseInt(process.argv[2] || '202', 10);
const warmup = parseInt(process.argv[3] || '6000', 10);
sim.initWorld(seed);
for (let i = 0; i < warmup; i++) sim.step();
const snap = sim.buildSnapshot(); // no rivers generated -> the browser generates them via the button
mkdirSync('public', { recursive: true });
const path = `public/preview-${seed}.json`;
writeFileSync(path, JSON.stringify(snap));
console.log('wrote', path, '| land', (sim.landCoverage() * 100).toFixed(1) + '%', '| tick', warmup);
