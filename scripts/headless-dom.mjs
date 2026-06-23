// Shared headless DOM stub. main.js is the browser entry, so importing it in Node
// runs its UI wiring (getElementById/addEventListener/...). This permissive Proxy
// element lets that wiring no-op so the pure simulation can be driven from vitest and
// the measurement harness. Idempotent and a no-op in a real browser. Goes away once
// the sim core is split out of the shell into its own DOM-free module.
export function installDomStub() {
  if (typeof globalThis.document !== 'undefined') return;
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
