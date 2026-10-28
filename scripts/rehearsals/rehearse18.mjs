/* global window, document */
// Breeding and gear extras (2026-10-27): Kevin buys Trail Boots, which wear per step and come off at zero; Waders
// swap into the feet slot with the Boots sold back; worn gear sells back in the SELL tab; the Pannier adds eight pack
// slots. Two creatures bred at a start store give an egg that cannot be taken until it hatches into the naming
// question; the young one sells at half until it grows; a found store's pen charges three quarters. Needs nothing.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('C:/Users/KevinReilly/taipan/package.json');
const { chromium } = require('playwright');
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' && !/ERR_(EMPTY_RESPONSE|CONNECTION_RESET|CONNECTION_REFUSED)/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('dialog', d => { errors.push('a browser dialog opened: ' + d.message()); d.dismiss(); });
const answer = async v => { await page.waitForSelector('#kAsk:not([hidden])', { timeout: 8000 }); await page.fill('#kAskIn', v); await page.press('#kAskIn', 'Enter'); };
const ok = (label, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra ? ': ' + extra : ''));
await page.goto('http://127.0.0.1:5173/worldbuilder/?debug&ketchem=continent&kseed=11');
await page.click('#introStart');
await page.waitForFunction(() => window.__wb && window.__wb.ketchem && window.__wb.ketchem.board() !== null, null, { timeout: 120000 });
await page.waitForTimeout(400);
const msg = () => page.evaluate(() => window.__wb.ketchem.board().kevin.msg || '');
const gear = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__wb.ketchem.board().kevin.gear || {})));
await page.evaluate(() => window.__wb.ketchem.pause(true));
// two grazers to breed, caught and named
const names = ['Ma', 'Pa'];
for (let k = 0; k < 2; k++) {
  await page.evaluate(() => { const sim = window.__wb.sim, K = window.__wb.ketchem.board(), p = K.kevin; const dx = sim.grid[sim.idx(p.x + 1, p.y)] !== sim.T.OCEAN ? 1 : -1; const h = sim.makeFauna(p.x + dx, p.y, 'herbivore', null); h.energy = h.maxEnergy * 0.9; sim.fauna.push(h); K.rng = () => 0.001; });
  await page.keyboard.press('Tab'); await page.keyboard.press('Space'); await page.keyboard.press('n'); await answer(names[k]);
}
// to the start store with coins
const K0 = await page.evaluate(() => { const K = window.__wb.ketchem.board(); const s = K.stores[K.starts[0].store]; K.kevin.wallet = 2000; K.kevin.x = s.x; K.kevin.y = s.y; return { store: [s.x, s.y] }; });
await page.keyboard.press('e'); await page.waitForSelector('#kPanel:not([hidden])', { timeout: 5000 });
// gear: Boots, wear, swap, sell back
await page.click('#kPanel [data-buy="Trail Boots"]'); await page.waitForTimeout(150);
let g = await gear(); ok('Kevin buys Trail Boots into the feet slot', !!g['Trail Boots'] && g['Trail Boots'].left === 2000, JSON.stringify(g));
await page.keyboard.press('Escape');
const walkOpen = async n => page.evaluate(async n => { const K = window.__wb.ketchem.board(), p = K.kevin; const r0 = (p.gear['Trail Boots'] || {}).left; for (let i = 0; i < n; i++) { const d = i % 2 ? -1 : 1; p.spent = 0; window.__wb.ketchem.step(d, 0); } return [r0, (p.gear['Trail Boots'] || {}).left]; }, n);
await page.evaluate(() => { const K = window.__wb.ketchem.board(), sim = window.__wb.sim, p = K.kevin; for (let y = 2; y < 90; y++) for (let x = 2; x < 90; x++) { const t = sim.grid[sim.idx(x, y)], t2 = sim.grid[sim.idx(x + 1, y)]; if (t === sim.T.PLAINS && t2 === sim.T.PLAINS && !sim.road[sim.idx(x, y)] && !sim.road[sim.idx(x + 1, y)]) { p.x = x; p.y = y; return; } } });
const w = await walkOpen(6);
ok('the Boots wear one per step on open ground', w[0] - w[1] === 6, JSON.stringify(w));
await page.evaluate(() => { window.__wb.ketchem.board().kevin.gear['Trail Boots'].left = 1; });
await walkOpen(2);
g = await gear(); const wm = await msg();
ok('at zero the Boots come off, with a message', !g['Trail Boots'] && /Trail Boots wore out/.test(wm), wm);
await page.evaluate(d => { const K = window.__wb.ketchem.board(); K.kevin.x = d[0]; K.kevin.y = d[1]; }, K0.store);
await page.keyboard.press('e'); await page.waitForSelector('#kPanel:not([hidden])', { timeout: 5000 });
await page.click('#kPanel [data-buy="Trail Boots"]'); await page.waitForTimeout(150);
const w0 = await page.evaluate(() => window.__wb.ketchem.board().kevin.wallet);
await page.click('#kPanel [data-buy="Waders"]'); await page.waitForTimeout(150);
g = await gear(); const sw = await msg(); const w1 = await page.evaluate(() => window.__wb.ketchem.board().kevin.wallet);
ok('Waders swap into the feet slot and the Boots are sold back', !!g.Waders && !g['Trail Boots'] && /swapped Trail Boots for Waders/.test(sw) && w0 - w1 === 160 - 90, sw + ' wallet ' + w0 + ' -> ' + w1);
await page.click('#kPanel [data-buy="Pannier"]'); await page.waitForTimeout(150);
const cap = await page.evaluate(() => window.__wb.ketchem.board().kevin && document.querySelector('#kHud .kh-pack').textContent);
ok('the Pannier adds eight pack slots', /\/18$/.test(cap.trim()), cap);
await page.click('#kPanel [data-tab="sell"]'); await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/sell-gear.png` });
const sellBtn = await page.$('#kPanel [data-sellgear="Waders"]');
ok('the SELL tab lists worn gear with its price back', !!sellBtn);
const wb0 = await page.evaluate(() => window.__wb.ketchem.board().kevin.wallet);
if (sellBtn) await sellBtn.click(); await page.waitForTimeout(150);
const wb1 = await page.evaluate(() => window.__wb.ketchem.board().kevin.wallet); g = await gear();
ok('selling the Waders back pays half their price', wb1 - wb0 === 80 && !g.Waders, wb0 + ' -> ' + wb1);
// breeding: an egg, then a hatch, then half price
await page.click('#kPanel [data-tab="pen"]');
await page.click('#kPanel label:has-text("Ma") input'); await page.click('#kPanel label:has-text("Pa") input');
const fee = await page.evaluate(() => document.getElementById('kpFee').textContent);
await page.click('#kPanel #kpBreed'); await page.waitForTimeout(200);
const egg = await page.evaluate(() => { const K = window.__wb.ketchem.board(), c = K.cabinet[K.cabinet.length - 1]; return { hatchAt: c && c.hatchAt, naming: K.kevin.naming, id: c && c.id }; });
ok('breeding at a start store leaves an egg, and asks no name yet', egg.hatchAt > 0 && !egg.naming, JSON.stringify(egg) + ' ' + fee);
await page.click('#kPanel [data-tab="box"]'); await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/egg.png` });
ok('the egg in the cabinet has no buttons and does not drag', await page.evaluate(id => !document.querySelector('#kPanel [data-take="' + id + '"]') && !document.querySelector('#kPanel [data-drag="' + id + '"]'), egg.id));
await page.keyboard.press('Escape');
await page.evaluate(id => { const c = window.__wb.ketchem.board().cabinet.find(x => x.id === id); c.hatchAt = window.__wb.sim.tick; window.__wb.ketchem.pause(false); }, egg.id);
await page.waitForTimeout(600); await page.evaluate(() => window.__wb.ketchem.pause(true));
const hatched = await page.evaluate(id => { const K = window.__wb.ketchem.board(), c = K.cabinet.find(x => x.id === id); return { egg: c && c.hatchAt !== undefined, naming: K.kevin.naming === id, born: c && c.bornAt !== undefined }; }, egg.id);
ok('it hatches into Kevin\'s naming question', !hatched.egg && hatched.naming && hatched.born, JSON.stringify(hatched));
await page.keyboard.press('n'); await answer('Kit');
await page.keyboard.press('e'); await page.waitForSelector('#kPanel:not([hidden])', { timeout: 5000 });
await page.click('#kPanel [data-tab="sell"]'); await page.waitForTimeout(150);
const kitRow = await page.evaluate(() => { const r = [...document.querySelectorAll('#kPanel tr')].find(t => /Kit/.test(t.textContent)); return r ? r.textContent.replace(/\s+/g, ' ') : ''; });
ok('the young one sells at half until it grows a level', /x0\.5 young/.test(kitRow), kitRow.slice(0, 160));
await page.screenshot({ path: `${out}/young-half.png` });
await page.keyboard.press('Escape');
// a found store's pen charges three quarters
const fees = await page.evaluate(() => { const K = window.__wb.ketchem.board(); const far = K.stores.find((s, i) => i !== K.starts[0].store && i !== K.starts[1].store); far.revealed = true; return { far: [far.x, far.y] }; });
await page.evaluate(() => { const K = window.__wb.ketchem.board(); for (const c of K.kevin.party) delete c.bredAt; });
const feeHome = fee;
await page.evaluate(d => { const K = window.__wb.ketchem.board(); K.kevin.x = d[0]; K.kevin.y = d[1]; }, fees.far);
await page.keyboard.press('e'); await page.waitForSelector('#kPanel:not([hidden])', { timeout: 5000 });
await page.click('#kPanel [data-tab="pen"]');
await page.click('#kPanel label:has-text("Ma") input'); await page.click('#kPanel label:has-text("Pa") input');
const feeFar = await page.evaluate(() => document.getElementById('kpFee').textContent);
const num = t => +((/(\d+)/.exec(t) || [])[1] || NaN);
ok('a found store\'s pen charges three quarters', num(feeFar) === Math.round(num(feeHome) * 0.75), feeHome + ' | ' + feeFar);
console.log('console errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
await browser.close();
