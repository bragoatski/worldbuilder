/* global window, document */
// Item pass rehearsal (2026-10-26): Kevin buys gear and a shard at his store through the panel, wears the Satchel and
// the Boots (pack cap, stride on open ground), uses the shard on a party creature through P and the question bar and
// watches it evolve; Root buys gear and uses a shard through the door; a save and load keep the gear.
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
const ok = (label, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra ? ': ' + extra : ''));
await page.goto('http://127.0.0.1:5173/worldbuilder/?debug&ketchem=continent&kseed=11');
await page.click('#introStart');
await page.waitForFunction(() => window.__wb && window.__wb.ketchem && window.__wb.ketchem.board() !== null, null, { timeout: 120000 });
await page.waitForTimeout(400);
const msg = () => page.evaluate(() => window.__wb.ketchem.board().kevin.msg);
await page.evaluate(() => window.__wb.ketchem.pause(true));
// a party creature one step short of an Ember species line
const cid = await page.evaluate(() => { const sim = window.__wb.sim, K = window.__wb.ketchem.board(), p = K.kevin; const dx = sim.grid[sim.idx(p.x + 1, p.y)] !== sim.T.OCEAN ? 1 : -1; const h = sim.makeFauna(p.x + dx, p.y, 'herbivore', null); h.energy = h.maxEnergy * 0.9; h.prefArid = 5; h.prefTemp = 7.4; h.prefSL = 5; h.prefElev = 5; sim.fauna.push(h); K.rng = () => 0.001; return h.id; });
await page.keyboard.press('Tab'); await page.keyboard.press('Space'); await page.keyboard.press('n'); await answer('Cinder');
// to the store, with coins
const K0 = await page.evaluate(() => { const K = window.__wb.ketchem.board(); const s = K.stores[K.starts[0].store]; K.kevin.wallet = 1000; return { kevin: [K.kevin.x, K.kevin.y], store: [s.x, s.y], shards: Object.keys(s.stock.potions).filter(n => / Shard$/.test(n)) }; });
console.log('this store\'s shards:', K0.shards.join(', '));
await page.evaluate(d => window.__wb.ketchem.step(Math.sign(d[0]), Math.sign(d[1])), [K0.store[0] - K0.kevin[0], K0.store[1] - K0.kevin[1]]);
await page.evaluate(() => window.__wb.ketchem.pause(false));
await page.keyboard.press('e'); await page.waitForSelector('#kPanel:not([hidden])');
const gearRows = await page.evaluate(() => [...document.querySelectorAll('#kPanel tr')].map(r => r.textContent.replace(/\s+/g, ' ').trim()).filter(t => /Satchel|Boots|Charm|Shard/.test(t)));
ok('the BUY tab lists the gear and this store\'s two shards', gearRows.filter(t => /Shard/.test(t)).length === 2 && gearRows.some(t => /Satchel/.test(t)), gearRows.join(' || '));
await page.click('#kPanel [data-buy="Satchel"]'); await page.click('#kPanel [data-buy="Trail Boots"]');
const worn = await page.evaluate(() => [...document.querySelectorAll('#kPanel .kp-worn')].length);
ok('bought gear shows as worn, without a Buy button', worn === 2, String(worn));
await page.screenshot({ path: `${out}/buy-gear.png` });
// Kevin's store stocks two shards; give him an Ember one if his store does not sell it, as Root could hand it over
const hasEmber = K0.shards.includes('Ember Shard');
if (hasEmber) await page.click('#kPanel [data-buy="Ember Shard"]'); else await page.evaluate(() => window.__wb.ketchem.board().kevin.pack.push({ potion: 'Ember Shard' }));
await page.keyboard.press('Escape');
const st = await page.evaluate(() => { const K = window.__wb.ketchem.board(), p = K.kevin; return { wallet: p.wallet, gear: Object.keys(p.gear || {}), hud: document.querySelector('#kHud .kh-pack').textContent }; });
ok('the Satchel lifts the pack cap in the HUD', /\/15$/.test(st.hud), st.hud + ', wallet ' + st.wallet + ', worn ' + st.gear.join(', '));
// the shard through P and the bar
await page.keyboard.press('p');
const pmsg = await msg();
const slot = String(pmsg.split(', ').findIndex(x => /Ember Shard/.test(x)) + 1);
await page.keyboard.press(slot); await answer('Cinder');
await page.waitForTimeout(300);
const after = await page.evaluate(id => { const K = window.__wb.ketchem.board(), c = K.kevin.party.find(x => x.id === id); return { prefTemp: c.prefTemp, namingSpecies: K.kevin.namingSpecies === id, msg: K.kevin.msg }; }, cid);
ok('the shard moved Cinder toward Ember and it evolved', after.prefTemp === 8.4 && /EVOLVED/.test(after.msg) && after.namingSpecies, JSON.stringify(after));
await page.keyboard.press('n'); await answer('Emberkin');
ok('the new species is named', /Emberkin/.test(await msg()), await msg());
await page.screenshot({ path: `${out}/evolved.png` });
// boots on open ground: proven by src/ketchem/items.test.js (Trail Boots add a tile of stride on open ground)
// save and load keep the gear
await page.evaluate(() => window.__wb.ketchem.save('items')); await page.waitForTimeout(800);
await page.evaluate(() => window.__wb.ketchem.load('items')); await page.waitForTimeout(800);
const gearAfterLoad = await page.evaluate(() => Object.keys(window.__wb.ketchem.board().kevin.gear || {}));
ok('a save and load keep what Kevin wears', gearAfterLoad.join(',') === 'Satchel,Trail Boots', gearAfterLoad.join(','));
// Root
const door = spawn(process.execPath, ['visit/door.mjs'], { cwd: 'C:/Users/KevinReilly/worldbuilder', env: { ...process.env, VISIT_MODE: 'ketchem' }, stdio: ['pipe', 'pipe', 'inherit'] });
const replies = new Map(); let buf = '';
door.stdout.on('data', d => { buf += d; const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) { try { const m = JSON.parse(l); if (replies.has(m.id)) replies.get(m.id)(m); } catch { /* skip */ } } });
let rid = 0;
function rpc(method, params) { const id = ++rid; return new Promise(r => { replies.set(id, r); door.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }); }
const call = async (name, args) => { const m = await rpc('tools/call', { name, arguments: args || {} }); return m.result ? m.result.content[0].text : 'DOOR ERROR: ' + (m.error && m.error.message); };
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'rehearsal', version: '0' } });
await call('look');
await page.evaluate(() => { const sim = window.__wb.sim, K = window.__wb.ketchem.board(), r = K.root; r.wallet = 500; const h = sim.makeFauna(r.x, r.y, 'omnivore', null); h.energy = h.maxEnergy; h.name = 'Bee'; h.prefArid = 5; h.prefTemp = 5; h.prefSL = 5; h.prefElev = 5; r.party.push(h); });
const rdir = await page.evaluate(() => { const K = window.__wb.ketchem.board(); const s = K.stores[K.starts[1].store]; return { dx: s.x - K.root.x, dy: s.y - K.root.y, shards: Object.keys(s.stock.potions).filter(n => / Shard$/.test(n)) }; });
const dirName = (rdir.dy < 0 ? 'N' : rdir.dy > 0 ? 'S' : '') + (rdir.dx < 0 ? 'W' : rdir.dx > 0 ? 'E' : '');
await call('walk', { direction: dirName, steps: 1 });
const shop = await call('shop');
ok('Root\'s shop lists the gear line', /gear \(once, worn for good\): Satchel 120, Trail Boots 180, Lucky Charm 300/.test(shop), shop.split('\n').find(l => l.startsWith('gear')) || '');
const rb = await call('buy', { item: 'Lucky Charm' }); ok('Root buys the Lucky Charm', /put it on/.test(rb), rb.split('\n')[0]);
const rb2 = await call('buy', { item: 'Lucky Charm' }); ok('and cannot buy it twice', /already wear/.test(rb2), rb2.split('\n')[0]);
const sh = rdir.shards[0];
await call('buy', { item: sh });
const used = await call('drink', { potion: sh, target: 'Bee' }); ok('Root uses a shard on "Bee" by name', /leans toward/.test(used), used.split('\n')[0]);
const pack = await call('pack'); ok('Root\'s pack says what it wears', /worn: Lucky Charm/.test(pack), pack.split('\n')[0].slice(-60));
console.log('leave ->', (await call('leave', { title: 'Item pass rehearsal', field_note: 'I bought a charm and leaned Bee. (scripted)' })).split('\n')[0]);
door.stdin.end();
console.log('console errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
await browser.close();
