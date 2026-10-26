// Ketch'em drawing (mechanics 14.6 and 16): roads and bridges, stores, landmarks and signposts go on the ground
// layer (after terrain and rivers, before plants and life); the fog goes on top of everything. DOM-free: draws into
// any 2D context at PIX pixels per tile, like render.js. K is the board object (board.js).
import { T, W, H, grid, riverData, road, fauna, tick, idx, hsv2hex } from '../sim.js';
import { isRevealed } from './fog.js';
import { factsOf, oddsFor, oddsVisible, findCreature } from './encounter.js';

export const ROAD = '#8a8f94', ROAD_EDGE = '#6f7479', PLANK = '#6b5a45', POST = '#4a3f32';
export const ROOF = '#3a3f47', DOOR = '#f3d9a4', SIGN_POST = '#5a4632', SIGN_BOARD = '#e9dcc0';
export const CLOUD = ['#c9cfd6', '#c1c8d0'];
export const CAIRN = '#9a9a9a', SNAG = '#6b5a45', POOL = '#3aa6e0';

function waterAt(i) { const t = grid[i]; if (t === T.OCEAN || t === T.COAST) return true; const rd = riverData && riverData[i]; return !!(rd && rd.lake); }
function riverAt(i) { const rd = riverData && riverData[i]; return !!(rd && !rd.lake); }

function planks(ctx, px, py, PIX) {
  ctx.fillStyle = PLANK;
  const ys = PIX >= 6 ? [0.25, 0.5, 0.75] : [0.2, 0.5, 0.8];
  for (const f of ys) ctx.fillRect(px + 1, py + Math.round(PIX * f), PIX - 2, 1);
}

export function drawKetchemGround(ctx, PIX, K) {
  if (!K || !road) return;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    if (!road[i]) continue;
    const px = x * PIX, py = y * PIX;
    if (waterAt(i)) {                      // a bridge over the sea or a lake: planks on posts, above the water
      ctx.fillStyle = POST; ctx.fillRect(px, py, 2, PIX); ctx.fillRect(px + PIX - 2, py, 2, PIX);
      ctx.fillStyle = ROAD; ctx.fillRect(px + 1, py + 1, PIX - 2, PIX - 2);
      planks(ctx, px, py, PIX);
    } else {
      ctx.fillStyle = ROAD_EDGE; ctx.fillRect(px, py, PIX, PIX);
      ctx.fillStyle = ROAD; ctx.fillRect(px + 1, py + 1, PIX - 2, PIX - 2);
      if (riverAt(i)) planks(ctx, px, py, PIX);    // a bridge over a river
    }
  }
  for (const s of K.stores) {
    const px = s.x * PIX, py = s.y * PIX;
    ctx.fillStyle = ROOF; ctx.fillRect(px, py, PIX, PIX);
    const dw = Math.max(1, Math.round(PIX / 3)), dh = Math.max(1, Math.round(PIX / 2));
    ctx.fillStyle = DOOR; ctx.fillRect(px + ((PIX - dw) >> 1), py + PIX - dh, dw, dh);
  }
  for (const l of K.landmarks || []) {
    const px = l.x * PIX, py = l.y * PIX, c = PIX >> 1;
    if (l.kind === 'pool') { ctx.fillStyle = POOL; ctx.fillRect(px + c - 1, py + c - 1, Math.max(2, PIX >> 1), Math.max(2, PIX >> 1)); }
    else if (l.kind === 'dead tree') { ctx.fillStyle = SNAG; ctx.fillRect(px + c, py + 1, 1, PIX - 2); ctx.fillRect(px + c - 1, py + (PIX >> 2), 1, 1); ctx.fillRect(px + c + 1, py + (PIX >> 1), 1, 1); }
    else { ctx.fillStyle = CAIRN; ctx.fillRect(px + c, py + c - 1, 1, 1); ctx.fillRect(px + c - 1, py + c, 3, 1); ctx.fillRect(px + c - 2, py + c + 1, 5, 1); }
  }
  for (const sp of K.signposts || []) {
    const px = sp.x * PIX, py = sp.y * PIX, c = PIX >> 1;
    ctx.fillStyle = SIGN_POST; ctx.fillRect(px + c - 1, py + 1, 2, PIX - 2);
    ctx.fillStyle = SIGN_BOARD; ctx.fillRect(px + c, py + 1, Math.max(2, c), 2);
  }
}

export const KEVIN = '#3b9eff', HULL = '#7a5a3a';
function hull(ctx, x, y, PIX) {
  ctx.fillStyle = HULL;
  ctx.beginPath(); ctx.ellipse((x + 0.5) * PIX, (y + 0.62) * PIX, PIX * 0.75, PIX * 0.4, 0, 0, Math.PI * 2); ctx.fill();
}

// The two characters: Kevin's blue dot (and boat), Root's boat under the amber dot visitDraw paints, Kevin's sight
// square, and his last message as a bubble. Drawn after the fog, before Root's own marks.
export function drawPlayers(ctx, PIX, K) {
  if (!K) return;
  ctx.save();
  if (K.root && K.root.boat && !K.root.away) hull(ctx, K.root.x, K.root.y, PIX);
  const p = K.kevin;
  if (p) {
    ctx.strokeStyle = 'rgba(59,158,255,0.45)'; ctx.lineWidth = Math.max(1, PIX / 4);
    ctx.strokeRect((p.x - 4) * PIX, (p.y - 4) * PIX, 9 * PIX, 9 * PIX);
    if (p.boat) hull(ctx, p.x, p.y, PIX);
    const cx = (p.x + 0.5) * PIX, cy = (p.y + 0.5) * PIX, r = Math.max(3, PIX * 0.9);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = KEVIN; ctx.fill(); ctx.lineWidth = Math.max(1.5, PIX / 3); ctx.strokeStyle = '#ffffff'; ctx.stroke();
    if (p.msg && p.msgUntil > Date.now()) {
      const font = Math.max(9, PIX * 1.6);
      ctx.font = font + 'px "JetBrains Mono",monospace'; ctx.textBaseline = 'bottom';
      const text = p.msg.length > 70 ? p.msg.slice(0, 67) + '...' : p.msg;
      const w = ctx.measureText(text).width, bx = Math.max(2, Math.min(ctx.canvas.width - w - 12, cx - w / 2 - 5));
      const above = cy - r - font - 8 >= 0, top = above ? cy - r - font - 8 : cy + r + 4;   // below the dot near the top edge
      ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillRect(bx, top, w + 10, font + 6);
      ctx.fillStyle = '#10141c'; ctx.fillText(text, bx + 5, top + font + 2);
    }
  }
  ctx.restore();
}

// ---------- encounters (9, 9b, 11): tags, rings, skulls, baits, the follower, and the timed effects ----------
export const TYPE_COLOUR = { Dune: '#d8c27a', Marsh: '#3c6e71', Ember: '#ff7a33', Frost: '#e6f2ff', Sun: '#ffd34d', Shade: '#6b5a9a', Peak: '#aaaaaa', Vale: '#3aa6e0', Plain: '#c8cdd3' };
const RING = o => (o >= 60 ? '#58d27a' : o >= 25 ? '#e8a838' : '#ff5a5a');
function skull(ctx, cx, cy, r) {
  ctx.fillStyle = '#f3f3f3'; ctx.beginPath(); ctx.arc(cx, cy - r * 0.15, r * 0.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(cx - r * 0.35, cy + r * 0.2, r * 0.7, r * 0.35);
  ctx.fillStyle = '#10141c'; ctx.fillRect(cx - r * 0.35, cy - r * 0.3, r * 0.22, r * 0.25); ctx.fillRect(cx + r * 0.13, cy - r * 0.3, r * 0.22, r * 0.25);
}
function stoneDot(ctx, x, y, r, name) {
  ctx.fillStyle = name === 'Obsidian' ? '#1b1b22' : name === 'Geode' ? '#8a6bd1' : '#e0a33a'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, Math.PI * 2); ctx.fill();
}
export function drawEncounters(ctx, PIX, K) {
  if (!K || !K.aw) return;
  const p = K.kevin; if (!p) return;
  const font = Math.max(8, Math.round(PIX * 1.3));
  ctx.save(); ctx.font = 'bold ' + font + 'px "JetBrains Mono",monospace'; ctx.textBaseline = 'bottom'; ctx.textAlign = 'center';
  const now = tick;
  // level tags and rings on creatures near Kevin (within 4 tiles; the odds within 2, or 4 with Nose)
  for (const f of fauna) {
    if (!f || Math.max(Math.abs(f.x - p.x), Math.abs(f.y - p.y)) > 4) continue;
    if (!isRevealed(K.fog, idx(f.x, f.y))) continue;
    const a = K.aw[f.id] || { state: 'calm' }, facts = factsOf(f);
    const cx = (f.x + 0.5) * PIX, cy = (f.y + 0.5) * PIX, r = PIX * 0.9;
    const visible = oddsVisible(K, p, f) && a.state !== 'fled' && !p.boat;
    ctx.globalAlpha = visible ? 1 : 0.4;
    const tag = 'L' + facts.L;
    const tw = ctx.measureText(tag).width + 4;
    ctx.fillStyle = a.state === 'growl' ? '#ff5a5a' : TYPE_COLOUR[facts.type] || '#ccc'; ctx.fillRect(cx - tw / 2, cy - r - font - 2, tw, font + 1);
    ctx.fillStyle = '#10141c'; ctx.fillText(tag, cx, cy - r - 2);
    ctx.globalAlpha = 1;
    if (a.state === 'growl') skull(ctx, cx, cy - r * 0.1, r);
    else if (visible) {
      const o = oddsFor(K, p, f);
      ctx.strokeStyle = RING(o); ctx.lineWidth = f.id === p.target ? 3 : 2 - (a.state === 'calm' ? 0.5 * Math.abs(Math.sin(now / 20)) : 0);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      if (a.feeding) { ctx.strokeStyle = 'rgba(88,210,122,0.5)'; ctx.beginPath(); ctx.arc(cx, cy, r + 2, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = '#e6edf3'; ctx.fillText(o + '%', cx, cy + r + font + 1);
    }
    if (a.state === 'wary' && (now % 20) < 8) { ctx.fillStyle = '#e6edf3'; ctx.fillText('~', cx, cy - r - font - 3); }
    if (f.id === p.target) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.strokeRect(f.x * PIX + 0.5, f.y * PIX + 0.5, PIX - 1, PIX - 1); ctx.setLineDash([]); }
  }
  // baits (under the cloud, nothing shows)
  for (const b of K.baits) {
    if (!isRevealed(K.fog, idx(b.x, b.y))) continue;
    const cx = (b.x + 0.5) * PIX, cy = (b.y + 0.5) * PIX;
    if (b.kind === 'plant' || b.kind === 'scatter') { ctx.fillStyle = '#58d27a'; ctx.beginPath(); ctx.ellipse(cx, cy, PIX * 0.3, PIX * 0.18, -0.6, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.fillStyle = '#f3e9d2'; ctx.fillRect(cx - PIX * 0.3, cy - 1, PIX * 0.6, 2); ctx.fillRect(cx - PIX * 0.3, cy - 2, 2, 4); ctx.fillRect(cx + PIX * 0.3 - 2, cy - 2, 2, 4); if (b.kind === 'stake') { ctx.fillStyle = '#7a5a3a'; ctx.fillRect(cx - 1, cy - PIX * 0.4, 2, PIX * 0.4); } }
    const feeder = b.creatureId ? findCreature(b.creatureId) : null;
    if (feeder && !(K.aw[feeder.id] || {}).feeding) { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo((feeder.x + 0.5) * PIX, (feeder.y + 0.5) * PIX); ctx.lineTo(cx, cy); ctx.stroke(); ctx.setLineDash([]); }
  }
  // the follower: itself, with an amber collar, one tile behind
  for (const q of [K.kevin, K.root]) {
    if (!q || q.away || !q.follower || !q.followerAt) continue;   // an away player's follower is not in the world
    const c = (q.party || []).find(x => x.id === q.follower); if (!c) continue;
    const cx = (q.followerAt.x + 0.5) * PIX, cy = (q.followerAt.y + 0.5) * PIX, d = Math.max(2, Math.min(4, PIX - 1)) * (c.size || 1);
    ctx.fillStyle = hsv2hex(c.hue, c.sat, c.val); ctx.fillRect(cx - d / 2, cy - d / 2, d, d);
    ctx.strokeStyle = '#e8a838'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, d * 0.9 + 1, 0, Math.PI * 2); ctx.stroke();
  }
  // timed effects
  for (const e of K.fx) {
    const t = now - e.start; if (e.len !== undefined && t >= e.len) continue;
    const f = e.id ? findCreature(e.id) : null;
    const ex = f ? f.x : e.x !== undefined ? e.x : e.to ? e.to.x : -1, ey = f ? f.y : e.y !== undefined ? e.y : e.to ? e.to.y : -1;
    if (ex < 0 || !isRevealed(K.fog, idx(ex, ey))) continue;   // an effect under the cloud stays hidden
    if (e.kind === 'alert' && f) { ctx.fillStyle = '#ffd34d'; ctx.globalAlpha = 1 - t / e.len; ctx.fillText('!', (f.x + 0.5) * PIX, (f.y - t / e.len) * PIX); ctx.globalAlpha = 1; }
    else if (e.kind === 'pulse' && f) { ctx.strokeStyle = 'rgba(255,90,90,' + (1 - t / e.len).toFixed(2) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc((f.x + 0.5) * PIX, (f.y + 0.5) * PIX, PIX * (0.5 + 2.5 * t / e.len), 0, Math.PI * 2); ctx.stroke(); }
    else if (e.kind === 'dust') { ctx.fillStyle = 'rgba(200,200,200,' + (1 - t / e.len).toFixed(2) + ')'; for (let k = 0; k < 3; k++) ctx.fillRect((e.x + 0.3 + 0.2 * k) * PIX, (e.y + 0.7) * PIX - k, 1, 1); }
    else if (e.kind === 'hardy') { ctx.strokeStyle = 'rgba(255,255,255,' + (1 - t / e.len).toFixed(2) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc((e.x + 0.5) * PIX, (e.y + 0.5) * PIX, PIX * 0.9, Math.PI, 2 * Math.PI); ctx.stroke(); }
    else if (e.kind === 'attack' && f) { const k = t < 6 ? t / 6 : (12 - t) / 6; const dx = Math.sign(e.x - f.x), dy = Math.sign(e.y - f.y); ctx.fillStyle = 'rgba(255,90,90,0.8)'; ctx.fillRect((f.x + 0.25 + dx * 0.5 * k) * PIX, (f.y + 0.25 + dy * 0.5 * k) * PIX, PIX * 0.5, PIX * 0.5); }
    else if (e.kind === 'knockdown') { ctx.fillStyle = '#ff5a5a'; ctx.globalAlpha = 1 - t / e.len; ctx.fillText('-' + e.lost, (e.x + 0.5) * PIX, (e.y - t / 3) * PIX); ctx.globalAlpha = 1; }
    else if (e.kind === 'eaten') { ctx.fillStyle = 'rgba(255,90,90,' + (1 - t / e.len).toFixed(2) + ')'; ctx.fillText('x', (e.x + 0.5) * PIX, (e.y + 0.5) * PIX); }
    else if (e.kind === 'throw') {
      const r = PIX * 0.25, fx0 = (e.from.x + 0.5) * PIX, fy0 = (e.from.y + 0.5) * PIX, tx = (e.to.x + 0.5) * PIX, ty = (e.to.y + 0.5) * PIX;
      if (t < 8) { const u = t / 8; stoneDot(ctx, fx0 + (tx - fx0) * u, fy0 + (ty - fy0) * u - 1.5 * PIX * 4 * u * (1 - u), r, e.stone); }
      else if (t < 12) { const u = (t - 8) / 4; ctx.strokeStyle = 'rgba(255,255,255,' + (1 - u) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tx, ty, PIX * 0.9 * (1 - u) + 1, 0, Math.PI * 2); ctx.stroke(); stoneDot(ctx, tx, ty, r, e.stone); }
      else if (t < 12 + e.wobbles * 10) { const w = (t - 12) % 10, ang = w < 3 ? -0.26 : w < 6 ? 0.26 : 0; ctx.save(); ctx.translate(tx, ty); ctx.rotate(ang); stoneDot(ctx, 0, 0, r, e.stone); ctx.restore(); }
      else if (e.caught) { const u = Math.min(1, (t - 12 - e.wobbles * 10) / 6); ctx.strokeStyle = 'rgba(255,255,255,' + (1 - u) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tx, ty, PIX * (0.3 + u), 0, Math.PI * 2); ctx.stroke(); stoneDot(ctx, tx, ty, r, e.stone); if (u < 0.5) { ctx.fillStyle = '#fff'; ctx.fillRect(tx - r * 2, ty - r * 2, 2, 2); ctx.fillRect(tx + r * 2, ty + r, 2, 2); } }
      else { const u = Math.min(1, (t - 12 - e.wobbles * 10) / 6); ctx.globalAlpha = 1 - u; stoneDot(ctx, tx - u * PIX, ty, r * 0.7, e.stone); stoneDot(ctx, tx + u * PIX, ty, r * 0.7, e.stone); ctx.globalAlpha = 1; }
    }
    else if (e.kind === 'evolve' && f === null && e.x !== undefined) {   // a long white flash at the owner's dot and the new name typed out above it
      const u = t / e.len; ctx.fillStyle = 'rgba(255,255,255,' + (0.9 * (1 - u)).toFixed(2) + ')'; ctx.beginPath(); ctx.arc((e.x + 0.5) * PIX, (e.y + 0.5) * PIX, PIX * (1 + 2 * u), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.fillText(String(e.name || 'a new species').slice(0, Math.ceil(String(e.name || 'a new species').length * Math.min(1, u * 1.5))), (e.x + 0.5) * PIX, (e.y - 1.2) * PIX); }
    else if (e.kind === 'bred') { const u = t / e.len; ctx.strokeStyle = 'rgba(243,217,164,' + (1 - u).toFixed(2) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc((e.x + 0.5) * PIX, (e.y + 0.5) * PIX, PIX * (0.4 + u), 0, Math.PI * 2); ctx.stroke(); }
    else if (e.kind === 'baitDrop') { const u = t / e.len; ctx.fillStyle = e.baitKind === 'plant' || e.baitKind === 'scatter' ? '#58d27a' : '#f3e9d2'; ctx.fillRect((e.x + 0.4) * PIX, (e.y + 0.4 - 0.5 * (1 - u)) * PIX, PIX * 0.2, PIX * 0.2); }
  }
  ctx.restore();   // the HUD and the party row are DOM (hud.js, step 10)
}

// Fog last: an undiscovered tile is cloud, and whatever stands on it (plants, creatures, roads) is hidden.
export function drawFog(ctx, PIX, K) {
  if (!K || !K.fog) return;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    if (isRevealed(K.fog, i)) continue;
    ctx.fillStyle = CLOUD[((x * 7 + y * 13) >> 2) & 1];
    ctx.fillRect(x * PIX, y * PIX, PIX, PIX);
  }
}
