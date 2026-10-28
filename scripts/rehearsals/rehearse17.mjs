/* global window */
// Saves, the rest of 18.2 (2026-10-27): Root's `save` (refused while the game has no name; `save as` names it and
// writes the relay's mirror), a `save as` that would overwrite another saved game is refused, Root leaving autosaves a
// named game, and deleting a slot from the F9 menu deletes its mirror. Root's part is played through the door; needs
// a scratch relay, whose folder is the second argument (the mirror is read from <folder>/ketchem/slots).
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
const require = createRequire('C:/Users/KevinReilly/taipan/package.json');
const { chromium } = require('playwright');
const out = process.argv[2], scratch = process.argv[3];
if (!scratch) { console.log('usage: node rehearse17.mjs <screenshots> <scratch relay folder>'); process.exit(1); }
const mirror = slot => existsSync(path.join(scratch, 'ketchem', 'slots', slot + '.json'));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' && !/ERR_(EMPTY_RESPONSE|CONNECTION_RESET|CONNECTION_REFUSED)/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('dialog', d => { if (d.type() === 'confirm' && /Delete the save "r17 one"/.test(d.message())) d.accept(); else { errors.push('an unexpected dialog: ' + d.message()); d.dismiss(); } });
const ok = (label, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra ? ': ' + extra : ''));
await page.goto('http://127.0.0.1:5173/worldbuilder/?debug&ketchem=continent&kseed=11');
await page.click('#introStart');
await page.waitForFunction(() => window.__wb && window.__wb.ketchem && window.__wb.ketchem.board() !== null, null, { timeout: 120000 });
await page.waitForTimeout(400);
const slots = () => page.evaluate(() => window.__wb.ketchem.slots()).then(a => a.map(m => ({ slot: m.slot, at: m.lastSaved, ticks: m.ticksPlayed })));
const door = spawn(process.execPath, ['visit/door.mjs'], { cwd: 'C:/Users/KevinReilly/worldbuilder', env: { ...process.env, VISIT_MODE: 'ketchem' }, stdio: ['pipe', 'pipe', 'inherit'] });
const replies = new Map(); let buf = '';
door.stdout.on('data', d => { buf += d; const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) { try { const m = JSON.parse(l); if (replies.has(m.id)) replies.get(m.id)(m); } catch { /* skip */ } } });
let rid = 0;
function rpc(method, params) { const id = ++rid; return new Promise(r => { replies.set(id, r); door.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }); }
const call = async (name, args) => { const m = await rpc('tools/call', { name, arguments: args || {} }); return m.result ? m.result.content[0].text : 'DOOR ERROR: ' + (m.error && m.error.message); };
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'rehearsal', version: '0' } });
const tools = (await rpc('tools/list', {})).result.tools.map(t => t.name);
ok('Root\'s Ketch\'em door offers save', tools.includes('save'), tools.join(' '));
await call('look');
let r = await call('save');
ok('save refuses while the game has no name', /^this game has no name yet: save as <name>/.test(r), r.split('\n')[0]);
r = await call('save', { as: 'r17 one' });
await page.waitForTimeout(500);
let ss = await slots();
ok('save as names the game and writes it', /^saved "r17 one"/.test(r) && ss.some(m => m.slot === 'r17 one'), r.split('\n')[0] + ' ' + JSON.stringify(ss));
ok('and the relay mirrors it', mirror('r17 one'));
ok('Kevin\'s game now carries the name', await page.evaluate(() => window.__wb.ketchem.board().slot === 'r17 one'));
// Kevin saves it as a second game; Root may not take the first one's name
await page.evaluate(() => window.__wb.ketchem.save('r17 two')); await page.waitForTimeout(600);
r = await call('save', { as: 'r17 one' });
ok('save as refuses a name another saved game holds', /already a saved game called "r17 one"/.test(r) && await page.evaluate(() => window.__wb.ketchem.board().slot === 'r17 two'), r.split('\n')[0]);
await page.evaluate(() => { window.__wb.ketchem.board().slot = 'r17 one'; });
r = await call('save', { as: 'R17 TWO' });
ok('and ignores case, as the mirror\'s files do', /already a saved game called "R17 TWO"/.test(r) && await page.evaluate(() => window.__wb.ketchem.board().slot === 'r17 one'), r.split('\n')[0]);
r = await call('save', { as: '../../escape' });
ok('a name is cleaned to a safe slot name', /^saved "escape"/.test(r) && !existsSync(path.join(scratch, 'escape.json')), r.split('\n')[0]);
await page.evaluate(() => window.__wb.ketchem.save('r17 two')); await page.waitForTimeout(400);
// leaving autosaves the named game
const before = (await slots()).find(m => m.slot === 'r17 two');
await page.waitForTimeout(1200);
console.log('leave ->', (await call('leave', { title: 'Saves rehearsal', field_note: 'I saved the game and left. (scripted)' })).split('\n')[0]);
await page.waitForTimeout(1200);
const after = (await slots()).find(m => m.slot === 'r17 two');
ok('Root leaving saves the named game', after && before && after.at !== before.at && after.ticks >= before.ticks, JSON.stringify(before) + ' -> ' + JSON.stringify(after));
door.stdin.end();
// the F9 menu deletes a slot and its mirror
await page.keyboard.press('F9'); await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/save-menu.png` });
await page.click('[data-del="r17 one"]'); await page.waitForTimeout(800);
ss = await slots();
ok('Delete in the F9 menu removes the slot', !ss.some(m => m.slot === 'r17 one'), JSON.stringify(ss.map(m => m.slot)));
ok('and its mirror', !mirror('r17 one') && mirror('r17 two'));
console.log('console errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
await browser.close();
