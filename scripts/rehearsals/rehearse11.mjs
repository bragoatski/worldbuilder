/* global window, document */
// Finishing-pass rehearsal (2026-10-26): the question bar in place of browser prompts, catches named in order, unique
// names, ability icons, the sound chip, drag between party and cabinet, the Almanac's usual abilities and variants,
// Musk through the bar; Root stands in a loaded game and in a new board after Reset at once.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire('C:/Users/KevinReilly/taipan/package.json');
const { chromium } = require('playwright');
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('dialog', d => { errors.push('a browser dialog opened: ' + d.message()); d.dismiss(); });
const answer = async v => { await page.waitForSelector('#kAsk:not([hidden])', { timeout: 5000 }); await page.fill('#kAskIn', v); await page.press('#kAskIn', 'Enter'); };
await page.goto('http://127.0.0.1:5173/worldbuilder/?debug&ketchem=continent&kseed=11');
await page.click('#introStart');
await page.waitForFunction(() => window.__wb && window.__wb.ketchem && window.__wb.ketchem.board() !== null, null, { timeout: 120000 });
await page.waitForTimeout(400);
const msg = () => page.evaluate(() => window.__wb.ketchem.board().kevin.msg);
const ok = (label, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra ? ': ' + extra : ''));
await page.evaluate(() => window.__wb.ketchem.pause(true));
// two catches before any name: the first caught is named first
const ids = [];
for (let k = 0; k < 2; k++) {
  ids.push(await page.evaluate(k => { const sim = window.__wb.sim, K = window.__wb.ketchem.board(), p = K.kevin; const dx = sim.grid[sim.idx(p.x + 1, p.y)] !== sim.T.OCEAN ? 1 : -1; const h = sim.makeFauna(p.x + dx, p.y, k ? 'carnivore' : 'herbivore', null); h.energy = h.maxEnergy * 0.9; if (k) { h.size = 1.7; h.vivid = true; h.tolerance = 5.5; p.stones.obsidian = 1; } sim.fauna.push(h); K.rng = () => 0.001; return h.id; }, k));
  if (k) await page.keyboard.press('3');   // a big carnivore can roll L10, where Amber is 0 by the rules; Obsidian always catches
  await page.keyboard.press('Tab'); await page.keyboard.press('Space');
}
await page.keyboard.press('n');
const label = await page.evaluate(() => document.querySelector('#kAsk label').textContent);
ok('the question bar asks, the world is not frozen by a browser prompt', !!label, label);
await page.screenshot({ path: `${out}/ask-bar.png` });
await page.fill('#kAskIn', 'Tam, Hopper'); await page.press('#kAskIn', 'Enter');
await page.keyboard.press('n'); await answer('Tam');
ok('a second "Tam" is refused', /already/.test(await msg()), await msg());
await page.keyboard.press('n'); await answer('Ash'); await page.keyboard.press('1');
const named = await page.evaluate(() => window.__wb.ketchem.board().kevin.party.map(c => c.id + ':' + c.name));
ok('the first catch took the first name, the second the next', named[0] === ids[0] + ':Tam' && named[1] === ids[1] + ':Ash', named.join(' '));
// icons and the sound chip
await page.evaluate(() => window.__wb.ketchem.pause(false)); await page.waitForTimeout(400);
const pips = await page.evaluate(() => [...document.querySelectorAll('#kParty .kc-pip')].map(p => (p.querySelector('svg') ? '[icon] ' : '') + p.textContent + ' | ' + p.title.slice(0, 40)));
ok('every pip has its icon', pips.length > 0 && pips.every(p => p.startsWith('[icon]')), pips.join(' ; '));
await page.keyboard.press('o'); await page.waitForTimeout(200);
const chipOff = await page.evaluate(() => document.querySelector('#kHud .kh-sound').textContent);
await page.keyboard.press('o'); await page.waitForTimeout(200);
const chipOn = await page.evaluate(() => document.querySelector('#kHud .kh-sound').textContent);
ok('O mutes and unmutes', chipOff === 'muted' && chipOn === 'sound', chipOff + ' / ' + chipOn);
await page.screenshot({ path: `${out}/icons.png` });
// the cabinet by drag
await page.evaluate(() => window.__wb.ketchem.pause(true));
const K0 = await page.evaluate(() => { const K = window.__wb.ketchem.board(); const s = K.stores[K.starts[0].store]; return { kevin: [K.kevin.x, K.kevin.y], store: [s.x, s.y] }; });
await page.evaluate(d => window.__wb.ketchem.step(Math.sign(d[0]), Math.sign(d[1])), [K0.store[0] - K0.kevin[0], K0.store[1] - K0.kevin[1]]);
await page.evaluate(() => window.__wb.ketchem.pause(false));
await page.keyboard.press('c');
await page.waitForSelector('#kPanel [data-zone="cabinet"]', { timeout: 5000 });
await page.dragAndDrop('#kPanel [data-zone="party"] tr[data-drag]', '#kPanel [data-zone="cabinet"]');
await page.waitForTimeout(200);
const afterDrag = await page.evaluate(() => { const K = window.__wb.ketchem.board(); return { party: K.kevin.party.map(c => c.name), cabinet: K.cabinet.map(c => c.name) }; });
ok('a party creature dragged into the cabinet', afterDrag.cabinet.length === 1 && afterDrag.party.length === 1, JSON.stringify(afterDrag));
await page.screenshot({ path: `${out}/drag.png` });
await page.dragAndDrop('#kPanel [data-zone="cabinet"] tr[data-drag]', '#kPanel [data-zone="party"]');
await page.waitForTimeout(200);
const back = await page.evaluate(() => window.__wb.ketchem.board().cabinet.length);
ok('and dragged back', back === 0, 'cabinet ' + back);
await page.evaluate(() => { window.__wb.ketchem.board().kevin.wallet = 0; });
await page.click('#kPanel [data-tab="buy"]'); await page.click('#kPanel [data-buy="Geode"]');
const note = await page.evaluate(() => { const n = document.querySelector('#kPanel .kp-note'); return n ? n.textContent : ''; });
ok('a refused purchase says why inside the panel', /not enough coins/.test(note), note);
await page.evaluate(() => { window.__wb.ketchem.board().kevin.wallet = 300; });
await page.keyboard.press('Escape');
// the Almanac
await page.keyboard.press('m'); await page.waitForSelector('#kPanel:not([hidden])');
const rows = await page.evaluate(() => [...document.querySelectorAll('#kPanel tr')].map(r => r.textContent.replace(/\s+/g, ' ').trim()).filter(t => /line|Hopper/.test(t)));
ok('the Almanac shows the usual abilities', rows.some(r => /usually/.test(r)), rows.join(' || '));
ok('and the big, vivid, tolerant variant', rows.some(r => /big · vivid · tolerant/.test(r)), '');
await page.screenshot({ path: `${out}/almanac.png` });
await page.keyboard.press('Escape');
// Musk through the bar
await page.evaluate(() => { window.__wb.ketchem.board().kevin.pack = [{ potion: 'Musk' }]; });
await page.keyboard.press('p'); await page.keyboard.press('1'); await answer('herbivore');
ok('Musk asks its type in the bar', /musk/.test(await msg()), await msg());
// Root
const door = spawn(process.execPath, ['visit/door.mjs'], { cwd: 'C:/Users/KevinReilly/worldbuilder', env: { ...process.env, VISIT_MODE: 'ketchem' }, stdio: ['pipe', 'pipe', 'inherit'] });
const replies = new Map(); let buf = '';
door.stdout.on('data', d => { buf += d; const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) { try { const m = JSON.parse(l); if (replies.has(m.id)) replies.get(m.id)(m); } catch { /* skip */ } } });
let rid = 0;
function rpc(method, params) { const id = ++rid; return new Promise(r => { replies.set(id, r); door.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }); }
const call = async (name, args) => { const m = await rpc('tools/call', { name, arguments: args || {} }); return m.result ? m.result.content[0].text : 'DOOR ERROR: ' + (m.error && m.error.message); };
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'rehearsal', version: '0' } });
await call('look');
const rootAt = await page.evaluate(() => { const r = window.__wb.ketchem.board().root; return [r.x, r.y]; });
await page.evaluate(() => window.__wb.ketchem.save('r11')); await page.waitForTimeout(800);
console.log('Root walks:', (await call('walk', { direction: 'N', steps: 2 })).split('\n')[0]);
await page.evaluate(() => window.__wb.ketchem.load('r11'));
await page.waitForFunction(() => window.__wb.ketchem.board() && window.__wb.ketchem.board().root, null, { timeout: 20000 }); await page.waitForTimeout(300);
const loaded = await page.evaluate(() => { const r = window.__wb.ketchem.board().root; return { away: !!r.away, at: [r.x, r.y], log: [...document.querySelectorAll('#vpLog div')].map(d => d.textContent).slice(-2).join(' | ') }; });
ok('after a load Root stands in the saved game at once', !loaded.away && loaded.at[0] === rootAt[0] && loaded.at[1] === rootAt[1], JSON.stringify(loaded));
const lookAfterLoad = (await call('look')).split('\n')[0];
ok('and its next look says so', /a saved game/.test(lookAfterLoad), lookAfterLoad);
// Reset while Root plays: a new board, Root on its doorstep
const seedBefore = await page.evaluate(() => window.__wb.ketchem.board().seed);
await page.click('#btnReset');
await page.waitForFunction(s => { const K = window.__wb.ketchem.board(); return K && K.seed !== s && !window.__wb.ketchem.building(); }, seedBefore, { timeout: 180000 });
await page.waitForTimeout(500);
const fresh = await page.evaluate(() => { const K = window.__wb.ketchem.board(), r = K.root; return { away: r ? !!r.away : 'none', onDoorstep: !!r && r.x === K.starts[1].x && r.y === K.starts[1].y, ketchem: document.body.classList.contains('ketchem') }; });
ok('Reset while Root plays builds a new board with Root on its doorstep', fresh.away === false && fresh.onDoorstep && fresh.ketchem, JSON.stringify(fresh));
const lookAfterReset = (await call('look')).split('\n')[0];
ok('and its next look says so', /a new board/.test(lookAfterReset), lookAfterReset);
await page.screenshot({ path: `${out}/reset-with-root.png` });
// a second Reset while the new board is still building
const seed2 = await page.evaluate(() => window.__wb.ketchem.board().seed);
await page.click('#btnReset');
await page.waitForFunction(() => window.__wb.ketchem.building(), null, { timeout: 10000 });
await page.waitForTimeout(800);
await page.click('#btnReset');
await page.waitForFunction(s => { const K = window.__wb.ketchem.board(); return K && K.seed !== s && !window.__wb.ketchem.building(); }, seed2, { timeout: 180000 });
await page.waitForTimeout(500);
const twice = await page.evaluate(() => { const K = window.__wb.ketchem.board(), r = K.root; return { away: r ? !!r.away : 'none', onDoorstep: !!r && r.x === K.starts[1].x && r.y === K.starts[1].y }; });
ok('a second Reset mid-build still leaves Root a board', twice.away === false && twice.onDoorstep, JSON.stringify(twice));
console.log('leave ->', (await call('leave', { title: 'Finishing pass rehearsal', field_note: 'A load and a reset with me on the board. (scripted)' })).split('\n')[0]);
door.stdin.end();
console.log('console errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
await browser.close();
