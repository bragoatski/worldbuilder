# STATUS - Worldbuilder

_Current truth. Overwritten each checkpoint. The newest handoff in `docs/04 Handoffs/` has the narrative._

## Where things are (2026-06-22)
Codebase professionalization is DONE and DEPLOYED. Branch `professionalize-codebase` was fast-forwarded into **`main`** (`ff515b4`) and pushed; the repo's Pages source is now "GitHub Actions" and the CI workflow built + published the Vite `dist/` bundle. **Live and confirmed:** https://bragoatski.github.io/worldbuilder/ serves the hashed bundle, HTTP 200, CI conclusion success.

Five green commits landed this session, each with the gate passing:
- **Vite + TypeScript + vitest toolchain.** `index.html` now loads `src/main.js` as an ES module (the former IIFE is top-level module scope). Dev: `npm run dev` (serves at `/worldbuilder/`).
- **Headless assertion gate.** The ~52 in-page (`T`) assertions now run in Node via vitest (`src/sim.test.js`) - the manual "press T" gate is automated. `init`/`runTests` were split into DOM-free cores (`initWorld`, `runAssertions`) plus DOM wrappers; pure entry points are exported from `src/main.js`.
- **Measurement harness** (`npm run measure`, `scripts/harness.mjs`): N seeds x M ticks headless -> extinction rate, time-to-extinction, oscillation, variance. The ecosystem-tuning instrument Kevin asked for.
- **ESLint + GitHub Actions CI** (`.github/workflows/ci.yml`): typecheck + lint + test + build on every push/PR.

The gate is now `npm run typecheck && npm run lint && npm test` (+ `npm run build`). All green as of this checkpoint.

- Repo: https://github.com/bragoatski/worldbuilder
- Live (unchanged, original build): https://bragoatski.github.io/worldbuilder/

## NEXT (in order)
1. **Confirm the live RENDER.** CI/HTTP are green, but the headless gate is blind to canvas render + UI. Open the live site (or `npm run dev`), Start, press `T` (should read 0 failed now), click around. The init/runTests refactor is behavior-preserving by construction, so this is a sanity check; if anything is off, `git revert` restores the prior build instantly.
2. **DECISION (Kevin): seed the ecology RNG?** Terrain is seeded; ecology still uses raw `Math.random()`, so per-seed runs aren't reproducible. The harness works on aggregates regardless, but reproducible single-run debugging/A-B tuning needs deterministic ecology. Long-standing open question.
3. **Ecosystem balance work, now measurable.** Use `npm run measure` to attack the traveling-wave extinction. First lever surfaced: `herbivoreEatSpeed === herbivoreSpeed` (the relaxed "eats slower than moves" assertion) - try making eating slower than moving and MEASURE the extinction-rate change. Then density-dependence + refugia (see North Star doc).
4. **Optional deep cleanup (polish, not capability):** split the DOM-free sim core out of `src/main.js` into its own `sim.js` (removes the interim DOM stub, enables strict per-module TS). Headless already works via the stub, so this is cleanliness. NOTE it touches the render/UI shell that the gate can't see, so it needs its own browser verify + redeploy - do it as a focused follow-up, not reflexively.

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
