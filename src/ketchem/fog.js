// Ketch'em fog: one shared bit per tile (mechanics sec. 16). Fog is cleared permanently for the save, for both
// players, by sight squares; a store also shows itself once a road leading to it is revealed within
// STORE_ROAD_REVEAL road tiles (14.6), so the road hints at where to go. K is the board object (board.js).
import { W, H, road, idx, inb } from '../sim.js';

export const SIGHT_HALF = 4;             // 9x9 (Farsight widens it: 5 / 6 / 7)
export const STORE_ROAD_REVEAL = 12;
const DIRS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

export function newFog(n) { return new Uint8Array((n + 7) >> 3); }
export function isRevealed(fog, i) { return (fog[i >> 3] >> (i & 7)) & 1; }
export function revealTile(fog, i) { fog[i >> 3] |= 1 << (i & 7); }
export function revealedCount(fog, n) { let c = 0; for (let i = 0; i < n; i++) c += isRevealed(fog, i); return c; }

// Road distance from each store along the road network (-1 off the road or unreachable). Cached on K; a board's
// roads never change after it is built, so the cache is dropped only when K is replaced.
export function storeRoadDist(K) {
  if (K._roadDist && K._roadDist.length === K.stores.length) return K._roadDist;
  K._roadDist = K.stores.map(s => {
    const dist = new Int16Array(W * H).fill(-1);
    if (!road[s.i]) return dist;
    const q = [s.i]; dist[s.i] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], x = c % W, y = (c / W) | 0;
      for (let d = 0; d < 8; d++) { const nx = x + DIRS[d][0], ny = y + DIRS[d][1]; if (!inb(nx, ny)) continue; const j = idx(nx, ny); if (road[j] && dist[j] < 0) { dist[j] = dist[c] + 1; q.push(j); } }
    }
    return dist;
  });
  return K._roadDist;
}

// A store is revealed when its tile is, or when a revealed road tile lies within STORE_ROAD_REVEAL road steps of it.
// Another store's tile does not count as a revealed road tile, or one sighting would cascade from store to store
// across the whole network. Returns the stores revealed by this call.
export function revealStores(K) {
  const out = [];
  const dists = storeRoadDist(K);
  const storeTile = new Set(K.stores.map(s => s.i));
  K.stores.forEach((s, k) => {
    if (s.revealed) return;
    let hit = isRevealed(K.fog, s.i);
    if (!hit) { const dist = dists[k]; for (let i = 0; i < W * H && !hit; i++) if (dist[i] > 0 && dist[i] <= STORE_ROAD_REVEAL && !storeTile.has(i) && isRevealed(K.fog, i)) hit = true; }
    if (hit) { s.revealed = true; revealTile(K.fog, s.i); out.push(s); }
  });
  return out;
}

// Clear the fog in the (2*half+1)^2 square around (cx, cy), clipped to the map, then apply the store rule.
export function revealSquare(K, cx, cy, half = SIGHT_HALF) {
  for (let y = Math.max(0, cy - half); y <= Math.min(H - 1, cy + half); y++)
    for (let x = Math.max(0, cx - half); x <= Math.min(W - 1, cx + half); x++) revealTile(K.fog, idx(x, y));
  return revealStores(K);
}
