'use strict';
// Root's visit: the assistant walks this world as a body, through a door that carries only its senses.
// The pure cores below (perceive / walkFrom / plantAt / bearing / pointText) are DOM-free and gate-tested.
// bootVisit() is the browser shell: on a locally served page with the relay running (visit/relay.mjs, started by
// the dev server) it adds a "Call Root" toggle. The game runs as normal until Kevin calls Root in; then the relay
// launches Root's session and carries its actions here. Kevin's own tools keep working, and anything he does
// reaches Root only if Root can see it.
import {
  CFG, T, TNAME, W, H, _seed, chronicleNote, elev, aridity, fauna, flora, getSpeciesName, grid, idx, inb,
  makeFlora, riverData, seasonPhase, seasonWave, tempField, tick, volcActive,
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

export const TRAIL_MAX = 400;      // footsteps kept for Kevin's map

export function newVisitState() {
  return { x: -1, y: -1, places: [], planted: [], plantsThisVisit: 0, trail: [], leftTick: null };
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

// The standable tile closest to (cx,cy), default the world's centre: where Root first arrives, and where it
// steps to if the ground under it has gone (the sea rose while it was away).
export function arrivalTile(cx = W >> 1, cy = H >> 1) {
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

// A plant Root put in the ground. Ids alone are not enough: a load resets the id counter, so an id can come back
// on an unrelated plant. Root's mark rides in the save with the plant; plants never move.
function findPlanted(p) { return flora.find(q => q && q.id === p.id && q.byRoot && q.x === p.x && q.y === p.y); }

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
      const f = findPlanted(p);
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
  if (st.leftTick != null && tick > st.leftTick) {
    out.push('The world has run ' + (tick - st.leftTick) + ' ticks since you left (you left at tick ' + st.leftTick + ').');
  }
  if (st.places.length) {
    out.push('Places you have named (rough direction from here):');
    st.places.forEach(p => {
      const dx = p.x - st.x, dy = p.y - st.y, d = Math.max(Math.abs(dx), Math.abs(dy));
      out.push('- "' + p.name + '": ' + (d === 0 ? 'here' : 'about ' + d + ' tiles ' + compass(dx, dy)));
    });
  }
  if (st.planted.length) {
    const alive = st.planted.filter(p => findPlanted(p)).length;
    out.push('Of the ' + st.planted.length + ' things you have planted, ' + alive + ' still live.');
  }
  return out.join('\n');
}

export function walkFrom(st, dir, steps) {
  dir = String(dir || '').toUpperCase();
  const d = DIRS[dir];
  if (!d) return 'There is no direction "' + dir + '". Use N, NE, E, SE, S, SW, W or NW.';
  const n = Math.max(1, Math.min(MAX_STRIDE, steps | 0 || 1));
  let moved = 0, why = '';
  for (let s = 0; s < n; s++) {
    const nx = st.x + d[0], ny = st.y + d[1];
    const b = blockedAt(nx, ny);
    if (b) { why = 'Stopped by ' + b + '.'; break; }
    st.x = nx; st.y = ny; moved++;
    if (!st.trail) st.trail = [];
    st.trail.push([nx, ny]); if (st.trail.length > TRAIL_MAX) st.trail.shift();
    if (STEEP.includes(grid[idx(nx, ny)]) && s < n - 1) { why = 'Steep ground: you stop to climb.'; break; }
  }
  return 'You walk ' + moved + ' of ' + n + ' ' + dir + '.' + (why ? ' ' + why : '');
}

export function plantAt(st) {
  if (st.plantsThisVisit >= PLANTS_PER_VISIT) return 'You have no seeds left this visit (' + PLANTS_PER_VISIT + ' per visit).';
  const i = idx(st.x, st.y);
  if (isWaterAt(i)) return 'Nothing roots in water.';
  if (liveFloraAt(st.x, st.y) >= (CFG.floraPerTileMax || 4)) return 'This ground is already full of plants.';
  const f = makeFlora(st.x, st.y, null);
  f.byRoot = true;
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

// Root's memory of one world (seed + size), as saved by the relay. A world run again from the same seed keeps the
// names Root gave its ground (terrain is seeded), but its plantings and footsteps belonged to the earlier run.
export function adoptWorldState(saved, nowTick) {
  const st = Object.assign(newVisitState(), saved || {});
  const restarted = !!saved && saved.lastTick != null && saved.lastTick > nowTick;
  if (restarted) { st.planted = []; st.trail = []; st.leftTick = null; }
  delete st.lastTick;
  return { st, restarted };
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
const VISIT_SPEED = 6;    // while Root is here, the world runs no faster than this between its moves
let V = null;             // the page's side of a visit: { st, key, here, phase, said, retired, points, ... }

export function visitDraw(ctx, PIX) {
  if (!V || !V.here) return;
  const st = V.st, now = Date.now();
  ctx.save();
  const tr = st.trail || [];
  for (let k = 0; k < tr.length; k++) {           // footsteps fade with age
    ctx.fillStyle = 'rgba(232,168,56,' + (0.08 + 0.32 * k / tr.length).toFixed(3) + ')';
    ctx.fillRect(tr[k][0] * PIX + PIX * 0.35, tr[k][1] * PIX + PIX * 0.35, PIX * 0.3, PIX * 0.3);
  }
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
  el.hidden = true;
  el.innerHTML = '<div class="vp-head"><span class="vp-dot"></span><span id="vpStatus"></span>' +
    '<button type="button" id="vpClose" aria-label="Hide">&times;</button></div>' +
    '<div id="vpLog"></div>' +
    '<form id="vpForm"><input id="vpInput" autocomplete="off" placeholder="Say something to Root"/></form>' +
    '<div class="vp-hint"><span>Shift+click the map to point</span><button type="button" id="vpHelpBtn">how this works</button></div>' +
    '<div id="vpHelp" hidden><ul>' +
    '<li><b>Talk.</b> Type above. Root hears you the next time it moves or stops to listen.</li>' +
    '<li><b>Point.</b> Shift+click the map. Inside the amber square Root sees exactly where; outside it, only a direction and a distance.</li>' +
    '<li><b>The square</b> is everything Root can see. Your Hand powers work as always, but Root only notices what happens inside it.</li>' +
    '<li><b>On the map,</b> faint amber dots are Root&rsquo;s footsteps and amber flags are places it has named. Root remembers them in this world, even if you start it over from the same seed.</li>' +
    '<li><b>Speed</b> drops while Root is here so the world is calm between its moves, and comes back when it leaves.</li>' +
    '<li><b>A visit</b> lasts about 20 minutes. Root leaves on its own and writes a field note, or press <i>Send Root home</i> and it will say goodbye first.</li>' +
    '<li>It is Root, with its memory, not a character. Ask it anything.</li>' +
    '</ul></div>';
  const css = document.createElement('style');
  css.textContent = '#visitPanel{position:fixed;right:16px;bottom:16px;width:min(340px,calc(100vw - 32px));z-index:50;' +
    'background:var(--bg-panel);border:1px solid var(--border-hi);border-radius:8px;color:var(--fg);font:12px/1.45 "JetBrains Mono",monospace;}' +
    '#visitPanel[hidden]{display:none;}' +
    '#visitPanel .vp-head{display:flex;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--border);color:var(--fg-dim);}' +
    '#vpStatus{flex:1;}' +
    '#vpClose{background:none;border:0;color:var(--fg-faint);font:16px/1 inherit;cursor:pointer;padding:0 2px;}' +
    '#vpClose:hover{color:var(--fg);}' +
    '.vp-dot{width:9px;height:9px;border-radius:50%;background:var(--fg-faint);flex:none;}' +
    '.root-here .vp-dot{background:#e8a838;box-shadow:0 0 0 2px #fff3;}' +
    '.root-coming .vp-dot{background:#e8a838;animation:vpPulse 1.2s ease-in-out infinite;}' +
    '@keyframes vpPulse{50%{opacity:.25;}}' +
    '#vpLog{max-height:30vh;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:6px;}' +
    '#vpLog:empty{display:none;}' +
    '#vpLog .r{color:#f3d9a4;} #vpLog .k{color:var(--fg);} #vpLog .s{color:var(--fg-faint);}' +
    '#vpForm{padding:8px 10px 4px;} #vpInput{width:100%;box-sizing:border-box;background:var(--bg-input);color:var(--fg);' +
    'border:1px solid var(--border);border-radius:6px;padding:7px 8px;font:inherit;}' +
    '#visitPanel .vp-hint{display:flex;justify-content:space-between;gap:8px;padding:0 10px 8px;color:var(--fg-faint);font-size:11px;}' +
    '#vpHelpBtn{background:none;border:0;padding:0;color:var(--fg-faint);font:inherit;cursor:pointer;text-decoration:underline dotted;}' +
    '#vpHelpBtn:hover,#vpHelpBtn[aria-expanded="true"]{color:var(--fg-dim);}' +
    '#vpHelp{border-top:1px solid var(--border);padding:8px 10px 10px;color:var(--fg-dim);font-size:11px;}' +
    '#vpHelp ul{margin:0;padding-left:14px;display:flex;flex-direction:column;gap:5px;} #vpHelp b{color:var(--fg);font-weight:600;}' +
    '#rootCall{display:inline-flex;align-items:center;gap:7px;margin-left:auto;margin-right:8px;padding:6px 11px;border-radius:7px;' +
    'background:transparent;border:1px solid var(--border-hi);color:var(--fg-dim);font:600 12px/1 inherit;cursor:pointer;white-space:nowrap;}' +
    '#rootCall:hover{background:rgba(255,255,255,.05);color:var(--fg);}' +
    '#rootCall.root-here{border-color:#e8a83866;color:#f3d9a4;}' +
    '#rootCall:disabled{cursor:default;opacity:.7;}';
  document.head.appendChild(css);
  document.body.appendChild(el);
  const btn = el.querySelector('#vpHelpBtn'), help = el.querySelector('#vpHelp');
  const show = open => {
    help.hidden = !open; btn.setAttribute('aria-expanded', String(open));
    try { localStorage.setItem('wb.visitHelp', open ? '1' : '0'); } catch { /* storage blocked: still works */ }
  };
  let open = false;
  try { open = localStorage.getItem('wb.visitHelp') === '1'; } catch { /* default closed */ }
  show(open);
  btn.addEventListener('click', () => show(help.hidden));
  el.querySelector('#vpClose').addEventListener('click', () => { el.hidden = true; });
  return el;
}

// The toggle in the top bar: Call Root / Send Root home.
function callButton(onClick) {
  const b = document.createElement('button');
  b.id = 'rootCall'; b.type = 'button';
  b.innerHTML = '<span class="vp-dot"></span><span id="rootCallLabel">Call Root</span>';
  b.setAttribute('data-tip', 'Root|Call Root into this world, or send it home');
  const mode = document.getElementById('modeToggle');
  if (mode && mode.parentNode) { mode.parentNode.insertBefore(b, mode); mode.style.marginLeft = '0'; }
  else { b.style.cssText = 'position:fixed;top:12px;right:16px;z-index:50;'; document.body.appendChild(b); }
  b.addEventListener('click', onClick);
  return b;
}

function logLine(cls, text) {
  const log = document.getElementById('vpLog'); if (!log) return;
  const d = document.createElement('div'); d.className = cls; d.textContent = text;
  log.appendChild(d); log.scrollTop = log.scrollHeight;
}

// One place that paints the button and the panel head from the visit's phase.
const PHASES = {
  idle:    { label: 'Call Root',          status: 'Root is not here',            cls: '' },
  coming:  { label: 'Root is on the way', status: 'Root is on the way',          cls: 'root-coming' },
  here:    { label: 'Send Root home',     status: 'Root is here',                cls: 'root-here' },
  leaving: { label: 'Root is leaving',    status: 'Root is saying goodbye',      cls: 'root-coming' },
  resting: { label: 'Root',               status: 'Another tab has Root now',    cls: '' },
};
function paint(phase, extra) {
  V.phase = phase;
  const p = PHASES[phase];
  const b = document.getElementById('rootCall'), lab = document.getElementById('rootCallLabel');
  if (b) { b.className = p.cls; b.disabled = phase === 'leaving' || phase === 'resting'; }
  if (lab) lab.textContent = p.label;
  const panelEl = document.getElementById('visitPanel');
  if (panelEl) panelEl.className = p.cls;
  const s = document.getElementById('vpStatus'); if (s) s.textContent = p.status + (extra ? ', ' + extra : '');
}

export const NO_GROUND = '\u0000no-ground';
const PAGE_ID = Math.random().toString(36).slice(2);   // the relay serves one live page; an older tab stands down
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Only a page served from this machine ever looks for the relay. The public site never probes the local network.
const LOCAL = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

async function post(path, body) {
  const r = await fetch(RELAY + path + (path.includes('?') ? '&' : '?') + 'page=' + PAGE_ID,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  if (r.status === 409) retire();
  return r.ok ? r.json() : null;
}

function retire() { if (!V.retired) { V.retired = true; paint('resting'); } }

function worldKey() { return 's' + _seed + '-' + W + 'x' + H; }

// hooks: { draw, screenToTile, canvas, getSpeed, setSpeed }
export function bootVisit(hooks) {
  if (!LOCAL) return;
  V = { st: newVisitState(), key: null, here: false, phase: 'idle', said: null, retired: false, points: [], speedBefore: null };
  V.hooks = hooks;
  (async function start() {
    // The dev server starts the relay alongside itself, so give it a moment. No relay: the game is just the game.
    let ok = false;
    for (let k = 0; k < 8 && !ok; k++) {
      try { ok = (await fetch(RELAY + '/page/hello?page=' + PAGE_ID)).ok; } catch { await sleep(1000); }
    }
    if (!ok) return;
    panel();
    callButton(() => {
      if (V.phase === 'idle') {
        post('/page/summon').then(r => { if (r) { paint('coming'); showPanel(); logLine('s', 'You call Root.'); } })
          .catch(() => logLine('s', 'The relay is not running.'));
      } else if (V.phase === 'coming' || V.phase === 'here') {
        post('/page/home').then(() => { paint('leaving'); logLine('s', 'You ask Root to head home.'); }).catch(() => {});
      }
    });
    paint('idle');
    wireInput(hooks);
    watchStatus();
    pump(hooks);
  })();
}

function showPanel() { const p = document.getElementById('visitPanel'); if (p) p.hidden = false; }

function wireInput(hooks) {
  document.getElementById('vpForm').addEventListener('submit', e => {
    e.preventDefault();
    const inp = document.getElementById('vpInput'), text = inp.value.trim();
    if (!text) return;
    inp.value = ''; logLine('k', 'You: ' + text);
    post('/page/kevin', { text: 'Kevin says: "' + text + '"' }).catch(() => logLine('s', 'The relay is not running.'));
  });
  // Shift+click points while Root is here. Capture phase on window so the Hand (and the double-click zoom reset)
  // never see it. The point is worded when Root next hears it, from where Root stands THEN.
  ['pointerdown', 'mousedown', 'click', 'dblclick'].forEach(type => window.addEventListener(type, ev => {
    if (!ev.shiftKey || ev.target !== hooks.canvas || !V.here) return;
    ev.stopImmediatePropagation(); ev.preventDefault();
    if (type !== 'click') return;
    const t = hooks.screenToTile(ev.clientX, ev.clientY);
    if (!inb(t.x, t.y)) return;
    logLine('k', 'You point at (' + t.x + ',' + t.y + ').');
    V.points.push({ x: t.x, y: t.y, t: Date.now() });
    post('/page/kevin', { wake: true }).catch(() => {});
  }, true));
}

// The relay knows whether Root's session is starting, inside, or gone; the page follows it.
async function watchStatus() {
  for (;;) {
    await sleep(2000);
    if (V.retired) return;
    let s;
    try { s = await (await fetch(RELAY + '/page/status?page=' + PAGE_ID)).json(); } catch { continue; }
    if (!s.mine) { retire(); return; }
    if (V.here && !s.present) depart('Root has gone.');            // the session ended without leaving
    if (s.present && s.leaving) paint('leaving');
    else if (s.present) paint('here', s.left != null ? s.left + ' min left' : '');
    else if (s.running) paint('coming');
    else {
      if (V.phase === 'coming') logLine('s', 'Root could not come through. The session transcript is in ~/root/visits.');
      paint('idle');
    }
  }
}

async function saveState() {
  if (V.retired || !V.key) return false;
  try { return !!(await post('/page/state?key=' + V.key, { ...V.st, lastTick: tick })); } catch { return false; }
}

// Root's memory of one world (seed + size). A world run again from the same seed keeps the names Root gave its
// ground, but its plantings and footsteps belonged to the earlier run.
async function loadState(key) {
  let saved = null;
  try { const r = await fetch(RELAY + '/page/state?key=' + key); if (r.ok) saved = await r.json(); } catch { /* fresh */ }
  return adoptWorldState(saved, tick);
}

function standOnGround() {
  const st = V.st;
  if (inb(st.x, st.y) && !blockedAt(st.x, st.y)) return true;
  const t = inb(st.x, st.y) ? arrivalTile(st.x, st.y) : arrivalTile();
  if (!t) return false;
  st.x = t.x; st.y = t.y;
  return true;
}

async function arriveHere() {
  V.key = worldKey();
  const loaded = await loadState(V.key);
  V.st = loaded.st;
  V.st.plantsThisVisit = 0;
  // A world still rising from the sea: wait for ground (the relay gives arrival 90 seconds).
  for (let k = 0; k < 160 && !standOnGround(); k++) { if (k === 0) logLine('s', 'Root is waiting for ground to rise.'); await sleep(500); }
  if (!standOnGround()) return null;
  V.here = true;
  V.speedBefore = V.hooks.getSpeed();
  V.hooks.setSpeed(Math.min(V.speedBefore, VISIT_SPEED));
  paint('here'); showPanel();
  logLine('s', 'Root steps through the door.');
  await saveState();
  return (loaded.restarted ? 'You have been in this world before, but it has started over since. The names you gave its ground remain.\n' : '') +
    arrivalText(V.st);
}

function depart(line) {
  if (!V.here) return;
  V.here = false;
  V.st.leftTick = tick;
  if (V.speedBefore != null) { V.hooks.setSpeed(V.speedBefore); V.speedBefore = null; }
  logLine('s', line);
  V.hooks.draw();
  return saveState();
}

function heardPoints() {
  if (!V.points.length) return '';
  const now = Date.now();
  const lines = V.points.map(p => {
    const s = Math.round((now - p.t) / 1000);
    return pointText(V.st, p.x, p.y) + (s >= 20 ? ' (' + (s < 90 ? s + ' seconds' : Math.round(s / 60) + ' minutes') + ' ago)' : '');
  });
  V.points = [];
  return '\n\nYou see:\n' + lines.join('\n');
}

async function pump(hooks) {
  setInterval(() => { if (V.here) saveState(); }, 60000);
  while (!V.retired) {
    let act;
    try {
      const r = await fetch(RELAY + '/page/poll?page=' + PAGE_ID);
      if (r.status === 409) { retire(); return; }
      if (!r.ok) throw new Error('relay ' + r.status);
      act = await r.json();
    } catch { await sleep(3000); continue; }
    if (!act || !act.id) continue;
    const a = act.args || {};
    let text;
    try {
      if (act.verb === 'arrive') {
        text = await arriveHere();
        if (text === null) text = NO_GROUND;   // the relay turns this into "the world is not ready" and stays outside
      } else {
        let prefix = '';
        if (V.here && worldKey() !== V.key) {   // Kevin started a new world while Root stood in the old one
          await saveState();
          V.key = worldKey();
          const loaded = await loadState(V.key);
          V.st = Object.assign(loaded.st, { plantsThisVisit: V.st.plantsThisVisit });
          prefix = 'The world dissolves and re-forms around you. This is a different world.\n\n';
        }
        standOnGround();
        const st = V.st;
        switch (act.verb) {
          case 'look': text = perceive(st) + heardPoints(); break;
          case 'walk': text = walkFrom(st, a.direction, a.steps) + '\n\n' + perceive(st) + heardPoints(); break;
          case 'plant': text = plantAt(st); await saveState(); text += heardPoints(); break;
          case 'name_place': text = namePlace(st, a.name); logLine('s', 'Root named a place: ' + String(a.name || '')); await saveState();
            text += heardPoints(); break;
          case 'say': V.said = { text: String(a.text || ''), until: Date.now() + 15000 };
            logLine('r', 'Root: ' + String(a.text || '')); text = 'Said.' + heardPoints(); break;
          case 'leave': text = (await depart('Root leaves through the door.')) ? 'What you left in this world is kept.' : 'You leave.'; break;
          default: text = 'Nothing happens: "' + act.verb + '" is not something you can do here.';
        }
        text = prefix + text;
      }
    } catch (e) {
      // A failure in one action must never stop the loop, or every later call stalls until it times out.
      text = 'Something in the world went wrong (' + (e && e.message || e) + '). You are unharmed; try again.';
      logLine('s', 'Error handling ' + act.verb + ': ' + (e && e.message || e));
    }
    hooks.draw();
    await post('/page/result', { id: act.id, text }).catch(() => {});
  }
}
