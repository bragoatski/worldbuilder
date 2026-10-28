/* global window, document, getComputedStyle */
// Guest-seat rehearsal (2026-10-26): a second person joins from the HUD, plays on the arrows and the right-hand keys
// while Kevin keeps WASD, catches and names a creature, opens a store, and leaves; Root's launch card refuses the
// seat while the guest holds it. Runs against a scratch relay (the launch card needs one; nothing is summoned).
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
await page.waitForTimeout(500);
const st = () => page.evaluate(() => { const K = window.__wb.ketchem.board(); const g = K.root && K.root.human && !K.root.away ? K.root : null; return { kevin: [K.kevin.x, K.kevin.y], guest: g ? [g.x, g.y] : null, gname: g && g.display, gmsg: g && g.msg, kmsg: K.kevin.msg, gparty: g ? g.party.map(c => c.name || c.type) : [] }; });
// join
ok('the HUD offers a guest seat', await page.evaluate(() => /\+ guest/.test(document.querySelector('#kHud .kh-guest').textContent)));
await page.click('#kHud .kh-guest'); await answer('Sam');
await page.waitForTimeout(300);
let s = await st();
ok('Sam joins on the second doorstep', s.guest && s.gname === 'Sam' && /Sam joins/.test(s.gmsg || ''), JSON.stringify(s));
const hud2 = await page.evaluate(() => { const h = document.getElementById('kHud2'); return h && !h.hidden ? h.textContent : null; });
ok('Sam has a bar of their own', !!hud2 && /Sam/.test(hud2), hud2);
const box = await page.evaluate(() => { const w = document.querySelector('.canvas-wrap').getBoundingClientRect(), h = document.getElementById('kHud2').getBoundingClientRect(), k = document.getElementById('kHud').getBoundingClientRect(); return { wrapRight: Math.round(w.right), hudRight: Math.round(h.right), hudTop: Math.round(h.top), kevinTop: Math.round(k.top), pos: getComputedStyle(document.getElementById('kHud2')).position }; });
ok('the guest bar sits top right, level with Kevin\'s', box.pos === 'absolute' && Math.abs(box.hudTop - box.kevinTop) <= 2 && box.wrapRight - box.hudRight <= 20, JSON.stringify(box));
// two hands on one keyboard
await page.evaluate(() => window.__wb.ketchem.pause(true));
const before = await st();
await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(100);
await page.keyboard.press('d'); await page.waitForTimeout(100);
const after = await st();
ok('the arrows move Sam, not Kevin', after.guest[0] !== before.guest[0] || after.guest[1] !== before.guest[1], JSON.stringify(before.guest) + ' -> ' + JSON.stringify(after.guest));
ok('WASD moves Kevin, not Sam', after.kevin[0] === before.kevin[0] + 1 || after.kevin[0] !== before.kevin[0], JSON.stringify(before.kevin) + ' -> ' + JSON.stringify(after.kevin));
// Sam catches and names
await page.evaluate(() => { const sim = window.__wb.sim, K = window.__wb.ketchem.board(), g = K.root; const dx = sim.grid[sim.idx(g.x + 1, g.y)] !== sim.T.OCEAN ? 1 : -1; const h = sim.makeFauna(g.x + dx, g.y, 'herbivore', null); h.energy = h.maxEnergy * 0.9; sim.fauna.push(h); K.rng = () => 0.001; });
await page.keyboard.press('.'); await page.keyboard.press('/');
s = await st(); ok('. and / throw for Sam', /caught/.test(s.gmsg || ''), s.gmsg);
await page.keyboard.press("'");
const q = await page.evaluate(() => document.querySelector('#kAsk label').textContent);
ok('the name question is Sam\'s', /^Sam:/.test(q), q);
await page.fill('#kAskIn', 'Moss'); await page.press('#kAskIn', 'Enter'); await page.waitForTimeout(200);
s = await st(); ok('Sam names it', s.gparty.includes('Moss'), JSON.stringify(s.gparty));
await page.evaluate(() => window.__wb.ketchem.pause(false)); await page.waitForTimeout(500);
const p2 = await page.evaluate(() => { const r = document.getElementById('kParty2'); return r && !r.hidden ? r.textContent : null; });
ok('Sam\'s party row shows Moss', /Moss/.test(p2 || ''), p2);
const pbox = await page.evaluate(() => { const w = document.querySelector('.canvas-wrap').getBoundingClientRect(), r = document.getElementById('kParty2').getBoundingClientRect(); return { wrapRight: Math.round(w.right), wrapBottom: Math.round(w.bottom), right: Math.round(r.right), bottom: Math.round(r.bottom) }; });
ok('the guest party row sits bottom right', pbox.wrapRight - pbox.right <= 20 && pbox.wrapBottom - pbox.bottom <= 20, JSON.stringify(pbox));
await page.screenshot({ path: `${out}/two-players.png` });
// Sam's store panel; Kevin's moves do not close it
await page.evaluate(() => { window.__wb.ketchem.pause(true); const K = window.__wb.ketchem.board(), s = K.stores[K.starts[1].store]; K.root.x = s.x; K.root.y = s.y; });
await page.keyboard.press(';'); await page.waitForTimeout(200);
const head = await page.evaluate(() => { const p = document.getElementById('kPanel'); return p && !p.hidden ? p.querySelector('.kp-head span').textContent : null; });
ok('; opens the store for Sam', !!head, head);
ok('Sam\'s panel has no Send (the saves are Kevin\'s)', await page.evaluate(() => { document.querySelector('#kPanel [data-tab="box"]').click(); return !document.querySelector('#kPanel [data-send]'); }));
await page.keyboard.press('w'); await page.waitForTimeout(100);
ok('Kevin walking does not close Sam\'s panel', await page.evaluate(() => !document.getElementById('kPanel').hidden));
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(100);
ok('Sam walking off the store closes it', await page.evaluate(() => document.getElementById('kPanel').hidden));
await page.evaluate(() => window.__wb.ketchem.pause(false));
// Root's launch card refuses the seat
await page.waitForSelector('#rootCall', { timeout: 15000 });
await page.click('#rootCall');
await page.click('#rootLaunch .rl-card[data-mode="ketchem"]');
await page.click('#rlBegin'); await page.waitForTimeout(500);
const log = await page.evaluate(() => [...document.querySelectorAll('#vpLog div')].map(d => d.textContent).slice(-2).join(' | '));
ok('Call Root says the seat is taken, and nothing is summoned', /taken by Sam/.test(log) && !/Calling Root/.test(log), log);
// a save and load keep Sam seated, then Sam leaves and Root's seat is free again
await page.evaluate(() => window.__wb.ketchem.save('seat')); await page.waitForTimeout(800);
await page.evaluate(() => window.__wb.ketchem.load('seat')); await page.waitForTimeout(800);
s = await st(); ok('a save and load keep Sam seated with Moss', s.gname === 'Sam' && s.gparty.includes('Moss'), JSON.stringify(s));
await page.click('#kHud .kh-guest'); await page.waitForTimeout(300);
s = await st(); ok('Sam leaves; the seat is free and the HUD offers it again', !s.guest && await page.evaluate(() => /\+ guest/.test(document.querySelector('#kHud .kh-guest').textContent)) && await page.evaluate(() => document.getElementById('kHud2').hidden), s.kmsg);
await page.click('#kHud .kh-guest'); await answer('Sam'); await page.waitForTimeout(300);
s = await st(); ok('and Sam comes back with Moss', s.gparty.includes('Moss'), JSON.stringify(s.gparty));
console.log('console errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
await browser.close();
