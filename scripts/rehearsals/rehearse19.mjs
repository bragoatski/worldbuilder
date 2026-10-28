/* global window, document, getComputedStyle */
// Controls panel and board picker (2026-10-28): the start card's "Play Ketch'em" row starts a board; the panel shows
// every control with its key; a tap on the pad steps and a held one walks until released; Target, Throw and Name by
// click catch and name a creature; the stones, the bait flow and the potion list work by clicks; the panel collapses
// and stays collapsed after a reload; nothing overlaps the HUD, the party row or the question bar at three window
// sizes; the picker fits a phone. Needs nothing.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('C:/Users/KevinReilly/taipan/package.json');
const { chromium } = require('playwright');
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error' && !/ERR_(EMPTY_RESPONSE|CONNECTION_RESET|CONNECTION_REFUSED)/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('dialog', d => { errors.push('a browser dialog opened: ' + d.message()); d.dismiss(); });
const ok = (label, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra ? ': ' + extra : ''));
const kv = () => page.evaluate(() => { const K = window.__wb.ketchem.board(), p = K.kevin; return { x: p.x, y: p.y, stone: p.stone, msg: p.msg || '', party: p.party.map(c => c.name || c.type), naming: !!p.naming }; });
const act = a => page.click('#kKeys [data-act="' + a + '"]');
// the picker
await page.goto('http://127.0.0.1:5173/worldbuilder/?debug');
await page.waitForSelector('#introBoards .intro-board[data-setting="archipelago"]', { timeout: 15000 });
const labels = await page.evaluate(() => [...document.querySelectorAll('#introBoards .intro-board')].map(b => b.textContent.replace(/\s+/g, ' ').trim()));
ok('the start card offers three Ketch\'em boards with their lines', labels.length === 3 && /Continent/.test(labels[0]) && /islands, bridges and boats/.test(labels[1]) && /Highlands/.test(labels[2]), JSON.stringify(labels));
await page.screenshot({ path: `${out}/picker.png` });
await page.click('#introBoards .intro-board[data-setting="continent"]');
await page.waitForFunction(() => window.__wb && window.__wb.ketchem && window.__wb.ketchem.board() !== null, null, { timeout: 120000 });
await page.waitForTimeout(600);
ok('a picker click builds a Continent board', await page.evaluate(() => window.__wb.ketchem.board().setting === 'continent'));
// the panel
await page.waitForSelector('#kKeys:not(.closed)', { timeout: 5000 });
const keysText = await page.evaluate(() => document.getElementById('kKeys').textContent.replace(/\s+/g, ' '));
ok('the panel shows the controls with their keys', /Throw/.test(keysText) && /Space/.test(keysText) && /Target/.test(keysText) && /Tab/.test(keysText) && /Almanac/.test(keysText) && /F5/.test(keysText), keysText.slice(0, 140));
await page.evaluate(() => window.__wb.ketchem.pause(true));
await page.screenshot({ path: `${out}/panel.png` });
// pad: a tap steps once
let a = await kv(); await act('move-right'); await page.waitForTimeout(150); let b = await kv();
ok('a tap on the pad steps Kevin', b.x !== a.x || b.y !== a.y || /water|edge|steep|lake|nothing/.test(b.msg), JSON.stringify([a.x, a.y]) + ' -> ' + JSON.stringify([b.x, b.y]) + ' ' + b.msg);
// hold walks, release stops
await page.evaluate(() => window.__wb.ketchem.pause(false));
const pad = await page.$('#kKeys [data-act="move-left"]'), box = await pad.boundingBox();
a = await kv();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
await page.waitForTimeout(1600); const mid = await kv();
await page.mouse.up(); await page.waitForTimeout(400); const r1 = await kv(); await page.waitForTimeout(1000); const r2 = await kv();
ok('holding the pad walks', Math.abs(mid.x - a.x) >= 2 || /water|edge|steep|lake/.test(mid.msg), JSON.stringify([a.x, mid.x]) + ' ' + mid.msg);
ok('and releasing it stops', r1.x === r2.x && r1.y === r2.y, JSON.stringify([r1.x, r2.x]));
await page.evaluate(() => window.__wb.ketchem.pause(true));
// stones
await act('stone-geode'); b = await kv();
ok('a click picks the Geode, and the panel lights it', b.stone === 'Geode' && await page.evaluate(() => document.querySelector('#kKeys [data-act="stone-geode"]').classList.contains('on')), b.stone);
await act('stone-amber');
// catch and name by clicks
await page.evaluate(() => { const sim = window.__wb.sim, K = window.__wb.ketchem.board(), p = K.kevin; const dx = sim.grid[sim.idx(p.x + 1, p.y)] !== sim.T.OCEAN ? 1 : -1; const h = sim.makeFauna(p.x + dx, p.y, 'herbivore', null); h.energy = h.maxEnergy * 0.9; sim.fauna.push(h); K.rng = () => 0.001; });
await act('target'); await act('throw'); b = await kv();
ok('Target and Throw by click catch it', /caught/.test(b.msg), b.msg);
await act('name');
await page.waitForSelector('#kAsk:not([hidden])', { timeout: 5000 });
await page.screenshot({ path: `${out}/name-question.png` });
const overlap = (r1, r2) => r1 && r2 && !(r1.right <= r2.left || r2.right <= r1.left || r1.bottom <= r2.top || r2.bottom <= r1.top);
const rects = () => page.evaluate(() => { const r = id => { const e = document.getElementById(id); if (!e || e.hidden || getComputedStyle(e).display === 'none') return null; const b = e.getBoundingClientRect(); return b.width ? { left: b.left, right: b.right, top: b.top, bottom: b.bottom } : null; }; return { keys: r('kKeys'), hud: r('kHud'), party: r('kParty'), ask: r('kAsk'), panel: r('kPanel') }; });
let R = await rects();
ok('the panel clears the HUD, the party row and the question bar (1600x950)', !overlap(R.keys, R.hud) && !overlap(R.keys, R.party) && !overlap(R.keys, R.ask), JSON.stringify(R));
await page.fill('#kAskIn', 'Clicky'); await page.press('#kAskIn', 'Enter'); await page.waitForTimeout(150);
b = await kv(); ok('the name question from a click names it', b.party.includes('Clicky'), JSON.stringify(b.party));
ok('Space after a click throws rather than re-clicking a button', await page.evaluate(() => document.activeElement === document.body || !document.activeElement.closest('#kKeys')));
// bait by clicks
await page.evaluate(() => { const p = window.__wb.ketchem.board().kevin; p.pack.push({ type: 'grass', gen: 0 }); });
await act('bait');
ok('Bait shows the four kinds', await page.evaluate(() => ['plant', 'scatter', 'meat', 'stake'].every(k => document.querySelector('#kKeys [data-bait="' + k + '"]'))));
await page.click('#kKeys [data-bait="plant"]');
ok('a kind shows Here and Cancel', await page.evaluate(() => !!document.querySelector('#kKeys [data-bait="here"]') && !!document.querySelector('#kKeys [data-act="bait-cancel"]')));
await page.screenshot({ path: `${out}/bait.png` });
await page.click('#kKeys [data-bait="here"]'); await page.waitForTimeout(150);
const baits = await page.evaluate(() => { const K = window.__wb.ketchem.board(); return K.baits.filter(x => x.by === 'kevin').map(x => [x.kind, x.x === K.kevin.x && x.y === K.kevin.y]); });
ok('Here sets a plant bait under Kevin', baits.length === 1 && baits[0][0] === 'plant' && baits[0][1], JSON.stringify(baits) + ' ' + (await kv()).msg);
// potions by clicks
await page.evaluate(() => { const p = window.__wb.ketchem.board().kevin; for (const n of ['Fleetfoot', 'Hawkeye']) p.pack.push({ potion: n }); });
await act('potion');
const plist = await page.evaluate(() => [...document.querySelectorAll('#kKeys [data-potion]')].map(b => b.dataset.potion));
ok('Potion lists the pack\'s potions as buttons', plist.join(',') === 'Fleetfoot,Hawkeye', JSON.stringify(plist));
await page.click('#kKeys [data-potion="Hawkeye"]'); await page.waitForTimeout(150);
const hk = await page.evaluate(() => window.__wb.ketchem.board().kevin.pack.filter(x => x.potion === 'Hawkeye').length);
b = await kv(); ok('a potion button drinks that potion', hk === 0, b.msg);
// More: the Almanac by click
await act('almanac'); await page.waitForTimeout(150);
ok('Almanac by click opens the panel', await page.evaluate(() => /Almanac/.test((document.querySelector('#kPanel .kp-head span') || {}).textContent || '')));
await page.keyboard.press('Escape');
// collapse, and it stays collapsed after a reload
await page.click('#kKeysToggle'); await page.waitForTimeout(150);
ok('the panel collapses to a tab', await page.evaluate(() => document.getElementById('kKeys').classList.contains('closed')));
await page.screenshot({ path: `${out}/collapsed.png` });
await page.goto('http://127.0.0.1:5173/worldbuilder/?debug&ketchem=continent&kseed=11'); await page.click('#introStart');
await page.waitForFunction(() => window.__wb && window.__wb.ketchem && window.__wb.ketchem.board() !== null, null, { timeout: 120000 }); await page.waitForTimeout(500);
ok('and stays collapsed after a reload', await page.evaluate(() => document.getElementById('kKeys').classList.contains('closed')));
await page.click('#kKeysToggle'); await page.waitForTimeout(150);
// overlap at other window sizes
for (const [w, h] of [[1280, 800], [1920, 1000]]) {
  await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(400);
  R = await rects();
  ok('the panel clears the HUD and the party row at ' + w + 'x' + h, !overlap(R.keys, R.hud) && !overlap(R.keys, R.party), JSON.stringify(R));
  await page.screenshot({ path: `${out}/panel-${w}.png` });
}
// the picker on a phone
const phone = await (await browser.newContext({ viewport: { width: 375, height: 760 }, hasTouch: true })).newPage();
await phone.goto('http://127.0.0.1:5173/worldbuilder/?debug');
await phone.waitForSelector('#introBoards .intro-board', { timeout: 15000 });
const sw = await phone.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
ok('the picker fits a phone with no sideways scroll', sw[0] <= sw[1], JSON.stringify(sw));
await phone.screenshot({ path: `${out}/picker-phone.png` });
console.log('console errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
await browser.close();
