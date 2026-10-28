// A gamepad for the guest seat (Ketch'em mechanics 25.1). A standard-mapping pad plays the guest at the shared screen:
// each button becomes the guest key it stands for, and main.js hands that key to guestKey, so the pad has no actions of
// its own. While the guest picks a kind or a potion, A B X Y are 1 2 3 4; while the guest's own question is open, A
// answers it and B declines. Pure: the page passes a Gamepad (or anything shaped like one) and the context.

// Standard mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 Back, 9 Start, 10 L3, 11 R3, 12-15 the d-pad.
export const PAD_KEYS = {
  0: '/', 1: '.', 2: "'", 3: ';',          // throw, target, name, use (or "here" for a bait)
  4: '[', 5: ']', 6: 'l', 7: 'j',          // stone back / on, potion, bait
  8: 'h', 9: 'y', 10: ',', 11: 'u',        // give, the Almanac, follow, feed
  12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight'
};
export const PAD_PICK = ['A', 'B', 'X', 'Y'];   // the face buttons in a choice, standing for 1 2 3 4
export const START = 9;
const ON = 0.5, OFF = 0.3;   // a stick or trigger counts down past ON and up only below OFF, so a resting one never chatters

// The buttons held now, as a set of indices; the left stick past half-way counts as the d-pad. prev: what was held at
// the last look (for the lower release line).
export function padPressed(gp, prev = new Set()) {
  const on = new Set();
  if (!gp) return on;
  const line = i => (prev.has(i) ? OFF : ON);
  (gp.buttons || []).forEach((b, i) => { if (b && (b.pressed || b.value > line(i))) on.add(i); });
  const ax = gp.axes || [];
  if (ax[0] < -line(14)) on.add(14); else if (ax[0] > line(15)) on.add(15);
  if (ax[1] < -line(12)) on.add(12); else if (ax[1] > line(13)) on.add(13);
  return on;
}
// What changed since the last look: buttons that went down, and buttons that came up.
export function padEdges(prev, now) {
  return { downs: [...now].filter(i => !prev.has(i)), ups: [...prev].filter(i => !now.has(i)) };
}
// What a button press means now. ctx.asking: the guest's own question is open; ctx.picking: the guest is choosing a
// bait kind or a potion. Returns a guest key, 'ok' / 'cancel' for the question, or null (nothing).
export function padKey(i, ctx = {}) {
  if (ctx.asking) return i === 0 ? 'ok' : i === 1 ? 'cancel' : null;
  if (ctx.picking && i >= 0 && i < PAD_PICK.length) return String(i + 1);
  return Object.hasOwn(PAD_KEYS, i) ? PAD_KEYS[i] : null;
}
// The arrow a released button let go of, so a held move stops (lower case, as guestKey keeps them).
export function padArrowUp(i) {
  const k = Object.hasOwn(PAD_KEYS, i) ? PAD_KEYS[i] : '';
  return /^Arrow/.test(k) ? k.toLowerCase() : null;
}
