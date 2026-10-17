// The visit relay: a mailbox between Root's door (door.mjs, an MCP server) and the page that owns the world
// (src/visit.js on ?visit). Zero dependencies. Root's actions queue here until the page takes them; the page's
// answers, plus anything Kevin said or pointed at, go back to Root. Root's own record (notes, the saved world,
// a log of every visit, field notes) lives under ~/root, because it is Root's life, not the product's.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = 7796;
const VISIT_MINUTES = Number(process.env.VISIT_MINUTES || 20);
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

let visit = null;          // { id, started (epoch ms), log path }
let nextId = 1;
const queue = [];          // actions waiting for the page
const waiting = new Map(); // action id -> resolve(text)
let pagePoll = null;       // the page's pending long-poll response
let inbox = [];            // what Kevin said or pointed at, not yet heard by Root
let inboxWake = null;

function log(entry) {
  if (visit) fs.appendFileSync(visit.log, JSON.stringify({ t: stamp(), ...entry }) + '\n');
}

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.end(JSON.stringify(obj));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 20e6) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function deliver() {
  if (pagePoll && queue.length) { const res = pagePoll; pagePoll = null; sendJSON(res, 200, queue.shift()); }
}

// Hand an action to the page and wait for what Root perceives back.
function ask(verb, args, timeoutMs = 25000) {
  const id = nextId++;
  queue.push({ id, verb, args });
  deliver();
  return new Promise(resolve => {
    const t = setTimeout(() => {
      waiting.delete(id);
      const qi = queue.findIndex(a => a.id === id); if (qi >= 0) queue.splice(qi, 1);
      resolve(null);
    }, timeoutMs);
    waiting.set(id, text => { clearTimeout(t); resolve(text); });
  });
}

function minutesLeft() { return visit ? VISIT_MINUTES - (Date.now() - visit.started) / 60000 : VISIT_MINUTES; }

function drainInbox() { const heard = inbox; inbox = []; return heard; }

function recentNotes(n) {
  if (!fs.existsSync(NOTES)) return [];
  return fs.readFileSync(NOTES, 'utf8').trim().split('\n').filter(Boolean).slice(-n).map(l => JSON.parse(l));
}

async function arrive() {
  const started = Date.now();
  visit = { id: stamp().slice(0, 16).replace(':', ''), started, log: null };
  visit.log = path.join(HOME, visit.id + '.jsonl');
  const history = await ask('arrive', {});
  if (history === null) { visit = null; return null; }
  const view = await ask('look', {});
  const notes = recentNotes(12);
  const parts = ['You step through the door. You have ' + VISIT_MINUTES + ' minutes here.'];
  if (notes.length) parts.push('Your notes from before:\n' + notes.map(n => '- [' + n.t.slice(0, 10) + '] ' + n.text).join('\n'));
  else parts.push('This is your first visit. You have no notes yet.');
  if (history) parts.push(history);
  parts.push(view);
  log({ verb: 'arrive' });
  return parts.join('\n\n');
}

const PAGE_DOWN = 'The door is open but the world is not: the page is not running or is still forming. ' +
  'Ask Kevin to open the visit page, then try again.';

// One call from Root's door. Returns the text Root perceives.
async function door(verb, args) {
  if (!visit && verb !== 'leave') {
    const a = await arrive();
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
  if (verb === 'note') {
    const t = String(args.text || '').trim();
    if (!t) return 'An empty note.' + footer();
    fs.appendFileSync(NOTES, JSON.stringify({ t: stamp(), visit: visit && visit.id, text: t }) + '\n');
    text = 'Noted. It will be with you next visit.';
  } else if (verb === 'listen') {
    const secs = Math.max(5, Math.min(120, Number(args.seconds) || 30));
    if (!inbox.length) await new Promise(r => { inboxWake = r; setTimeout(r, secs * 1000); });
    inboxWake = null;
    const view = await ask('look', {});
    text = (inbox.length ? '' : 'You wait ' + secs + ' seconds. Nobody speaks.\n\n') + (view || PAGE_DOWN);
  } else if (verb === 'leave') {
    if (!visit) return 'You are not inside.';
    const saved = await ask('leave', {});
    const note = String(args.field_note || '').trim(), title = String(args.title || 'A visit').trim();
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

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return sendJSON(res, 204, {});
    const url = req.url.split('?')[0];
    if (req.method === 'POST' && url === '/door') {
      const b = await body(req);
      return sendJSON(res, 200, { text: await door(String(b.verb || ''), b.args || {}) });
    }
    if (req.method === 'GET' && url === '/page/poll') {
      if (pagePoll) sendJSON(pagePoll, 200, {});        // a newer poll replaces a stale one (page reload)
      pagePoll = res;
      const mine = res;
      setTimeout(() => { if (pagePoll === mine) { pagePoll = null; sendJSON(mine, 200, {}); } }, 20000);
      return deliver();
    }
    if (req.method === 'POST' && url === '/page/result') {
      const b = await body(req);
      const w = waiting.get(b.id);
      if (w) { waiting.delete(b.id); w(String(b.text || '')); }
      return sendJSON(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url === '/page/kevin') {
      const b = await body(req);
      const t = String(b.text || '').slice(0, 1000);
      if (t) { inbox.push(t); log({ kevin: t }); if (inboxWake) inboxWake(); }
      return sendJSON(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url === '/page/load') {
      if (!fs.existsSync(WORLD)) return sendJSON(res, 404, {});
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return fs.createReadStream(WORLD).pipe(res);
    }
    if (req.method === 'POST' && url === '/page/save') {
      const b = await body(req);
      if (!b.snapshot || !b.root) return sendJSON(res, 400, { error: 'snapshot and root required' });
      fs.writeFileSync(WORLD + '.tmp', JSON.stringify(b));
      fs.renameSync(WORLD + '.tmp', WORLD);
      return sendJSON(res, 200, { ok: true });
    }
    sendJSON(res, 404, { error: 'no such path' });
  } catch (e) {
    sendJSON(res, 500, { error: String(e && e.message || e) });
  }
});
server.requestTimeout = 0;
server.listen(PORT, '127.0.0.1', () => console.log(stamp() + ' visit relay on http://127.0.0.1:' + PORT + ', record in ' + HOME));
