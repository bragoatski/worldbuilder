'use strict';
// Root's visit: the assistant walks this world as a body, through a door that carries only its senses.
// The pure cores below (perceive / walkFrom / plantAt / bearing / pointText) are DOM-free and gate-tested.
// bootVisit() is the browser shell: it runs ONLY with ?visit in the URL and talks to visit/relay.mjs,
// which hands it Root's actions and carries back what Root perceives. The page owns the world: Kevin's
// own tools (the Hand, the inspector) keep working, and anything he does reaches Root only if Root can see it.
import {
  CFG, T, TNAME, W, H, chronicleNote, elev, aridity, fauna, flora, getSpeciesName, grid, idx, inb,
  landCoverage, makeFlora, riverData, seasonPhase, seasonWave, tempField, tick, volcActive,
} from './sim.js';

export const SIGHT = 4;            // Root sees a (2*SIGHT+1)^2 square around itself, nothing more
export const MAX_STRIDE = 3;       // tiles per walk call
export const PLANTS_PER_VISIT = 5;

// One glyph per biome (TNAME order). ASCII so the view costs few tokens.
const GLYPH = ['O', 'o', 'g', 'F', 'h', 'M', 'd', 'w', 'J', 'a', 's', 'V', 'G', 't', 'v', 'm'];
const STEEP = [T.MOUNTAIN, T.GLACIER, T.VOLCANIC];
const DIRS = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] };
const CREATURE = { apex: 'A', carnivore: 'C', omnivore: 'O', scavenger: 'S', herbivore: 'H' };
const CREATURE_RANK = ['apex', 'carnivore', 'omnivore', 'scavenger', 'herbivore'];

export function newVisitState() {
  return { x: -1, y: -1, places: [], planted: [], plantsThisVisit: 0 };
}

function isWaterAt(i) {
  if (grid[i] === T.OCEAN || grid[i] === T.COAST) return true;
  const rd = riverData && riverData[i];
  return !!(rd && rd.lake);
}

function blockedAt(x, y) {
  if (!inb(x, y)) return 'the edge of the world';
  const i = idx(x, y);
  if (grid[i] === T.OCEAN) return 'open ocean';
  if (grid[i] === T.COAST) return 'shallow sea';
  if (riverData && riverData[i] && riverData[i].lake) return 'a lake';
  if (volcActive[i]) return 'an active vent, too hot to cross';
  return null;
}

// The land tile closest to the world's centre: where Root first arrives.
export function arrivalTile() {
  const cx = W >> 1, cy = H >> 1;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < W * H; i++) {
    const x = i % W, y = (i / W) | 0;
    if (blockedAt(x, y) || STEEP.includes(grid[i])) continue;
    const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best < 0 ? null : { x: best % W, y: (best / W) | 0 };
}

export function bearing(dx, dy) {
  if (dx === 0 && dy === 0) return 'here';
  const parts = [];
  if (dy) parts.push(Math.abs(dy) + (dy < 0 ? 'N' : 'S'));
  if (dx) parts.push(Math.abs(dx) + (dx > 0 ? 'E' : 'W'));
  return parts.join(' ');
}

function compass(dx, dy) {
  const a = Math.atan2(-dy, dx) * 180 / Math.PI; // 0 = east, 90 = north
  const names = ['east', 'northeast', 'north', 'northwest', 'west', 'southwest', 'south', 'southeast'];
  return names[((Math.round(a / 45) % 8) + 8) % 8];
}

function tempWord(v) { return v < 2 ? 'freezing' : v < 4 ? 'cold' : v < 6 ? 'mild' : v < 8 ? 'warm' : 'hot'; }
function aridWord(v) { return v < 2 ? 'wet' : v < 4 ? 'damp' : v < 6 ? 'moderate' : v < 8 ? 'dry' : 'parched'; }

function seasonText() {
  if (!CFG.seasonalTilt) return 'No seasons turn in this world.';
  const p = seasonPhase(), w = seasonWave(p), next = seasonWave((p + 0.02) % 1);
  const trend = next > w + 1e-6 ? ', warming' : next < w - 1e-6 ? ', cooling' : '';
  const name = w > 0.5 ? 'the warm season' : w < -0.5 ? 'the cold season' : 'between seasons';
  return 'It is ' + name + trend + '.';
}

function liveFloraAt(x, y) {
  let n = 0;
  for (let k = 0; k < flora.length; k++) { const f = flora[k]; if (f && f.x === x && f.y === y) n++; }
  return n;
}

function creatureLine(f, sx, sy) {
  const e = f.maxEnergy ? f.energy / f.maxEnergy : 0.5;
  const fed = e < 0.25 ? 'starving' : e < 0.5 ? 'hungry' : 'well fed';
  const a = f.maxAge ? f.age / f.maxAge : 0;
  const life = a < 0.2 ? 'young' : a > 0.8 ? 'old' : 'adult';
  const size = f.size >= 1.7 ? 'giant ' : f.size >= 1.3 ? 'large ' : f.size <= 0.75 ? 'small ' : '';
  const sp = getSpeciesName(f);
  return '- ' + size + f.type + (sp ? ' (' + sp + ')' : '') + ' at ' + bearing(f.x - sx, f.y - sy) + ', ' + life + ', ' + fed;
}

// What Root perceives from (sx,sy): a text view of its square and nothing beyond it.
export function perceive(st) {
  const sx = st.x, sy = st.y, i0 = idx(sx, sy);
  const out = [];
  out.push('Tick ' + tick + '. ' + seasonText());
  out.push('You stand at (' + sx + ',' + sy + '): ' + TNAME[grid[i0]].toLowerCase() + ', elevation ' +
    elev[i0].toFixed(1) + ', ' + tempWord(tempField[i0]) + ', ' + aridWord(aridity[i0]) + '.');

  const seen = new Set();
  const ground = [], life = [];
  const byTile = new Map();
  for (let k = 0; k < fauna.length; k++) {
    const f = fauna[k];
    if (!f || Math.abs(f.x - sx) > SIGHT || Math.abs(f.y - sy) > SIGHT) continue;
    const key = f.y * W + f.x;
    if (!byTile.has(key)) byTile.set(key, []);
    byTile.get(key).push(f);
  }
  let plantTiles = 0, plants = 0;
  for (let dy = -SIGHT; dy <= SIGHT; dy++) {
    let g = '', l = '';
    for (let dx = -SIGHT; dx <= SIGHT; dx++) {
      const x = sx + dx, y = sy + dy;
      if (dx === 0 && dy === 0) { g += '@'; l += '@'; seen.add('@'); continue; }
      if (!inb(x, y)) { g += 'x'; l += ' '; seen.add('x'); continue; }
      const i = idx(x, y), rd = riverData && riverData[i];
      const c = volcActive[i] ? '*' : rd && rd.lake ? 'L' : rd ? '~' : GLYPH[grid[i]];
      g += c; seen.add(c);
      const here = byTile.get(i);
      if (here) {
        let top = here[0];
        for (const f of here) if (CREATURE_RANK.indexOf(f.type) < CREATURE_RANK.indexOf(top.type)) top = f;
        l += CREATURE[top.type] || '?';
      } else {
        const n = isWaterAt(i) ? 0 : liveFloraAt(x, y);
        if (n) { plantTiles++; plants += n; }
        l += n ? String(Math.min(n, 9)) : '.';
      }
    }
    ground.push(g); life.push(l);
  }
  out.push('', 'Ground (north is up, you are @):', ...ground);
  const legend = [];
  GLYPH.forEach((c, t) => { if (seen.has(c)) legend.push(c + ' ' + TNAME[t].toLowerCase()); });
  if (seen.has('~')) legend.push('~ river');
  if (seen.has('L')) legend.push('L lake');
  if (seen.has('*')) legend.push('* active vent');
  if (seen.has('x')) legend.push('x beyond the edge');
  out.push('Legend: ' + legend.join(', '));
  out.push('', 'Life (digits = plants on a tile, letters = creatures: H herbivore, C carnivore, O omnivore, S scavenger, A apex):', ...life);

  const creatures = [];
  byTile.forEach(list => list.forEach(f => creatures.push(f)));
  creatures.sort((a, b) => Math.max(Math.abs(a.x - sx), Math.abs(a.y - sy)) - Math.max(Math.abs(b.x - sx), Math.abs(b.y - sy)));
  out.push('');
  if (creatures.length) {
    out.push('Creatures in sight (' + creatures.length + '):');
    creatures.slice(0, 12).forEach(f => out.push(creatureLine(f, sx, sy)));
    if (creatures.length > 12) out.push('- and ' + (creatures.length - 12) + ' more, further off');
  } else out.push('No creatures in sight.');
  out.push(plants ? 'Plants in sight: ' + plants + ' on ' + plantTiles + ' tiles.' : 'No plants in sight.');

  const mine = st.planted.filter(p => Math.abs(p.x - sx) <= SIGHT && Math.abs(p.y - sy) <= SIGHT);
  if (mine.length) {
    out.push('Your plantings in sight:');
    mine.forEach(p => {
      const f = flora.find(q => q && q.id === p.id);
      out.push('- at ' + bearing(p.x - sx, p.y - sy) + ', planted tick ' + p.tick + ': ' +
        (f ? 'alive, health ' + Math.round(f.health * 100) + '%' : 'gone'));
    });
  }
  const near = st.places.filter(p => Math.abs(p.x - sx) <= SIGHT && Math.abs(p.y - sy) <= SIGHT);
  if (near.length) out.push('Places you named, in sight: ' + near.map(p => '"' + p.name + '" ' + bearing(p.x - sx, p.y - sy)).join('; '));
  return out.join('\n');
}

// Root's sense of its own history on arrival: its named places (it remembers roughly where they are)
// and how its plantings fared. Bearings, not maps: it has to walk to see them.
export function arrivalText(st) {
  const out = [];
  if (st.places.length) {
    out.push('Places you have named (rough direction from here):');
    st.places.forEach(p => {
      const dx = p.x - st.x, dy = p.y - st.y, d = Math.max(Math.abs(dx), Math.abs(dy));
      out.push('- "' + p.name + '": ' + (d === 0 ? 'here' : 'about ' + d + ' tiles ' + compass(dx, dy)));
    });
  }
  if (st.planted.length) {
    const alive = st.planted.filter(p => flora.some(q => q && q.id === p.id)).length;
    out.push('Of the ' + st.planted.length + ' things you have planted, ' + alive + ' still live.');
  }
  return out.join('\n');
}

export function walkFrom(st, dir, steps) {
  const d = DIRS[String(dir || '').toUpperCase()];
  if (!d) return 'There is no direction "' + dir + '". Use N, NE, E, SE, S, SW, W or NW.';
  const n = Math.max(1, Math.min(MAX_STRIDE, steps | 0 || 1));
  let moved = 0, why = '';
  for (let s = 0; s < n; s++) {
    const nx = st.x + d[0], ny = st.y + d[1];
    const b = blockedAt(nx, ny);
    if (b) { why = 'Stopped by ' + b + '.'; break; }
    st.x = nx; st.y = ny; moved++;
    if (STEEP.includes(grid[idx(nx, ny)]) && s < n - 1) { why = 'Steep ground: you stop to climb.'; break; }
  }
  return 'You walk ' + moved + ' of ' + n + ' ' + dir.toUpperCase() + '.' + (why ? ' ' + why : '');
}

export function plantAt(st) {
  if (st.plantsThisVisit >= PLANTS_PER_VISIT) return 'You have no seeds left this visit (' + PLANTS_PER_VISIT + ' per visit).';
  const i = idx(st.x, st.y);
  if (isWaterAt(i)) return 'Nothing roots in water.';
  if (liveFloraAt(st.x, st.y) >= (CFG.floraPerTileMax || 4)) return 'This ground is already full of plants.';
  const f = makeFlora(st.x, st.y, null);
  flora.push(f);
  st.plantsThisVisit++;
  st.planted.push({ id: f.id, x: st.x, y: st.y, tick });
  return 'You plant a seed. It takes its chances with this ground like anything else (' +
    (PLANTS_PER_VISIT - st.plantsThisVisit) + ' seeds left this visit).';
}

export function namePlace(st, raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name) return 'A name needs at least one word.';
  st.places = st.places.filter(p => !(p.x === st.x && p.y === st.y));
  st.places.push({ name, x: st.x, y: st.y, tick });
  chronicleNote('terrain', 'Root names a place: ' + name + '.', '#e8a838');
  return 'This place is now "' + name + '".';
}

// Kevin pointing at a tile, as Root would perceive it: exact if in sight, a bearing if not.
export function pointText(st, px, py) {
  const dx = px - st.x, dy = py - st.y;
  if (Math.abs(dx) <= SIGHT && Math.abs(dy) <= SIGHT) {
    return 'Kevin points at ' + (dx || dy ? 'the tile ' + bearing(dx, dy) + ' of you' : 'you') + '.';
  }
  return 'Kevin points far off to the ' + compass(dx, dy) + ', about ' + Math.max(Math.abs(dx), Math.abs(dy)) + ' tiles away.';
}

// ===================== Browser shell (gate-blind) =====================
const RELAY = 'http://127.0.0.1:7796';
const LAND_READY = 0.3;   // a fresh world grows from ocean; Root arrives once there is ground to stand on
const VISIT_SPEED = 6;
let V = null;             // live visit: { st, ready, said:{text,until}, status }

export function visitDraw(ctx, PIX) {
  if (!V || !V.ready) return;
  const st = V.st, now = Date.now();
  ctx.save();
  ctx.strokeStyle = 'rgba(232,168,56,0.55)'; ctx.lineWidth = Math.max(1, PIX / 4);
  ctx.strokeRect((st.x - SIGHT) * PIX, (st.y - SIGHT) * PIX, (2 * SIGHT + 1) * PIX, (2 * SIGHT + 1) * PIX);
  const font = Math.max(9, PIX * 1.6);
  ctx.font = font + 'px "JetBrains Mono",monospace'; ctx.textBaseline = 'bottom';
  for (const p of st.places) {
    ctx.fillStyle = '#e8a838'; ctx.fillRect(p.x * PIX + PIX * 0.3, p.y * PIX + PIX * 0.3, PIX * 0.4, PIX * 0.4);
    ctx.fillStyle = 'rgba(8,11,16,0.75)'; const w = ctx.measureText(p.name).width;
    ctx.fillRect(p.x * PIX + PIX, p.y * PIX - font, w + 6, font + 2);
    ctx.fillStyle = '#f3d9a4'; ctx.fillText(p.name, p.x * PIX + PIX + 3, p.y * PIX + 1);
  }
  const cx = (st.x + 0.5) * PIX, cy = (st.y + 0.5) * PIX, r = Math.max(3, PIX * 0.9);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#e8a838'; ctx.fill(); ctx.lineWidth = Math.max(1.5, PIX / 3); ctx.strokeStyle = '#ffffff'; ctx.stroke();
  if (V.said && V.said.until > now) {
    const text = V.said.text.length > 60 ? V.said.text.slice(0, 57) + '...' : V.said.text;
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillRect(cx - w / 2 - 5, cy - r - font - 8, w + 10, font + 6);
    ctx.fillStyle = '#10141c'; ctx.fillText(text, cx - w / 2, cy - r - 4);
  }
  ctx.restore();
}

function panel() {
  const el = document.createElement('div');
  el.id = 'visitPanel';
  el.innerHTML = '<div class="vp-head"><span class="vp-dot"></span><span id="vpStatus">Opening the door</span></div>' +
    '<div id="vpLog"></div>' +
    '<form id="vpForm"><input id="vpInput" autocomplete="off" placeholder="Say something to Root"/></form>' +
    '<div class="vp-hint">Shift+click the map to point.</div>';
  const css = document.createElement('style');
  css.textContent = '#visitPanel{position:fixed;right:16px;bottom:16px;width:min(340px,calc(100vw - 32px));z-index:50;' +
    'background:var(--bg-panel);border:1px solid var(--border-hi);border-radius:8px;color:var(--fg);font:12px/1.45 "JetBrains Mono",monospace;}' +
    '#visitPanel .vp-head{display:flex;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--border);color:var(--fg-dim);}' +
    '#visitPanel .vp-dot{width:9px;height:9px;border-radius:50%;background:#e8a838;box-shadow:0 0 0 2px #fff3;}' +
    '#visitPanel.away .vp-dot{background:var(--fg-faint);}' +
    '#vpLog{max-height:30vh;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:6px;}' +
    '#vpLog .r{color:#f3d9a4;} #vpLog .k{color:var(--fg);} #vpLog .s{color:var(--fg-faint);}' +
    '#vpForm{padding:0 10px 4px;} #vpInput{width:100%;box-sizing:border-box;background:var(--bg-input);color:var(--fg);' +
    'border:1px solid var(--border);border-radius:6px;padding:7px 8px;font:inherit;}' +
    '#visitPanel .vp-hint{padding:0 10px 8px;color:var(--fg-faint);font-size:11px;}';
  document.head.appendChild(css);
  document.body.appendChild(el);
  return el;
}

function logLine(cls, text) {
  const log = document.getElementById('vpLog'); if (!log) return;
  const d = document.createElement('div'); d.className = cls; d.textContent = text;
  log.appendChild(d); log.scrollTop = log.scrollHeight;
}
function setStatus(text, away) {
  const s = document.getElementById('vpStatus'); if (s) s.textContent = text;
  const p = document.getElementById('visitPanel'); if (p) p.classList.toggle('away', !!away);
}

async function post(path, body) {
  const r = await fetch(RELAY + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.ok ? r.json() : null;
}

// hooks: { draw, importJSON, buildSnapshot, setSpeed, screenToTile, canvas }
export function bootVisit(hooks) {
  V = { st: newVisitState(), ready: false, said: null, left: false };
  panel();
  document.getElementById('vpForm').addEventListener('submit', e => {
    e.preventDefault();
    const inp = document.getElementById('vpInput'), text = inp.value.trim();
    if (!text) return;
    inp.value = ''; logLine('k', 'You: ' + text);
    post('/page/kevin', { text: 'Kevin says: "' + text + '"' }).catch(() => logLine('s', 'The relay is not running.'));
  });
  // Shift+click points. Capture phase on window so the Hand never sees the click.
  ['pointerdown', 'mousedown', 'click'].forEach(type => window.addEventListener(type, ev => {
    if (!ev.shiftKey || ev.target !== hooks.canvas || !V.ready) return;
    ev.stopImmediatePropagation(); ev.preventDefault();
    if (type !== 'click') return;
    const t = hooks.screenToTile(ev.clientX, ev.clientY);
    if (!inb(t.x, t.y)) return;
    logLine('k', 'You point at (' + t.x + ',' + t.y + ').');
    post('/page/kevin', { text: pointText(V.st, t.x, t.y) }).catch(() => {});
  }, true));

  const save = () => post('/page/save', { snapshot: hooks.buildSnapshot(), root: V.st }).catch(() => {});

  (async function start() {
    while (!grid) await new Promise(r => setTimeout(r, 200));   // boot() has built the first world
    let saved = null;
    try { const r = await fetch(RELAY + '/page/load'); if (r.ok) saved = await r.json(); } catch { /* relay down: shown below */ }
    CFG.seasonalTilt = true;                 // a visited world has seasons, so what Root learns goes stale
    if (saved && saved.snapshot) {
      hooks.importJSON(saved.snapshot);
      CFG.seasonalTilt = true;
      Object.assign(V.st, saved.root || {}, { plantsThisVisit: 0 });
      logLine('s', 'The world you share is back, at tick ' + tick + '.');
    } else {
      setStatus('The world is forming');
      logLine('s', 'A new world is forming. Root arrives once there is ground to stand on.');
      while (landCoverage() < LAND_READY) await new Promise(r => setTimeout(r, 500));
    }
    if (!inb(V.st.x, V.st.y) || blockedAt(V.st.x, V.st.y)) Object.assign(V.st, arrivalTile() || { x: W >> 1, y: H >> 1 });
    hooks.setSpeed(VISIT_SPEED);
    V.ready = true; hooks.draw();
    save();                                  // a reload must never lose a world Root has stood in
    setStatus('Waiting for Root at the door', true);
    setInterval(() => { if (!V.left) save(); }, 60000);
    pump(hooks, save);
  })();
}

async function pump(hooks, save) {
  for (;;) {
    let act;
    try { const r = await fetch(RELAY + '/page/poll'); act = r.ok ? await r.json() : null; }
    catch { setStatus('Relay offline, retrying', true); await new Promise(r => setTimeout(r, 3000)); continue; }
    if (!act || !act.id) continue;
    const st = V.st, a = act.args || {};
    let text;
    switch (act.verb) {
      case 'arrive': V.left = false; setStatus('Root is here'); logLine('s', 'Root steps through the door.');
        text = arrivalText(st); break;
      case 'look': text = perceive(st); break;
      case 'walk': text = walkFrom(st, a.direction, a.steps) + '\n\n' + perceive(st); break;
      case 'plant': text = plantAt(st); save(); break;
      case 'name_place': text = namePlace(st, a.name); logLine('s', 'Root named a place: ' + a.name); save(); break;
      case 'say': V.said = { text: String(a.text || ''), until: Date.now() + 15000 };
        logLine('r', 'Root: ' + a.text); text = 'Said.'; break;
      case 'leave': V.left = true; await save(); setStatus('Root has left', true); logLine('s', 'Root leaves through the door.');
        text = 'The world is saved at tick ' + tick + '.'; break;
      default: text = 'Unknown action.';
    }
    hooks.draw();
    await post('/page/result', { id: act.id, text }).catch(() => {});
  }
}
