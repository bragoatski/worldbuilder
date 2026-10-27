// Ketch'em's three sounds (mechanics 9b: "a single short click, burst and growl sample would be enough"): synthesised
// with WebAudio, no files. The click is a catch, the burst a stone breaking free, the growl a predator's warning. They
// follow the effects list the canvas already draws (K.fx), each at the moment the animation shows it, and only for
// what is in Kevin's sight square. O or the HUD chip turns sound on and off; the choice is kept per browser.
// Loads without a window (tests): every entry point is a no-op there.
import { tick } from '../sim.js';

const KEY = 'ketchem.sound';
let on = true, ctx = null;
try { if (typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === 'off') on = false; } catch { /* storage blocked: default on */ }
export function soundOn() { return on; }
export function toggleSound() {
  on = !on;
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* storage blocked: the choice lasts this page */ }
  return on;
}

function audio() {
  if (typeof window === 'undefined' || !(window.AudioContext || window.webkitAudioContext)) return null;
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); return null; }   // no gesture yet: skip, rather than queue sounds to play all at once on the first key
  return ctx;
}
const VOL = 0.14;
function env(c, g, at, peak, len) { g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, at + len); }
// A catch: two bright blips, the stone shutting and a sparkle.
function click(c) {
  const t = c.currentTime;
  for (const [f, d] of [[1250, 0], [1900, 0.06]]) {
    const o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.value = f; env(c, g, t + d, VOL * 0.5, 0.06);
    o.connect(g).connect(c.destination); o.start(t + d); o.stop(t + d + 0.08);
  }
}
// A stone breaking free: a short noise burst falling through a low-pass.
function burst(c) {
  const t = c.currentTime, n = Math.floor(c.sampleRate * 0.2), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = b; f.type = 'lowpass'; f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.2); env(c, g, t, VOL, 0.2);
  s.connect(f).connect(g).connect(c.destination); s.start(t);
}
// A predator's warning: a low sawtooth with a slow wobble, under half a second.
function growl(c) {
  const t = c.currentTime, o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), f = c.createBiquadFilter(), g = c.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(95, t); o.frequency.linearRampToValueAtTime(75, t + 0.45);
  lfo.frequency.value = 18; lg.gain.value = 12; lfo.connect(lg).connect(o.frequency);
  f.type = 'lowpass'; f.frequency.value = 420; env(c, g, t, VOL * 1.2, 0.45);
  o.connect(f).connect(g).connect(c.destination); o.start(t); lfo.start(t); o.stop(t + 0.5); lfo.stop(t + 0.5);
}
export const SOUNDS = { click, burst, growl };

// Each effect sounds once (WeakSet), at its moment: a throw's click or burst when the wobbles end (9b), a growl with
// each warning pulse.
const done = new WeakSet();
// Kevin's sight square (controls.js: 4, or 5 under Hawkeye): what he can see, he can hear.
function inSight(K, x, y) {
  const p = K.kevin; if (!p || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const h = (p.effects || []).some(e => e.potion === 'Hawkeye' && e.until > tick) ? 5 : 4;
  return Math.abs(x - p.x) <= h && Math.abs(y - p.y) <= h;
}
// What one effect sounds like at t ticks after it started: 'wait' (not yet), null (silent: done, out of sight, or long
// past after a load or a pause), or the sound's name. Pure, so the timing is testable.
export function soundFor(K, e, t) {
  if (e.kind === 'throw') {
    const at = 12 + (e.wobbles || 0) * 10;   // throw 8 + pull-in 4 + the wobbles (9b): the click or the burst
    if (t < at) return 'wait';
    if (t > at + 12 || !e.to || !inSight(K, e.to.x, e.to.y)) return null;
    return e.caught ? 'click' : 'burst';
  }
  if (e.kind === 'pulse') return t > 6 || !inSight(K, e.x, e.y) ? null : 'growl';   // each warning pulse (11.2: a sound plus a small red ripple)
  return null;
}
export function soundTick(K) {
  if (!K || !K.fx || !on) return;
  let c = null;
  for (const e of K.fx) {
    if (done.has(e)) continue;
    const name = soundFor(K, e, tick - e.start);
    if (name === 'wait') continue;
    done.add(e);
    if (name && (c = c || audio())) SOUNDS[name](c);
  }
}
