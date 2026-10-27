// An inline question bar for Kevin (names, give, feed, Musk's type, a game's name), in place of window.prompt: a
// browser prompt is modal, so while it was open the world stopped and Root's door timed out (adversarial run
// 2026-10-25). The bar sits above the party row; Enter answers, Esc or the X declines. One question at a time: a
// second question waits until the first is answered, so Kevin's and a guest's never cancel each other. Keys typed
// into it never reach the game (the page's keydown skips the bar). ask() resolves to the trimmed text, or null.
let bar = null, pending = null;
const queue = [];   // questions asked while one is open wait their turn (Kevin's and the guest's never cancel each other)
function css() {
  const s = document.createElement('style');
  s.textContent = '#kAsk{position:fixed;left:50%;bottom:104px;transform:translateX(-50%);z-index:75;width:min(560px,calc(100vw - 32px));box-sizing:border-box;' +
    'background:var(--bg-panel);border:1px solid #e8a83899;border-radius:10px;padding:10px 12px;color:var(--fg);font:12px/1.45 "JetBrains Mono",monospace;box-shadow:0 12px 32px rgba(0,0,0,.45);}' +
    '#kAsk[hidden]{display:none;} #kAsk label{display:block;color:var(--fg-dim);margin-bottom:6px;}' +
    '#kAsk .ka-row{display:flex;gap:8px;} #kAsk input{flex:1;min-width:0;background:var(--bg-input);color:var(--fg);border:1px solid var(--border-hi);border-radius:6px;padding:6px 8px;font:inherit;}' +
    '#kAsk input:focus{outline:none;border-color:#e8a838;} #kAsk button{border-radius:6px;padding:4px 10px;font:600 11px/1 inherit;cursor:pointer;border:1px solid var(--border-hi);background:transparent;color:var(--fg-dim);}' +
    '#kAsk button:hover{color:var(--fg);background:rgba(255,255,255,.05);} #kAsk .ka-hint{color:var(--fg-faint);font-size:10px;margin-top:5px;}';
  document.head.appendChild(s);
}
function ensure() {
  if (bar) return;
  css();
  bar = document.createElement('div'); bar.id = 'kAsk'; bar.hidden = true;
  bar.innerHTML = '<label for="kAskIn"></label><div class="ka-row"><input id="kAskIn" autocomplete="off" spellcheck="false"><button type="button" data-ok>OK</button><button type="button" data-no aria-label="Cancel">&times;</button></div><div class="ka-hint">Enter to answer, Esc to cancel. The world keeps moving.</div>';
  document.body.appendChild(bar);
  const input = bar.querySelector('input');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(input.value); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
  });
  bar.querySelector('[data-ok]').addEventListener('click', () => finish(input.value));
  bar.querySelector('[data-no]').addEventListener('click', () => finish(null));
}
function finish(v) {
  if (!bar) return;
  bar.hidden = true;
  const cb = pending; pending = null;
  const input = bar.querySelector('input'); input.blur();
  if (cb) cb(v === null ? null : String(v).trim());
  if (!pending && queue.length) { const q = queue.shift(); show(q.question, q.initial, q.resolve); }
}
function show(question, initial, resolve) {
  bar.querySelector('label').textContent = question;
  const input = bar.querySelector('input'); input.value = initial;
  bar.hidden = false; pending = resolve;
  setTimeout(() => { input.focus(); input.select(); }, 0);
}
export function ask(question, initial = '') {
  if (typeof document === 'undefined') return Promise.resolve(null);
  ensure();
  return new Promise(resolve => { if (pending) queue.push({ question, initial, resolve }); else show(question, initial, resolve); });
}
export function asking() { return !!pending; }
export function closeAsk() { while (queue.length) queue.shift().resolve(null); if (pending) finish(null); }   // a board change answers every open question with null
