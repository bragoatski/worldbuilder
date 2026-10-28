/* global window, document */
// Step 9 rehearsal on the live page: two caught grazers, the PEN tab at the store, a bred young one in the cabinet,
// named; Root breeds through the door.
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
let names = ['Ma, Hopper', 'Pa', 'Kid'];
const answer = async v => { await page.waitForSelector('#kAsk:not([hidden])', { timeout: 5000 }); await page.fill('#kAskIn', v); await page.press('#kAskIn', 'Enter'); };
await page.goto('http://127.0.0.1:5173/worldbuilder/?debug&ketchem=continent&kseed=11');
await page.click('#introStart');
await page.waitForFunction(() => window.__wb && window.__wb.ketchem && window.__wb.ketchem.board() !== null, null, { timeout: 120000 });
await page.waitForTimeout(400);
const msg = () => page.evaluate(() => window.__wb.ketchem.board().kevin.msg);
await page.evaluate(() => window.__wb.ketchem.pause(true));
for (let k = 0; k < 2; k++) {
  await page.evaluate(() => { const sim = window.__wb.sim, K = window.__wb.ketchem.board(), p = K.kevin; const dx = sim.grid[sim.idx(p.x + 1, p.y)] !== sim.T.OCEAN ? 1 : -1; const h = sim.makeFauna(p.x + dx, p.y, 'herbivore', null); h.energy = h.maxEnergy * 0.9; sim.fauna.push(h); K.rng = () => 0.001; });
  await page.keyboard.press('Tab'); await page.keyboard.press('Space'); await page.keyboard.press('n'); await answer(names.shift() || 'x');
}
console.log('party:', JSON.stringify(await page.evaluate(() => window.__wb.ketchem.board().kevin.party.map(c => c.name))));
const K0 = await page.evaluate(() => { const K = window.__wb.ketchem.board(); const s = K.stores[K.starts[0].store]; K.kevin.wallet = 300; return { kevin: [K.kevin.x, K.kevin.y], store: [s.x, s.y] }; });
await page.evaluate(d => window.__wb.ketchem.step(Math.sign(d[0]), Math.sign(d[1])), [K0.store[0] - K0.kevin[0], K0.store[1] - K0.kevin[1]]);
await page.evaluate(() => window.__wb.ketchem.pause(false));
await page.keyboard.press('e');
await page.waitForSelector('#kPanel:not([hidden])', { timeout: 5000 });
await page.click('#kPanel [data-tab="pen"]');
await page.click('#kPanel label:has-text("Ma") input'); await page.click('#kPanel label:has-text("Pa") input');
console.log('fee line:', await page.evaluate(() => document.getElementById('kpFee').textContent), 'button enabled:', await page.evaluate(() => !document.getElementById('kpBreed').disabled));
await page.screenshot({ path: `${out}/pen.png` });
await page.click('#kPanel #kpBreed');
console.log('Breed ->', JSON.stringify(await msg()));
const after = await page.evaluate(() => { const K = window.__wb.ketchem.board(); return { wallet: K.kevin.wallet, cabinet: K.cabinet.map(c => ({ type: c.type, age: c.age, gen: c.gen, parents: c.parents })), naming: !!K.kevin.naming, rests: K.kevin.party.map(c => c.bredAt !== undefined) }; });
console.log('after:', JSON.stringify(after));
await page.keyboard.press('Escape');
await page.keyboard.press('n'); await answer(names.shift() || 'x'); console.log('N ->', JSON.stringify(await msg()), 'cabinet names', JSON.stringify(await page.evaluate(() => window.__wb.ketchem.board().cabinet.map(c => c.name))));
// Root
const door = spawn(process.execPath, ['visit/door.mjs'], { cwd: 'C:/Users/KevinReilly/worldbuilder', env: { ...process.env, VISIT_MODE: 'ketchem' }, stdio: ['pipe', 'pipe', 'inherit'] });
const replies = new Map(); let buf = '';
door.stdout.on('data', d => { buf += d; const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) { try { const m = JSON.parse(l); if (replies.has(m.id)) replies.get(m.id)(m); } catch { /* skip */ } } });
let rid = 0;
function rpc(method, params) { const id = ++rid; return new Promise(r => { replies.set(id, r); door.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }); }
const call = async (name, args) => { const m = await rpc('tools/call', { name, arguments: args || {} }); return m.result ? m.result.content[0].text : 'DOOR ERROR: ' + (m.error && m.error.message); };
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'rehearsal', version: '0' } });
console.log('door tools:', (await rpc('tools/list', {})).result.tools.map(t => t.name).join(' '));
await call('look');
await page.evaluate(() => { const sim = window.__wb.sim, K = window.__wb.ketchem.board(), r = K.root; r.wallet = 300; for (let k = 0; k < 2; k++) { const h = sim.makeFauna(r.x, r.y, 'herbivore', null); h.energy = h.maxEnergy; h.name = k ? 'Bee' : 'Ant'; r.party.push(h); } });
const rdir = await page.evaluate(() => { const K = window.__wb.ketchem.board(); const s = K.stores[K.starts[1].store]; return { dx: s.x - K.root.x, dy: s.y - K.root.y }; });
const dirName = (rdir.dy < 0 ? 'N' : rdir.dy > 0 ? 'S' : '') + (rdir.dx < 0 ? 'W' : rdir.dx > 0 ? 'E' : '');
console.log('walk onto the store:', (await call('walk', { direction: dirName, steps: 1 })).split('\n')[0]);
console.log('shop (pen line):', (await call('shop')).split('\n').find(l => l.startsWith('pen')));
console.log('breed ->', (await call('breed', { a: 'Ant', b: 'Bee' })).split('\n')[0]);
console.log('name ->', (await call('name', { name: 'Larva' })).split('\n')[0]);
console.log('breed again ->', (await call('breed', { a: 'Ant', b: 'Bee' })).split('\n')[0]);
console.log('leave ->', (await call('leave', { title: 'Step 9 rehearsal', field_note: 'I bred Ant and Bee. (scripted)' })).split('\n')[0]);
door.stdin.end();
console.log('console errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
await browser.close();
