// Ketch'em's three sounds as WebAudio synthesis, no files and no imports, so the guest link can serve this module to a
// guest's page as it is (visit/guest-link.mjs, /synth.js) and both screens sound alike. The click is a catch, the burst
// a stone breaking free, the growl a predator's warning. Loads without a window (tests): audio() is null there.
let ctx = null;
export function audio() {
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
// Play one by name; a name it does not know, or no audio yet, is silence.
export function play(name) { const c = Object.hasOwn(SOUNDS, name) ? audio() : null; if (c) SOUNDS[name](c); }
