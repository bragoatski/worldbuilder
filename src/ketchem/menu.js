// The save menu (F9): the slots newest first with Load and Delete, Export of the current game, Import from a file.
// DOM only; the page passes what each button does. Esc or the X closes it.
let el = null;

function css() {
  const s = document.createElement('style');
  s.textContent = '#kSaveMenu{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:70;width:min(520px,calc(100vw - 32px));' +
    'background:var(--bg-panel);border:1px solid var(--border-hi);border-radius:10px;padding:12px;color:var(--fg);font:12px/1.45 "JetBrains Mono",monospace;box-shadow:0 12px 32px rgba(0,0,0,.45);}' +
    '#kSaveMenu[hidden]{display:none;}' +
    '#kSaveMenu .km-head{display:flex;justify-content:space-between;align-items:center;color:var(--fg-dim);font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;}' +
    '#kSaveMenu .km-head button{background:none;border:0;color:var(--fg-faint);font:16px/1 inherit;cursor:pointer;}' +
    '#kSaveMenu table{width:100%;border-collapse:collapse;} #kSaveMenu td{padding:5px 4px;border-top:1px solid var(--border);vertical-align:top;}' +
    '#kSaveMenu td.n{font-weight:600;color:var(--fg);} #kSaveMenu td.m{color:var(--fg-dim);font-size:11px;}' +
    '#kSaveMenu button.b{border-radius:6px;padding:4px 9px;font:600 11px/1 inherit;cursor:pointer;border:1px solid var(--border-hi);background:transparent;color:var(--fg-dim);margin-left:4px;}' +
    '#kSaveMenu button.b:hover{color:var(--fg);background:rgba(255,255,255,.05);}' +
    '#kSaveMenu .km-row{display:flex;gap:8px;justify-content:flex-end;margin-top:10px;align-items:center;color:var(--fg-dim);}' +
    '#kSaveMenu .km-empty{color:var(--fg-faint);padding:10px 4px;}';
  document.head.appendChild(s);
}

// acts: { slots: async () => [...meta], load(slot), del(slot), exportNow(), importFile(file), saveNow(), hasGame: () => bool }
export function saveMenu(acts) {
  if (!el) {
    css();
    el = document.createElement('div'); el.id = 'kSaveMenu'; el.hidden = true;
    document.body.appendChild(el);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.hidden) { el.hidden = true; e.stopPropagation(); } });
  }
  async function render() {
    const slots = await acts.slots().catch(() => []);
    const rows = slots.map(m => '<tr><td class="n">' + esc(m.slot) + '</td><td class="m">' + esc(m.setting) + ' ' + esc(m.seed) + '<br>' + esc(m.ticksPlayed || 0) + ' ticks, ' + esc(m.players || '') + ', saved ' + esc(String(m.lastSaved).replace('T', ' ').slice(0, 19)) + '</td>' +
      '<td style="text-align:right;white-space:nowrap"><button class="b" data-load="' + esc(m.slot) + '">Load</button><button class="b" data-del="' + esc(m.slot) + '">Delete</button></td></tr>').join('');
    el.innerHTML = '<div class="km-head"><span>Saved games</span><button type="button" id="kmClose" aria-label="Close">&times;</button></div>' +
      (rows ? '<table>' + rows + '</table>' : '<div class="km-empty">No saved games yet. F5 saves the game you are playing.</div>') +
      '<div class="km-row"><label>Import <input type="file" id="kmImport" accept="application/json" style="width:180px"></label>' +
      (acts.hasGame() ? '<button class="b" id="kmSave">Save now</button><button class="b" id="kmExport">Export</button>' : '') + '</div>';
    el.querySelector('#kmClose').addEventListener('click', () => { el.hidden = true; });
    el.querySelectorAll('[data-load]').forEach(b => b.addEventListener('click', () => { el.hidden = true; acts.load(b.dataset.load); }));
    el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => { if (confirm('Delete the save "' + b.dataset.del + '"? This cannot be undone.')) { await acts.del(b.dataset.del); render(); } }));
    const imp = el.querySelector('#kmImport'); imp.addEventListener('change', () => { if (imp.files[0]) { el.hidden = true; acts.importFile(imp.files[0]); } });
    const sv = el.querySelector('#kmSave'); if (sv) sv.addEventListener('click', async () => { await acts.saveNow(); render(); });
    const ex = el.querySelector('#kmExport'); if (ex) ex.addEventListener('click', () => acts.exportNow());
  }
  return { open() { el.hidden = false; render(); }, close() { el.hidden = true; }, toggle() { if (el.hidden) this.open(); else this.close(); } };
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
