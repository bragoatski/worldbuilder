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

## Shareable worlds - Living World chunk 4 (2026-06-30) - DONE + DEPLOYED (main ecd62a8, ff'd 7ed0da8..ecd62a8 + pushed, CI success, live bundle index-BBeJNJbL.js confirmed HTTP 200)
Thread 3 (shareable worlds): a world is a shareable LINK. Insight: a world is fully determined at GENESIS by
its **seed + config** (terrain + ecology are deterministic from the seeded streams; `WORLD` is re-derived from
the seed by `pickWorldMeta`), so a compact world code `{ v, seed, preset, cfg-diff-from-default }` reproduces
it - far smaller than the baked `wb-eco-1` JSON snapshot (which stays the exact-evolved-state download path).
Encoded into a `?w=` URL param, so a world is a permalink. Shipped, balance-safe by construction:
- **`buildWorldCode`/`applyWorldCode`** (pure) - build the recipe (cfg = diff-from-`DEFAULT_CFG` MINUS the
  derived elevation keys, which `applyElevationIntensity` recomputes on load -> a default world encodes to an
  EMPTY diff) / apply it (reset CFG to default, layer the diff for KNOWN + matching-typed keys only since a URL
  is untrusted, restore the preset label, `initWorld(seed)`; throws on a malformed / bad-version / seedless code).
- **`encodeWorldCode`/`decodeWorldCode`** - URL-safe base64 codec; `worldPermalink` = `origin+pathname+'?w='+code`.
- **Boot restore** - `init()` consumes a `?w=` param ONCE (`_pendingWorldCode`, one-shot so a later preset/reset
  rolls fresh), applying the code + syncing the UI + noting the Chronicle; a malformed code falls through to a
  fresh world.
- **Share deck seg** (index.html): **Copy Link** (clipboard + `history.replaceState` address-bar reflect) +
  **Postcard** (`worldPostcard`: a Chronicle-driven blurb - seed/preset, tick + land% + flora/herb/carn,
  biggest + oldest named creature, up to 3 recent story beats, and the link). No exclamation marks.
**Why balance-safe:** the only sim mutation is `applyWorldCode` -> `initWorld`, the SAME re-genesis path the
preset selector already uses, and it runs only from boot / a button, never in `step()` -> the measured `eRng`
loop is byte-identical (no harness A/B needed; Kevin flagged this in the prompt). Gate GREEN: typecheck clean +
lint 0 errors (32 warnings, +9 warn-only legacy) + **22 tests** (was 17; new shareable-worlds block: round-trip,
deterministic replay, default-reset, untrusted-input robustness, postcard) + build (bundle `index-BBeJNJbL.js`).
**Gate-blind (DOM):** the Copy Link / Postcard buttons + clipboard + address-bar + `init()`'s `?w=` boot branch
-> eyeball in the live app (load a shared link, confirm the same world; see the chunk-4 handoff checklist).

## Scenarios + light objectives - Living World chunk 5 (2026-06-30) - DONE + DEPLOYED (main da4a4c1, ff'd ecd62a8..da4a4c1 + pushed, CI success, live bundle index-CEEBKIas.js confirmed HTTP 200)
Pillar E: named starting setups + win/lose objectives on top of the sandbox. Shipped, balance PROVEN safe
(harness before/after byte-identical - see below):
- **Four scenarios** (`SCENARIOS` in `src/main.js`), each = a preset + a FIXED seed + a small terrain warmup
  + a burst of initial life + an objective: **Genesis** (balanced; establish a full 3-tier web), **The Long
  Balance** (balanced; keep all three alive 4000 ticks after they establish), **Ice Age Refuge** (iceage;
  keep grazers alive 3000 ticks), **Trial by Fire** (volcanic; keep a full web alive 3000 ticks). Deck seg
  (Scenario dropdown + Start) + an **Objective sidebar panel** (goal, phase, progress bar, per-tier readout).
- **Two objective shapes, one PURE observer** (`evaluateScenario(def,stats,tick,prevStatus)->newStatus`, the
  gate-testable core): `establish` = REACH tier counts (no lose); `endure` = REACH `establish` then HOLD
  `floor` for `duration` ticks, and a drop below the floor AFTER establishment loses. The two-phase shape
  sidesteps the cold start (a world still warming up is never a failure). Terminal states latch.
- **Read-only observer on the step path.** `scenarioSample()` runs at the END of `step()` right after
  `chronicleSample()`, on the same 10-tick cadence: it derives stats, advances the pure evaluator, and
  narrates transitions (`'scenario'` Chronicle events - begun / established / complete / failed). It NEVER
  touches fauna/flora/RNG and early-returns entirely when no scenario is armed (the harness never arms one).
- **Setup is a small ASYNC warmup.** A fresh world is all ocean (land forms only via `step()`), so
  `startScenario` (deck button) warms terrain in 40-step chunks via `setTimeout` (tab stays responsive, the
  world visibly forms) to a LOW land target (~1%), then seeds the initial life + arms the objective. Kept low
  deliberately: a scenario starts small and DEVELOPS during play toward the establish thresholds. The pure
  `applyScenarioDef` (sync, same deterministic path) is what the gate + a scenario permalink boot use.
- **Shareable.** A scenario is a permalink: `buildWorldCode` adds a `scen` field; `applyWorldCode` re-arms the
  named built-in (ignoring the URL cfg diff - only the trusted id + seed ride along). A `?w=` scenario link
  boots via the async `startScenario` so the load stays responsive.
- **Balance proof.** `measure --seeds=8` before vs after = BYTE-IDENTICAL: extinction 0% (0/8),
  carn-persistence 75% (6/8), phase lag +127t, final fauna 73.6, final flora 2263.8, cap-hits 0 (== the C2
  chunk-3/4 numbers). Gate GREEN: typecheck clean + lint 0 errors (32 warnings, unchanged legacy) + **28
  tests** (was 22; new scenarios block: the pure evaluator's establish/endure/lose/latch logic, setup arms +
  seeds + reproduces the same world, the scenario permalink round-trips + re-arms, and a scenario run replays
  identically) + build (bundle `index-CEEBKIas.js`).
- **Gate-blind (DOM):** the Scenario deck + Start button, the Objective panel render, the async warmup
  animation, and the `?w=scen` boot branch. The pure cores are gate-covered; eyeball in the live app (start
  each scenario, watch the world form + the Objective panel + Chronicle beats; open a scenario link).
- **Open follow-ups (Tier B, for Kevin):** the win/lose THRESHOLDS + warmup targets are best-effort defaults
  (balance-safe regardless, since they only affect win/lose feel) - eyeball whether each scenario is winnable
  and fun, and tune the numbers. The async warmup is ~5-12s of visible world-forming.

## Speciation + trophic-depth experiment - Living World chunk 6 (2026-06-30) - DONE + DEPLOYED (main b58f4be, ff'd da4a4c1..b58f4be + pushed, CI success, live bundle index-D09CKDhj.js confirmed HTTP 200 + contains the chunk-6 code)
Pillar C (speciation) SHIPPED; trophic depth built as a measured DEFAULT-OFF experiment that the harness
shelved (flag rather than guess). Two commits: `c3273dc` (speciation) + `f23a95c` (scavenger).

**SPECIATION (shipped, balance BYTE-IDENTICAL to C2).** Lineage drift becomes named, diverging species.
- A species = a genome SIGNATURE: the SAME (tier, hue, climate-pref) buckets `generateSpeciesName` keys its
  binomial on (`speciesKey(f)=type|floor(hue/20)|floor(prefArid/2.5)|floor(prefTemp/2.5)`), so one signature
  is 1:1 with one name. As drift (`mutateFaunaChild` shifting hue/prefArid/prefTemp) carries a lineage's
  descendants into a new bucket, a new signature appears among the living -> a species has DIVERGED. No new
  per-creature genome, no eRng -> observation only.
- Pure cores (gate-tested on synthetic data): `speciesCensus(list=fauna)` buckets living fauna into named
  per-species entries; `updateSpeciesRegistry(census,reg,tick)->events` is a PURE REDUCER (like
  `evaluateScenario`) that registers a species once established, narrates divergence / extinction (latching) /
  re-emergence. `speciesSample()` runs at the END of `step()` (after `scenarioSample`), Chronicle cadence,
  read-only -> harness proved BYTE-IDENTICAL to C2 (extinction 0%, carn-persistence 75% 6/8, phase lag +127t,
  final fauna 73.6, flora 2263.8, cap-hits 0).
- Threshold `SPECIES_MIN_GEN=3` / `SPECIES_MIN_POP=6` (also gates `getSpeciesName`): generational depth grows
  ~1/500 ticks and RESETS on population crashes, so the inherited gen>=5 gate almost never fired (empty panel);
  gen>=3/pop>=6 surfaces the real established clusters at healthy peaks. Balance-neutral pacing knob.
- `speciesRegistry` module memory (reset in `initWorld`, round-trips snapshot/restore). A **Species sidebar
  panel** (`renderSpecies`, gate-blind DOM): the living census (name / tier icon / pop / gen / size / vivid) +
  an emerged/extinct records line. New Chronicle `'species'` events (divergence / extinction / re-emergence).
- Reproductive isolation (mate choice) deliberately NOT built - it is behavior-touching, its own harness loop.
- Gate: typecheck clean + lint 0 errors (32 warnings unchanged) + 33 tests (was 28) + build.

**TROPHIC DEPTH - SCAVENGER (built, ships DEFAULT-OFF; the A/B shelved it).** A detritivore tier eating
`carrion[]` (corpses), the trophic addition least likely to break C2 (no predation pressure on the living
tiers - it harvests the death flux, unlike an apex tier). Behind `CFG.scavengersEnabled` (default off ->
`_dropCarrion` no-op + no scavenger code -> eRng byte-identical to C2). Full sim (carrion lifecycle in the step
path + snapshot/restore; makeFauna/mutateFaunaChild/buildSpatialIndex/scoreTileForFauna/faunaStep scavenger
branches; render marker + carrion specks) + harness `--scav=N` A/B instrument + tests (flag-off no-carrion
guard + flag-on carrion-created/consumed + deterministic). **A/B VERDICT (8 seeds, `--scav=12`): FAILS
keep-if-better -> stays off.** Scavenger-persistence 0% (0/8; they starve - carrion mean ~11 corpses is too
sparse for a wanderer), and herb/carn did not improve (extinction 0->13%, carn-persistence 75->63%, partly
reshuffle noise; cap-hits 0). Viability + balance tuning is its own loop (see NEXT). Scaffolding + instrument
banked default-off (byte-identical to C2), exactly like the reverted fauna-distribution / auto-rivers
experiments - measured, shelved, documented, not deleted.

**Gate-blind (DOM, eyeball in the live app):** the Species panel (watch species diverge + go extinct as the
world booms/busts; open the panel, check names/pop/gen); if you flip `CFG.scavengersEnabled` on in the console,
the olive-brown hollow-square scavengers + dark carrion specks + the scavenger species rows.

## Trophic depth take 2 - scavenger VIABLE + shipped ON - Living World chunk 7 (2026-07-01) - DONE + deploying
Made the chunk-6 detritivore self-sustaining WITHOUT regressing C2, then flipped `CFG.scavengersEnabled` ON.
The failure mode was food scarcity (carrion ~11 corpses / ~2000 tiles = too sparse for a random wanderer),
so take-2 attacked it on four complementary axes + fixed a hidden confound:
- **`carrionMaxAge` 100 -> 300** - carrion accumulates (~11 -> ~23 standing) AND post-crash death PULSES persist
  long enough to feed a scavenger bloom (the realistic "scavengers boom after a die-off").
- **`scavengerEatGain` 20 -> 35** - a single find sustains a wanderer between corpses.
- **Ring-2-4 carrion SCENT** scan in `scoreTileForFauna` (mirrors the carnivore prey-scent) - directs movement
  toward a distant kill/crash field. This is the lever that actually FINDS sparse food.
- **Carrion-dependent immigration RESCUE** in `naturalFaunaSpawn` (`scavengerRescueRate/MinCarrion/ScavCap`, a
  knob-D analog): scavengers immigrate while scarce AND corpses are present, capped at 6 (rescue, not subsidy),
  guarded on the flag so OFF draws no eRng.
- **Confound fixed:** `naturalFaunaSpawn` had lumped scavengers into the carnivore count (`else cc++`), which
  once scavengers exist starves knob D's carnivore-rescue headroom (this helped tank the chunk-6 carn 75->58).
  The three tiers are now counted SEPARATELY.

**A/B verdict (measure -> A/B -> keep-if-better, all at 12 seeds): PASS, shipped ON.** C2 reference (`--scav=0`):
extinction 0%, carn-persistence 75% (9/12), cap-hits 0, final fauna 61.3 / flora 2211. Before (old tuning
`--scav=12`): extinction 17%, carn 58%, scavenger-persistence 8% (final scav 2.5) - confirmed the documented
failure. Take-2 (`--scav=12`): extinction 0%, carn 75% (9/12), cap-hits 0, final fauna 60.5 / flora 2210 ==
C2 EXACTLY, with **scavenger-persistence 100% (12/12), final scav mean 11.1** (above the rescue cap of 6 =>
genuinely reproducing, not just rescue-propped); it even mildly DAMPS the herb oscillation (amp 29 vs 40).
Bar cleared (neutral-to-better herb/carn + non-zero scav persistence + 0 cap-hits), so `scavengersEnabled`
defaults ON. Flag OFF stays byte-identical to C2 (`--scav=0` remains the proof). Added a `Scav` populate button
(the rescue also auto-introduces scavengers once carrion accumulates). Gate GREEN: typecheck clean + lint 0
errors (32 warnings unchanged) + **34 tests** (was 33; +the shipped-default-ON assertion; the flag-OFF test is
now try/finally-isolated; one chunk-2 single-seed inheritance test disables the tier to dodge the eRng reshuffle)
+ build (bundle `index-DQuD9VMF.js`). **Gate-blind (DOM), eyeball in the live app:** the olive-brown
hollow-square scavengers + dark carrion specks appear by default now; the `Scav` populate button; watch a
post-crash corpse field draw scavengers in + a scavenger species row in the Species panel.

## Trophic depth take 3 - APEX predator VIABLE + shipped ON - Living World chunk 8 (2026-07-02) - DONE + DEPLOYED (main 7c13750, ff'd 16be8b4..7c13750 + pushed; live bundle index-Dootdbvb.js, CI publishing)
Added a 4th trophic level: an APEX predator (dark-crimson solid diamond, 🦁) that hunts the MID-tier consumers
(carnivores + scavengers). This was the HARD fight the roadmap predicted - it stacks a level on the fragile
carnivore tier - so it was built default-off behind `CFG.apexEnabled`, mirroring the chunk-7 scavenger recipe,
and A/B'd against the chunk-7 shipped baseline (scavengers on). The design that cleared the bar keeps predation
LIGHT: the apex is RARE (rescue cap 5) + eats SLOWLY (`apexEatSpeed` 26 vs carnivore 18) + banks a lot per kill
(`apexEatGain` 95, `apexMaxEnergy` 180) so it needs FEW kills to persist (the scavenger take-2 lesson: high
per-find gain => fewer feeds => lighter pressure). Prey base = carnivores + scavengers via the existing
`_carn/_scav` indices (no new prey index); ring-2-4 SCENT to find dispersed prey; a mid-prey-dependent
immigration RESCUE (`apexRescue*`, knob-D analog, flag-guarded). `naturalFaunaSpawn` now counts FOUR tiers
separately (apex no longer lumped into the carnivore count -> knob D's carnivore rescue keeps its headroom).

**A/B verdict (measure -> A/B -> keep-if-better, 12 seeds): PASS, shipped ON.** Reference (`--scav=12`, apex
off; byte-identical to the chunk-7 baseline): extinction 0%, carn-persistence 75% (9/12), scav 100% (mean 11.1),
cap-hits 0, final fauna 60.5 / flora 2210. Treatment (`--scav=12 --apex=8`): extinction 0%, **carn-persistence
75% -> 83% (10/12)**, scav 100% (mean 11.3), **apex-persistence 100% (12/12, mean 3.7)**, cap-hits 0, final
fauna 40.5 / flora 2252. Every existing tier is neutral-to-BETTER (carn-persistence actually ROSE; carn
oscillation amplitude fell 6.7 -> 4.7 - the apex DAMPS the carnivore boom-bust), the new tier persists 100%,
0 cap-hits. Bar cleared, so `apexEnabled` defaults ON. **HONEST caveats (Tier B, for Kevin's eyeball):**
(1) the apex is RESCUE-SUSTAINED, not self-reproducing (mean 3.7 sits at the rescue floor ~5; unlike the
scavenger which reproduces above its cap). A self-reproducing apex would need a richer prey base (e.g. letting
it also take herbivores), which risks the balance - deferred. (2) It is a real TROPHIC CASCADE: total fauna
drops ~60 -> ~40 (steadier too: sd 49 -> 26) and flora ticks up (2210 -> 2252). That is the textbook top-down
effect (a stabilizing trim of the boom-bust), not a collapse - but the world does read as somewhat LESS crowded.
If you dislike the thinner feel, the flag flips back off (byte-identical) or the apex can be made even rarer.
Flag OFF is byte-identical to the chunk-7 baseline (`--apex=0` is the proof). Added an `Apex` populate button.
Gate GREEN: typecheck clean + lint 0 errors (32 warnings unchanged) + **37 tests** (was 34; +3 apex: shipped-
default-ON, flag-OFF byte-identical, flag-ON hunt+deterministic) + build (bundle `index-Dootdbvb.js`).
**Gate-blind (DOM), eyeball in the live app:** dark-crimson diamond apex (🦁 in the Species/Inspector panels)
appear by default; the `Apex` populate button; watch the apex crop carnivores/scavengers + the total population
settle lower + steadier + an apex species row in the Species panel.

## NEXT (in order)
The Living World Roadmap (`docs/01 Design/Living World Roadmap.md`) is the driver; next chunk first,
then the still-valid pre-roadmap backlog.
0. **Trophic depth take 4 - the OMNIVORE tier (its own loop).** Apex is DONE (chunk 8, shipped ON). The omnivore
   is the last planned trophic tier and a different kind of hard: it eats BOTH flora and fauna (blurs the
   herb/carn coupling), so it competes with herbivores AND carnivores at once. Same default-off
   measure->A/B->keep-if-better loop, same bar (neutral-to-better on ALL existing tiers - herb/carn/scav/apex -
   + non-zero omnivore persistence + 0 cap-hits). Reuse the `--scav`/`--apex`-style harness instrument
   (add `--omni=N` + an `omnivoreEnabled` flag). Watch competition-with-herbivores as the likely balance risk.
   (Optional follow-up if desired: make the APEX self-reproducing via a broader prey base - deferred from chunk 8.)
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
