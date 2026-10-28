/* global window, document */
// Gamepad rehearsal (2026-10-27): a scripted standard gamepad plays the guest seat on the live page. Start asks for a
// guest and A accepts "Guest"; the d-pad and the stick move them; B targets, A throws, X offers a free name and A takes
// it; RT then A then Y baits here; Back gives Kevin coins; R3 feeds; Start opens and closes the Almanac; B declines the
// guest's own question; and the pad never answers one of Kevin's; RB turns the potion list to a fifth potion. Needs
// nothing (no Root is called).
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
await page.addInitScript(() => {   // a pad the script holds: 17 buttons, 4 axes, standard mapping
  window.__pad = { id: 'rehearsal pad', index: 0, connected: true, mapping: 'standard', buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
  window.__pads = [window.__pad];
  Object.defineProperty(navigator, 'getGamepads', { value: () => window.__pads, configurable: true });
});
const ok = (label, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra ? ': ' + extra : ''));
const A = 0, B = 1, X = 2, Y = 3, RT = 7, BACK = 8, START = 9, R3 = 11, RIGHT = 15;
const press = async i => { await page.evaluate(i => { window.__pad.buttons[i] = { pressed: true, value: 1 }; }, i); await page.waitForTimeout(150); await page.evaluate(i => { window.__pad.buttons[i] = { pressed: false, value: 0 }; }, i); await page.waitForTimeout(150); };
const bar = () => page.evaluate(() => { const b = document.getElementById('kAsk'); return b && !b.hidden ? { q: b.querySelector('label').textContent, v: b.querySelector('input').value } : null; });
const st = () => page.evaluate(() => { const K = window.__wb.ketchem.board(), g = K.root && K.root.human && !K.root.away ? K.root : null; return { guest: g ? [g.x, g.y] : null, gname: g && g.display, gmsg: g && g.msg, gparty: g ? g.party.map(c => c.name || c.type) : [], kwallet: K.kevin.wallet, gwallet: g ? g.wallet : null, baits: K.baits.filter(b => b.by === 'guest').map(b => [b.kind, b.x, b.y]) }; });
await page.goto('http://127.0.0.1:5173/worldbuilder/?debug&ketchem=continent&kseed=11');
await page.click('#introStart');
await page.waitForFunction(() => window.__wb && window.__wb.ketchem && window.__wb.ketchem.board() !== null, null, { timeout: 120000 });
await page.waitForTimeout(500);
await page.evaluate(() => { window.__wb.ketchem.pause(true); window.dispatchEvent(new Event('gamepadconnected')); });
// Start seats a guest, A takes the offered name
await press(START);
let q = await bar(); ok('Start asks who joins, and says A takes "Guest"', !!q && /Who joins/.test(q.q) && /A on the pad/.test(q.q) && q.v === 'Guest', JSON.stringify(q));
await press(A);
let s = await st(); ok('A seats Guest', s.gname === 'Guest' && !(await bar()), JSON.stringify(s));
// moving
let s0 = s; await press(RIGHT); s = await st();
ok('the d-pad moves the guest', s.guest[0] === s0.guest[0] + 1 || s.guest[1] !== s0.guest[1] || /winded|nothing|water/.test(s.gmsg || ''), JSON.stringify(s0.guest) + ' -> ' + JSON.stringify(s.guest));
s0 = s; await page.evaluate(() => { window.__pad.axes[0] = -1; }); await page.waitForTimeout(150); await page.evaluate(() => { window.__pad.axes[0] = 0; }); await page.waitForTimeout(150); s = await st();
ok('the left stick moves the guest', s.guest[0] === s0.guest[0] - 1, JSON.stringify(s0.guest) + ' -> ' + JSON.stringify(s.guest));
// catch and name with a free name
await page.evaluate(() => { const sim = window.__wb.sim, K = window.__wb.ketchem.board(), g = K.root; const dx = sim.grid[sim.idx(g.x + 1, g.y)] !== sim.T.OCEAN ? 1 : -1; const h = sim.makeFauna(g.x + dx, g.y, 'herbivore', null); h.energy = h.maxEnergy * 0.9; sim.fauna.push(h); K.rng = () => 0.001; });
await press(B); await press(A); s = await st();
ok('B targets and A throws', /caught/.test(s.gmsg || ''), s.gmsg);
await press(X); q = await bar();
ok('X asks the guest to name it, offering a free name', !!q && /^Guest: name your herbivore/.test(q.q) && /^Herbivore \d+$/.test(q.v), JSON.stringify(q));
await page.screenshot({ path: `${out}/pad-name.png` });
await press(A); s = await st();
ok('A takes the offered name', s.gparty.length === 1 && /^Herbivore \d+$/.test(s.gparty[0]), JSON.stringify(s.gparty));
// Kevin's question is never the pad's
await page.keyboard.press('g'); q = await bar();
await press(A); const q2 = await bar();
ok('the pad does not answer Kevin\'s question', !!q && /^Give Guest what\?/.test(q.q) && !!q2 && q2.q === q.q, JSON.stringify(q2));
await page.press('#kAskIn', 'Escape'); await page.waitForTimeout(100);
// bait here
await page.evaluate(() => { const g = window.__wb.ketchem.board().root; g.pack.push({ type: 'grass', gen: 0 }, { type: 'grass', gen: 0 }); });
await press(RT); s = await st(); ok('RT asks for a bait kind in pad buttons', /bait: A plant, B scatter, X meat, Y stake/.test(s.gmsg || ''), s.gmsg);
await press(A); s = await st(); ok('A picks plant and names the pad\'s way to place it', /bait plant: which way\? \(the d-pad, or Y for here/.test(s.gmsg || ''), s.gmsg);
await press(Y); s = await st(); ok('Y sets the bait under the guest', s.baits.length === 1 && s.baits[0][0] === 'plant' && s.baits[0][1] === s.guest[0] && s.baits[0][2] === s.guest[1], JSON.stringify(s.baits));
// give, and B declining
await page.evaluate(() => { const K = window.__wb.ketchem.board(); K.kevin.x = K.root.x; K.kevin.y = K.root.y; K.root.wallet = 25; });
s0 = await st(); await press(BACK); q = await bar();
ok('Back asks what to give Kevin', !!q && /^Guest: Give Kevin what\?/.test(q.q) && q.v === 'coins 10', JSON.stringify(q));
await press(B); s = await st();
ok('B declines the guest\'s question; nothing moves', !(await bar()) && s.kwallet === s0.kwallet, JSON.stringify(s));
await press(BACK); await press(A); s = await st();
ok('Back then A gives Kevin 10 coins', s.kwallet === s0.kwallet + 10 && s.gwallet === 15, s0.kwallet + ' -> ' + s.kwallet + ', ' + s.gmsg);
// feed
await press(R3); q = await bar(); await press(A); s = await st();
ok('R3 then A feeds the first party creature a plant', !!q && /Feed which party creature/.test(q.q) && /eats a (rare )?plant/.test(s.gmsg || ''), s.gmsg);
// the Almanac
await press(START);
const head = await page.evaluate(() => { const p = document.getElementById('kPanel'); return p && !p.hidden ? p.querySelector('.kp-head span').textContent : null; });
ok('Start opens the Almanac for the guest', /^Almanac/.test(head || ''), head);
await page.screenshot({ path: `${out}/pad-almanac.png` });
await press(START);
ok('Start again closes it', await page.evaluate(() => document.getElementById('kPanel').hidden));
// RB turns the potion list: the fifth potion is reachable from the pad
const LT = 6, RB = 5;
await page.evaluate(() => { const g = window.__wb.ketchem.board().root; for (const n of ['Fleetfoot', 'Hush', 'Smoke', 'Decoy', 'Hawkeye']) g.pack.push({ potion: n }); });
await press(LT); s = await st(); ok('LT lists four potions under A B X Y and says RB has more', /^potion: A Fleetfoot x1, B Hush x1, X Smoke x1, Y Decoy x1 \(RB: more, 1\/2\)/.test(s.gmsg || ''), s.gmsg);
await press(RB); s = await st(); ok('RB turns to the fifth', /^potion: A Hawkeye x1 \(RB: more, 2\/2\)/.test(s.gmsg || ''), s.gmsg);
await press(A); s = await st();
const hk = await page.evaluate(() => window.__wb.ketchem.board().root.pack.filter(x => x.potion === 'Hawkeye').length);
ok('A uses the fifth potion', hk === 0 && /Hawkeye/i.test(s.gmsg || ''), s.gmsg);
// a held d-pad is let go when the pad disappears
await page.evaluate(() => { window.__pad.buttons[15] = { pressed: true, value: 1 }; }); await page.waitForTimeout(150);
await page.evaluate(() => { window.__pads = []; }); await page.waitForTimeout(200);
await page.evaluate(() => window.__wb.ketchem.pause(false)); await page.waitForTimeout(400);
const g1 = (await st()).guest; await page.waitForTimeout(800); const g2 = (await st()).guest;
ok('after the pad disconnects mid-press, the guest stops walking', g1[0] === g2[0] && g1[1] === g2[1], JSON.stringify(g1) + ' -> ' + JSON.stringify(g2));
await page.screenshot({ path: `${out}/pad-play.png` });
console.log('console errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
await browser.close();
