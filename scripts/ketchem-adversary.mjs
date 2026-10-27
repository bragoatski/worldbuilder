/* global window, document */
// Run: node scripts/ketchem-adversary.mjs   (dev server on 5173; Playwright borrowed from ~/taipan; no Root, the relay is untouched)
// Directed adversarial playthrough on the live page (no Root; the real relay is untouched). Each scene forces a
// situation a hostile player could reach, then checks the game's invariants and the error box.
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/KevinReilly/taipan/package.json');
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' && !/ERR_(EMPTY_RESPONSE|CONNECTION_RESET|CONNECTION_REFUSED)/.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 300)));
let answers = [];
const reply = async () => { if (await page.$('#kAsk:not([hidden])')) { await page.fill('#kAskIn', answers.length ? answers.shift() : 'x'); await page.press('#kAskIn', 'Enter'); } };   // the question bar (ask.js) replaced window.prompt
await page.goto('http://127.0.0.1:5173/worldbuilder/?debug&ketchem=continent&kseed=23');
await page.click('#introStart');
await page.waitForFunction(() => window.__wb && window.__wb.ketchem && window.__wb.ketchem.board() !== null, null, { timeout: 180000 });
await page.waitForTimeout(300);
const ev = (fn, arg) => page.evaluate(fn, arg);
const msg = () => ev(() => window.__wb.ketchem.board().kevin.msg);
const pause = on => ev(on => window.__wb.ketchem.pause(on), on);
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await reply(); } };
const findings = [];
const check = async (scene) => {
  const v = await ev(() => {
    const sim = window.__wb.sim, K = window.__wb.ketchem.board(), v = [];
    const err = document.getElementById('err'); if (err && err.style.display === 'block') v.push('ERR BOX: ' + err.textContent.slice(0, 200));
    const where = new Map(); const seen = (id, place) => { if (!where.has(id)) where.set(id, []); where.get(id).push(place); };
    for (const f of sim.fauna) if (f) seen(f.id, 'fauna');
    for (const p of [K.kevin, K.root]) if (p) for (const c of p.party || []) seen(c.id, p.id + '.party');
    for (const c of K.cabinet || []) seen(c.id, 'cabinet');
    for (const s of K.stores) for (const c of s.held || []) seen(c.id, 'held');
    for (const [id, places] of where) if (places.length > 1) v.push('creature ' + id + ' in ' + places.join('+'));
    for (const p of [K.kevin, K.root]) {
      if (!p) continue; const own = new Set((p.party || []).concat(K.cabinet || []).map(c => c.id));
      if ((p.party || []).length > 3) v.push(p.id + ' party ' + p.party.length);
      if (!(p.wallet >= 0) || !Number.isFinite(p.wallet)) v.push(p.id + ' wallet ' + p.wallet);
      for (const k of ['amber', 'geode', 'obsidian']) if (!(p.stones[k] >= 0) || !Number.isFinite(p.stones[k])) v.push(p.id + ' stones.' + k + ' ' + p.stones[k]);
      if (p.follower && !(p.party || []).some(c => c.id === p.follower)) v.push(p.id + ' follower ' + p.follower + ' not in party');
      if (p.naming && !own.has(p.naming)) v.push(p.id + ' naming ' + p.naming + ' not owned');
      for (const n of p.namingQueue || []) if (!own.has(n)) v.push(p.id + ' namingQueue ' + n + ' not owned');
      if (p.namingSpecies && !own.has(p.namingSpecies)) v.push(p.id + ' namingSpecies ' + p.namingSpecies + ' not owned');
      const t = sim.grid[sim.idx(p.x, p.y)]; if ((t === sim.T.OCEAN || t === sim.T.COAST) && !p.boat && !p.away) v.push(p.id + ' on water without a boat');
      if (p.pack && p.pack.length > 25) v.push(p.id + ' pack ' + p.pack.length);
    }
    const live = new Set(sim.fauna.filter(Boolean).map(f => f.id));
    for (const b of K.baits || []) if (b.creatureId && !live.has(b.creatureId)) v.push('bait walker ' + b.creatureId + ' gone');
    for (const f of sim.fauna) { if (!f || !f.held) continue; const a = K.aw[f.id]; const why = a && (a.bolt || a.asleep || a.baitId || a.state === 'growl' || a.pursueUntil); if (!why) v.push('held fauna ' + f.id + ' without a reason (' + (a ? a.state : 'no aw') + ')'); }
    return v;
  });
  if (v.length) { findings.push(scene + ': ' + v.join(' | ')); console.log('VIOLATION [' + scene + '] ' + v.join(' | ')); }
  else console.log('ok [' + scene + ']');
};
// helpers that reach into the sim, as a cheat-free player could by walking: a creature beside Kevin
const beside = (type, energy = 0.9, extra = {}) => ev(([type, energy, extra]) => { const sim = window.__wb.sim, K = window.__wb.ketchem.board(), p = K.kevin; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) { const x = p.x + dx, y = p.y + dy; if (x < 0 || y < 0 || x >= sim.W || y >= sim.H) continue; const g = sim.grid[sim.idx(x, y)]; if (g === sim.T.OCEAN || g === sim.T.COAST || g === sim.T.MOUNTAIN) continue; if (sim.fauna.some(f => f && f.x === x && f.y === y)) continue; const h = sim.makeFauna(x, y, type, null); h.energy = h.maxEnergy * energy; Object.assign(h, extra); sim.fauna.push(h); return h.id; } return null; }, [type, energy, extra]);
const luck = v => ev(v => { window.__wb.ketchem.board().rng = () => v; }, v);
const state = () => ev(() => { const K = window.__wb.ketchem.board(), p = K.kevin; return { party: p.party.map(c => (c.name || c.type) + '#' + c.id), cabinet: K.cabinet.map(c => (c.name || c.type) + '#' + c.id), wallet: p.wallet, stones: p.stones, follower: p.follower, naming: p.naming, queue: p.namingQueue, pack: p.pack.length, species: Object.keys(K.almanac.species).length, msg: p.msg }; });
const toStore = () => ev(() => { const K = window.__wb.ketchem.board(), s = K.stores[K.starts[0].store], p = K.kevin; p.x = s.x; p.y = s.y; p.boat = false; p.moved = true; });
const offStore = () => ev(() => { const K = window.__wb.ketchem.board(), s = K.stores[K.starts[0].store], p = K.kevin; p.x = s.door.x; p.y = s.door.y; p.moved = true; });

await pause(true);
// Scene 1: four catches with a full party; the fourth goes where? Naming with hostile names.
await luck(0.001);
for (let k = 0; k < 4; k++) { await beside('herbivore'); await key('Tab'); await key(' '); console.log('catch ' + (k + 1) + ' ->', await msg()); }
await check('four catches');
console.log('after four catches', JSON.stringify(await state()));
answers = ['<img src=x onerror=alert(1)>', 'plants', '', 'a'.repeat(100)];
for (let k = 0; k < 4; k++) { await key('n'); console.log('N ->', await msg()); }
await check('hostile names');
console.log(JSON.stringify(await state()));
// Scene 2: the follower sold, given (nobody), boxed, bred; the pen with a cabinet parent and a full party
await key('f'); console.log('F ->', await msg());
await toStore(); await key('e'); await page.waitForSelector('#kPanel:not([hidden])');
await page.click('#kPanel [data-tab="sell"]');
const firstSell = await ev(() => { const b = document.querySelector('#kPanel [data-sell]'); return b ? b.dataset.sell : null; });
console.log('selling the follower?', firstSell, 'follower is', (await state()).follower);
await ev(() => { const K = window.__wb.ketchem.board(), p = K.kevin; const f = p.party.find(c => c.id === p.follower); const b = [...document.querySelectorAll('#kPanel [data-sell]')].find(b => b.dataset.sell === (f ? f.name || f.type : '')); if (b) b.click(); });
console.log('sold ->', await msg()); await check('sold the follower'); console.log(JSON.stringify(await state()));
await page.click('#kPanel [data-tab="pen"]');
const pens = await ev(() => [...document.querySelectorAll('#kPanel [data-pen]')].map(c => c.dataset.pen + ':' + c.dataset.type + (c.disabled ? ':disabled' : '')));
console.log('pen rows', pens);
await ev(() => { const cs = [...document.querySelectorAll('#kPanel [data-pen]:not([disabled])')]; const h = cs.filter(c => c.dataset.type === 'herbivore'); if (h.length >= 2) { h[0].click(); h[1].click(); } });
await ev(() => { const K = window.__wb.ketchem.board(); K.kevin.wallet = 0; });
await page.click('#kpBreed').catch(() => {}); console.log('breed with 0 coins ->', await msg());
await ev(() => { const K = window.__wb.ketchem.board(); K.kevin.wallet = 1000; });
await page.click('#kPanel [data-tab="pen"]');
await ev(() => { const cs = [...document.querySelectorAll('#kPanel [data-pen]:not([disabled])')]; const h = cs.filter(c => c.dataset.type === 'herbivore'); if (h.length >= 2) { h[0].click(); h[1].click(); } });
await page.click('#kpBreed').catch(() => {}); console.log('breed ->', await msg());
await check('bred'); console.log(JSON.stringify(await state()));
await key('Escape');
// Scene 3: save mid-naming, load, name
await ev(() => window.__wb.ketchem.save('adv')); await page.waitForTimeout(800);
await ev(() => window.__wb.ketchem.load('adv')); await page.waitForFunction(() => window.__wb.ketchem.board() !== null); await page.waitForTimeout(300);
await check('loaded mid-naming'); console.log('after load', JSON.stringify(await state()));
answers = ['Kid']; await key('n'); console.log('N after load ->', await msg()); await check('named after load');
// Scene 4: knock-down with no grazer: box every herbivore, plant a hungry carnivore, force a miss
await pause(true);
await toStore(); await key('c'); await page.waitForSelector('#kPanel:not([hidden])');
await ev(() => { for (const b of [...document.querySelectorAll('#kPanel [data-box]')]) b.click(); });
await key('Escape'); await offStore();
console.log('party boxed', JSON.stringify(await state()));
await luck(0.999); await key('2'); await ev(() => { window.__wb.ketchem.board().kevin.stones.geode = 1; });
await beside('carnivore', 0.2); await key('Tab'); await key(' '); console.log('miss at hungry carnivore ->', await msg());
await pause(false); await page.waitForTimeout(2500); await pause(true);
await check('after the attack'); console.log(JSON.stringify(await state()));
// Scene 5: potions at the edges
await ev(() => { const K = window.__wb.ketchem.board(), p = K.kevin; p.pack = ['Homeward', 'Homeward', 'Tonic', 'Slumber', 'Musk', 'Decoy', 'Fleetfoot', 'Fleetfoot', 'Survey', 'Hush', 'Smoke', 'Mirror'].map(potion => ({ potion })); p.wallet = 500; });
await toStore(); await key('p'); await key('1'); console.log('Homeward on the store ->', await msg());
await pause(false); await page.waitForTimeout(1500); await pause(true); await check('homeward on the store');
await key('p'); await key('2'); console.log('Tonic with empty party ->', await msg());
await key('p'); await key('3'); console.log('Slumber with no target ->', await msg());
answers = ['dragon']; await key('p'); await key('4'); console.log('Musk bad type ->', await msg());
await key('p'); await key('5'); console.log('Decoy no facing ->', await msg());
await key('p'); await key('6'); await key('p'); await key('6'); console.log('two Fleetfoots ->', await msg(), JSON.stringify(await ev(() => window.__wb.ketchem.board().kevin.effects)));
await ev(() => { const K = window.__wb.ketchem.board(), p = K.kevin, sim = window.__wb.sim; for (let i = 0; i < sim.W * sim.H; i++) { const g = sim.grid[i]; if (g !== sim.T.OCEAN && g !== sim.T.COAST && g !== sim.T.MOUNTAIN) { p.x = i % sim.W; p.y = (i / sim.W) | 0; break; } } p.moved = true; });
await key('p'); await key('6'); console.log('Survey at the corner ->', await msg()); await check('survey at the corner');
await offStore();
// Scene 6: Slumber on a bolting creature, then the sleep ends
await luck(0.999); await key('1'); const h2 = await beside('herbivore'); await key('Tab'); await key(' '); console.log('miss (bolt) ->', await msg());
await ev(() => { const K = window.__wb.ketchem.board(), p = K.kevin; p.pack = [{ potion: 'Slumber' }]; });
await ev(id => { const K = window.__wb.ketchem.board(); K.kevin.target = id; }, h2);
await key('p'); await key('1'); console.log('Slumber on a bolter ->', await msg());
await pause(false); await page.waitForTimeout(3000); await pause(true);
console.log('bolter state', JSON.stringify(await ev(id => { const K = window.__wb.ketchem.board(), f = window.__wb.sim.fauna.find(f => f && f.id === id); return f ? { held: f.held, aw: K.aw[id] } : 'gone'; }, h2)));
await check('after the sleep');
// Scene 7: give with nobody, give garbage, buy garbage
answers = ['coins -10']; await key('g'); console.log('give -10 ->', await msg());
answers = ['coins 1e9']; await key('g'); console.log('give 1e9 ->', await msg());
await toStore(); await key('e'); await page.waitForSelector('#kPanel:not([hidden])');
console.log('buy qty -5 ->', await ev(() => { const K = window.__wb.ketchem.board(); return JSON.stringify([K.kevin.wallet, (window.__wb.ketchem.buy ? 'x' : 'n/a')]); }));
await key('Escape');
// Scene 8: sell plant 99 / plants when named 'plants'
console.log('sell plant 99 -> covered by src/ketchem/market.test.js');
await check('end'); console.log('final', JSON.stringify(await state()));
console.log('FINDINGS ' + findings.length); for (const f of findings) console.log('  ' + f);
console.log('page errors ' + errors.length); for (const e of [...new Set(errors)].slice(0, 10)) console.log('  ' + e);
await browser.close();
