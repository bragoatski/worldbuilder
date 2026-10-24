// The visit relay: a mailbox between Root's door (door.mjs, an MCP server) and the Worldbuilder page.
// Zero dependencies. The Vite dev server starts it (vite.config.js), so the normal game can offer a
// "Call Root" button: the page asks the relay to summon Root, the relay launches a Claude session whose
// only tools are the door's, and Root's actions queue here until the page carries them out.
// Root's own record (notes, visit logs, field notes, what it left in each world) lives under ~/root.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MODES, modeOf, verbsFor } from './modes.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = 7796;
// Only a local page may talk to the relay from a browser. Without this, any website open in Kevin's browser
// could POST a fake "Kevin says" line into Root's context. Requests with no Origin come from local processes
// (the door), which already run as Kevin.
const PAGE_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/;
const HOSTS = ['127.0.0.1:' + PORT, 'localhost:' + PORT];   // refuses DNS-rebinding hosts
// No time limit by default (owner ruling 2026-10-17): Root stays until it leaves or Kevin sends it home. Kevin sees
// the cost instead, as a token counter. VISIT_MINUTES (rehearsals) restores a limit.
const VISIT_MINUTES = Number(process.env.VISIT_MINUTES || 0);
const GRACE_MINUTES = 5;      // with a limit: after time is up, this long to say goodbye; then only leave works
const HOME_GRACE_MS = 3 * 60000;   // after "send Root home", the session is ended if Root has not left by then
// VISIT_ROOT points a rehearsal at a scratch folder so a test never writes Root's real record.
const ROOT_DIR = process.env.VISIT_ROOT || path.join(os.homedir(), 'root');
const HOME = path.join(ROOT_DIR, 'visits');
const WORLDS = path.join(HOME, 'worlds');   // what Root left in each world, keyed by seed + size
const NOTES = path.join(HOME, 'notes.jsonl');
const GUIDE = path.join(HOME, 'field-guide.json');   // every named species Root has seen, across all worlds
const FIELD_NOTES = path.join(ROOT_DIR, 'field-notes', 'field-notes.md');
fs.mkdirSync(WORLDS, { recursive: true });
fs.mkdirSync(path.dirname(FIELD_NOTES), { recursive: true });

// The Claude executable. On Windows `claude` is a .cmd shim that would need a shell (and its quoting);
// launch the real binary behind it instead.
function claudeBin() {
  if (process.env.VISIT_CLAUDE) return process.env.VISIT_CLAUDE;
  if (process.platform === 'win32' && process.env.APPDATA) {
    const exe = path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return 'claude';
}

// West-coast local time with an explicit offset (global rule: display local, compute UTC).
function stamp(d = new Date()) {
  const off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-', a = Math.abs(off);
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' +
    p(d.getMinutes()) + ':' + p(d.getSeconds()) + sign + p(a / 60 | 0) + ':' + p(a % 60);
}

let visit = null;          // { id, started (epoch ms), log path, session, mode, dismissed (epoch ms) }
let child = null;          // the summoned Claude session, while it runs
let summonedMode = null;   // the mode the running session was launched in; the door must agree with it
let nextId = 1;
const queue = [];          // actions waiting for the page
const waiting = new Map(); // action id -> { resolve, taken }
let pagePoll = null;       // the current page's pending long-poll response
let currentPage = null;    // the newest page; an older tab is told to stand down
let inbox = [];            // [{ t, text }] what Kevin said, not yet heard by Root
const wakers = new Set();  // listen calls waiting for Kevin

function log(entry) {
  if (visit) fs.appendFileSync(visit.log, JSON.stringify({ t: stamp(), ...entry }) + '\n');
}

function sendJSON(res, code, obj) {
  if (res.writableEnded) return;
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': res.allowOrigin || 'http://localhost:5173',
    'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' });
  res.end(JSON.stringify(obj));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.setEncoding('utf8');   // never split a multibyte character across chunks
    req.on('data', c => { s += c; if (s.length > 2e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function deliver() {
  if (!pagePoll || !queue.length) return;
  const res = pagePoll; pagePoll = null;
  const a = queue.shift();
  const w = waiting.get(a.id); if (w) w.taken = true;
  sendJSON(res, 200, a);
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

function minutesLeft() {
  if (!VISIT_MINUTES) return Infinity;
  return visit ? VISIT_MINUTES - (Date.now() - visit.started) / 60000 : VISIT_MINUTES;
}

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

const PAGE_DOWN = 'The door is open but the world is not: the Worldbuilder page is not open, or there is no ground yet. ' +
  'Try again in a moment.';

async function arrive(session, mode) {
  visit = { id: stamp().slice(0, 16).replace(':', ''), started: Date.now(), log: null, session, mode, dismissed: 0 };
  visit.log = path.join(HOME, visit.id + '.jsonl');
  try {
    const history = await ask('arrive', { mode }, 90000);   // the page may wait for ground to rise
    if (history === null || history === '\u0000no-ground') { visit = null; return null; }
    const view = await ask('look', {});
    const notes = recentNotes(12);
    const opener = mode === 'sky' ? 'The sky opens below you. ' : 'You step through the door. ';
    const parts = [opener + (VISIT_MINUTES ? 'You have ' + VISIT_MINUTES + ' minutes here.' : 'Stay as long as you like.')];
    if (notes.length) parts.push('Your notes from before:\n' + notes.map(n => '- [' + String(n.t).slice(0, 10) + '] ' + n.text).join('\n'));
    else parts.push('This is your first visit. You have no notes yet.');
    if (history) parts.push(history);
    parts.push(view || PAGE_DOWN);
    log({ verb: 'arrive', mode });
    return parts.join('\n\n');
  } catch (e) { visit = null; throw e; }
}

// Each door process (one Claude session) carries its own session id. A call from a new session while an old
// visit is still open means that session died without leaving: close it and arrive fresh.
// The door serves one mode's tools; the relay still refuses any verb outside the mode it launched, so a tool
// name guessed at by the model (or a door started by hand in another mode) does nothing.
async function door(verb, args, session, mode) {
  mode = modeOf(summonedMode || mode);
  if (!verbsFor(mode).includes(verb)) return 'nothing happens ("' + verb + '" is not a thing a ' + mode + ' can do)';
  if (visit && visit.session !== session) { log({ verb: 'abandoned' }); visit = null; }
  if (!visit && verb !== 'leave') {
    const a = await arrive(session, mode);
    if (a === null) return PAGE_DOWN;
    if (verb === 'look' || verb === 'survey') return a + footer();
    return a + '\n\n---\n\n' + await act(verb, args);
  }
  return await act(verb, args);
}

function footer() {
  const heard = drainInbox();
  const left = minutesLeft();
  let s = '';
  if (heard.length) s += '\n' + heard.join('\n');
  if (visit && visit.dismissed) s += '\n\n(Kevin asks you to head home. Say goodbye if you like, then CALL leave with your field note. Ending your turn without leave loses the note.)';
  else if (VISIT_MINUTES) s += left > 0 ? '\n\n(' + Math.max(1, Math.round(left)) + ' min left)' : '\n\n(Your time here is up. Say goodbye if you like, then leave with your field note.)';
  // Root sees its own running cost, so a token budget Kevin sets is one Root can keep (and never has to guess at:
  // the first real visit ran 1.5M against a 1M ask and its field note claimed it left "well before" the budget).
  // Counted from the session's usage reports, so it trails the current step by one reply.
  if (tokens) s += '\n(' + fmtTok(tokens) + ' tok)';
  return s;
}

function fmtTok(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.round(n / 1e3) + 'k'; }

async function act(verb, args) {
  let text;
  const closing = (visit && visit.dismissed) || (VISIT_MINUTES && minutesLeft() < -GRACE_MINUTES);
  if (closing && !['leave', 'say', 'note'].includes(verb)) {
    return 'The world has gone still around you; it is time to go. Leave with your field note.';
  }
  // Any action may carry words for Kevin: spoken first, in the same step, so talking costs no extra reply.
  if (args.say && verb !== 'say' && verb !== 'leave') await ask('say', { text: String(args.say) });
  if (verb === 'guide') {
    text = guideAct(args);
  } else if (verb === 'note') {
    const t = String(args.text || '').trim();
    if (!t) return 'empty note' + footer();
    fs.appendFileSync(NOTES, JSON.stringify({ t: stamp(), visit: visit && visit.id, text: t }) + '\n');
    text = 'noted';
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
    text = (woke ? '' : 'quiet ' + secs + 's\n') + (view || PAGE_DOWN);
  } else if (verb === 'leave') {
    if (!visit) return 'You are not inside.';
    const mode = visit.mode;   // read before the await: the session's close handler may null the visit meanwhile
    const saved = await ask('leave', {});
    const note = String(args.field_note || '').trim();
    const title = String(args.title || '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'A visit';
    if (note) {   // a visitor's note is headed as before; the other modes name themselves
      const as = mode && mode !== 'visitor' ? ' (as ' + MODES[mode].label + ')' : '';
      fs.appendFileSync(FIELD_NOTES, '\n## ' + stamp().slice(0, 10) + ': ' + title + as + '\n\n' + note + '\n\nRoot\n');
    }
    log({ verb, args, text: saved });
    visit = null;
    return (saved || 'The page did not answer.') + (note ? ' Your field note is written.' : ' You left no field note.');
  } else {
    text = await ask(verb, args);
    if (text === null) text = PAGE_DOWN;
  }
  log({ verb, args, text });
  return text + footer();
}

// ---- Root's field guide ----
function readGuide() {
  try { return JSON.parse(fs.readFileSync(GUIDE, 'utf8')); } catch { return { entries: {} }; }
}
function writeGuide(g) { fs.writeFileSync(GUIDE + '.tmp', JSON.stringify(g, null, 1)); fs.renameSync(GUIDE + '.tmp', GUIDE); }

// Merge one look's sightings; returns the names that are new to the guide.
function recordSightings(list, world, tick) {
  if (!Array.isArray(list) || !list.length) return [];
  const g = readGuide(), fresh = [];
  for (const x of list.slice(0, 40)) {
    const key = String(x.key || '').slice(0, 64), name = String(x.name || '').slice(0, 60);
    if (!key || !name) continue;
    const e = g.entries[key];
    if (e) { e.seen++; e.last = { t: stamp(), world }; continue; }
    g.entries[key] = { name, type: String(x.type || ''), first: { t: stamp(), world, tick, biome: String(x.biome || '') }, seen: 1, last: { t: stamp(), world }, note: '' };
    fresh.push(name + ' (' + String(x.type || '?').slice(0, 1).toUpperCase() + ')');
  }
  writeGuide(g);
  return fresh;
}

function guideAct(args) {
  const g = readGuide(), list = Object.values(g.entries);
  if (args.species) {
    const want = String(args.species).toLowerCase().trim();
    const e = list.find(x => x.name.toLowerCase() === want);
    if (!e) return 'no "' + args.species + '" in your guide';
    if (args.note == null) return guideLine(e);
    e.note = String(args.note).replace(/\s+/g, ' ').trim().slice(0, 200);
    writeGuide(g);
    return 'noted under ' + e.name;
  }
  if (!list.length) return 'your guide is empty: species get names once a lineage is a few generations old';
  return list.length + ' species\n' + list.map(guideLine).join('\n');
}
function guideLine(e) {
  return e.name + ' ' + (e.type || '?').slice(0, 1).toUpperCase() + ' x' + e.seen + ' first ' + e.first.biome + ' ' + String(e.first.t).slice(0, 10) +
    (e.note ? ': ' + e.note : '');
}

function wakeListeners() { for (const w of [...wakers]) w(); }

// Launch Root: a headless Claude session whose only tools are the door's. --setting-sources user keeps Root's
// own global layer (identity, memory) but not ~/CLAUDE.md, the phone bridge's rules. The session's full
// transcript is kept beside the visit log.
// Tokens processed by the current visit's session: input + cache writes + cache reads + output, per model reply.
// The stream repeats a reply's usage once per content block, so each reply id counts once.
let tokens = 0;
const tokenIds = new Set();
function countTokens(line) {
  let e;
  try { e = JSON.parse(line); } catch { return; }
  const m = e && e.type === 'assistant' && e.message;
  if (!m || !m.usage || tokenIds.has(m.id)) return;
  tokenIds.add(m.id);
  const u = m.usage;
  tokens += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
}

// Which model Root visits on, chosen per visit from the page. Tokens are tokens on any model; the cheaper models
// make each one cost less. Sonnet is the default (owner ask 2026-10-18: "far cheaper").
const MODELS = { opus: 'opus', sonnet: 'sonnet', haiku: 'haiku' };

// The brief Root is launched with: the common part (identity, how a visit works, the sense code) plus the
// mode's own part (its tools, its way of seeing). Composed at summon so a brief edit needs no relay restart.
function composeBrief(mode) {
  const text = fs.readFileSync(path.join(DIR, 'briefs', 'common.md'), 'utf8').trim() + '\n\n' +
    fs.readFileSync(path.join(DIR, 'briefs', MODES[mode].brief), 'utf8').trim() + '\n';
  const f = path.join(os.tmpdir(), 'root-brief-' + mode + '.md');
  fs.writeFileSync(f, text);
  return f;
}

function summon(model, mode) {
  if (child) return false;
  mode = modeOf(mode);
  const cfg = path.join(os.tmpdir(), 'root-door-mcp.json');
  fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { door: { command: process.execPath, args: [path.join(DIR, 'door.mjs')], env: { VISIT_MODE: mode } } } }));
  // The slim launch: the visit brief REPLACES the default system prompt and only local settings load, so no
  // CLAUDE.md or coding rules ride along. Measured 2026-10-18: standing context 13.4k -> 3.2k tokens, and the
  // standing context was half of the first real visit's 1.5M (it is re-read on every reply).
  const args = ['-p', '--allowedTools', 'mcp__door', '--tools=', '--setting-sources', 'local',
    '--mcp-config', cfg, '--strict-mcp-config', '--system-prompt-file', composeBrief(mode),
    '--output-format', 'stream-json', '--verbose',
    '--model', process.env.VISIT_MODEL || MODELS[model] || MODELS.sonnet];
  args.push(mode === 'sky' ? 'Kevin has opened the sky for you. The world is below.' : 'Kevin has called you in. The door is in front of you.');   // after a single-value flag: never eaten by a variadic one
  const out = fs.openSync(path.join(HOME, stamp().slice(0, 16).replace(':', '') + '.session.jsonl'), 'a');
  const env = { ...process.env }; delete env.CLAUDECODE;   // a fresh session, not a nested one
  child = spawn(claudeBin(), args, { cwd: HOME, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  summonedMode = mode;   // only once a session exists to be in that mode
  const me = child;
  tokens = 0; tokenIds.clear();
  // Keep the transcript, and count what the visit costs from the session's own usage reports.
  let partial = '';
  child.stdout.on('data', chunk => {
    fs.writeSync(out, chunk);
    partial += chunk.toString('utf8');
    const lines = partial.split('\n'); partial = lines.pop();
    for (const line of lines) countTokens(line);
  });
  child.stderr.on('data', chunk => fs.writeSync(out, chunk));
  const done = () => {
    if (child !== me) return;
    child = null; summonedMode = null; fs.closeSync(out);
    if (visit) { log({ verb: 'ended without leaving' }); visit = null; }
  };
  child.on('close', done);   // after its output is drained, so the last usage report is counted
  child.on('error', e => { fs.writeSync(out, JSON.stringify({ relay_error: String(e.message) }) + '\n'); done(); });
  return true;
}

function endSession() {
  if (!child) return;
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {});
  else child.kill();
}

function sendHome() {
  if (visit && !visit.dismissed) {
    visit.dismissed = Date.now();
    log({ kevin: 'sent Root home' });
    wakeListeners();
    const me = child;
    setTimeout(() => { if (child && child === me) endSession(); }, HOME_GRACE_MS);
  } else if (!visit) endSession();   // still starting up and not yet through the door: just stop it
}

function stateFile(key) { return /^[\w-]{1,64}$/.test(key || '') ? path.join(WORLDS, key + '.json') : null; }

const server = http.createServer(async (req, res) => {
  try {
    const origin = req.headers.origin;
    if (!HOSTS.includes(req.headers.host) || (origin && !PAGE_ORIGIN.test(origin))) {
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
    const stale = () => page !== currentPage;
    if (req.method === 'POST' && url === '/door') {
      const b = await body(req);
      return sendJSON(res, 200, { text: await door(String(b.verb || ''), b.args || {}, String(b.session || ''), String(b.mode || '')) });
    }
    if (req.method === 'GET' && url === '/page/hello') {
      currentPage = page;                   // the newest page is where Root lives from here on
      if (pagePoll) { const old = pagePoll; pagePoll = null; sendJSON(old, 409, { error: 'a newer page has taken over' }); }
      return sendJSON(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url === '/page/status') {
      return sendJSON(res, 200, { mine: !stale(), running: !!child, present: !!visit, mode: summonedMode,
        left: visit && VISIT_MINUTES ? Math.max(0, Math.ceil(minutesLeft())) : null, leaving: !!(visit && visit.dismissed),
        tokens });
    }
    if (req.method === 'POST' && url === '/page/summon') {
      if (stale()) return sendJSON(res, 409, { error: 'a newer page has taken over' });
      const b = await body(req);
      return sendJSON(res, 200, { started: summon(String(b.model || ''), String(b.mode || '')) });
    }
    if (req.method === 'POST' && url === '/page/home') {
      if (stale()) return sendJSON(res, 409, { error: 'a newer page has taken over' });
      sendHome();
      return sendJSON(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url === '/page/poll') {
      if (stale()) return sendJSON(res, 409, { error: 'a newer page has taken over' });
      if (pagePoll) sendJSON(pagePoll, 200, {});
      pagePoll = res;
      res.on('close', () => { if (pagePoll === res) pagePoll = null; });   // never hand an action to a dead socket
      setTimeout(() => { if (pagePoll === res) { pagePoll = null; sendJSON(res, 200, {}); } }, 20000);
      return deliver();
    }
    if (req.method === 'POST' && url === '/page/result') {
      const b = await body(req);
      const w = waiting.get(b.id);
      if (w) {
        waiting.delete(b.id);
        let text = String(b.text || '');
        const fresh = recordSightings(b.sighted, String(b.world || ''), Number(b.tick) || 0);
        if (fresh.length) text += '\nnew in your guide: ' + fresh.join(', ');
        w.resolve(text);
      }
      return sendJSON(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url === '/page/kevin') {
      const b = await body(req);
      const t = String(b.text || '').slice(0, 1000);
      if (t) { inbox.push({ t: Date.now(), text: t }); log({ kevin: t }); }
      if (t || b.wake) wakeListeners();     // a point wakes a listening Root; the page words it on delivery
      return sendJSON(res, 200, { ok: true });
    }
    if (url === '/page/state') {            // what Root left in one world: names, plantings, footsteps
      const f = stateFile(u.searchParams.get('key'));
      if (!f) return sendJSON(res, 400, { error: 'bad key' });
      if (req.method === 'GET') return sendJSON(res, 200, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);   // null: never been here
      if (req.method === 'POST') {
        if (stale()) return sendJSON(res, 409, { error: 'a newer page has taken over' });
        const b = await body(req);
        fs.writeFileSync(f + '.tmp', JSON.stringify(b));
        fs.renameSync(f + '.tmp', f);
        return sendJSON(res, 200, { ok: true });
      }
    }
    sendJSON(res, 404, { error: 'no such path' });
  } catch (e) {
    sendJSON(res, 500, { error: String(e && e.message || e) });
  }
});
server.requestTimeout = 0;
server.on('error', e => {   // another relay already holds the port: that one serves, this one bows out
  if (e.code === 'EADDRINUSE') { console.log('visit relay already running on ' + PORT); process.exit(0); }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => console.log(stamp() + ' visit relay on http://127.0.0.1:' + PORT + ', record in ' + HOME));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { endSession(); process.exit(0); });
