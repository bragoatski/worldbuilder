/* global window, document */
// Guest link rehearsal (2026-10-27): Kevin's page on the dev server, a guest's page in a second browser through the
// guest link on 127.0.0.1:7797. The guest joins with the code, sees their corner of the world, moves with the arrows on
// their own screen, catches and names a creature (the name question on their screen), buys at a store by command;
// Kevin's arrows move Kevin while the guest is remote; then (2026-10-27) the guest baits by button and by key, gives and
// feeds by command and by button, and reads the Almanac as text; the guest leaves and the link closes.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('C:/Users/KevinReilly/taipan/package.json');
const { chromium } = require('playwright');
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const host = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const guest = await (await browser.newContext({ viewport: { width: 420, height: 900 }, hasTouch: true })).newPage();
const errors = [];
for (const [who, p] of [['host', host], ['guest', guest]]) {
  p.on('console', m => { if (m.type() === 'error' && !/ERR_(EMPTY_RESPONSE|CONNECTION_RESET|CONNECTION_REFUSED)/.test(m.text())) errors.push(who + ': ' + m.text()); });
  p.on('pageerror', e => errors.push(who + ' pageerror: ' + e.message));
  p.on('dialog', d => { errors.push(who + ': a browser dialog opened'); d.dismiss(); });
}
const answer = async v => { await host.waitForSelector('#kAsk:not([hidden])', { timeout: 8000 }); await host.fill('#kAskIn', v); await host.press('#kAskIn', 'Enter'); };
const ok = (label, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra ? ': ' + extra : ''));
await host.goto('http://127.0.0.1:5173/worldbuilder/?debug&ketchem=continent&kseed=11');
await host.click('#introStart');
await host.waitForFunction(() => window.__wb && window.__wb.ketchem && window.__wb.ketchem.board() !== null, null, { timeout: 120000 });
await host.waitForSelector('#kHud .kh-guest[data-remote="1"]', { timeout: 15000 });
ok('with the link running, the HUD offers a guest on another screen', true);
await host.click('#kHud .kh-guest[data-remote="1"]'); await answer('Sam');
await host.waitForFunction(() => /code \d{6}/.test(window.__wb.ketchem.board().kevin.msg || ''), null, { timeout: 8000 });
const kmsg = await host.evaluate(() => window.__wb.ketchem.board().kevin.msg);
const code = /code (\d{6})/.exec(kmsg)[1];
ok('Kevin sees the address and the code', /127\.0\.0\.1:7797\/\?code=\d{6}/.test(kmsg), kmsg);
// the guest joins
await guest.goto('http://127.0.0.1:7797/');
await guest.fill('#code', '000000'); await guest.click('#go'); await guest.waitForTimeout(800);
ok('a wrong code is refused on the guest page', await guest.evaluate(() => !document.getElementById('join').hidden && /no game here with that code/.test(document.getElementById('joinMsg').textContent)));
await guest.fill('#code', code); await guest.click('#go');
await guest.waitForFunction(() => document.getElementById('view').src.startsWith('data:image/jpeg'), null, { timeout: 8000 });
ok('the guest sees their corner of the world and their numbers', await guest.evaluate(() => /Sam/.test(document.getElementById('bar').textContent)), await guest.evaluate(() => document.getElementById('bar').textContent));
await guest.screenshot({ path: `${out}/guest-screen.png` });
// moves: the guest's arrows on their own page; Kevin's arrows on his
await host.evaluate(() => window.__wb.ketchem.pause(true));
const pos = () => host.evaluate(() => { const K = window.__wb.ketchem.board(); return { g: [K.root.x, K.root.y], k: [K.kevin.x, K.kevin.y] }; });
const p0 = await pos();
await guest.keyboard.press('ArrowLeft'); await host.waitForTimeout(700);
await host.keyboard.press('ArrowRight'); await host.waitForTimeout(200);
const p1 = await pos();
ok('the guest\'s arrow moved Sam', p1.g[0] !== p0.g[0] || p1.g[1] !== p0.g[1], JSON.stringify(p0.g) + ' -> ' + JSON.stringify(p1.g));
ok('Kevin\'s arrow moved Kevin, not Sam (Sam is remote)', (p1.k[0] !== p0.k[0] || p1.k[1] !== p0.k[1]), JSON.stringify(p0.k) + ' -> ' + JSON.stringify(p1.k));
// a touch press on the d-pad
await guest.tap('#pad [data-k="ArrowUp"]'); await host.waitForTimeout(700);
const p2 = await pos();
ok('a tap on the guest\'s d-pad moves Sam', p2.g[0] !== p1.g[0] || p2.g[1] !== p1.g[1], JSON.stringify(p1.g) + ' -> ' + JSON.stringify(p2.g));
// catch and name
await host.evaluate(() => { const sim = window.__wb.sim, K = window.__wb.ketchem.board(), g = K.root; const dx = sim.grid[sim.idx(g.x + 1, g.y)] !== sim.T.OCEAN ? 1 : -1; const h = sim.makeFauna(g.x + dx, g.y, 'herbivore', null); h.energy = h.maxEnergy * 0.9; sim.fauna.push(h); K.rng = () => 0.001; });
await guest.click('#acts [data-k="."]'); await guest.click('#acts [data-k="/"]'); await host.waitForTimeout(700);
await guest.click('#acts [data-k="\'"]');
await guest.waitForSelector('#q:not([hidden])', { timeout: 8000 });
const qText = await guest.evaluate(() => document.getElementById('qText').textContent);
ok('the name question appears on the guest\'s screen, not Kevin\'s', /name your herbivore/.test(qText) && await host.evaluate(() => document.getElementById('kAsk') === null || document.getElementById('kAsk').hidden), qText);
await guest.fill('#qIn', 'Moss'); await guest.press('#qIn', 'Enter'); await host.waitForTimeout(900);
ok('Sam named it Moss from their screen', await host.evaluate(() => window.__wb.ketchem.board().root.party.some(c => c.name === 'Moss')));
// a store by command
await host.evaluate(() => { const K = window.__wb.ketchem.board(), s = K.stores[K.starts[1].store]; K.root.x = s.x; K.root.y = s.y; K.root.wallet = 100; });
await host.waitForTimeout(600);
const shop = await guest.evaluate(() => document.getElementById('shop').hidden ? '' : document.getElementById('shop').textContent);
ok('on a store the guest sees what it sells', /buy: /.test(shop), shop.split('\n')[0]);
await guest.fill('#cmd', 'buy Geode 2'); await guest.press('#cmd', 'Enter'); await host.waitForTimeout(900);
const geode = await host.evaluate(() => window.__wb.ketchem.board().root.stones.geode);
ok('buy Geode 2 from the guest\'s screen', geode === 2, 'geode ' + geode);
await guest.screenshot({ path: `${out}/guest-store.png` });
// ===== guest parity (2026-10-27): bait, give, feed and the Almanac from the guest's screen =====
await host.evaluate(() => { const K = window.__wb.ketchem.board(), s = K.stores[K.starts[1].store], g = K.root; g.x = s.door.x; g.y = s.door.y; K.kevin.x = g.x; K.kevin.y = g.y; for (let i = 0; i < 3; i++) g.pack.push({ type: 'grass', gen: 0 }); });
await host.waitForTimeout(400);
const dirKey15 = await host.evaluate(() => { const sim = window.__wb.sim, g = window.__wb.ketchem.board().root; for (const [k, dx, dy] of [['ArrowUp', 0, -1], ['ArrowDown', 0, 1], ['ArrowLeft', -1, 0], ['ArrowRight', 1, 0]]) { const t = sim.grid[sim.idx(g.x + dx, g.y + dy)]; if (![0, 1, 5, 11, 12].includes(t)) return k; } return 'ArrowUp'; });
const gBaits15 = () => host.evaluate(() => { const K = window.__wb.ketchem.board(); return K.baits.filter(b => b.by === 'guest').map(b => ({ kind: b.kind, x: b.x, y: b.y, payload: b.payload && b.payload.name })); });
const padSel = '#pad [data-k="' + dirKey15 + '"]';
const gmsg = () => host.evaluate(() => window.__wb.ketchem.board().root.msg || '');
await guest.click('#more [data-seq="j 1"]'); await host.waitForTimeout(800);
let m15 = await gmsg(); ok('the Bait plant button asks which way', /bait plant: which way/.test(m15), m15);
await guest.tap(padSel); await host.waitForTimeout(800);
let b15 = await gBaits15(); ok('a d-pad tap sets the guest\'s plant bait', b15.length === 1 && b15[0].kind === 'plant', JSON.stringify(b15) + ' ' + await gmsg());
const kw = () => host.evaluate(() => { const k = window.__wb.ketchem.board().kevin; return { wallet: k.wallet, amber: k.stones.amber }; });
const kw15 = await kw();
await guest.fill('#cmd', 'give coins 4'); await guest.press('#cmd', 'Enter'); await host.waitForTimeout(900);
let kw15b = await kw(); ok('give coins 4 on the command line reaches Kevin', kw15b.wallet === kw15.wallet + 4, JSON.stringify(kw15) + ' -> ' + JSON.stringify(kw15b));
await guest.fill('#cmd', 'feed Moss'); await guest.press('#cmd', 'Enter'); await host.waitForTimeout(900);
m15 = await gmsg(); ok('feed Moss on the command line', /"Moss" eats a (rare )?plant/.test(m15), m15);
await guest.click('#more [data-k="h"]');
await guest.waitForSelector('#q:not([hidden])', { timeout: 8000 });
let q15 = await guest.evaluate(() => document.getElementById('qText').textContent);
ok('the Give button asks on the guest\'s screen', /Give Kevin what\?/.test(q15) && await host.evaluate(() => document.getElementById('kAsk') === null || document.getElementById('kAsk').hidden), q15);
await guest.fill('#qIn', 'Amber 1'); await guest.press('#qIn', 'Enter'); await host.waitForTimeout(900);
kw15b = await kw(); ok('Sam gives Kevin an Amber from their screen', kw15b.amber === kw15.amber + 1, JSON.stringify(kw15b));
await guest.keyboard.press('u');
await guest.waitForSelector('#q:not([hidden])', { timeout: 8000 });
q15 = await guest.evaluate(() => document.getElementById('qText').textContent);
ok('U on the guest\'s keyboard asks the feed question there', /Feed which party creature, and what\?/.test(q15), q15);
await guest.fill('#qIn', 'Moss'); await guest.press('#qIn', 'Enter'); await host.waitForTimeout(900);
m15 = await gmsg(); ok('and Moss eats', /"Moss" eats a (rare )?plant/.test(m15), m15);
await guest.click('#more [data-k="y"]'); await host.waitForTimeout(900);
const alm = await guest.evaluate(() => document.getElementById('alm').hidden ? '' : document.getElementById('alm').textContent);
ok('the Almanac button shows the Almanac as text on the guest\'s screen', /^Almanac: \d+ species, \d\/4 stores found/.test(alm) && /caught 1/.test(alm), alm.split('\n').slice(0, 2).join(' | '));
ok('and no panel opens on Kevin\'s screen', await host.evaluate(() => document.getElementById('kPanel') === null || document.getElementById('kPanel').hidden));
await guest.screenshot({ path: `${out}/guest-almanac.png`, fullPage: true });
await guest.keyboard.press('y'); await host.waitForTimeout(900);
ok('Y on the guest\'s keyboard hides it', await guest.evaluate(() => document.getElementById('alm').hidden));
await guest.keyboard.press('j'); await guest.keyboard.press('4'); await guest.keyboard.press(dirKey15); await host.waitForTimeout(900);
b15 = await gBaits15(); ok('J 4 and an arrow on the guest\'s keyboard stake Moss', b15.length === 1 && b15[0].kind === 'stake' && b15[0].payload === 'Moss', JSON.stringify(b15) + ' ' + await gmsg());
await guest.screenshot({ path: `${out}/guest-parity.png`, fullPage: true });
await host.evaluate(() => window.__wb.ketchem.pause(false));
await host.screenshot({ path: `${out}/host.png` });
// leaving closes the link
await host.click('#kHud .kh-guest.on'); await host.waitForTimeout(1500);
ok('when Sam leaves, the guest page loses the game', await guest.evaluate(() => !document.getElementById('join').hidden));
// the same guest sits down at this keyboard next: the arrows are theirs again
await host.click('#kHud .kh-guest:not([data-remote])'); await answer('Sam'); await host.waitForTimeout(300);
await host.evaluate(() => window.__wb.ketchem.pause(true));
const before = await pos(); await host.keyboard.press('ArrowLeft'); await host.waitForTimeout(200); const after = await pos();
ok('after playing remotely, Sam plays at this keyboard', after.g[0] !== before.g[0] || after.g[1] !== before.g[1], JSON.stringify(before.g) + ' -> ' + JSON.stringify(after.g));
ok('and the arrows on this keyboard move Sam, not Kevin', after.k[0] === before.k[0] && after.k[1] === before.k[1], JSON.stringify(after.k));
console.log('console errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
await browser.close();
