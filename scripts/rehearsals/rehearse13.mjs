/* global window, document, indexedDB */
// Trading between saves rehearsal (2026-10-26): game "alpha" (kseed 11) and game "beta" (kseed 12) in IndexedDB; a
// cabinet creature in alpha is sent to beta from the store's BOX tab; alpha's save no longer holds it, beta's does,
// with a fresh id; loading beta shows it in the cabinet. No Root: the relay only mirrors.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('C:/Users/KevinReilly/taipan/package.json');
const { chromium } = require('playwright');
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error' && !/ERR_(EMPTY_RESPONSE|CONNECTION_RESET|CONNECTION_REFUSED)/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('dialog', d => { errors.push('a browser dialog opened: ' + d.message()); d.dismiss(); });
const answer = async v => { await page.waitForSelector('#kAsk:not([hidden])', { timeout: 8000 }); await page.fill('#kAskIn', v); await page.press('#kAskIn', 'Enter'); };
const ok = (label, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra ? ': ' + extra : ''));
const boot = async seed => {
  await page.goto('http://127.0.0.1:5173/worldbuilder/?debug&ketchem=continent&kseed=' + seed);
  await page.click('#introStart');
  await page.waitForFunction(() => window.__wb && window.__wb.ketchem && window.__wb.ketchem.board() !== null, null, { timeout: 120000 });
  await page.waitForTimeout(300);
};
const record = slot => page.evaluate(s => new Promise((res, rej) => { const r = indexedDB.open('ketchem', 1); r.onsuccess = () => { const q = r.result.transaction('slots').objectStore('slots').get(s); q.onsuccess = () => res(q.result ? { cabinet: q.result.cabinet.map(c => c.id + ':' + (c.name || c.type)) } : null); q.onerror = () => rej(q.error); }; r.onerror = () => rej(r.error); }), slot);
// beta: an empty cabinet, saved
await boot(12);
await page.evaluate(() => window.__wb.ketchem.save('beta')); await page.waitForTimeout(800);
// alpha: a named creature in the cabinet, saved
await boot(11);
await page.evaluate(() => window.__wb.ketchem.pause(true));
await page.evaluate(() => { const sim = window.__wb.sim, K = window.__wb.ketchem.board(), p = K.kevin; const dx = sim.grid[sim.idx(p.x + 1, p.y)] !== sim.T.OCEAN ? 1 : -1; const h = sim.makeFauna(p.x + dx, p.y, 'herbivore', null); h.energy = h.maxEnergy * 0.9; sim.fauna.push(h); K.rng = () => 0.001; });
await page.keyboard.press('Tab'); await page.keyboard.press('Space'); await page.keyboard.press('n'); await answer('Wanderer');
const K0 = await page.evaluate(() => { const K = window.__wb.ketchem.board(); const s = K.stores[K.starts[0].store]; return { kevin: [K.kevin.x, K.kevin.y], store: [s.x, s.y] }; });
await page.evaluate(d => window.__wb.ketchem.step(Math.sign(d[0]), Math.sign(d[1])), [K0.store[0] - K0.kevin[0], K0.store[1] - K0.kevin[1]]);
await page.evaluate(() => window.__wb.ketchem.pause(false));
await page.keyboard.press('c'); await page.waitForSelector('#kPanel [data-box]');
await page.click('#kPanel [data-box]');
await page.evaluate(() => window.__wb.ketchem.save('alpha')); await page.waitForTimeout(800);
const before = { alpha: await record('alpha'), beta: await record('beta') };
ok('alpha holds "Wanderer" in its cabinet, beta holds nothing', before.alpha.cabinet.some(x => /Wanderer/.test(x)) && before.beta.cabinet.length === 0, JSON.stringify(before));
const sendBtn = await page.$('#kPanel [data-send]');
ok('the cabinet row has a Send button', !!sendBtn);
await page.screenshot({ path: `${out}/send-button.png` });
await sendBtn.click();
const q = await page.evaluate(async () => { await new Promise(r => setTimeout(r, 300)); const l = document.querySelector('#kAsk label'); return l ? l.textContent : ''; });
ok('the bar asks which saved game, and offers beta only', /beta/.test(q) && !/alpha/.test(q), q);
await answer('beta');
await page.waitForFunction(() => /went to the cabinet/.test(window.__wb.ketchem.board().kevin.msg || ''), null, { timeout: 10000 }).catch(() => {});
const msg = await page.evaluate(() => window.__wb.ketchem.board().kevin.msg);
ok('the send is confirmed', /went to the cabinet of "beta"/.test(msg), msg);
const after = { alpha: await record('alpha'), beta: await record('beta'), live: await page.evaluate(() => window.__wb.ketchem.board().cabinet.map(c => c.name)) };
ok('alpha no longer holds it, in the save or the live game', !after.alpha.cabinet.some(x => /Wanderer/.test(x)) && !after.live.includes('Wanderer'), JSON.stringify(after.alpha) + ' live ' + JSON.stringify(after.live));
ok('beta holds it once', after.beta.cabinet.filter(x => /Wanderer/.test(x)).length === 1, JSON.stringify(after.beta));
await page.screenshot({ path: `${out}/sent.png` });
// load beta and see it in the cabinet
await page.evaluate(() => window.__wb.ketchem.load('beta'));
await page.waitForFunction(() => window.__wb.ketchem.board() && window.__wb.ketchem.board().slot === 'beta', null, { timeout: 30000 });
await page.waitForTimeout(500);
const inBeta = await page.evaluate(() => window.__wb.ketchem.board().cabinet.map(c => ({ id: c.id, name: c.name, from: c.tradedFrom, held: c.held })));
ok('loading beta shows "Wanderer" in its cabinet, marked as sent from alpha', inBeta.length === 1 && inBeta[0].name === 'Wanderer' && inBeta[0].from === 'alpha' && inBeta[0].held === true, JSON.stringify(inBeta));
const born = await page.evaluate(() => window.__wb.sim.makeFauna(1, 1, 'herbivore', null).id);
ok('the next creature born in beta gets a higher id', born > inBeta[0].id, born + ' > ' + inBeta[0].id);
// the duplication the critic found: ask to send, move the creature to the party while the question is open, then answer
await page.evaluate(() => { const K = window.__wb.ketchem.board(); const s = K.stores[K.starts[0].store]; K.kevin.x = s.x; K.kevin.y = s.y; K.kevin.moved = true; });
await page.keyboard.press('c'); await page.waitForSelector('#kPanel [data-send]');
await page.click('#kPanel [data-send]');
await page.waitForSelector('#kAsk:not([hidden])');
await page.evaluate(() => document.querySelector('#kPanel [data-take]').click());
await page.fill('#kAskIn', 'alpha'); await page.press('#kAskIn', 'Enter'); await page.waitForTimeout(800);
const dupMsg = await page.evaluate(() => window.__wb.ketchem.board().kevin.msg);
const alphaNow = await record('alpha');
ok('moving it to the party mid-question cancels the send: no second copy', /left the cabinet/.test(dupMsg) && !alphaNow.cabinet.some(x => /Wanderer/.test(x)), dupMsg + ' | alpha ' + JSON.stringify(alphaNow.cabinet));
await page.keyboard.press('Escape');
await page.keyboard.press('c'); await page.waitForSelector('#kPanel [data-box]'); await page.click('#kPanel [data-box]'); await page.keyboard.press('Escape');
// a send with no other save: delete beta, try from beta's cabinet
await page.evaluate(() => new Promise(r => { const q = indexedDB.open('ketchem', 1); q.onsuccess = () => { const t = q.result.transaction('slots', 'readwrite'); t.objectStore('slots').delete('alpha'); t.oncomplete = r; }; }));
const K1 = await page.evaluate(() => { const K = window.__wb.ketchem.board(); const s = K.stores[K.starts[0].store]; K.kevin.x = s.x; K.kevin.y = s.y; K.kevin.moved = true; return true; });
void K1;
await page.keyboard.press('c'); await page.waitForSelector('#kPanel [data-send]');
await page.click('#kPanel [data-send]'); await page.waitForTimeout(500);
const none = await page.evaluate(() => window.__wb.ketchem.board().kevin.msg);
ok('with no other saved game the send says so and keeps the creature', /no other saved game/.test(none) && (await page.evaluate(() => window.__wb.ketchem.board().cabinet.length)) === 1, none);
console.log('console errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
await browser.close();
