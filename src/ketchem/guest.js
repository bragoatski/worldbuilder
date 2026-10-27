// A guest in the second seat (mechanics 25): a second person on the same keyboard plays the character Root plays when
// Root is called in. The game was built for two players, Kevin and the second seat (K.root), so a
// guest takes that seat rather than becoming a third player. Each occupant keeps its own belongings: Root's record
// is set aside (K.rootStash) while a guest plays, and the guest's (K.guestStash) while they are away. Pure over K.
import { newPlayer } from './controls.js';
import { initPlayer } from './encounter.js';
import { revealSquare, SIGHT_HALF } from './fog.js';

export function guestSeated(K) { return !!(K && K.root && K.root.human && !K.root.away); }
export function seatName(K) { return guestSeated(K) ? (K.root.display || 'Guest') : 'Root'; }

// The guest sits down on the second start's doorstep (or where they stood last time). Refused while Root plays.
export function seatGuest(K, rootPlaying = false, name = 'Guest') {
  if (!K || !K.starts) return { ok: false, text: 'no board' };
  if (guestSeated(K)) return { ok: false, text: (K.root.display || 'The guest') + ' is already playing' };
  if (rootPlaying || (K.root && !K.root.human && !K.root.away)) return { ok: false, text: 'Root is in the second seat: send Root home first' };
  if (K.root && !K.root.human) K.rootStash = K.root;   // Root's party, stones and coins wait for Root
  const s = K.starts[1];
  const back = K.guestStash; delete K.guestStash;
  K.root = back || initPlayer(newPlayer(s.x, s.y), 'guest');   // its own id: baits, growls and news never follow the seat to someone else
  if (!back) { K.root.x = s.x; K.root.y = s.y; }
  K.root.human = true; K.root.away = false; K.root.display = String(name || 'Guest').replace(/[^A-Za-z0-9' ]/g, '').trim().slice(0, 16) || 'Guest';
  K.root.boat = false; K.root.follower = null; K.root.followerAt = null;
  revealSquare(K, K.root.x, K.root.y, SIGHT_HALF);
  return { ok: true, text: K.root.display + ' joins on the doorstep of ' + K.stores[s.store].name + (back ? ' with what they had' : '') };
}

// The guest gets up: their record waits for them, and Root's comes back to the seat (away until Root is called in).
export function unseatGuest(K) {
  if (!guestSeated(K)) return { ok: false, text: 'no guest is playing' };
  const g = K.root; g.away = true; g.follower = null; g.followerAt = null;
  K.guestStash = g;
  K.root = K.rootStash || null; delete K.rootStash;
  if (K.root) K.root.away = true;
  if (K.cam === 'root') K.cam = 'kevin';
  return { ok: true, text: g.display + ' leaves; what they carry waits for them' };
}
