# STATUS - Worldbuilder

_Current truth. Overwritten each checkpoint. The newest handoff in `docs/04 Handoffs/` has the narrative._

## Where things are (2026-06-22)
Codebase professionalization is well underway on branch **`professionalize-codebase`** (NOT yet merged to `main`; `main` + the live GitHub Pages site are untouched and still serve the original single-file build). Four green commits landed this session, each with the gate passing:
- **Vite + TypeScript + vitest toolchain.** `index.html` now loads `src/main.js` as an ES module (the former IIFE is top-level module scope). Dev: `npm run dev` (serves at `/worldbuilder/`).
- **Headless assertion gate.** The ~52 in-page (`T`) assertions now run in Node via vitest (`src/sim.test.js`) - the manual "press T" gate is automated. `init`/`runTests` were split into DOM-free cores (`initWorld`, `runAssertions`) plus DOM wrappers; pure entry points are exported from `src/main.js`.
- **Measurement harness** (`npm run measure`, `scripts/harness.mjs`): N seeds x M ticks headless -> extinction rate, time-to-extinction, oscillation, variance. The ecosystem-tuning instrument Kevin asked for.
- **ESLint + GitHub Actions CI** (`.github/workflows/ci.yml`): typecheck + lint + test + build on every push/PR.

The gate is now `npm run typecheck && npm run lint && npm test` (+ `npm run build`). All green as of this checkpoint.

- Repo: https://github.com/bragoatski/worldbuilder
- Live (unchanged, original build): https://bragoatski.github.io/worldbuilder/

## NEXT (in order)
1. **Decide + act on the deploy switch BEFORE merging to `main`.** Because `index.html` now loads the Vite bundle, the live site must serve built `dist/`. The CI `deploy` job does this but is inert until the repo's **Pages source is switched to "GitHub Actions"** (Settings -> Pages). Switch it, then merge `professionalize-codebase` -> `main`. (Kevin's call / action.)
2. **DECISION (Kevin): seed the ecology RNG?** Terrain is seeded; ecology still uses raw `Math.random()`, so per-seed runs aren't reproducible. The harness works on aggregates regardless, but reproducible single-run debugging/A-B tuning needs deterministic ecology. This is Kevin's long-standing open question.
3. **Ecosystem balance work, now measurable.** Use the harness to attack the traveling-wave extinction. First lever surfaced: `herbivoreEatSpeed === herbivoreSpeed` (the relaxed "eats slower than moves" assertion) - try making eating slower than moving and MEASURE the extinction-rate change. Then density-dependence + refugia (see North Star doc).
4. **Optional cleanups (lower value now):** split the DOM-free sim core out of `src/main.js` into its own `sim.js` (removes the interim DOM stub, enables strict per-module TS), then tighten types. Headless already works via the stub, so this is cleanliness, not capability - safe to do under the now-green gate.

## Known gaps
- The headless harness imports the browser entry `main.js` via a permissive DOM stub (`scripts/headless-dom.mjs`); interim until the sim core is split out.
- Terrain genesis is slow (~3-4k ticks to ~30% land); ecology studies must warm up accordingly.
- ESLint runs `eslint:recommended` with legacy-pattern rules downgraded to warnings (19 advisory warnings in `main.js`); it errors only on genuinely new bugs.
- Per-seed ecology not reproducible (NEXT #2).

## Open decisions (Kevin's)
- Pages source switch + merge to main (NEXT #1).
- Deterministic ecology yes/no (NEXT #2).
- Definition of "balanced" for the ecosystem (needed before serious tuning; see North Star doc).
- North star (income / community / portfolio / love) - still drives long-term priority.
