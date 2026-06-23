import { describe, it, expect } from 'vitest';

// Headless DOM stub: main.js is the browser entry, so importing it in Node runs its
// UI wiring (getElementById/addEventListener/etc). A permissive Proxy element lets that
// wiring no-op so we can drive the pure simulation + assertions. This stub goes away
// once the sim core is split out of the shell into its own DOM-free module.
function installDomStub() {
  const el = new Proxy(function () {}, {
    get(_t, p) {
      if (p === 'style') return new Proxy({}, { get: () => '', set: () => true });
      if (p === 'classList') return { toggle() {}, add() {}, remove() {}, contains: () => false };
      if (p === 'getContext') return () => null;
      if (p === 'getBoundingClientRect') return () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
      if (p === 'querySelectorAll') return () => [];
      if (p === 'querySelector' || p === 'closest') return () => null;
      if (p === 'getAttribute') return () => null;
      if (p === 'addEventListener' || p === 'removeEventListener' || p === 'appendChild' || p === 'removeChild' || p === 'click') return () => {};
      if (p === 'value' || p === 'textContent') return '';
      if (p === 'checked') return false;
      if (p === 'offsetWidth' || p === 'offsetHeight' || p === 'width' || p === 'height') return 0;
      return undefined;
    },
    set() { return true; },
  });
  globalThis.document = {
    getElementById: () => el, querySelector: () => el, querySelectorAll: () => [],
    addEventListener: () => {}, createElement: () => el, body: el,
  };
  globalThis.window = { addEventListener: () => {}, removeEventListener: () => {}, innerWidth: 0, innerHeight: 0 };
}
installDomStub();

const sim = await import('./main.js');

describe('in-page assertions (headless)', () => {
  it('every assertion passes after a fresh world init', () => {
    sim.initWorld(12345);
    const { pass, fail, out } = sim.runAssertions();
    // Surface the full assertion log if anything is red.
    expect(fail, '\n' + out.join('\n')).toBe(0);
    expect(pass).toBeGreaterThan(40);
  });

  it('is deterministic for a fixed seed (terrain)', () => {
    sim.initWorld(777);
    const landA = sim.landCoverage();
    sim.initWorld(777);
    const landB = sim.landCoverage();
    expect(landB).toBe(landA);
  });
});
