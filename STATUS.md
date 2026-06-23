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

## Ecosystem balance work (active 2026-06-22)
Plan lives in `docs/01 Design/Balance Proposal.md` (read it - decisions, knob families, metrics, baselines). Kevin's resolved decisions: balance is achieved by TUNING RATES into a natural bounded predator-prey oscillation, NOT by population caps (a run that hits a cap = failure); seed the ecology RNG (done); keep the flora per-tile limit (food base); include the prey-dependent predator spawn-rescue (knob D); and make herds FRAGMENT into many spaced-out groups (knob C / spatial dispersion is a desired feature, not a fallback).

**Step 1 DONE: ecology RNG seeded.** Added the `eRng` dynamics stream (see Engineering Lessons - Reproducibility). Terrain stream (`sRng`) byte-identical; new ecology-determinism test green; re-baselined (seeded numbers in the proposal). Runs are now reproducible, so A/B tuning is a clean comparison.

## NEXT (in order)
1. **Harness metrics + terrain snapshot.** Add the cycle-aware metrics (predator-prey phase lag, per-trophic period/amplitude, completed-cycles, carnivore-persistence, per-trophic min floor, cap-hit count, spatial-dispersion / cluster count) and a post-warmup terrain snapshot to cut the ~70s/seed re-run cost. The instrument the tuning depends on.
2. **Ecosystem tuning loop** (awaiting Kevin's go per step): knob A (predator numerical-response lag - the "do not grow too fast" knob) -> add D (spawn rescue) -> tune C (dispersion/asynchrony) -> fine-tune B alongside. Each step one reproducible A/B vs the seeded baseline, kept only if the cycle metrics improve. Stop when the Decision-1 target (bounded coexisting oscillation, no cap-hits) is met.
3. **Rivers** (after ecosystem): priority-flood -> flow-accumulation rewrite of `generateRivers` + connectivity assertions + visual verify.
4. **Beaches:** cut or cosmetic-only coastline pass; lowest priority.
5. **Optional deep cleanup:** split the DOM-free sim core out of `src/main.js` into its own `sim.js` (removes the interim DOM stub, enables strict per-module TS). Touches the render/UI shell the gate can't see, so it needs its own browser verify + redeploy - a focused follow-up, not reflexive.

## Known gaps
- The headless harness imports the browser entry `main.js` via a permissive DOM stub (`scripts/headless-dom.mjs`); interim until the sim core is split out.
- Terrain genesis is slow (~3-4k ticks to ~30% land); ecology studies must warm up accordingly.
- ESLint runs `eslint:recommended` with legacy-pattern rules downgraded to warnings (19 advisory warnings in `main.js`); it errors only on genuinely new bugs.

## Open decisions (Kevin's)
- North star (income / community / portfolio / love) - still drives long-term priority.
- (RESOLVED 2026-06-22: deterministic ecology = yes/done; "balanced" = tuned bounded oscillation, no caps; flora limit kept; spawn-rescue in; dispersion is a goal. See Balance Proposal.)
