/* global window, document, getComputedStyle */
// Step 10 rehearsal on the live page: the HUD bar, the party row (two cards, one following), a drunk Fleetfoot's arc,
// the SELL card with its drawing and breakdown, the Almanac panel; Root's party row under its status and the party
// line at the top of its look.
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
let names = ['Tam, Hopper', 'Ash'];
const answer = async v => { await page.waitForSelector('#kAsk:not([hidden])', { timeout: 5000 }); await page.fill('#kAskIn', v); await page.press('#kAskIn', 'Enter'); };
await page.goto('http://127.0.0.1:5173/worldbuilder/?debug&ketchem=continent&kseed=11');
await page.click('#introStart');
await page.waitForFunction(() => window.__wb && window.__wb.ketchem && window.__wb.ketchem.board() !== null, null, { timeout: 120000 });
await page.waitForTimeout(400);
console.log('HUD at start:', await page.evaluate(() => document.getElementById('kHud').textContent), '| party row hidden:', await page.evaluate(() => document.getElementById('kParty').hidden));
await page.evaluate(() => window.__wb.ketchem.pause(true));
for (let k = 0; k < 2; k++) {
  await page.evaluate(k => { const sim = window.__wb.sim, K = window.__wb.ketchem.board(), p = K.kevin; const dx = sim.grid[sim.idx(p.x + 1, p.y)] !== sim.T.OCEAN ? 1 : -1; const h = sim.makeFauna(p.x + dx, p.y, k ? 'carnivore' : 'herbivore', null); h.energy = h.maxEnergy * 0.9; if (k) { h.size = 1.5; h.vivid = true; } sim.fauna.push(h); K.rng = () => 0.001; }, k);
  await page.keyboard.press('Tab'); await page.keyboard.press('Space'); await page.keyboard.press('n'); await answer(names.shift() || 'x');
}
await page.keyboard.press('f');
await page.evaluate(() => { const K = window.__wb.ketchem.board(); K.kevin.pack.push({ potion: 'Fleetfoot' }); K.kevin.wallet = 300; });
await page.keyboard.press('p'); await page.keyboard.press('1');
await page.evaluate(() => window.__wb.ketchem.pause(false));
await page.waitForTimeout(600);
console.log('HUD:', await page.evaluate(() => document.getElementById('kHud').textContent));
console.log('arc:', await page.evaluate(() => { const a = document.querySelector('.kh-arc'); return a ? a.title + ' | ' + a.style.background.slice(0, 40) : 'none'; }));
console.log('party cards:', await page.evaluate(() => [...document.querySelectorAll('#kParty .kc')].map(c => (c.classList.contains('out') ? '[out] ' : '') + c.querySelector('.kc-top').textContent + ' / ' + c.querySelector('.kc-sub').textContent + ' / ' + [...c.querySelectorAll('.kc-pip')].map(p => p.textContent + ' (' + p.title.slice(0, 24) + ')').join(', '))));
console.log('glyph pixels:', await page.evaluate(() => [...document.querySelectorAll('#kParty canvas')].map(c => { const d = c.getContext('2d').getImageData(0, 0, 30, 30).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })));
await page.evaluate(() => window.__wb.ketchem.pause(true));
await page.screenshot({ path: `${out}/hud-party.png` });
// the store: SELL card with the drawing and the breakdown
const K0 = await page.evaluate(() => { const K = window.__wb.ketchem.board(); const s = K.stores[K.starts[0].store]; return { kevin: [K.kevin.x, K.kevin.y], store: [s.x, s.y] }; });
await page.evaluate(d => window.__wb.ketchem.step(Math.sign(d[0]), Math.sign(d[1])), [K0.store[0] - K0.kevin[0], K0.store[1] - K0.kevin[1]]);
await page.evaluate(() => window.__wb.ketchem.pause(false));
await page.keyboard.press('e');
await page.waitForSelector('#kPanel:not([hidden])', { timeout: 5000 });
await page.click('#kPanel [data-tab="sell"]');
console.log('sell rows:', await page.evaluate(() => [...document.querySelectorAll('#kPanel tr')].slice(0, 2).map(r => r.querySelector('td.n').textContent + ' | ' + r.querySelector('td.m').textContent)));
console.log('sell glyph pixels:', await page.evaluate(() => [...document.querySelectorAll('#kPanel canvas')].map(c => { const d = c.getContext('2d').getImageData(0, 0, 26, 26).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })));
console.log('panel bottom offset:', await page.evaluate(() => getComputedStyle(document.getElementById('kPanel')).bottom));
await page.screenshot({ path: `${out}/sell.png` });
await page.keyboard.press('Escape');
// the Almanac
await page.keyboard.press('m');
await page.waitForSelector('#kPanel:not([hidden])', { timeout: 5000 });
console.log('almanac head:', await page.evaluate(() => document.querySelector('#kPanel .kp-head span').textContent));
console.log('almanac rows:', await page.evaluate(() => [...document.querySelectorAll('#kPanel tr')].map(r => r.textContent.replace(/\s+/g, ' ').trim())));
await page.screenshot({ path: `${out}/almanac.png` });
await page.keyboard.press('Escape');
// Root
const door = spawn(process.execPath, ['visit/door.mjs'], { cwd: 'C:/Users/KevinReilly/worldbuilder', env: { ...process.env, VISIT_MODE: 'ketchem' }, stdio: ['pipe', 'pipe', 'inherit'] });
const replies = new Map(); let buf = '';
door.stdout.on('data', d => { buf += d; const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) { try { const m = JSON.parse(l); if (replies.has(m.id)) replies.get(m.id)(m); } catch { /* skip */ } } });
let rid = 0;
function rpc(method, params) { const id = ++rid; return new Promise(r => { replies.set(id, r); door.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }); }
const call = async (name, args) => { const m = await rpc('tools/call', { name, arguments: args || {} }); return m.result ? m.result.content[0].text : 'DOOR ERROR: ' + (m.error && m.error.message); };
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'rehearsal', version: '0' } });
await call('look');
await page.evaluate(() => { const sim = window.__wb.sim, K = window.__wb.ketchem.board(), r = K.root; const h = sim.makeFauna(r.x, r.y, 'omnivore', null); h.energy = h.maxEnergy; h.name = 'Bee'; r.party.push(h); });
console.log('Root look head:', (await call('look')).split('\n')[0]);
await page.waitForTimeout(500);
console.log('Root party row:', await page.evaluate(() => { const v = document.getElementById('vpParty'); return v ? [...v.querySelectorAll('.kc')].map(c => c.querySelector('.kc-top').textContent) : 'no vpParty'; }));
await page.evaluate(() => { const v = document.getElementById('visitPanel'); if (v) v.hidden = false; });
await page.screenshot({ path: `${out}/root-party.png` });
console.log('leave ->', (await call('leave', { title: 'Step 10 rehearsal', field_note: 'I looked at my party. (scripted)' })).split('\n')[0]);
await page.waitForTimeout(500);
console.log('Root row after leaving:', await page.evaluate(() => document.getElementById('vpParty').innerHTML.length));
door.stdin.end();
console.log('console errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
await browser.close();
