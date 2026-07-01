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

## Ecosystem tuning loop - the work (2026-06-22..23); outcome ACCEPTED + SHIPPED (see next section)
Ran the autonomous knob loop (Kevin's mandate: tune until balance or a clearly better baseline, taking cascade notes). Full A/B ledger: `docs/01 Design/Ecosystem Tuning Log.md`. **Committed best = "C2" (`2c24af7`):** `carnivoreEatGain 40` (knob A, `5827511`), prey-dependent carnivore rescue (knob D, `4518b43`), `herbivoreCrowding 2.0` (knob C, `2c24af7`).

On the standard 1000-tick protocol, C2 vs the seeded baseline: full-extinction **17% -> 0%**, carnivore-persistence **0% -> 83%**, phase lag **-44t -> +68t** (carnivores now peak AFTER prey - a real coupled cycle), cap-hits 0. Knob C (herbivore conspecific crowding = spatial dispersion) was the load-bearing lever, exactly as the proposal predicted; A and D tune rates but cannot break the global synchrony alone.

**Key finding (long-run validation + post-V1 experiments):** the world is NON-STATIONARY - terrain genesis never stops, so land grows ~24% -> ~54% and flora ~2k -> ~11k over a longer window. C2 is WINDOW-balanced (excellent at land ~24%) but NOT steady-state. The ROOT cause is the **paradox of enrichment**: as the rising carrying capacity K grows, the predator-prey cycle amplitude grows until troughs hit zero -> 33% of seeds crash by 3000t. We TESTED the prey-side fixes and both fail for the same reason: knob B (local density-dependent birth) is INERT (knob C already keeps local density low), and pushing dispersion (crowding 2.0->2.5) BACKFIRES (raises effective K -> cap-hits 27->388). So no fixed rate-knob set balances a world with unbounded-growing K. Full A/B trail in the tuning log (steps B1/B2, C3 + FINAL STATE); durable lessons in Engineering Lessons (non-stationary world, RNG reshuffle, eatGain-vs-eatSpeed, crowding-is-load-bearing, paradox-of-enrichment).

## Ecosystem balance: ACCEPTED + SHIPPED (Kevin, 2026-06-23)
Kevin's call: **accept C2 and ship it.** C2 is the committed balanced baseline (knobs A+D+C; 1000t: 0% extinction / 83% persistence / +68t lag). The clean rate-knob search is EXHAUSTED - everything past C2 (knob B, the D re-tunes, eatGain 32, eatSpeed 26, crowding 2.5) was measured and reverted. The long-run gap is the paradox of enrichment under non-stationary K, which rate knobs cannot reach; treated as ORGANIC living-world behavior, not a bug. **`faunaMaxPop` kept at 400** (deliberate, NOT raised): the long-run data shows the cap does benign STABILIZING work (clamps the seed-1202 boom and keeps it alive), so raising it would risk trading a metric artifact for a real boom-and-crash. If steady-state long-run balance ever becomes a priority, the root fix is to BOUND K generation-side (cap land/flora growth) or add an enrichment-robust mechanism (predator interference / prey predation-refuge) - see the tuning log FINAL STATE + Engineering Lessons (paradox of enrichment).

## Rivers (2026-06-23) - DONE + DEPLOYED to Pages (main `5ee98df`, CI success, live bundle index-D0G5m6MV.js)
Rewrote `generateRivers` as the standard hydrology pipeline (priority-flood depression fill -> D8 flow
receivers -> flow accumulation -> threshold), replacing the greedy downhill tracer that dead-ended in
basins. Guarantees dendritic rivers reaching the sea by construction; structural invariants gate-tested
on a synthetic continent (`sim.test.js`). Full clean gate green (typecheck + lint + 7 tests + build).

Tuned with Kevin over several visual rounds (the render is GATE-BLIND - verified via the `?debug`
`window.__wb` handle + `scripts/make-preview-world.mjs`, see Engineering Lessons):
- **Default `maxLandCap` 0.60 -> 0.90** so the world starts as a continent (islands now require dialing
  the slider back). This is the lever that lets rivers grow long (maxAcc ~30 at 55% land vs ~345 at 89%).
  TRADEOFF: default ecology now runs at ~90% land vs the ~24% C2 was tuned at (flagged; slider-adjustable).
- Rivers: brighter color, UNIFORM width per river set by river LENGTH (main-stem decomposition), more
  meander, threshold 22 (~4% coverage, nuanced not covered), mouths clipped at the coast (no ocean bleed),
  occasional braided deltas at wide mouths.
- Lakes: FEWER + BIGGER + VARIED, placed as source lakes at the highest river heads (natural fill-lakes are
  only coastal); smooth curved per-lake shores from a shape outline (~1/3 given a distinctive non-circular
  shape), the shape also defines the cell mask so flora/fauna are suppressed across the whole lake footprint
  and no river line is ever drawn inside a lake.

**Fauna distribution (Kevin asked: rarer / crowd water / rare in deserts) was ATTEMPTED and REVERTED** -
the harness proves it regresses the C2 balance (0%->17% extinction, 83%->50% carnivore-persistence) because
fauna scoring is what knob C uses to disperse the herd (see Engineering Lessons). It needs its own
harness-tuned loop, NOT a quick add. The branch's ecology is back to C2 (only the render suppression of
fauna/flora ON lakes is kept - balance-neutral).

Deployed 2026-06-23 (Kevin's call: ship rivers/lakes; fauna as a separate task). Open follow-ups: the
`maxLandCap=0.90` ecology tradeoff; richer braided deltas.

## Flora distribution + clustering (2026-06-24) - DONE + deploying to Pages
Kevin: flora overran the map; make it fewer / cluster on rivers+lakes / struggle in deserts, then re-balance.
Shipped two flora-only mechanisms (biomes/terrain untouched), behind CFG knobs + live Ecology sliders
(Flora Thinning / Water Clustering / Desert Harshness):
- **Clustering** - new `waterDist` field (BFS to ocean/coast/river/lake) drives flora placement + a survival
  brake; an aridity brake clears deserts. Flora hugs water + (in-browser, with rivers) the river network.
- **Maturity thinning** - `floraLandThin` scales flora spread/spawn down as land fills, INERT below 40%
  land. This is what "balances the rest": the low-land C2 balance (tuned at ~24% land) is preserved while
  the matured ~90%-land world stops being carpeted.

Measured (`scripts/flora-ab.mjs`, warm-per-variant): high land ~76% coverage **66% -> 41%** (flora ~halved),
flora now clusters wetter-than-land + near-water, **desert share 1.6% -> 0%**, predator-prey cycle held (0%
extinction, carnivores persist). Low land (8-seed clean A/B): balance **neutral-to-better** (extinction 13%
vs 25%) - the standard harness's 17%/50% was an RNG-reshuffle artifact (flora identical), see Engineering
Lessons. Kevin signed off on the in-browser look (gate-blind: rivers absent from the harness). Full gate
green (typecheck + 7 tests + lint + build). New instruments: harness flora-distribution block + `flora-ab.mjs`.

**River density (2026-06-24, follow-up):** Kevin saw too few rivers - root cause was under-developed preview
worlds (rivers need ~85-90% land to form; the previews were ~56%), NOT a regression (flora work never touched
river code). Made the render threshold a CFG knob + live "River Density" slider (Terrain panel) and lowered the
default 22 -> 14 (river coverage 4.1% -> 6.0% at 88.7% land; also surfaces rivers at lower land). `preview-1000.json`
is a high-land (88.7%) world for checking the look.

## 2026-06-25 session - menu + cleanup + river-feel + herbivore desync (ALL DEPLOYED, live bundle index-Cc5Q1Q42.js)
- **Control Deck menu** (`index.html`, 2eb4949): two-tier deck - icon transport (play/pause/step/reset/force) + live telemetry chips (tick + flora/herb/carn) + labeled setup deck (World/Populate/Data); world-averages moved to the sidebar. Replaces the old single toolbar+status bar (top scrollbar / left-stretched look).
- **Removed beaches + ecotone/ecology overlays** (54d2c54): the whole beach erosion sim (beachStep, render, ~12 CFG.beach*, the cap slider) is GONE; the Ecotone overlay + Blending toggle and the Ecology overlay button removed. KEPT the 1.6x ecotone flora-edge boost (balance-load-bearing).
- **River-feel pass** (6a55b45): unified lake/river color (#3aa6e0), removed the tiny per-headwater source pools, source lakes 6->3 + ~half radius, never bleed into ocean (lake ocean-reject + butt-cap clipped river mouths + braided deltas cut), routing smoothing 3->6 for longer continent-stretching flows.
- **Herbivore desync + carnivore re-balance** (08933c5): herbivores get a position-based move/eat phase so the herd stops growing as a synchronized pulsing ring. Desync alone STARVES carnivores (clustered prey ring = predator food, 83%->0%); compensated (carnivoreEatGain 40->55, scent ring 2-3->2-5, knob-D rescue boost). Harness 10 seeds: **0% extinction / 80% carnivore-persistence = C2**. See Engineering Lessons (Fauna distribution vs the balance).
- **2026-06-28 river visibility** (Kevin: "ran 2 sims, no rivers"; herbivores confirmed GREAT): root cause was land level - rivers only form at high land (`scripts/river-diag.mjs`: 0 below ~40% land, the good ones at ~88%). Lowered default `riverAccumThreshold 14 -> 6` (slider dense-end min 6 -> 3) so rivers show ~4x more at moderate land, still dendritic on real terrain. Rivers stay MANUAL (Rivers button / slider) - auto-generating them cost carnivore-persistence 80% -> 60% (rivers concentrate flora), so it was reverted. Balance still 0%/80%.
- **GATE-BLIND visual confirmations still open** (shipped to live for Kevin): rivers now show at moderate land when you click Rivers / use the River Density slider (no need to grind to ~90% land).

## Seasons / climate rebuild (2026-06-29) - DONE + DEPLOYED (main `28ebcce`, ff'd + pushed, CI live bundle index-DTrtWU3A.js)
Kevin: "look into the seasons, make sure they are balanced when turned on." Investigation (via the new
`scripts/season-probe.mjs` + harness `--seasons` flag) found Seasonal Tilt was structurally BROKEN, not just
mis-tuned: the seasonal delta was INTEGRATED onto `tempField`/`aridity` every tick while `computeTemperature`/
`computeAridity` (which overwrite the field) were suppressed when climate was on. Result: (1) a permanent
cool/dry DRIFT (the plateau waveform averaged ~-0.15, not zero), and (2) REGIME-DEPENDENCE - seasons were
nearly invisible until land hit the cap and genesis stopped, then surfaced as drift.

Fix (Kevin chose: proper redesign + moderate strength): rewrote climate as a bounded, zero-mean OFFSET on a
cached genesis baseline. `computeTemperature`/`computeAridity` now write `baseTemp`/`baseArid`; `applyClimate`
runs every tick and sets live temp/aridity = base + seasonal/anomaly/volcano offsets (recomputed, never
accumulated). New `seasonWave` is a symmetric trapezoid (zero-mean, gate-tested). Amplitude knobs in CFG
(`seasonalTempAmp` 1.5 etc.). Anomalies + volcano ash converted to bounded offsets too (they shared the bug).

Validated: probe shows NO drift at the matured world (phase-0 Tmean constant 4.31 vs old 4.37->3.97) and
seasons now visible at ALL land levels. Balance A/B (harness `--seasons`): clean C2 window (8 seeds, 1000t)
cap-hits 0 both, seasons slightly DAMP the swing (osc 85->69); harsh long window (6 seeds, 4000t) extinction
33%->17%, carn-persistence 67%->83% - seasons are neutral-to-stabilizing, never destabilizing. Crucially,
climate-OFF is byte-identical to before (field=base+0), so C2 is untouched. Gate GREEN (typecheck + 7 tests
incl. new zero-mean wave test + lint 0 errors). Engineering Lessons + CodeMap updated.

NOTE: an unexpected commit `7ab8ffc` ("chore(harness): preserve season/climate A/B probe tooling (WIP)")
appeared mid-session (20:33, authored bragoatski) committing the probe tooling but NOT the main.js fix -
likely a concurrent session or a manual checkpoint. The main.js redesign is committed on top (see git log).
DEPLOYED 2026-06-29 (Kevin's call: ship it). OPEN follow-ups: visual eyeball of the seasonal swing +
Climate Δ overlay (render is gate-blind, not yet eyeballed); the amp knobs (`seasonalTempAmp` etc.) have no
UI sliders yet (tunable in code); this STATUS doc-fix sits on `ecology-balance` ahead of `main` by one commit.

## Chronicle - Living World chunk 1 (2026-06-29) - DONE, deploying
Direction set with Kevin (see `docs/01 Design/Living World Roadmap.md`): AMPLIFY the simulation, do not
discard it. Threads 1 (deepen the living-world sim) + 2 (god-game agency) first; 3 (shareable worlds) folds
in. Per-chunk workflow: one large chunk -> full gate -> docs -> commit -> deploy -> next-session prompt.

Chunk 1 = **the Chronicle** (the world's memory). A PURE, headless-safe event log: `chronicleSample()` runs
at the END of `step()` on a 10-tick cadence, derives population/lineage stats, and emits typed events off
round-number milestone LADDERS (so the feed reads as a story, not +1 spam): extinctions/arrivals, population
+ flora + land milestones, generation milestones (named once a lineage hits gen>=5), crashes, vivid-lineage
emergence, longevity records. No DOM / no RNG in the sampler (Worker-safe + deterministic);
`renderChronicle()` is the only DOM part - a new "Chronicle" sidebar panel + a notable-life records strip.
`chronicleNote()` is exposed for chunk-3 god-powers to log deliberate acts. BALANCE-SAFE (read-only
observation; no fauna rate/behavior touched), and it round-trips through snapshot/restore. Gate GREEN:
typecheck + lint (0 errors) + 10 tests (new: ladder-monotone, `chronicleNote` contract,
determinism-through-snapshot) + build. The PANEL RENDER is gate-blind -> needs an eyeball in the live app.

## Chronicle - Living World chunk 2 (2026-06-30) - DONE + DEPLOYED (main d7d0191, ff'd + pushed, CI success, live bundle index-0doKaswX.js)
Make evolution VISIBLE (pillar A). Shipped, balance PROVEN safe (harness byte-identical before/after):
- **Heritable cosmetic `size` gene.** Founders start at exactly 1.0; the gene only diversifies through
  inherited drift in `mutateFaunaChild` (so a large lineage is visibly EVOLVED, not initial luck). Drift
  is drawn from a NEW isolated RNG stream `cRng` (`cRandn`, offset `_seed ^ 0x85EBCA6B`) so it NEVER
  consumes an `eRng` draw -> the ecology trajectory (and C2 balance) is byte-identical. Clamped [0.5,2.2].
  Rendered as the fauna marker dimension (`dim` in `draw`). Knob: `CFG.faunaSizeMutationMag` (0.09).
- **`lineageId` gene** (founder = own id, inherited) so living kin are countable. Pure annotation.
- **Follow-a-creature camera:** `followId` + `updateFollow()` (called at the end of `draw()`) recenters
  the camera on the tracked creature each frame and clears when it dies; `startFollow` zooms in + expands
  the Lineage panel. An accent ring marks the followed creature.
- **Lineage inspector panel** (`#panelLineage`/`renderLineagePanel`): live size/gen/energy/age/genome +
  living-kin count + lineage top-gen + a Stop button. Per-creature **Follow buttons** added to the
  Inspector. Both wired via delegated listeners.
- **Chronicle size record:** `CHRON_SIZE_LADDER` + `records.peakSize`; feed event "a creature grew to N×
  normal size" + a Biggest entry in the records strip.
- Genes round-trip through snapshot/restore (they live on the fauna objects; `cRng` re-seeded in
  `restoreState`). Gate GREEN: typecheck clean + lint 0 errors (23 pre-existing warnings) + **13 tests**
  (was 10; new: size/lineage validity, kin+drift, balance-safe snapshot replay) + build. The RENDER +
  follow camera + panels are gate-blind DOM -> need an eyeball in the live app (follow a creature, watch
  it stay centered; check the size markers + Lineage panel + size events in the Chronicle).

## God powers - Living World chunk 3 (2026-06-30) - DONE + DEPLOYED (main 7ed0da8, ff'd + pushed, CI success, live bundle index-CmijjgF9.js confirmed HTTP 200)
God-game agency (pillar D): deliberate interventions with Chronicle-logged consequence. First BEHAVIOR-touching
chunk, but **balance-safe BY CONSTRUCTION** - proven with a harness before/after (see below). Shipped:
- **Land brush** (`brushTerrain(cx,cy,dir)`): a "God" deck seg -> Raise / Lower buttons set a `placeMode`;
  clicking the map raises or lowers a soft elevation disc (radius/delta in CFG), handling the land<->sea
  boundary (ocean crosses to land at elev>=0.5; land sinks to ocean below 0.35, clearing stranded life),
  then refreshes the climate base + `reclassTerrain`. Logs a `'god'` event on a coastline crossing.
- **Meteor** (`meteorStrike`): aims at the densest life (`_pickStrikeTarget`, or an explicit tile), craters
  terrain (ocean basin at the centre, gouged rim) and wipes fauna + flora in the blast radius (kill particles);
  logs the death toll.
- **Drought** (`droughtEvent`): withers flora weighted by tile aridity (dry interior/deserts scorch worst,
  wet oases persist); logs the loss. The downstream starvation cascade is narrated for free by the existing
  Chronicle crash/extinct detectors.
- **Bloom** (`bloomEvent`): a `seedFloraCluster` burst carpeting the world with new growth; logs it.
All are PURE sim-core mutations (chronicle is headless-safe) + thin DOM button/click wrappers; helpers
`_killLifeAt`/`_compactLife` use the null-then-filter life-array convention. **Why balance-safe:** none run
inside `step()`, and the harness/tests only ever exercise `step()`, so the measured `eRng` stream is untouched.
**Harness proof (`measure --seeds=8` before vs after): BYTE-IDENTICAL** - extinction 0% (0/8), carn-persistence
75% (6/8), phase lag +127t, final fauna 73.6, final flora 2263.8, cap-hits 0 (== the C2 chunk-2 numbers).
Gate GREEN: typecheck clean + lint 0 errors (23 pre-existing warnings) + **17 tests** (was 13; new god-powers
block: brush raise/lower land<->sea, meteor wipes+craters+logs, drought withers+logs, bloom seeds+logs) + build.
The RENDER + the brush/event feel are gate-blind DOM -> eyeball in the live app (Raise/Lower then click the map;
Meteor/Drought/Bloom and watch the Chronicle + the map react).

## NEXT (in order)
The Living World Roadmap (`docs/01 Design/Living World Roadmap.md`) is now the driver; next chunk first,
then the still-valid pre-roadmap backlog.
0. **Living World chunk 4 - Shareable worlds (thread 3).** Seed + CFG -> URL permalink (builds on the JSON
   export) + a "copy world link" action; optionally a Chronicle-driven "postcard". Balance-safe (no step
   changes). Roadmap has the remaining sequence after it (scenarios + objectives, then speciation + trophic
   depth - the harness-heavy chunks, last).
1. **Fauna distribution as a MEASURED ecology task** (Kevin asked: fauna rarer / crowd water / rare in
   deserts like the arctic). It is NOT a quick add - a naive version (harsh-biome avoidance + water
   attraction in `scoreTileForFauna`) regressed the C2 balance to 17% extinction / 50% carnivore-persistence
   because that score is knob C's dispersion lever (see Engineering Lessons - Fauna distribution vs the
   balance). Needs the harness measure->A/B->keep-if-better loop, ideally at the new high-land regime.
   The 2026-06-24 FLORA work now provides reusable pieces: the `waterDist` field (for a fauna water-attraction
   that won't need its own BFS) and the LAND-ADAPTIVE pattern (`floraLandThin`) for changing high-land
   behavior without disturbing the low-land C2 balance.
2. ~~**Beaches:** cut or cosmetic-only coastline pass~~ DONE 2026-06-25: beaches removed entirely (Kevin's call).
3. **Optional deep cleanup:** split the DOM-free sim core out of `src/main.js` into its own `sim.js` (removes the interim DOM stub, enables strict per-module TS). Touches the render/UI shell the gate can't see, so it needs its own browser verify + redeploy - a focused follow-up, not reflexive.

## Known gaps
- The headless harness imports the browser entry `main.js` via a permissive DOM stub (`scripts/headless-dom.mjs`); interim until the sim core is split out.
- Terrain genesis is slow (~3-4k ticks to ~30% land); ecology studies must warm up accordingly.
- ESLint runs `eslint:recommended` with legacy-pattern rules downgraded to warnings (19 advisory warnings in `main.js`); it errors only on genuinely new bugs.

## Open decisions (Kevin's)
- North star (income / community / portfolio / love) - still drives long-term priority.
- (RESOLVED 2026-06-22: deterministic ecology = yes/done; "balanced" = tuned bounded oscillation, no caps; flora limit kept; spawn-rescue in; dispersion is a goal. See Balance Proposal.)
