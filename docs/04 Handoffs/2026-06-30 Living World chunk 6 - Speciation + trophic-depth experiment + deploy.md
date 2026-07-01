# 2026-06-30 - Living World chunk 6: Speciation (pillar C) + trophic-depth experiment + deploy

Self-contained handoff. Read STATUS.md for current truth and `docs/01 Design/Living World Roadmap.md` for the
direction + chunk sequence. Prior handoff: `2026-06-30 Living World chunk 5 - Scenarios + objectives + deploy.md`.

## The direction (unchanged)
Worldbuilder's moat is the SIMULATION. The roadmap AMPLIFIES it: deepen the sim + make its evolution VISIBLE,
god-game agency, shareable worlds. Per-chunk workflow: one large chunk -> full gate -> docs -> commit ->
deploy -> next-session prompt. Chunks 1-5 = Chronicle / evolution-visible / god powers / shareable worlds /
scenarios. Chunk 6 (this one) = the harness-heavy pair: SPECIATION (pillar C) + TROPHIC DEPTH.

## What shipped: two commits
- `c3273dc` **feat(speciation)** - lineage drift -> named, diverging species. SHIPPED, balance byte-identical.
- `f23a95c` **feat(trophic)** - a scavenger tier as a DEFAULT-OFF measured experiment. The A/B shelved it; it
  ships off + flagged. (All code in `src/main.js`; the Species panel in `index.html`; harness `--scav` in
  `scripts/harness.mjs`; tests in `src/sim.test.js`.)

## Speciation (pillar C) - the shipped half
A **species** is a cluster of living fauna sharing a genome SIGNATURE - the SAME (tier, hue, climate-pref)
buckets `generateSpeciesName` already keys its binomial on, so one signature is 1:1 with one name. As drift
(`mutateFaunaChild` shifting hue / prefArid / prefTemp) carries a lineage's descendants into a new bucket, a
new signature appears among the living -> a species has DIVERGED. It reuses the genome that already exists
(chunk 2's `lineageId` + the climate/color genes); nothing new is drawn, so it is pure observation.

- **Pure cores (gate-tested on synthetic data, no slow world):** `speciesKey(f)` (the bucket string);
  `speciesCensus(list=fauna)` (buckets living fauna -> named per-species entries `{key,type,name,pop,maxGen,
  maxSize,vivid}`, pop desc); `updateSpeciesRegistry(census,reg,tick)->events` - a PURE REDUCER (like
  `evaluateScenario`) that registers a species once ESTABLISHED (`gen>=SPECIES_MIN_GEN` & `pop>=SPECIES_MIN_POP`)
  and narrates first divergence / extinction (latching) / re-emergence, returning the events to log.
- **Observer:** `speciesSample()` runs at the END of `step()` right after `scenarioSample()`, on the Chronicle
  cadence. It builds the census, advances the reducer, and logs `'species'` Chronicle events. Read-only (no
  eRng, no fauna/flora mutation) -> the measured ecology loop is BYTE-IDENTICAL (proof below), same shape as
  `chronicleSample`.
- **Threshold `SPECIES_MIN_GEN=3` / `SPECIES_MIN_POP=6`** (also gates `getSpeciesName`). WHY not the inherited
  gen>=5: generational depth grows ~1 per ~500 ticks and RESETS on every population crash (survivors are gen-0
  immigrants), so in this boom-bust world gen>=5 almost never fired (empty panel). Measured seed 2024: maxGen
  reached 2 at t+1000 and gen>=5 only at ~t+7000, right before the crash wiped it. gen>=3/pop>=6 surfaces the
  real established clusters at healthy peaks. Balance-neutral, so this is a story/pacing knob.
- **Memory + UI:** `speciesRegistry` (`newSpeciesRegistry()`, reset in `initWorld`, round-trips
  snapshot/restore). A **Species sidebar panel** (`renderSpecies`, in the `draw()` tail, gate-blind DOM): the
  living census (name / tier icon / pop / gen / size / vivid) + an emerged/extinct records line + a badge.
- **Reproductive isolation is deliberately NOT built** - mate choice is behavior-touching, so per the roadmap
  it is a separate, harness-gated experiment, not part of "tracking + naming first".

### Balance proof (byte-identical)
`node scripts/harness.mjs --seeds=8` after speciation == the C2 baseline exactly: extinction 0% (0/8),
carn-persistence 75% (6/8), phase lag +127t, final fauna 73.6, final flora 2263.8, cap-hits 0. Speciation only
reads, so it cannot move the eRng stream (the same reason the Chronicle + scenario observers are safe).

## Trophic depth (scavenger) - the default-off experiment
A **scavenger** (detritivore) tier that eats **carrion** (dead-fauna corpses). Chosen as the trophic addition
LEAST likely to break C2: it adds no predation pressure on the living tiers, only harvests the death flux the
3-tier web already wastes (an apex tier stacking a 4th predator level would directly amplify the paradox of
enrichment). Behind `CFG.scavengersEnabled` (**default OFF**). Off => `_dropCarrion` is a no-op and no
scavenger code runs => the eRng stream is byte-identical to C2 (the `--scav=0` run == C2 is the proof).

- **Carrion** (`carrion[]`): a persistent list managed in the STEP path (not `deathParticles`, which is a
  render-only flash the headless harness never sees). Pushed by `_dropCarrion(x,y)` on fauna death in
  `faunaStep` (starve / age / carnivore-kill), consumed by scavengers, aged out at `CFG.carrionMaxAge`,
  null-then-filter compacted. Reset in `initWorld`, round-trips snapshot/restore.
- **Scavenger:** `makeFauna` / `mutateFaunaChild` scavenger branch (olive-brown; `scavenger*` CFG for
  energy/speed/repro); `buildSpatialIndex` adds `_scavAtTile` + `_carrionAtTile`; `scoreTileForFauna` +
  `faunaStep` scavenger branches (seek + eat carrion, mild self-crowding); render = hollow-square marker + dark
  carrion specks; species narration/icons handle the tier.
- **Harness A/B:** `--scav=N` seeds N scavengers + toggles the flag in the measured window only (like
  `--seasons`), and reports scavenger-persistence + carrion.

### A/B verdict: FAILS keep-if-better -> ships OFF
`node scripts/harness.mjs --seeds=8 --scav=12`:
- **scavenger-persistence 0% (0/8)** - they go extinct in every seed (final scav mean 0). Carrion mean is only
  ~11 corpses across ~2000 land tiles - too sparse for a wandering detritivore to find enough food.
- herb/carn did NOT improve: extinction 0%->13%, carn-persistence 75%->63% (partly RNG-reshuffle noise since
  seeding 12 extra fauna shifts the stream, and persistence is noisy below 10 seeds); cap-hits stayed 0.

So the tier as-tuned is not even self-sustaining, let alone balance-neutral. Per "measure -> A/B ->
keep-if-better; flag rather than guess", it ships default-OFF. The scaffolding + the `--scav` instrument are
banked (byte-identical to C2), exactly like the reverted fauna-distribution / auto-rivers experiments -
measured, shelved, documented, not deleted.

## Gate (full, green)
`npm run typecheck` (clean) + `npm run lint` (0 errors; 32 warnings, unchanged legacy patterns) + `npm test`
(**33 tests**, was 28; new speciation block - census bucketing + naming, key boundaries, the registry
reducer's divergence/extinction/latch/re-emergence; new trophic block - flag-off no-carrion guard, flag-on
carrion-created/consumed + deterministic) + `npm run build` (ok, bundle `index-UbNjK09T.js`).
**Gate-blind (DOM):** the Species panel render + the scavenger/carrion render (only visible with the flag on).

## Live eyeball checklist (for Kevin, gate-blind)
1. Open the app, press play, let a world develop (or load a developed one / run a scenario). As populations
   boom, open the **Species** sidebar panel: you should see named species (e.g. `Ceraus aridinus`) with pop /
   gen / size, and Chronicle beats "A new grazer species diverged: ..." and "... has gone extinct" as the
   world booms and crashes. The records line shows Living / Emerged / Extinct counts.
2. The scavenger tier is OFF by default (nothing to see). To eyeball it, open the console and set
   `__wb`? - it is not exposed by default; the scavenger is a code-level experiment for now. If you want to
   see it, temporarily flip `CFG.scavengersEnabled=true` in `src/main.js` and run: olive-brown hollow-square
   scavengers, dark carrion specks on corpses, and scavenger species rows. (It will starve out - that is the
   A/B result; it is off for a reason.)

## Open follow-ups (Tier B, for Kevin)
- **Trophic depth, take 2 (the next chunk):** make the scavenger VIABLE + balance-safe via its own tuning loop
  (raise carrion density/nutrition or foraging range, and/or a small immigration rescue so it cannot instantly
  die; re-measure at >=10 seeds; require neutral-to-better herb/carn + non-zero scavenger persistence + 0
  cap-hits before flipping the default on). Then apex + omnivore tiers, each its own loop.
- Speciation naming is coarse (genus from a hue bucket, epithet from arid+temp buckets) - if you want more
  distinct-sounding species, enrich `generateSpeciesName` (still pure + 1:1 with the key). Flora could also
  speciate (it already has names) - deferred; fauna is where the evolution story lives.
- Still-valid pre-roadmap backlog: fauna distribution as a MEASURED ecology task; the optional sim-core split.

## Concurrent-session note
`src/main.js` + `index.html` are shared across sessions. Working tree was clean at start (branch
`ecology-balance`, one deploy-marker commit `35fec5d` ahead of `main` == `da4a4c1`). Changes are additive.
Check `git status` + mtime before editing if another session may be active.

## Deploy
Deploy = ff `main` to the reviewed SHA (sweeping in the `35fec5d` chunk-5 deploy-marker lead + this chunk's two
feat commits + docs) + push; GitHub Pages CI builds + publishes. Live: https://bragoatski.github.io/worldbuilder/

## NEXT (chunk 7): Trophic depth, take 2 - make the scavenger viable + balance-safe
The scaffolding + the `--scav` harness instrument are in place (default-off, byte-identical to C2). Run the
measure -> A/B -> keep-if-better loop to get the scavenger to (a) persist and (b) not regress the herb/carn
balance, then flip the default on. Then the apex + omnivore tiers, each its own measured loop. See STATUS +
the Engineering Lessons "Speciation / trophic depth" entry for the failure mode + the levers.
