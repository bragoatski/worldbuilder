// The Controls panel (Ketch'em only): every key of Kevin's character as a button with its key in a small chip, so the
// panel is both a touch pad and a lesson in the keys. Docked on the left edge where the Hand rail sits outside a
// board; it collapses to a slim tab (the choice is kept in localStorage). A click builds a synthetic key event and
// hands it to the page's own ketchemKey through the `act` callbacks, so no action logic lives here: a button and its
// key are the same code path. The Move pad holds like a key: pointerdown is a keydown, pointerup / leave / cancel the
// keyup. DOM only; the module loads without a document (tests), and the pure parts below are what the tests cover.

// Keys that are not one printable character: the name a button carries (data-key) -> what the event says.
const NAMED = {
  Space: { key: ' ', code: 'Space' }, Tab: { key: 'Tab', code: 'Tab' }, Escape: { key: 'Escape', code: 'Escape' },
  F5: { key: 'F5', code: 'F5' }, F9: { key: 'F9', code: 'F9' },
};
const CHIP = { Space: 'Space', Tab: 'Tab', Escape: 'Esc', F5: 'F5', F9: 'F9' };
export function chipOf(name) { return CHIP[name] || String(name).toUpperCase(); }

// The key a button name sends, as the event's key and code.
export function keySend(name) {
  if (NAMED[name]) return NAMED[name];
  const n = String(name);
  return { key: n, code: /^\d$/.test(n) ? 'Digit' + n : 'Key' + n.toUpperCase() };
}
// The synthetic keydown ketchemKey takes: the shape of a plain, non-repeating press with no modifier.
export function keyEvent(name) {
  const s = keySend(name);
  return {
    key: s.key, code: s.code, repeat: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
    preventDefault() {}, target: typeof document !== 'undefined' ? document.body : null,
  };
}
// What the window keyup handler sees as the key: lower-cased, so the page's _kPressed table matches.
export function releaseKey(name) { return String(keySend(name).key).toLowerCase(); }

const STONES = [['Amber', 'amber', '1'], ['Geode', 'geode', '2'], ['Obsidian', 'obsidian', '3']];
const BAIT_KINDS = [['plant', 'Plant', 'p'], ['scatter', 'Scatter', 's'], ['meat', 'Meat', 'm'], ['stake', 'Stake', 't']];
const btn = (act, label, key, more) => Object.assign({ act, label, key }, more);

// The sections for a state: { stone, stones: {amber, geode, obsidian}, bait: null | { kind }, potion: bool, potions: [[name, count]], asking: bool }.
// Each section: { id, title, cols, buttons, hint? }; a button: { act, label, key (the name it sends), plus optional
// hold (a pad key), cell [row, col], aria, on, count, bait, potion }.
export function panelSections(state = {}) {
  const st = state || {}, stones = st.stones || {}, bait = st.bait || null;
  const move = {
    id: 'move', title: 'Move', cols: 3, pad: true, buttons: [
      btn('move-up', '\u25B2', 'w', { hold: true, cell: [1, 2], aria: 'Move up' }),
      btn('move-left', '\u25C0', 'a', { hold: true, cell: [2, 1], aria: 'Move left' }),
      btn('move-down', '\u25BC', 's', { hold: true, cell: [3, 2], aria: 'Move down' }),
      btn('move-right', '\u25B6', 'd', { hold: true, cell: [2, 3], aria: 'Move right' }),
    ],
  };
  // A pending choice changes what every other key means (a digit picks a potion, P or S a bait kind), so only its own buttons stay.
  if (st.potion) {
    return [{
      id: 'potion', title: 'Potion: pick one', cols: 1,
      buttons: (st.potions || []).slice(0, 9).map(([name, n], i) => btn('potion-' + (i + 1), name, String(i + 1), { count: n, potion: name })).concat([btn('potion-cancel', 'Cancel', 'Escape')]),
    }];
  }
  if (bait && !bait.kind) {
    return [move, {
      id: 'bait', title: 'Bait: pick a kind', cols: 2,
      buttons: BAIT_KINDS.map(([kind, label, key]) => btn('bait-' + kind, label, key, { bait: kind })).concat([btn('bait-cancel', 'Cancel', 'Escape')]),
    }];
  }
  if (bait) {
    return [move, {
      id: 'bait', title: 'Bait: ' + bait.kind, cols: 2, hint: 'The Move pad picks the direction.',
      buttons: [btn('bait-here', 'Here', 'e', { bait: 'here' }), btn('bait-cancel', 'Cancel', 'Escape')],
    }];
  }
  return [
    move,
    {
      id: 'act', title: 'Act', cols: 2, buttons: [
        btn('throw', 'Throw', 'Space', { wide: true }), btn('target', 'Target', 'Tab'), btn('use', 'Use', 'e'), btn('name', 'Name', 'n'), btn('follow', 'Follow', 'f'),
      ],
    },
    {
      id: 'stones', title: 'Stones', cols: 1,
      buttons: STONES.map(([name, k, key]) => btn('stone-' + k, name, key, { count: stones[k] === undefined ? 0 : stones[k], on: st.stone === name })),
    },
    { id: 'bait', title: 'Bait', cols: 1, buttons: [btn('bait', 'Bait', 'b')] },
    { id: 'potion', title: 'Potion', cols: 1, buttons: [btn('potion', 'Potion', 'p')] },
    {
      id: 'more', title: 'More', cols: 2, buttons: [
        btn('pack', 'Pack', 'i'), btn('almanac', 'Almanac', 'm'), btn('give', 'Give', 'g'), btn('feed', 'Feed', 't'), btn('cabinet', 'Cabinet', 'c'),
        btn('camera', 'Camera', 'v'), btn('sound', 'Sound', 'o'), btn('save', 'Save', 'F5'), btn('load', 'Load', 'F9'),
      ],
    },
  ];
}

// A signature of what the panel shows: the panel re-renders only when it changes (never under a press).
export function stateSig(state) {
  const st = state || {}, s = st.stones || {};
  return JSON.stringify([st.stone || '', s.amber, s.geode, s.obsidian, st.bait ? st.bait.kind || '' : null, !!st.potion, st.potions || [], !!st.asking]);
}

// Open by default on a wide screen; below 1100 px the store panel and the question bar would overlap it, so it starts collapsed.
export function defaultOpen(width) { return !(width < 1100); }

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
export function buttonHTML(b) {
  return '<button type="button" tabindex="-1" class="kk-b' + (b.on ? ' on' : '') + (b.hold ? ' kk-pad' : '') + (b.wide ? ' wide' : '') + '" data-act="' + esc(b.act) + '" data-key="' + esc(b.key) + '"' +
    (b.hold ? ' data-hold="1"' : '') + (b.bait ? ' data-bait="' + esc(b.bait) + '"' : '') + (b.potion ? ' data-potion="' + esc(b.potion) + '"' : '') +
    (b.aria ? ' aria-label="' + esc(b.aria) + '"' : '') + (b.on !== undefined ? ' aria-pressed="' + (b.on ? 'true' : 'false') + '"' : '') +
    (b.cell ? ' style="grid-row:' + b.cell[0] + ';grid-column:' + b.cell[1] + '"' : '') + '>' +
    '<span class="kk-l">' + esc(b.label) + (b.count !== undefined ? ' <i>' + esc(b.count) + '</i>' : '') + '</span><span class="kk-k">' + esc(chipOf(b.key)) + '</span></button>';
}
export function sectionHTML(s) {
  return '<section class="kk-sec" data-sec="' + esc(s.id) + '"><div class="kk-h">' + esc(s.title) + '</div><div class="kk-grid c' + s.cols + (s.pad ? ' kk-padgrid' : '') + '">' + s.buttons.map(buttonHTML).join('') + '</div>' +
    (s.hint ? '<div class="kk-hint">' + esc(s.hint) + '</div>' : '') + '</section>';
}

// ---- DOM ----
const LS_KEY = 'kKeysOpen';
let root = null, dynEl = null, padEl = null, toggleEl = null, lastSig = '', act = null, busy = false;   // busy: the question bar is open, the buttons do nothing
const held = new Map();   // pointerId -> the key name held down

function css() {
  const s = document.createElement('style');
  s.textContent = '#kKeys{position:absolute;left:14px;top:50%;transform:translateY(-50%);z-index:6;width:196px;max-height:calc(100% - 192px);box-sizing:border-box;display:flex;flex-direction:column;' +
    'background:rgba(13,17,23,.82);border:1px solid var(--border-hi);border-radius:10px;backdrop-filter:blur(6px);box-shadow:0 6px 24px rgba(0,0,0,.45);color:var(--fg);font:11px/1.3 "JetBrains Mono",monospace;user-select:none;-webkit-user-select:none;}' +
    '#kKeys[hidden]{display:none;}' +
    '#kKeys .kk-head{display:flex;justify-content:space-between;align-items:center;padding:6px 8px 5px 10px;border-bottom:1px solid var(--border);flex:none;color:var(--fg-dim);font-size:10px;text-transform:uppercase;letter-spacing:.08em;}' +
    '#kKeys #kKeysToggle{background:none;border:1px solid var(--border);border-radius:6px;color:var(--fg-dim);font:inherit;font-size:12px;line-height:1;padding:2px 7px;cursor:pointer;}' +
    '#kKeys #kKeysToggle:hover{color:var(--fg);background:rgba(255,255,255,.05);}' +
    '#kKeys .kk-body{overflow-y:auto;overflow-x:hidden;padding:4px 8px 8px;scrollbar-width:thin;scrollbar-color:var(--border-hi) transparent;}' +
    '#kKeys .kk-h{color:var(--fg-faint);font-size:9px;text-transform:uppercase;letter-spacing:.08em;margin:7px 0 3px;}' +
    '#kKeys .kk-grid{display:grid;gap:4px;} #kKeys .kk-grid.c1{grid-template-columns:1fr;} #kKeys .kk-grid.c2{grid-template-columns:1fr 1fr;} #kKeys .kk-grid.c3{grid-template-columns:repeat(3,1fr);} #kKeys .kk-b.wide{grid-column:1/-1;}' +
    '#kKeys .kk-padgrid{width:132px;margin:0 auto;grid-template-rows:repeat(3,38px);}' +
    '#kKeys .kk-b{display:flex;align-items:center;justify-content:space-between;gap:4px;min-width:0;box-sizing:border-box;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--fg-dim);font:600 11px/1.2 "JetBrains Mono",monospace;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;}' +
    '#kKeys .kk-b:hover{color:var(--fg);background:rgba(255,255,255,.05);border-color:var(--border-hi);} #kKeys .kk-b:active{background:rgba(232,168,56,.14);border-color:#e8a83899;color:var(--fg);}' +
    '#kKeys .kk-b:focus-visible,#kKeys #kKeysToggle:focus-visible{outline:2px solid #e8a838;outline-offset:1px;}' +
    '#kKeys .kk-b .kk-l{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;} #kKeys .kk-b .kk-l i{font-style:normal;color:var(--fg-faint);margin-left:2px;}' +
    '#kKeys .kk-k{flex:none;font-size:9px;font-weight:400;padding:0 4px;border:1px solid var(--border-hi);border-radius:3px;background:var(--bg-input);color:var(--fg-faint);}' +
    '#kKeys .kk-b.on{border-color:#e8a83899;background:rgba(232,168,56,.1);color:var(--fg);} #kKeys .kk-b.on .kk-k{color:#e8a838;border-color:#e8a83866;}' +
    '#kKeys .kk-pad{flex-direction:column;justify-content:center;gap:2px;padding:2px;touch-action:none;} #kKeys .kk-pad .kk-l{font-size:13px;}' +
    '#kKeys .kk-hint{color:#f3d9a4;font-size:10px;margin-top:4px;}' +
    '#kKeys.asking .kk-body{opacity:.4;pointer-events:none;}' +
    '#kKeys.closed{left:0;width:auto;max-height:none;border-left:0;border-radius:0 10px 10px 0;}' +
    '#kKeys.closed .kk-head{border-bottom:0;padding:0;} #kKeys.closed .kk-title,#kKeys.closed .kk-body{display:none;}' +
    '#kKeys.closed #kKeysToggle{border:0;border-radius:0 10px 10px 0;padding:12px 5px;font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;writing-mode:vertical-rl;}';
  document.head.appendChild(s);
}

function readOpen() {
  try { const v = localStorage.getItem(LS_KEY); if (v === '1') return true; if (v === '0') return false; } catch { /* storage blocked: use the default */ }
  return defaultOpen(typeof window !== 'undefined' ? window.innerWidth : 1024);
}
function saveOpen(v) { try { localStorage.setItem(LS_KEY, v ? '1' : '0'); } catch { /* storage blocked: the choice lasts this page only */ } }
function setOpen(v, persist) {
  root.classList.toggle('closed', !v);
  toggleEl.setAttribute('aria-expanded', v ? 'true' : 'false');
  toggleEl.setAttribute('aria-label', v ? 'Collapse controls' : 'Open controls');
  toggleEl.title = v ? 'Collapse' : 'Open the controls';
  toggleEl.textContent = v ? '‹' : 'Controls ›';
  if (!v) releaseAll();
  if (persist) saveOpen(v);
}

// A pad press is a keydown; its end (up, leave, cancel, or the panel going away) is the page's keyup. Two pointers on one
// direction send one keydown, and the keyup waits for the last of them.
function press(id, name) {
  if (!act || busy || held.has(id)) return;
  const dup = [...held.values()].includes(name); held.set(id, name);
  if (!dup) act.down(keyEvent(name));
}
function release(id) {
  if (!held.has(id)) return;
  const name = held.get(id); held.delete(id);
  if (act && ![...held.values()].includes(name)) act.up(releaseKey(name));
}
function releaseAll() { for (const id of [...held.keys()]) release(id); }
// A press that ends off its button must not leave the button focused: Space would click it again instead of throwing.
function blurPanel() { const a = document.activeElement; if (root && a && root.contains(a)) a.blur(); }

function ensure() {
  if (root) return;
  css();
  const host = document.querySelector('.canvas-wrap') || document.body;
  root = document.createElement('div'); root.id = 'kKeys'; root.setAttribute('role', 'group'); root.setAttribute('aria-label', 'Controls');
  root.innerHTML = '<div class="kk-head"><span class="kk-title">Controls</span><button type="button" id="kKeysToggle" tabindex="-1"></button></div>' +
    '<div class="kk-body" id="kKeysBody">' + sectionHTML(panelSections()[0]) + '<div class="kk-dyn"></div></div>';
  host.appendChild(root);
  dynEl = root.querySelector('.kk-dyn'); toggleEl = root.querySelector('#kKeysToggle');
  toggleEl.setAttribute('aria-controls', 'kKeysBody');
  setOpen(readOpen(), false);
  toggleEl.addEventListener('click', () => { setOpen(root.classList.contains('closed'), true); toggleEl.blur(); });
  // Never a focus target: a click must leave the keyboard with the game, so Space after a click throws and does not re-click.
  padEl = root.querySelector('[data-sec="move"]');
  root.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
  root.addEventListener('contextmenu', e => { if (e.target.closest('button')) e.preventDefault(); });
  // Every button acts on pointerdown (primary button only), not on click: a re-render between press and release cannot drop it.
  root.addEventListener('pointerdown', e => {
    const b = e.target.closest('button[data-key]'); if (!b) return;
    e.preventDefault();   // a tap neither selects text nor takes focus
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (busy) return;
    if (b.dataset.hold) press(e.pointerId, b.dataset.key);
    else if (act) act.down(keyEvent(b.dataset.key));
  });
  for (const b of root.querySelectorAll('.kk-pad')) b.addEventListener('pointerleave', e => release(e.pointerId));
  const end = e => { release(e.pointerId); blurPanel(); };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
  window.addEventListener('blur', releaseAll);
  // A click that no pointer press made (detail 0: a keyboard or an assistive tool) acts here; a pointer's click already acted.
  root.addEventListener('click', e => {
    const b = e.target.closest('button[data-key]'); if (!b || !act || busy || e.detail !== 0) return;
    act.down(keyEvent(b.dataset.key));
    if (b.dataset.hold) act.up(releaseKey(b.dataset.key));   // a tap on the pad: down and up
    b.blur();
  });
}

// Called from draw() with the state (null while no board is up) and the page's callbacks: { down(event), up(key) }.
export function keypanelTick(state, actions) {
  if (typeof document === 'undefined') return;
  if (actions) act = actions;
  if (!state) { if (root && !root.hidden) { releaseAll(); root.hidden = true; } lastSig = ''; return; }
  ensure(); root.hidden = false;
  busy = !!state.asking; root.classList.toggle('asking', busy); root.setAttribute('aria-disabled', busy ? 'true' : 'false');
  if (busy) releaseAll();
  const sig = stateSig(state); if (sig === lastSig) return;
  lastSig = sig;
  const secs = panelSections(state), pad = secs.some(x => x.id === 'move');
  padEl.hidden = !pad; if (!pad) releaseAll();   // the pad is built once, so a press on it survives every re-render; it is hidden while a potion choice is pending
  dynEl.innerHTML = secs.filter(x => x.id !== 'move').map(sectionHTML).join('');
}
