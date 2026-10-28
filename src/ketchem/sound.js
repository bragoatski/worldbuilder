// Ketch'em's three sounds (mechanics 9b: "a single short click, burst and growl sample would be enough"): synthesised
// with WebAudio, no files. The click is a catch, the burst a stone breaking free, the growl a predator's warning. They
// follow the effects list the canvas already draws (K.fx), each at the moment the animation shows it, and only for
// what is in the sight square of someone at this screen (Kevin, and a guest at the same keyboard or pad); a guest on
// another screen hears their own (soundsDue, sent through the link). O or the HUD chip turns sound on and off here.
// Loads without a window (tests): every entry point is a no-op there.
import { tick } from '../sim.js';
import { audio, SOUNDS } from './synth.js';

const KEY = 'ketchem.sound';
let on = true;
try { if (typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === 'off') on = false; } catch { /* storage blocked: default on */ }
export function soundOn() { return on; }
export function toggleSound() {
  on = !on;
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* storage blocked: the choice lasts this page */ }
  return on;
}

export { SOUNDS };

// Each effect sounds once (WeakSet), at its moment: a throw's click or burst when the wobbles end (9b), a growl with
// each warning pulse.
const done = new WeakSet();
// A player's sight square (controls.js: 4, or 5 under Hawkeye): what they can see, they can hear.
function inSight(K, x, y, p = K.kevin) {
  if (!p || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const h = (p.effects || []).some(e => e.potion === 'Hawkeye' && e.until > tick) ? 5 : 4;
  return Math.abs(x - p.x) <= h && Math.abs(y - p.y) <= h;
}
// What one effect sounds like at t ticks after it started: 'wait' (not yet), null (silent: done, out of sight, or long
// past after a load or a pause), or the sound's name. Pure, so the timing is testable.
export function soundFor(K, e, t, p = K.kevin) {
  if (e.kind === 'throw') {
    const at = 12 + (e.wobbles || 0) * 10;   // throw 8 + pull-in 4 + the wobbles (9b): the click or the burst
    if (t < at) return 'wait';
    if (t > at + 12 || !e.to || !inSight(K, e.to.x, e.to.y, p)) return null;
    return e.caught ? 'click' : 'burst';
  }
  if (e.kind === 'pulse') return t > 6 || !inSight(K, e.x, e.y, p) ? null : 'growl';   // each warning pulse (11.2: a sound plus a small red ripple)
  return null;
}
// The sounds now due for these listeners, each effect once per done-set: 'wait' keeps an effect for a later look; the
// first listener who can hear it decides. Pure over K apart from the done-set.
export function soundsDue(K, listeners, doneSet) {
  const out = [];
  if (!K || !K.fx) return out;
  for (const e of K.fx) {
    if (doneSet.has(e)) continue;
    let name = null, wait = false;
    for (const p of listeners) { const n = soundFor(K, e, tick - e.start, p); if (n === 'wait') { wait = true; break; } if (n) { name = n; break; } }
    if (wait) continue;
    doneSet.add(e);
    if (name) out.push(name);
  }
  return out;
}
// This screen's listeners: Kevin, and a guest playing here rather than from another screen.
export function screenListeners(K) {
  const g = K && K.root && K.root.human && !K.root.away && !K.root.remote ? K.root : null;
  return [K.kevin, g].filter(Boolean);
}
export function soundTick(K) {
  if (!K || !K.fx || !on) return;
  let c = null;
  for (const name of soundsDue(K, screenListeners(K), done)) if ((c = c || audio())) SOUNDS[name](c);
}
