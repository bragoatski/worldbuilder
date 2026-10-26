// The store panel (BUY / SELL / BOX / PEN) and the Almanac panel for Kevin (the market section of the design, 22.2 M / C,
// 5.6). DOM only; the page passes the lists and what each button does. Esc or the X closes. Creature cards carry the
// sim's drawing of the creature (hud.js drawGlyphs) and the SELL card its price breakdown.
import { drawGlyphs } from './hud.js';
let el = null, mode = null;
function css() {
  const s = document.createElement('style');
  s.textContent = '#kPanel{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:70;width:min(640px,calc(100vw - 32px));max-height:60vh;overflow:auto;' +
    'background:var(--bg-panel);border:1px solid var(--border-hi);border-radius:10px;padding:12px;color:var(--fg);font:12px/1.45 "JetBrains Mono",monospace;box-shadow:0 12px 32px rgba(0,0,0,.45);}' +
    '#kPanel[hidden]{display:none;}' +
    '#kPanel .kp-head{display:flex;justify-content:space-between;align-items:center;color:var(--fg-dim);font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;}' +
    '#kPanel .kp-head button{background:none;border:0;color:var(--fg-faint);font:16px/1 inherit;cursor:pointer;}' +
    '#kPanel .kp-tabs{display:flex;gap:6px;margin-bottom:8px;} #kPanel .kp-tabs button{border-radius:6px;padding:5px 10px;font:600 11px/1 inherit;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--fg-dim);}' +
    '#kPanel .kp-tabs button.on{border-color:#e8a83899;color:var(--fg);background:rgba(232,168,56,.08);}' +
    '#kPanel table{width:100%;border-collapse:collapse;} #kPanel td{padding:5px 4px;border-top:1px solid var(--border);vertical-align:top;}' +
    '#kPanel td.n{font-weight:600;color:var(--fg);} #kPanel td.m{color:var(--fg-dim);font-size:11px;} #kPanel td.r{text-align:right;white-space:nowrap;}' +
    '#kPanel button.b{border-radius:6px;padding:4px 9px;font:600 11px/1 inherit;cursor:pointer;border:1px solid var(--border-hi);background:transparent;color:var(--fg-dim);margin-left:4px;}' +
    '#kPanel button.b:hover{color:var(--fg);background:rgba(255,255,255,.05);} #kPanel .kp-empty{color:var(--fg-faint);padding:8px 4px;} #kPanel pre{white-space:pre-wrap;margin:0;color:var(--fg-dim);}' +
    '#kPanel td.g{width:26px;padding:4px 4px 0 0;} #kPanel .kp-glyph{width:26px;height:26px;display:block;image-rendering:pixelated;background:rgba(255,255,255,.04);border-radius:5px;}' +
    '#kPanel .kp-bd{color:var(--fg-faint);font-size:10px;margin-top:2px;} #kPanel .kp-sec{color:var(--fg-faint);font-size:10px;text-transform:uppercase;letter-spacing:.08em;padding:10px 4px 2px;}';
  document.head.appendChild(s);
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function ensure() {
  if (el) return;
  css(); el = document.createElement('div'); el.id = 'kPanel'; el.hidden = true; document.body.appendChild(el);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.hidden) { el.hidden = true; e.stopPropagation(); } });
}
export function closePanel() { if (el) el.hidden = true; mode = null; }
export function panelOpen() { return !!el && !el.hidden; }

// acts: { lists: () => shopLists, buy(item, qty), sell(name), sellPlants(), box(name, take), onChange() }
export function storePanel(acts, tab = 'buy') {
  ensure(); mode = 'store';
  const L = acts.lists();
  const tabs = ['buy', 'sell', 'box', 'pen'].map(t => '<button type="button" data-tab="' + t + '" class="' + (t === tab ? 'on' : '') + '">' + t.toUpperCase() + '</button>').join('');
  let body;
  if (tab === 'buy') {
    body = '<table>' + L.buy.map(b => '<tr><td class="n">' + esc(b.item) + '</td><td class="m">' + esc(b.blurb || (b.item + ' stone')) + (b.left === Infinity ? '' : ' (' + b.left + ' in stock)') + '</td><td class="r">' + b.price + ' <button class="b" data-buy="' + esc(b.item) + '">Buy</button><button class="b" data-buy="' + esc(b.item) + '" data-qty="5">x5</button></td></tr>').join('') + '</table>';
  } else if (tab === 'sell') {
    const rows = L.sell.map(c => '<tr>' + glyphCell(c) + '<td class="n">' + esc(c.name) + '</td><td class="m">' + esc(c.species) + ' ' + esc(c.type) + ' L' + esc(c.level) + ' ' + esc(c.elemental) + ' ' + esc(c.growth || '') + (c.abilities.length ? ', ' + esc(c.abilities.join(', ')) : '') + (c.where === 'cabinet' ? ' (cabinet)' : '') + (c.breakdown ? '<div class="kp-bd">' + esc(c.breakdown) + '</div>' : '') + '</td><td class="r">' + esc(c.price) + ' <button class="b" data-sell="' + esc(c.name) + '">Sell</button></td></tr>').join('');
    const plants = L.plants.map((x, i) => '<tr><td class="g"></td><td class="n">plant ' + (i + 1) + '</td><td class="m">gen ' + x.gen + ', health ' + Math.round((x.health || 0) * 100) + '%</td><td class="r">' + x.price + ' <button class="b" data-sellplant="' + (i + 1) + '">Sell</button></td></tr>').join('') +
      (L.plants.length > 1 ? '<tr><td class="g"></td><td class="n">all plants</td><td class="m"></td><td class="r">' + L.plants.reduce((a, x) => a + x.price, 0) + ' <button class="b" data-sellplants="1">Sell all</button></td></tr>' : '');
    body = rows || plants ? '<table>' + rows + plants + '</table>' : '<div class="kp-empty">Nothing to sell: the party and the pack are empty.</div>';
  } else if (tab === 'pen') {
    const rows = L.pen.map(c => '<tr>' + glyphCell(c) + '<td class="n"><label><input type="checkbox" data-pen="' + c.id + '" data-type="' + esc(c.type) + '"' + (c.cooldown || c.newborn ? ' disabled' : '') + '> ' + esc(c.name) + '</label></td><td class="m">' + esc(c.type) + ' L' + esc(c.level) + ' ' + esc(c.elemental) + (c.cooldown ? ', rests ' + c.cooldown + ' ticks' : c.newborn ? ', newborn' : '') + '</td><td class="r"></td></tr>').join('');
    body = (rows ? '<table>' + rows + '</table>' : '<div class="kp-empty">Nothing to breed: catch two of one kind.</div>') + '<div class="km-row" style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;align-items:center;color:var(--fg-dim)"><span id="kpFee">pick two of one kind</span><button class="b" id="kpBreed" disabled>Breed</button></div>';
  } else {
    const party = L.party.map(c => '<tr>' + glyphCell(c) + '<td class="n">' + esc(c.name) + '</td><td class="m">party, ' + esc(c.type) + ' L' + esc(c.level) + ' ' + esc(c.elemental) + ' ' + esc(c.growth || '') + '</td><td class="r"><button class="b" data-box="' + esc(c.name) + '">To cabinet</button></td></tr>').join('');
    const cab = L.box.map(c => '<tr>' + glyphCell(c) + '<td class="n">' + esc(c.name) + '</td><td class="m">cabinet, ' + esc(c.type) + ' L' + esc(c.level) + ' ' + esc(c.elemental) + ' ' + esc(c.growth || '') + '</td><td class="r"><button class="b" data-take="' + esc(c.name) + '">To party</button></td></tr>').join('');
    body = party || cab ? '<table>' + party + cab + '</table>' : '<div class="kp-empty">The party and the cabinet are empty.</div>';
  }
  el.innerHTML = '<div class="kp-head"><span>' + esc(L.store) + ' &middot; ' + L.wallet + ' coins</span><button type="button" id="kpClose" aria-label="Close">&times;</button></div><div class="kp-tabs">' + tabs + '</div>' + body;
  el.hidden = false;
  const glyphs = {}; for (const list of [L.sell, L.box, L.party, L.pen]) for (const c of list || []) if (c.id !== undefined) glyphs[c.id] = c.glyph;
  drawGlyphs(el, glyphs, 13);
  el.querySelector('#kpClose').addEventListener('click', closePanel);
  el.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => storePanel(acts, b.dataset.tab)));
  const redo = t => { acts.onChange(); storePanel(acts, t); };
  el.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => { acts.buy(b.dataset.buy, +(b.dataset.qty || 1)); redo('buy'); }));
  el.querySelectorAll('[data-sell]').forEach(b => b.addEventListener('click', () => { acts.sell(b.dataset.sell); redo('sell'); }));
  el.querySelectorAll('[data-sellplants]').forEach(b => b.addEventListener('click', () => { acts.sellPlants(); redo('sell'); }));
  el.querySelectorAll('[data-sellplant]').forEach(b => b.addEventListener('click', () => { acts.sell('plant ' + b.dataset.sellplant); redo('sell'); }));
  el.querySelectorAll('[data-box]').forEach(b => b.addEventListener('click', () => { acts.box(b.dataset.box, false); redo('box'); }));
  el.querySelectorAll('[data-take]').forEach(b => b.addEventListener('click', () => { acts.box(b.dataset.take, true); redo('box'); }));
  const picks = () => [...el.querySelectorAll('[data-pen]:checked')];
  const feeEl = el.querySelector('#kpFee'), breedBtn = el.querySelector('#kpBreed');
  el.querySelectorAll('[data-pen]').forEach(c => c.addEventListener('change', () => { const ps = picks(); if (ps.length > 2) { c.checked = false; return; } const two = ps.length === 2, same = two && ps[0].dataset.type === ps[1].dataset.type; breedBtn.disabled = !same; feeEl.textContent = same ? 'fee ' + L.fee(ps[0].dataset.pen, ps[1].dataset.pen) + ' coins' : two ? 'two of one kind' : 'pick two of one kind'; }));
  if (breedBtn) breedBtn.addEventListener('click', () => { const ps = picks(); if (ps.length === 2) { acts.breed(ps[0].dataset.pen, ps[1].dataset.pen); redo('pen'); } });
}

function glyphCell(c) { return '<td class="g"><canvas class="kp-glyph" width="26" height="26" data-glyph="' + esc(c.id) + '"></canvas></td>'; }

// The Almanac (M): every species met with its drawing, nickname, binomial, counts and variants, then the places found.
// A: almanacLists() from market.js.
export function almanacPanel(A) {
  ensure(); mode = 'almanac';
  const glyphs = {};
  const rows = A.species.map((e, i) => {
    glyphs['s' + i] = e.glyph;
    const title = (e.nickname ? '<b>' + esc(e.nickname) + '</b> ' : '') + '<span class="kp-sci">' + esc(e.scientific || 'unnamed ' + e.type + ' line') + '</span>';
    const notes = [e.namedBy ? 'named by ' + esc(e.namedBy) : '', e.evolvedFrom ? 'evolved from ' + esc(e.evolvedFrom) : ''].concat(e.variants.map(esc)).filter(Boolean).join(' · ');
    return '<tr><td class="g"><canvas class="kp-glyph" width="26" height="26" data-glyph="s' + i + '"></canvas></td><td class="n">' + title + '<div class="kp-bd">' + esc(e.type) + (notes ? ' · ' + notes : '') + '</div></td><td class="r m">seen ' + esc(e.seen) + ' · caught ' + esc(e.caught) + ' · best L' + esc(e.bestLevel) + '</td></tr>';
  }).join('');
  const places = A.stores.map(s => '<tr><td class="g"></td><td class="n">' + esc(s.name) + '</td><td class="r m">store ' + esc(s.bearing) + '</td></tr>').join('') +
    A.landmarks.map(l => '<tr><td class="g"></td><td class="n">' + esc(l.name) + '</td><td class="r m">' + esc(l.kind || 'landmark') + ' ' + esc(l.bearing) + '</td></tr>').join('');
  el.innerHTML = '<div class="kp-head"><span>Almanac &middot; ' + A.species.length + ' species &middot; ' + esc(A.found) + '/' + esc(A.total) + ' stores found</span><button type="button" id="kpClose" aria-label="Close">&times;</button></div>' +
    (rows ? '<table>' + rows + '</table>' : '<div class="kp-empty">No species met yet. Creatures within sight go in here.</div>') +
    (places ? '<div class="kp-sec">Places</div><table>' + places + '</table>' : '');
  el.hidden = false;
  drawGlyphs(el, glyphs, 13);
  el.querySelector('#kpClose').addEventListener('click', closePanel);
}

export function textPanel(title, text) {
  ensure(); mode = 'text';
  el.innerHTML = '<div class="kp-head"><span>' + esc(title) + '</span><button type="button" id="kpClose" aria-label="Close">&times;</button></div><pre>' + esc(text) + '</pre>';
  el.hidden = false;
  el.querySelector('#kpClose').addEventListener('click', closePanel);
}
export function panelMode() { return panelOpen() ? mode : null; }
