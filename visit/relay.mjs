// The visit relay: a mailbox between Root's door (door.mjs, an MCP server) and the page that owns the world
// (src/visit.js on ?visit). Zero dependencies. Root's actions queue here until the page takes them; the page's
// answers, plus anything Kevin said, go back to Root. Root's own record (notes, the saved world, a log of every
// visit, field notes) lives under ~/root, because it is Root's life, not the product's.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = 7796;
// Only the visit page may talk to the relay from a browser. Without this, any website open in Kevin's
// browser could POST a fake "Kevin says" line into Root's context. Requests with no Origin come from
// local processes (the door), which already run as Kevin.
const PAGE_PORT = Number(process.env.VISIT_PAGE_PORT || 5181);
const PAGE_ORIGINS = ['http://localhost:' + PAGE_PORT, 'http://127.0.0.1:' + PAGE_PORT];
const HOSTS = ['127.0.0.1:' + PORT, 'localhost:' + PORT];   // refuses DNS-rebinding hosts
const VISIT_MINUTES = Number(process.env.VISIT_MINUTES || 20);
const GRACE_MINUTES = 5;   // after time is up, this long to say goodbye and leave; then only leave works
// VISIT_ROOT points a rehearsal at a scratch folder so a test never writes Root's real record.
const ROOT_DIR = process.env.VISIT_ROOT || path.join(os.homedir(), 'root');
const HOME = path.join(ROOT_DIR, 'visits');
const WORLD = path.join(HOME, 'world.json');
const NOTES = path.join(HOME, 'notes.jsonl');
const FIELD_NOTES = path.join(ROOT_DIR, 'field-notes', 'field-notes.md');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(path.dirname(FIELD_NOTES), { recursive: true });

// West-coast local time with an explicit offset (global rule: display local, compute UTC).
function stamp(d = new Date()) {
  const off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-', a = Math.abs(off);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' +
    p(d.getMinutes()) + ':' + p(d.getSeconds()) + sign + p(a / 60 | 0) + ':' + p(a % 60);
}

let visit = null;          // { id, started (epoch ms), log path, session }
let nextId = 1;
const queue = [];          // actions waiting for the page
const waiting = new Map(); // action id -> { resolve, taken }
let pagePoll = null;       // the current page's pending long-poll response
let currentPage = null;    // the newest visit page; an older tab is told to stand down
let inbox = [];            // [{ t, text }] what Kevin said, not yet heard by Root
const wakers = new Set();  // listen calls waiting for Kevin

function log(entry) {
  if (visit) fs.appendFileSync(visit.log, JSON.stringify({ t: stamp(), ...entry }) + '\n');
}

function sendJSON(res, code, obj) {
  if (res.writableEnded) return;
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': res.allowOrigin || PAGE_ORIGINS[0],
    'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' });
  res.end(JSON.stringify(obj));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.setEncoding('utf8');   // never split a multibyte character across chunks
    req.on('data', c => { s += c; if (s.length > 20e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function deliver() {
  if (!pagePoll || !queue.length) return;
  const res = pagePoll; pagePoll = null;
  const a = queue.shift();
  const w = waiting.get(a.id); if (w) w.taken = true;
  sendJSON(res, 200, { ...a, left: visit ? Math.max(0, Math.ceil(minutesLeft())) : null });
}

// Hand an action to the page and wait for what Root perceives back. If the page has already TAKEN the action,
// wait longer rather than report failure: a "page is down" answer to an action that actually ran would make
// Root retry it (and walk twice).
function ask(verb, args, timeoutMs = 25000) {
  const id = nextId++;
  queue.push({ id, verb, args });
  return new Promise(resolve => {
    let extended = false;
    const giveUp = () => {
      const w = waiting.get(id);
      if (!w) return;
      if (w.taken && !extended) { extended = true; setTimeout(giveUp, 60000); return; }
      waiting.delete(id);
      const qi = queue.findIndex(a => a.id === id); if (qi >= 0) queue.splice(qi, 1);
      resolve(null);
    };
    const t = setTimeout(giveUp, timeoutMs);
    waiting.set(id, { resolve: text => { clearTimeout(t); resolve(text); }, taken: false });
    deliver();
  });
}

function minutesLeft() { return visit ? VISIT_MINUTES - (Date.now() - visit.started) / 60000 : VISIT_MINUTES; }

function ago(ms) {
  const s = Math.round(ms / 1000);
  return s < 20 ? '' : ' (' + (s < 90 ? s + ' seconds' : Math.round(s / 60) + ' minutes') + ' ago)';
}

function drainInbox() {
  const now = Date.now(), heard = inbox.map(m => m.text + ago(now - m.t));
  inbox = [];
  return heard;
}

function recentNotes(n) {
  if (!fs.existsSync(NOTES)) return [];
  const out = [];
  for (const line of fs.readFileSync(NOTES, 'utf8').split('\n')) {
    try { if (line.trim()) out.push(JSON.parse(line)); } catch { /* a damaged line never blocks arrival */ }
  }
  return out.slice(-n);
}

async function arrive(session) {
  visit = { id: stamp().slice(0, 16).replace(':', ''), started: Date.now(), log: null, session };
  visit.log = path.join(HOME, visit.id + '.jsonl');
  try {
    const history = await ask('arrive', {});
    if (history === null) { visit = null; return null; }
    const view = await ask('look', {});
    const notes = recentNotes(12);
    const parts = ['You step through the door. You have ' + VISIT_MINUTES + ' minutes here.'];
    if (notes.length) parts.push('Your notes from before:\n' + notes.map(n => '- [' + String(n.t).slice(0, 10) + '] ' + n.text).join('\n'));
    else parts.push('This is your first visit. You have no notes yet.');
    if (history) parts.push(history);
    parts.push(view || PAGE_DOWN);
    log({ verb: 'arrive' });
    return parts.join('\n\n');
  } catch (e) { visit = null; throw e; }
}

const PAGE_DOWN = 'The door is open but the world is not: the page is not running or is still forming. ' +
  'Ask Kevin to open the visit page, then try again.';

// Each door process (one Claude session) carries its own session id. A call from a new session while an old
// visit is still open means that session died without leaving: close it and arrive fresh.
async function door(verb, args, session) {
  if (visit && visit.session !== session) { log({ verb: 'abandoned' }); visit = null; }
  if (!visit && verb !== 'leave') {
    const a = await arrive(session);
    if (a === null) return PAGE_DOWN;
    if (verb === 'look') return a + footer();
    return a + '\n\n---\n\n' + await act(verb, args);
  }
  return await act(verb, args);
}

function footer() {
  const heard = drainInbox();
  const left = minutesLeft();
  let s = '';
  if (heard.length) s += '\n\nYou hear:\n' + heard.join('\n');
  s += left > 0 ? '\n\n(' + Math.max(1, Math.round(left)) + ' min left)' : '\n\n(Your time here is up. Say goodbye if you like, then leave with your field note.)';
  return s;
}

async function act(verb, args) {
  let text;
  if (minutesLeft() < -GRACE_MINUTES && !['leave', 'say', 'note'].includes(verb)) {
    return 'Your time here is over and the world has gone still around you. Leave with your field note.';
  }
  if (verb === 'note') {
    const t = String(args.text || '').trim();
    if (!t) return 'An empty note.' + footer();
    fs.appendFileSync(NOTES, JSON.stringify({ t: stamp(), visit: visit && visit.id, text: t }) + '\n');
    text = 'Noted. It will be with you next visit.';
  } else if (verb === 'listen') {
    const secs = Math.max(5, Math.min(120, Number(args.seconds) || 30));
    let woke = inbox.length > 0;
    if (!woke) {
      await new Promise(r => {
        const w = () => { woke = true; wakers.delete(w); r(); };
        wakers.add(w);
        setTimeout(() => { wakers.delete(w); r(); }, secs * 1000);
      });
    }
    const view = await ask('look', {});
    text = (woke ? '' : 'You wait ' + secs + ' seconds. Nobody speaks.\n\n') + (view || PAGE_DOWN);
  } else if (verb === 'leave') {
    if (!visit) return 'You are not inside.';
    const saved = await ask('leave', {});
    const note = String(args.field_note || '').trim();
    const title = String(args.title || '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'A visit';
    if (note) {
      fs.appendFileSync(FIELD_NOTES, '\n## ' + stamp().slice(0, 10) + ': ' + title + '\n\n' + note + '\n\nRoot\n');
    }
    log({ verb, args, text: saved });
    visit = null;
    return (saved || 'The page did not answer; the last autosave stands.') + (note ? ' Your field note is written.' : ' You left no field note.');
  } else {
    text = await ask(verb, args);
    if (text === null) text = PAGE_DOWN;
  }
  log({ verb, args, text });
  return text + footer();
}

function wakeListeners() { for (const w of [...wakers]) w(); }

function writeWorld(data) {
  fs.writeFileSync(WORLD + '.tmp', data);
  for (let tries = 0; ; tries++) {   // Windows: a rename onto a file someone has open fails with EPERM, briefly
    try { fs.renameSync(WORLD + '.tmp', WORLD); return; } catch (e) {
      if (tries >= 5 || (e.code !== 'EPERM' && e.code !== 'EBUSY')) throw e;
      const until = Date.now() + 100; while (Date.now() < until) { /* short spin, rare */ }
    }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const origin = req.headers.origin;
    if (!HOSTS.includes(req.headers.host) || (origin && !PAGE_ORIGINS.includes(origin))) {
      res.writeHead(403); return res.end();
    }
    res.allowOrigin = origin;
    if (req.method === 'OPTIONS') return sendJSON(res, 204, {});
    // A JSON content type forces a browser preflight, which the origin check above then refuses.
    if (req.method === 'POST' && !String(req.headers['content-type'] || '').includes('application/json')) {
      return sendJSON(res, 415, { error: 'application/json required' });
    }
    const u = new URL(req.url, 'http://127.0.0.1');
    const url = u.pathname, page = u.searchParams.get('page');
    if (req.method === 'POST' && url === '/door') {
      const b = await body(req);
      return sendJSON(res, 200, { text: await door(String(b.verb || ''), b.args || {}, String(b.session || '')) });
    }
    if (req.method === 'GET' && url === '/page/poll') {
      if (page !== currentPage) return sendJSON(res, 409, { error: 'a newer visit page has taken over' });
      if (pagePoll) sendJSON(pagePoll, 200, {});
      pagePoll = res;
      res.on('close', () => { if (pagePoll === res) pagePoll = null; });   // never hand an action to a dead socket
      setTimeout(() => { if (pagePoll === res) { pagePoll = null; sendJSON(res, 200, {}); } }, 20000);
      return deliver();
    }
    if (req.method === 'POST' && url === '/page/result') {
      const b = await body(req);
      const w = waiting.get(b.id);
      if (w) { waiting.delete(b.id); w.resolve(String(b.text || '')); }
      return sendJSON(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url === '/page/kevin') {
      const b = await body(req);
      const t = String(b.text || '').slice(0, 1000);
      if (t) { inbox.push({ t: Date.now(), text: t }); log({ kevin: t }); }
      if (t || b.wake) wakeListeners();     // a point wakes a listening Root; the page words it on delivery
      return sendJSON(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url === '/page/load') {
      currentPage = page;                   // the newest page owns the world from here on
      if (pagePoll) { const old = pagePoll; pagePoll = null; sendJSON(old, 409, { error: 'a newer visit page has taken over' }); }
      if (!fs.existsSync(WORLD)) return sendJSON(res, 404, {});
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin || PAGE_ORIGINS[0], 'Vary': 'Origin' });
      return res.end(fs.readFileSync(WORLD));   // read whole, so no open handle blocks a concurrent save's rename
    }
    if (req.method === 'POST' && url === '/page/save') {
      if (page !== currentPage) return sendJSON(res, 409, { error: 'a newer visit page has taken over' });
      const b = await body(req);
      if (!b.snapshot || !b.root) return sendJSON(res, 400, { error: 'snapshot and root required' });
      writeWorld(JSON.stringify(b));
      return sendJSON(res, 200, { ok: true });
    }
    sendJSON(res, 404, { error: 'no such path' });
  } catch (e) {
    sendJSON(res, 500, { error: String(e && e.message || e) });
  }
});
server.requestTimeout = 0;
server.listen(PORT, '127.0.0.1', () => console.log(stamp() + ' visit relay on http://127.0.0.1:' + PORT + ', record in ' + HOME));
