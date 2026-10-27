// The host side of the guest link (mechanics 26). Kevin's page is the game; a guest on another screen sees a picture of
// their corner of the world and sends keys, answers and store commands through visit/guest-link.mjs. This module only
// moves data: the page passes what to send (frame, state) and what to do with each input. Only a page served from this
// machine opens a link; the public site never looks for one.
const LINK = 'http://127.0.0.1:7798';   // the link's host side: this machine only (visit/guest-link.mjs)
const LOCAL = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
let L = null;   // { code, key, guest, hooks, timer, questions: [{ id, text, initial, resolve }], guestSeen }
let nextQ = 1;   // question ids keep counting across links, so a guest page never mistakes a new question for an old one

async function post(path, body) {
  const r = await fetch(LINK + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  if (!r.ok) throw new Error('guest link ' + r.status);
  return r.json();
}
export async function linkAvailable() {
  if (!LOCAL || typeof fetch === 'undefined') return false;
  try { const r = await fetch(LINK + '/host/hello'); if (!r.ok) return false; const d = await r.json(); return !d.open || !!L; } catch { return false; }   // a link open in another tab is not offered here
}
// Where the guest goes: the guest port's address as the link server reports it (127.0.0.1 means this machine only).
export function guestAddress() { return L && L.guest ? 'http://' + L.guest.host + ':' + L.guest.port + '/?code=' + L.code : null; }
export function linkOpen() { return !!L; }
export function linkCode() { return L ? L.code : null; }
// hooks: { frame() -> jpeg data URL or null, state() -> object, input(ev), idle() (no guest input for a while) }
export async function openLink(hooks) {
  if (L) return L.code;
  const n = new Uint32Array(1); crypto.getRandomValues(n);
  const code = String(100000 + (n[0] % 900000));
  const r = await post('/host/open', { code });
  L = { code, key: r.key, guest: r.guest, hooks, timer: null, questions: [], guestSeen: 0, busy: false };
  L.timer = setInterval(pump, 200);
  return code;
}
export async function closeLink() {
  if (!L) return;
  clearInterval(L.timer);
  for (const q of L.questions) q.resolve(null);
  const key = L.key; L = null;
  try { await post('/host/close', { key }); } catch { /* the link server is gone: nothing to close */ }
}
// A question for the remote guest: shown on their screen; resolves with their answer or null.
export function askRemote(text, initial = '') {
  if (!L) return Promise.resolve(null);
  return new Promise(resolve => L.questions.push({ id: nextQ++, text, initial, resolve }));
}
// A board change: questions about the old board are answered null (their callers do nothing on null).
export function dropQuestions() {
  if (!L) return;
  for (const q of L.questions.splice(0)) q.resolve(null);
}
async function pump() {
  if (!L || L.busy) return;
  L.busy = true;
  const link = L;
  try {
    const q = link.questions[0];
    const state = Object.assign({}, link.hooks.state(), { question: q ? { id: q.id, text: q.text, initial: q.initial } : null });
    const r = await post('/host/frame', { key: link.key, jpeg: link.hooks.frame(), state });
    if (L !== link) return;
    link.guestSeen = r.guestSeen || 0;
    for (const ev of r.inputs || []) {
      if (ev.t === 'answer') { const k = link.questions.findIndex(x => x.id === ev.id); if (k >= 0) link.questions.splice(k, 1)[0].resolve(ev.text); }
      else { try { link.hooks.input(ev); } catch (e) { console.warn('guest input', ev, e); } }   // one bad input never drops the rest
    }
    if (link.guestSeen && Date.now() - link.guestSeen > 3000) link.hooks.idle();   // a dropped connection must not leave an arrow held down
  } catch { /* the link server stopped: the next pump tries again */ }
  finally { link.busy = false; }
}
