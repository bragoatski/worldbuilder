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

## Branch / deploy
Steps 1 + 2 are MERGED to `main` and pushed (2026-06-22, Kevin's call). They are sim-internal tooling with no visual change, so the CI redeploy is a functional no-op. `ecology-balance` remains the working branch for the tuning loop. (Top "Where things are" section below predates this merge; it narrates the professionalization deploy.)

## Ecosystem balance work (active 2026-06-22)
Plan lives in `docs/01 Design/Balance Proposal.md` (read it - decisions, knob families, metrics, baselines). Kevin's resolved decisions: balance is achieved by TUNING RATES into a natural bounded predator-prey oscillation, NOT by population caps (a run that hits a cap = failure); seed the ecology RNG (done); keep the flora per-tile limit (food base); include the prey-dependent predator spawn-rescue (knob D); and make herds FRAGMENT into many spaced-out groups (knob C / spatial dispersion is a desired feature, not a fallback).

**Step 1 DONE: ecology RNG seeded.** Added the `eRng` dynamics stream (see Engineering Lessons - Reproducibility). Terrain stream (`sRng`) byte-identical; new ecology-determinism test green; re-baselined (seeded numbers in the proposal). Runs are now reproducible, so A/B tuning is a clean comparison.

**Step 2 DONE: harness metrics + terrain snapshot (the instrument step 3 depends on).** The harness now reports the cycle-aware metrics (predator-prey phase lag, per-trophic period/amplitude, completed cycles, carnivore-persistence, per-trophic min floor, cap-hit count, herd spatial dispersion) on top of the old survival/oscillation lines. `snapshotState()`/`restoreState()` warm the slow ~3k-tick terrain ONCE per seed and replay the ecology window (`--snapshot`, `--repeat=N`); a head-to-head timing run cut warmup 31.4s -> 7.7s across 4 replays. New determinism-through-snapshot test green. See Engineering Lessons - Snapshot/restore for the RNG-phase caveat, and the proposal's Implementation status for the seeded baseline cycle numbers. TOOLING ONLY: no ecology rate/behavior changed.

## Ecosystem tuning loop - DONE for now (2026-06-22): a much better baseline committed; full-balance is a Kevin fork
Ran the autonomous knob loop (Kevin's mandate: tune until balance or a clearly better baseline, taking cascade notes). Full A/B ledger: `docs/01 Design/Ecosystem Tuning Log.md`. **Committed best = "C2" (`2c24af7`):** `carnivoreEatGain 40` (knob A, `5827511`), prey-dependent carnivore rescue (knob D, `4518b43`), `herbivoreCrowding 2.0` (knob C, `2c24af7`).

On the standard 1000-tick protocol, C2 vs the seeded baseline: full-extinction **17% -> 0%**, carnivore-persistence **0% -> 83%**, phase lag **-44t -> +68t** (carnivores now peak AFTER prey - a real coupled cycle), cap-hits 0. Knob C (herbivore conspecific crowding = spatial dispersion) was the load-bearing lever, exactly as the proposal predicted; A and D tune rates but cannot break the global synchrony alone.

**Key finding (long-run validation, ticks=3000):** the world is NON-STATIONARY - terrain genesis never stops, so land grows ~24% -> ~54% and flora ~2k -> ~11k across a longer window. C2 is therefore WINDOW-balanced (excellent at land ~24%) but NOT steady-state: at high flora herbivores hit the population cap (a Decision-1 failure) and 2/6 seeds crash past tick ~1300. See the tuning log V1 entry + Engineering Lessons (non-stationary world, RNG reshuffle, eatGain-vs-eatSpeed, crowding-is-load-bearing).

## NEXT (in order)
1. **Ecosystem full-balance fork (Kevin's call - Tier B).** C2 is a large, real improvement and is committed. To close the rest (cap-hits + 2 long-run crashes) the levers are beyond tuning the current knobs: (a) ACCEPT C2 window-balance and move to rivers; (b) add PREY-SIDE density-dependence (herbivore reproduction suppressed by local crowding, not just movement - the proposal's reason-1 fix) to bound amplitude + prevent cap-hits regardless of flora, then validate in the long/high-flora regime; (c) re-baseline against a plateaued (long-warmup) world and re-tune; (d) bound terrain growth. Recommendation: (b), since prey self-limitation fixes the actual long-run failure (flora-driven boom into the cap) at its root.
2. **Rivers** (after ecosystem): priority-flood -> flow-accumulation rewrite of `generateRivers` + connectivity assertions + visual verify.
3. **Beaches:** cut or cosmetic-only coastline pass; lowest priority.
4. **Optional deep cleanup:** split the DOM-free sim core out of `src/main.js` into its own `sim.js` (removes the interim DOM stub, enables strict per-module TS). Touches the render/UI shell the gate can't see, so it needs its own browser verify + redeploy - a focused follow-up, not reflexive.

## Known gaps
- The headless harness imports the browser entry `main.js` via a permissive DOM stub (`scripts/headless-dom.mjs`); interim until the sim core is split out.
- Terrain genesis is slow (~3-4k ticks to ~30% land); ecology studies must warm up accordingly.
- ESLint runs `eslint:recommended` with legacy-pattern rules downgraded to warnings (19 advisory warnings in `main.js`); it errors only on genuinely new bugs.

## Open decisions (Kevin's)
- North star (income / community / portfolio / love) - still drives long-term priority.
- (RESOLVED 2026-06-22: deterministic ecology = yes/done; "balanced" = tuned bounded oscillation, no caps; flora limit kept; spawn-rescue in; dispersion is a goal. See Balance Proposal.)
