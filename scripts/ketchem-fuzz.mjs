/* global window, document */
// Run: node scripts/ketchem-fuzz.mjs <seed> <actions>   (dev server on 5173; Playwright borrowed from ~/taipan; no Root, the relay is untouched)
// Adversarial playthrough: random keys, hostile prompt answers, creatures planted around Kevin, panel buttons mashed,
// save + load mid-way; after every burst the game's invariants are checked and the page's error box read.
// No Root: the real relay stays untouched (nothing summons).
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/KevinReilly/taipan/package.json');
const { chromium } = require('playwright');
const seed = +(process.argv[2] || 23), ITER = +(process.argv[3] || 1500);
let rs = seed * 7919 + 1; const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 300)));
const HOSTILE = ['<img src=x onerror=alert(1)>', 'plants', '', 'a'.repeat(100), 'Tam, Hopper', 'coins 1e9', 'coins -5', 'Amber NaN', 'herbivore', 'Ash', 'Tam', 'x, y, z', '0', 'carnivore', 'Goat, Snack', 'Tam, Tam', 'fuzz', 'Bee'];
const reply = async () => { if (await page.$('#kAsk:not([hidden])')) { if (rnd() < 0.85) { await page.fill('#kAskIn', pick(HOSTILE)); await page.press('#kAskIn', 'Enter'); } else await page.press('#kAskIn', 'Escape'); } };   // the question bar (ask.js) replaced window.prompt
await page.goto('http://127.0.0.1:5173/worldbuilder/?debug&ketchem=continent&kseed=' + seed);
await page.click('#introStart');
await page.waitForFunction(() => window.__wb && window.__wb.ketchem && window.__wb.ketchem.board() !== null, null, { timeout: 180000 });
await page.waitForTimeout(300);

const invariants = () => page.evaluate(() => {
  const sim = window.__wb.sim, K = window.__wb.ketchem.board(), v = [];
  if (!K) return ['no board'];
  const err = document.getElementById('err'); if (err && err.style.display === 'block') v.push('ERR BOX: ' + err.textContent.slice(0, 300));
  const where = new Map(); const seen = (id, place) => { if (!where.has(id)) where.set(id, []); where.get(id).push(place); };
  for (const f of sim.fauna) if (f) seen(f.id, 'fauna');
  for (const p of [K.kevin, K.root]) if (p) for (const c of p.party || []) seen(c.id, p.id + '.party');
  for (const c of K.cabinet || []) seen(c.id, 'cabinet');
  for (const s of K.stores) for (const c of s.held || []) seen(c.id, 'held');
  for (const [id, places] of where) if (places.length > 1) v.push('creature ' + id + ' in ' + places.join('+'));
  const ids = sim.fauna.filter(Boolean).map(f => f.id); if (new Set(ids).size !== ids.length) v.push('duplicate fauna ids');
  for (const p of [K.kevin, K.root]) {
    if (!p) continue; const own = new Set((p.party || []).concat(K.cabinet || []).map(c => c.id));
    if ((p.party || []).length > 3) v.push(p.id + ' party ' + p.party.length);
    if (!(p.wallet >= 0) || !Number.isFinite(p.wallet)) v.push(p.id + ' wallet ' + p.wallet);
    for (const k of ['amber', 'geode', 'obsidian']) if (!(p.stones[k] >= 0) || !Number.isFinite(p.stones[k])) v.push(p.id + ' stones.' + k + ' ' + p.stones[k]);
    if (p.follower && !(p.party || []).some(c => c.id === p.follower)) v.push(p.id + ' follower ' + p.follower + ' not in party');
    if (p.naming && !own.has(p.naming)) v.push(p.id + ' naming ' + p.naming + ' not owned');
    for (const n of p.namingQueue || []) if (!own.has(n)) v.push(p.id + ' namingQueue ' + n + ' not owned');
    if (p.namingSpecies && !own.has(p.namingSpecies)) v.push(p.id + ' namingSpecies ' + p.namingSpecies + ' not owned');
    if (p.x < 0 || p.y < 0 || p.x >= sim.W || p.y >= sim.H) v.push(p.id + ' off map ' + p.x + ',' + p.y);
    const t = sim.grid[sim.idx(p.x, p.y)]; if ((t === sim.T.OCEAN || t === sim.T.COAST) && !p.boat && !p.away) v.push(p.id + ' on water without a boat');
    if (p.pack && p.pack.length > 25) v.push(p.id + ' pack ' + p.pack.length);
    // (no 'held' check on party or cabinet creatures: held only matters in the wild list the sim steps)
  }
  const live = new Set(ids);
  for (const b of K.baits || []) if (b.creatureId && !live.has(b.creatureId)) v.push('bait walker ' + b.creatureId + ' gone');
  for (const f of sim.fauna) { if (!f || !f.held) continue; const a = K.aw[f.id]; const why = a && (a.bolt || a.asleep || a.baitId || a.state === 'growl' || a.pursueUntil); if (!why) v.push('held fauna ' + f.id + ' without a reason (' + (a ? a.state : 'no aw') + ')'); }
  for (const f of sim.fauna) if (f && (f.x < 0 || f.y < 0 || f.x >= sim.W || f.y >= sim.H)) v.push('fauna off map ' + f.id);
  return v;
});
const plant = () => page.evaluate(k => {
  const sim = window.__wb.sim, K = window.__wb.ketchem.board(), p = K.kevin; let n = 0;
  for (let t = 0; t < 4; t++) { const x = p.x + (k % 3) - 1 + (t & 1), y = p.y + ((k >> 1) % 3) - 1 + (t >> 1); if (x < 0 || y < 0 || x >= sim.W || y >= sim.H) continue; const g = sim.grid[sim.idx(x, y)]; if (g === sim.T.OCEAN || g === sim.T.COAST || g === sim.T.MOUNTAIN) continue;
    const h = sim.makeFauna(x, y, ['herbivore', 'carnivore', 'omnivore', 'apex'][(k + t) % 4], null); h.energy = h.maxEnergy * ((k + t) % 2 ? 0.2 : 0.9); sim.fauna.push(h); n++; }
  p.wallet += 50; p.stones.amber += 3; if (k % 5 === 0) p.pack.push({ potion: ['Fleetfoot', 'Slumber', 'Homeward', 'Smoke', 'Tonic', 'Musk', 'Decoy', 'Hush', 'Survey', 'Spice', 'Mirror', 'Hawkeye'][k % 12] });
  return n;
}, Math.floor(rnd() * 1000));

const DIRS = ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];
const ACTS = ['Tab', 'Tab', ' ', ' ', ' ', '1', '2', '3', 'e', 'e', 'f', 'n', 'n', 'p', 'i', 'm', 'c', 'g', 't', 'v', 'Escape', 'F5', 'F9', 'b', 'r', 'Enter'];
const log = []; let bursts = 0;
async function act() {
  const r = rnd();
  if (r < 0.45) { const d = pick(DIRS); log.push(d); if (rnd() < 0.3) { await page.keyboard.down('Shift'); await page.keyboard.press(d); await page.keyboard.up('Shift'); } else if (rnd() < 0.5) { await page.keyboard.down(d); await page.waitForTimeout(120); await page.keyboard.up(d); } else await page.keyboard.press(d); }
  else if (r < 0.85) { const k = pick(ACTS); log.push(k); await page.keyboard.press(k); if (k === 'b') { const s = pick(['p', 's', 'm', 't', 'x']); log.push(s); await page.keyboard.press(s); const d = pick(DIRS.concat(['e', 'Escape'])); log.push(d); await page.keyboard.press(d); } if (k === 'p') { const n = pick(['1', '2', '3', '9', 'x']); log.push(n); await page.keyboard.press(n); } }
  else if (r < 0.93) { const b = await page.$$('#kPanel button, #kMenu button, .km-row button'); if (b.length) { const x = pick(b); log.push('click ' + (await x.textContent()).trim().slice(0, 12)); await x.click({ force: true }).catch(() => {}); } }
  else { const box = await page.$('#c'); const bb = await box.boundingBox(); const x = bb.x + rnd() * bb.width, y = bb.y + rnd() * bb.height; log.push('click map'); await page.mouse.click(x, y, { modifiers: rnd() < 0.2 ? ['Shift'] : [] }); }
}
const found = [];
for (let i = 1; i <= ITER; i++) {
  await act(); await reply();
  if (i % 50 === 0) {
    bursts++;
    const planted = await plant();
    const v = await invariants();
    if (v.length) { found.push({ i, v, tail: log.slice(-30).join(' ') }); console.log('VIOLATION at ' + i + ': ' + v.join(' | ') + '\n  keys: ' + log.slice(-30).join(' ')); if (v.some(x => x.startsWith('ERR BOX'))) break; }
    if (i % 300 === 0) {
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.__wb.ketchem.save('fuzz'));
      await page.waitForTimeout(800);
      await page.evaluate(() => window.__wb.ketchem.load('fuzz'));
      await page.waitForFunction(() => window.__wb.ketchem.board() !== null, null, { timeout: 20000 });
      await page.waitForTimeout(300);
      const v2 = await invariants(); if (v2.length) { found.push({ i: i + 0.5, v: v2 }); console.log('VIOLATION after load at ' + i + ': ' + v2.join(' | ')); }
      const st = await page.evaluate(() => { const K = window.__wb.ketchem.board(); return { tick: window.__wb.sim.tick, party: K.kevin.party.map(c => c.name || c.type), cab: K.cabinet.length, wallet: K.kevin.wallet, held: window.__wb.sim.fauna.filter(f => f && f.held).length, fauna: window.__wb.sim.fauna.length, aw: Object.keys(K.aw).length, baits: K.baits.length, fx: K.fx.length, species: Object.keys(K.almanac.species).length }; });
      console.log('checkpoint ' + i + ' ' + JSON.stringify(st) + ' planted ' + planted);
    }
  }
}
const panelTxt = await page.evaluate(() => (document.getElementById('kPanel') || {}).textContent || '');
console.log('panel text has raw tags: ' + /<img|onerror/.test(panelTxt));
console.log('DONE ' + ITER + ' actions, ' + bursts + ' bursts, violations ' + found.length + ', page errors ' + errors.length);
for (const e of [...new Set(errors)].slice(0, 20)) console.log('  ' + e);
await browser.close();
