// Ketch'em drawing (mechanics 14.6 and 16): roads and bridges, stores, landmarks and signposts go on the ground
// layer (after terrain and rivers, before plants and life); the fog goes on top of everything. DOM-free: draws into
// any 2D context at PIX pixels per tile, like render.js. K is the board object (board.js).
import { T, W, H, grid, riverData, road, idx } from '../sim.js';
import { isRevealed } from './fog.js';

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
