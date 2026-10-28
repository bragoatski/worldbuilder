// The guest link (Ketch'em mechanics 26): a second person plays the guest seat from another screen. Kevin's page is
// the game: it seats a remote guest, sends this server a picture of the guest's corner of the world and the guest's
// numbers a few times a second, and takes the guest's keys and answers back. The guest's page only shows the picture
// and sends input. No game logic lives here: it is a mailbox between two pages.
//
// Two listeners, so exposing one can never expose the other:
// - the guest port (GUEST_PORT, default 7797; GUEST_HOST, default 127.0.0.1): the guest's page, /frame and /input,
//   behind a six-digit join code, with wrong guesses rate-limited. Opening it to other devices (GUEST_HOST, or a
//   `tailscale serve` in front of it) is the owner's call, not this file's.
// - the host port (7798, always 127.0.0.1): Kevin's page opens and feeds the link here. It refuses other Host headers
//   (DNS rebinding), browser calls from any origin but this machine's dev page, and posts that are not JSON (so a
//   foreign page cannot send a simple cross-site request); every call after /host/open carries the session key it
//   returned, so a second tab cannot take the link over.
//
// Run: node visit/guest-link.mjs
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const MAX_BODY = 2e6, MAX_INPUTS = 200, HOST_PORT_DEFAULT = 7798;
const WRONG_LIMIT = 20, WRONG_WINDOW = 60000, LOCKOUT = 60000;   // per guest address: 20 wrong codes a minute, then a minute's pause
function stamp() {   // local time with its offset (the owner reads these)
  const d = new Date(), o = -d.getTimezoneOffset(), p = n => String(Math.abs(n)).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + (o >= 0 ? '+' : '-') + p(Math.floor(Math.abs(o) / 60)) + ':' + p(Math.abs(o) % 60);
}

export function createGuestLink(opts = {}) {
  const guestInfo = { host: opts.guestHost || '127.0.0.1', port: opts.guestPort || 7797 };
  const S = { code: null, key: null, frame: null, state: null, inputs: [], guestSeen: 0, frameAt: 0 };
  const wrong = new Map();   // guest address -> { n, since, until }
  const send = (res, code, obj, origin) => {
    if (res.writableEnded) return;
    const h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    if (origin) { h['Access-Control-Allow-Origin'] = origin; h['Access-Control-Allow-Headers'] = 'Content-Type'; h.Vary = 'Origin'; }
    res.writeHead(code, h); res.end(obj === undefined ? '' : JSON.stringify(obj));
  };
  const body = req => new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > MAX_BODY) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('not JSON')); } });
    req.on('error', reject);
  });
  const localOrigin = o => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o || '');
  const clear = () => { S.code = null; S.key = null; S.frame = null; S.state = null; S.inputs = []; S.guestSeen = 0; };

  // ---------- the host side ----------
  const hostServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'), path = url.pathname, origin = req.headers.origin;
    try {
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) return send(res, 403, { error: 'this machine only' });
      if (origin && !localOrigin(origin)) return send(res, 403, { error: 'this machine only' });
      if (req.method === 'OPTIONS') return send(res, 204, undefined, origin);
      if (req.method === 'POST' && !/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'JSON only' }, origin);
      if (path === '/host/hello') return send(res, 200, { ok: true, open: !!S.code, guest: guestInfo }, origin);
      if (req.method !== 'POST') return send(res, 405, { error: 'POST' }, origin);
      const b = await body(req);
      if (path === '/host/open') {
        if (S.code && S.key !== b.key && Date.now() - S.frameAt < 10000) return send(res, 409, { error: 'a guest link is open in another tab' }, origin);
        if (!/^\d{6}$/.test(String(b.code || ''))) return send(res, 400, { error: 'a code of six digits' }, origin);
        clear(); S.code = String(b.code); S.key = randomBytes(16).toString('hex'); S.frameAt = Date.now();
        return send(res, 200, { ok: true, key: S.key, guest: guestInfo }, origin);
      }
      if (!S.key || b.key !== S.key) return send(res, 403, { error: 'not the open session' }, origin);
      if (path === '/host/close') { clear(); return send(res, 200, { ok: true }, origin); }
      if (path === '/host/frame') {
        if (typeof b.jpeg === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(b.jpeg)) S.frame = b.jpeg;
        if (b.state && typeof b.state === 'object') S.state = b.state;
        S.frameAt = Date.now();
        const inputs = S.inputs; S.inputs = [];
        return send(res, 200, { inputs, guestSeen: S.guestSeen }, origin);
      }
      return send(res, 404, { error: 'no such host call' }, origin);
    } catch (e) { return send(res, 400, { error: String(e && e.message || e) }, origin); }
  });

  // ---------- the guest side ----------
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'), path = url.pathname;
    try {
      if (path === '/' || path === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(GUEST_PAGE); }
      if (path !== '/frame' && path !== '/input') return send(res, 404, { error: 'not here' });
      const who = req.socket.remoteAddress || '?', now = Date.now(), w = wrong.get(who);
      if (w && w.until > now) return send(res, 429, { error: 'too many wrong codes; wait a minute' });
      if (!S.code || url.searchParams.get('code') !== S.code) {   // one answer for no game and a wrong code: a guess learns nothing
        const r = w && now - w.since < WRONG_WINDOW ? w : { n: 0, since: now, until: 0 };
        r.n++; if (r.n >= WRONG_LIMIT) r.until = now + LOCKOUT; wrong.set(who, r);
        return send(res, 403, { error: 'no game here with that code' });
      }
      S.guestSeen = now;
      if (path === '/frame') return send(res, 200, { jpeg: S.frame, state: S.state, fresh: now - S.frameAt < 3000 });
      if (req.method !== 'POST') return send(res, 405, { error: 'POST' });
      const b = await body(req);
      for (const ev of Array.isArray(b.events) ? b.events.slice(0, 50) : []) {
        if (!ev || typeof ev !== 'object') continue;
        const t = String(ev.t || '');
        if (t === 'down' || t === 'up') S.inputs.push({ t, key: String(ev.key || '').slice(0, 16) });
        else if (t === 'answer' || t === 'cmd') S.inputs.push({ t, id: Number(ev.id) || 0, text: ev.text === null ? null : String(ev.text || '').slice(0, 80) });
      }
      if (S.inputs.length > MAX_INPUTS) S.inputs.splice(0, S.inputs.length - MAX_INPUTS);
      return send(res, 200, { ok: true });
    } catch (e) { return send(res, 400, { error: String(e && e.message || e) }); }
  });
  return { server, hostServer, state: S, HOST_PORT: HOST_PORT_DEFAULT };
}

// The guest's page: the picture, the numbers, a question box, a command line for the store, and buttons for a phone.
// Plain HTML; colours as tokens with a dark default; no external requests.
const GUEST_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>Ketch'em guest</title><style>
:root{--bg:#0b1016;--panel:#111820;--border:#1f2a37;--hi:#283850;--fg:#e6edf3;--dim:#7b8da4;--faint:#4a5568;--green:#58d27a;--amber:#e8a838}
:root[data-theme="light"]{--bg:#f4f6f8;--panel:#ffffff;--border:#d6dde5;--hi:#b9c4d0;--fg:#10141c;--dim:#4a5568;--faint:#7b8da4}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){--bg:#f4f6f8;--panel:#ffffff;--border:#d6dde5;--hi:#b9c4d0;--fg:#10141c;--dim:#4a5568;--faint:#7b8da4}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.45 ui-monospace,"JetBrains Mono",monospace;padding:12px 16px;max-width:760px;margin:0 auto}
h1{font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin:0 0 10px}
.card{background:var(--panel);border:1px solid var(--hi);border-radius:10px;padding:10px 12px;margin-bottom:10px}
input,button{font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--hi);border-radius:6px;padding:7px 9px}
button{cursor:pointer;background:transparent}button:active{background:rgba(255,255,255,.08)}
#view{width:100%;aspect-ratio:1;image-rendering:pixelated;border-radius:8px;border:1px solid var(--border);background:#000;display:block}
#bar{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center}#bar b{color:var(--green)}#msg{color:var(--amber);min-height:1.4em;margin-top:6px}
#party{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}#party span{border:1px solid var(--border);border-radius:6px;padding:2px 7px;color:var(--dim)}
#q[hidden],#join[hidden],#game[hidden]{display:none}#q label{display:block;color:var(--dim);margin-bottom:6px}.row{display:flex;gap:8px}.row input{flex:1;min-width:0}
#pad{display:grid;grid-template-columns:repeat(3,56px);grid-template-rows:repeat(3,56px);gap:6px}#pad button{font-size:18px}
#acts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;flex:1;min-width:0}#acts button,#more button{padding:7px 4px;min-width:0}#controls{display:flex;gap:12px;align-items:flex-start}
.keys{color:var(--faint);font-size:11px;margin-top:8px}#stale{color:var(--faint)}#shop,#alm{white-space:pre-wrap;margin:8px 0 0;color:var(--dim);font:inherit}
#more{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-top:10px}
</style></head><body>
<h1>Ketch'em, the guest seat</h1>
<div id="join" class="card"><label for="code">The join code on the host's screen</label><div class="row" style="margin-top:6px"><input id="code" inputmode="numeric" autocomplete="off"><button id="go">Join</button></div><div id="joinMsg" class="keys"></div></div>
<div id="game" hidden>
<img id="view" alt="Your corner of the world">
<div class="card"><div id="bar"></div><div id="party"></div><div id="msg"></div><pre id="shop" hidden></pre><pre id="alm" hidden></pre><div id="stale"></div></div>
<div id="q" class="card" hidden><label id="qText"></label><div class="row"><input id="qIn" autocomplete="off"><button id="qOk">OK</button><button id="qNo">Skip</button></div></div>
<div class="card"><div id="controls"><div id="pad">
<span></span><button data-k="ArrowUp" aria-label="Up">&#8593;</button><span></span>
<button data-k="ArrowLeft" aria-label="Left">&#8592;</button><span></span><button data-k="ArrowRight" aria-label="Right">&#8594;</button>
<span></span><button data-k="ArrowDown" aria-label="Down">&#8595;</button><span></span></div>
<div id="acts"><button data-k=".">Target</button><button data-k="/">Throw</button><button data-k="]">Stone</button>
<button data-k="'">Name</button><button data-k=";">Use</button><button data-k=",">Follow</button>
<button data-k="l">Potion</button><button data-k="k">Pack</button><button data-k="[">Stone back</button></div></div>
<div id="more"><button data-seq="j 1">Bait plant</button><button data-seq="j 2">Scatter</button><button data-seq="j 3">Bait meat</button><button data-seq="j 4">Stake</button>
<button data-k="h">Give</button><button data-k="u">Feed</button><button data-k="y">Almanac</button></div>
<div class="row" style="margin-top:10px"><input id="cmd" placeholder="give coins 5, feed Moss; at a store: buy Geode 2, sell Moss" autocomplete="off"><button id="cmdGo">Send</button></div>
<div class="keys">Keys: arrows move, . target, / throw, [ ] stone, ' name, ; pick or the store, , follow, L then a number for a potion, K the pack, J bait (1 plant, 2 scatter, 3 meat, 4 stake, then an arrow, or ; for here), H give to the host, U feed, Y the Almanac. A bait button waits for an arrow or Use.</div></div>
</div>
<script>
const $=id=>document.getElementById(id);let code=new URLSearchParams(location.search).get('code')||'';let lastQ=0,answeredAt=0,out=[],busy=false,running=false;const held=new Set();
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function push(ev){out.push(ev);flush();}
async function flush(){if(busy||!out.length)return;busy=true;const events=out.splice(0,50);let sent=false;try{sent=(await fetch('/input?code='+encodeURIComponent(code),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events})})).ok;}catch(e){}
  busy=false;if(!sent){out.unshift(...events);return setTimeout(flush,500);}if(out.length)flush();}   // a failed send is sent again, so a key is never left down
async function tick(){
  try{const r=await fetch('/frame?code='+encodeURIComponent(code));
    if(r.status===403||r.status===429){running=false;releaseAll();$('game').hidden=true;$('join').hidden=false;$('joinMsg').textContent=(await r.json()).error;return;}
    const d=await r.json();if(d.jpeg)$('view').src=d.jpeg;const s=d.state||{};
    $('stale').textContent=d.fresh?'':'waiting for the host';
    $('bar').innerHTML='<b>'+esc(s.name||'Guest')+'</b> '+esc(s.wallet||0)+' coins &middot; '+['Amber','Geode','Obsidian'].map(n=>esc((s.stone===n?'['+n+' ':n+' ')+((s.stones||{})[n.toLowerCase()]||0)+(s.stone===n?']':''))).join(' ')+' &middot; pack '+esc(s.pack||'');
    $('party').innerHTML=(s.party||[]).map(c=>'<span>'+esc(c)+'</span>').join('');
    $('msg').textContent=s.msg||'';$('shop').textContent=s.shop||'';$('shop').hidden=!s.shop;$('alm').textContent=s.almanac||'';$('alm').hidden=!s.almanac;
    const q=s.question;
    if(q&&(q.id!==lastQ||(answeredAt&&Date.now()-answeredAt>2500))){lastQ=q.id;answeredAt=0;$('qText').textContent=q.text;$('qIn').value=q.initial||'';$('q').hidden=false;$('qIn').focus();}   // an answer that never arrived: ask again
    if(!q&&!$('q').hidden&&lastQ){$('q').hidden=true;}
  }catch(e){$('stale').textContent='the host is not answering';}
  if(running)setTimeout(tick,200);
}
function answer(t){push({t:'answer',id:lastQ,text:t});answeredAt=Date.now();$('q').hidden=true;}
$('qOk').onclick=()=>answer($('qIn').value);$('qNo').onclick=()=>answer(null);
$('qIn').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();answer($('qIn').value);}else if(e.key==='Escape'){e.preventDefault();answer(null);}e.stopPropagation();});
$('cmd').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('cmdGo').click();}e.stopPropagation();});
$('cmdGo').onclick=()=>{const t=$('cmd').value.trim();if(t){push({t:'cmd',text:t});$('cmd').value='';}};
const KEYS=new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','.','/','[',']',"'",';',',','l','k','j','h','u','y','1','2','3','4','5','6','7','8','9']);
const norm=k=>k.length===1?k.toLowerCase():k;   // Caps Lock does not change L or K
function down(k){if(held.has(k))return;held.add(k);push({t:'down',key:k});}
function up(k){if(!held.has(k))return;held.delete(k);push({t:'up',key:k});}
function releaseAll(){for(const k of[...held])up(k);}
window.addEventListener('keydown',e=>{const k=norm(e.key);if($('game').hidden||!KEYS.has(k))return;e.preventDefault();if(e.repeat)return;down(k);});
window.addEventListener('keyup',e=>{const k=norm(e.key);if($('game').hidden||!KEYS.has(k))return;up(k);});
window.addEventListener('blur',releaseAll);document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseAll();});   // a key released while away still lets go
for(const b of document.querySelectorAll('[data-k]')){const k=b.dataset.k;
  b.addEventListener('pointerdown',e=>{e.preventDefault();down(k);});
  for(const ev of['pointerup','pointerleave','pointercancel'])b.addEventListener(ev,()=>up(k));}
for(const b of document.querySelectorAll('[data-seq]'))b.addEventListener('click',e=>{e.preventDefault();for(const k of b.dataset.seq.split(' ')){push({t:'down',key:k});push({t:'up',key:k});}});   // a bait button: J and the kind, then an arrow or Use picks the tile
function join(){code=$('code').value.trim()||code;if(!code)return;history.replaceState(null,'','?code='+encodeURIComponent(code));lastQ=0;answeredAt=0;$('join').hidden=true;$('game').hidden=false;if(!running){running=true;tick();}}
$('go').onclick=join;$('code').addEventListener('keydown',e=>{if(e.key==='Enter')join();});
if(code){$('code').value=code;join();}
</script></body></html>`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const PORT = +(process.env.GUEST_PORT || 7797), HOST = process.env.GUEST_HOST || '127.0.0.1';
  const { server, hostServer, HOST_PORT } = createGuestLink({ guestHost: HOST, guestPort: PORT });
  const busy = e => { if (e.code === 'EADDRINUSE') { console.log(stamp() + ' guest link already running'); process.exit(0); } throw e; };
  server.on('error', busy); hostServer.on('error', busy);
  hostServer.listen(HOST_PORT, '127.0.0.1', () => server.listen(PORT, HOST, () => console.log(stamp() + ' guest link: the guest opens http://' + HOST + ':' + PORT + ' ; the host side is on 127.0.0.1:' + HOST_PORT + ' only')));
}
