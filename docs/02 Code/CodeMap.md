# CodeMap - Worldbuilder

## Project structure (updated 2026-07-03: the sim core is split out of main.js into src/sim.js, chunk 10)
Vite + TS project. The DOM-free SIMULATION is now a separate module from the UI shell:
- **`index.html`** - HTML shell + CSS; loads `src/main.js` as an ES module.
- **`src/sim.js`** (~1650 lines) - the DOM-free SIMULATION CORE. State + the three RNG streams, PRESETS/CFG, climate, biomes, terrain genesis, rivers GENERATION (`generateRivers`/`clearRivers`), ecology (flora/fauna + scavenger/apex/omnivore), the chronicle SAMPLER, speciation, scenarios CORE, god powers, snapshot/restore, `initWorld`/`step`/`runAssertions`, and the world-code cores. **Imports cleanly in Node with NO DOM stub** - nothing here touches document/window/canvas (proven: `node -e "import('./src/sim.js')"` loads). Exports its public API at the bottom (~130 names: live state bindings + pure functions) for the shell + the headless consumers. Three setters (`setWorldSize`/`setActiveScenario`/`setDeathParticles`) exist ONLY because ES module bindings are read-only from the importer, so the shell writes those via setters (see Engineering Lessons - The sim/UI split).
- **`src/main.js`** (~800 lines) - the browser UI SHELL. Rendering (`draw`/`drawRivers`/`drawHUD`/`drawPopGraph`/`renderChronicle`/`renderSpecies`/`renderObjective`/`renderLineagePanel`), canvas + zoom/pan + the follow-camera, ALL DOM wiring + sliders + panels, inspector/tooltip, export/import DOM wrappers, `applyPreset`/`syncUIToConfig`, `startScenario` (async warmup), `init`/`loop`/`boot`, and the `?w=` boot restore. The ONLY file that touches the DOM. Imports the sim core at the top (the import list is exhaustive - eslint `no-undef` would flag any omission).
- **`src/sim.test.js`** - vitest: imports `src/sim.js` DIRECTLY (no stub) and runs the ~40 headless assertions (the automated gate).
- **`scripts/harness.mjs`** - `npm run measure`, the multi-seed ecosystem measurement tool (also reports a flora-distribution block); imports `src/sim.js` directly.
- **`scripts/flora-ab.mjs` / `river-diag.mjs` / `season-probe.mjs` / `make-preview-world.mjs`** - manual A/B + diagnostic probes; all import `src/sim.js` directly.
- **`eslint.config.js`, `vite.config.js`, `tsconfig.json`, `.github/workflows/ci.yml`** - toolchain.

Gate: `npm run typecheck && npm run lint && npm test` (+ `npm run build`). For a PURE refactor, also prove `npm run measure` is BYTE-IDENTICAL before/after (the C2-balance safety net).

**Where a symbol lives (chunk 10):** the inventory below still lists the right symbol NAMES + section order, but each now lives in `src/sim.js` (the pure ones) or `src/main.js` (the render/DOM ones). Rule of thumb: if it touches the DOM (draw*/render*/inspect/tooltip/hooks/sliders/canvas/export-import wrappers/follow-camera/init/loop/boot) it is in `main.js`; everything else (the whole simulation) is in `sim.js`. Re-grep by name in either file for exact lines.

---

Navigation index for `src/main.js`. The section ORDER and the key symbols below are accurate and are the primary navigation aid. Re-grep by function name for exact lines.

## File shape (top to bottom)
1. **Head + CSS** - design tokens (`:root`), component styles (toolbar, status bar, sidebar panels, inspector, tooltip, legend, intro screen, population graph).
2. **Body / HTML** - intro overlay; toolbar (start/pause/step/reset/force, speed/map/px/preset, seed, flora/herb/carn/place/rivers, png/save/load/test); status bar; layout = canvas + sidebar (overlay selector + collapsible panels: Inspector, Terrain, Climate, Ecology, Population, Legend, Tests).
3. **Script (IIFE, 'use strict')** - everything below.

## Systems and key symbols
- **Error / util:** `togglePanel`, `window.onerror` HUD.
- **State:** grid / elev / aridity / tempField / sunlight (+ `baseTemp`/`baseArid` = the genesis climate before climate offsets) + volcano fields; ecology state (`flora[]`, `fauna[]`, `deathParticles`, `placeMode`, species-name parts, `popHistory`, `biomeBoundary`, `floraRemnants`); river vars; beach vars.
- **Seeded PRNG (three streams, all `mulberry32`, all re-seeded in `initWorld`/`restoreState`):** `sRng` = world GENERATION (`sRandn`/`sTruncNorm`/`sBeta`/`sGamma`); `eRng` = world DYNAMICS / ecology (`randn`); `cRng` = COSMETIC genes only (the size gene, via `cRandn`; offset `_seed ^ 0x85EBCA6B`). `cRng` is isolated so cosmetic genes never shift the eRng phase -> the C2 balance is byte-identical with or without them (see Engineering Lessons - Reproducibility). The only raw `Math.random` is the seed PICKER in `initWorld`.
- **Presets:** `PRESETS` (8: balanced/desert/wetlands/iceage/volcanic/jungle/archipelago/pangaea), `applyPreset`, `syncUIToConfig`.
- **Config:** terrain enum `T` / `TNAME` / `TERRAIN_COLORS` (16 biomes), `WORLD`, `CFG` (all tunables incl. ecology + beach), `DEFAULT_CFG`.
- **Canvas helpers:** `idx`, `inb`, `neighbors4/8`, `clamp`, `resize`. **Zoom / pan:** `applyZoomPan`, `screenToTile`.
- **Follow-a-creature camera (the lineage lens, chunk 2):** state `followId` + `FOLLOW_MIN_ZOOM`; `findFauna(id)`, `centerOnTile(tx,ty)` (pan = canvasCenter - tileCenter; zoom-independent because transform-origin is center), `startFollow(id)` (zooms in + expands the panel), `stopFollow`, `updateFollow` (called at the end of `draw()`: recenters + refreshes the panel each frame, and clears follow when the creature dies), `renderLineagePanel(f,died)` + `_sizeWord`. Pure UI/observation -> balance-safe. The Follow buttons (inspector) + Stop button (lineage panel) are wired via delegated listeners. ALL gate-blind DOM.
- **Climate (OFFSET model, 2026-06-29; mid-run EASE-IN added 2026-07-08):** `climateInit`, `initAnomalyBlobs`, `updateAnomalyBlobs` (now with a `born`/`life` lifecycle: blobs fade in via `_blobEnv`, expire + respawn -> TRANSIENT spells), `seasonPhase` (counts from `seasonAnchorTick`), `seasonWave` (zero-mean trapezoid), `climateStep` (advances time scalars + blob drift only), `applyClimate` (writes live temp/aridity = genesis base + bounded offsets, EVERY tick; also the RISING-EDGE detector on `_prevSeasonalTilt`/`_prevAnomalies` -> on a mid-run toggle it anchors the season clock + re-stamps blob `born` so the map EASES in from zero instead of jumping. `tick>0` guard keeps genesis-ON worlds byte-identical). `seasonAnchorTick`/`_prev*` round-trip snapshot/restore + reset on load. `computeTemperature`/`computeAridity` write `baseTemp`/`baseArid`; the live fields are base + seasonal/anomaly/volcano OFFSETS, so climate forcings never accumulate or drift (the pre-2026-06-29 model integrated a delta onto the field and drifted once genesis stopped). Amplitude knobs in CFG: `seasonalTempAmp`/`seasonalAridAmp` + `anomaly*`/`volcano*` variants.
- **UI hooks:** `hook()` + all button bindings, placement mode, overlay selector, canvas click/move/wheel/pan, climate + ecology slider hooks, legend tooltips, hotkeys.
- **Sliders:** `SLIDER_SCHEMA`, `buildSliders`, `applyElevationIntensity`.
- **Climate fields:** `computeSunlight` (+ `reseedSunlight`, `addHotColdBlobs`), `computeTemperature`, `computeAridity` (BFS from coast + river moisture).
- **Biomes:** `classifyTile` (the 16-biome rule ladder), `reclassTerrain` (+ ecotone boundary cache).
- **Terrain generation:** `pickWorldMeta`, `currentCoreHeight`, `landCoverage`, `tryVolcano`, `coolVolcano`, `tryCoastal`, `erosionStep`, `promoteVolcanoAt`, `clusterSpikePass`, `eruptionPromotionPass`, `mountainFringePass`, `isolatedHillDecayPass`. **Rare in-run VOLCANO BIRTH (2026-07-08):** `tryVolcanoBirth` (in `step()` after eruptionPromotionPass; occasionally promotes the highest highland to a full elev-10 volcano) gated by `_eventRand` (a STREAM-FREE splitmix32 hash of `_seed`/`tick` - draws no sim RNG, so enabling it is balance-safe by construction). CFG: `volcanoBirthRate` (0.005, taste dial; 0 = off = byte-identical), `volcanoBirthCheckEvery`, `volcanoBirthMinElev`. Harness A/B: `--birth=RATE`; probe: `scripts/volcano-diag.mjs`.
- **Rivers** (`generateRivers` ~L594, `clearRivers` ~L794, `drawRivers` ~L799): the hydrology pipeline that replaced the old greedy downhill tracer. `generateRivers` = Step 0 smooth the routing surface (`RIVER_SMOOTH_PASSES`) -> 1 priority-flood depression fill + D8 receivers (Barnes 2014, binary min-heap seeded from ocean+border) -> 2 flow accumulation + upstream-length `ul` -> 3 natural lakes (depth+size+highland filter) -> 4 build riverData (river where `acc>=RIVER_ACCUM_THRESHOLD`; entry/exit dirs; estuary) -> 5 source lakes (`SOURCE_LAKE_*`: big lakes flooded at the highest, spaced river heads) -> 6 main-stem decomposition giving each river ONE length-based width (`volume`). `drawRivers` renders smooth per-lake blobs (`lakeShapes`), per-river-uniform width, coast-clipped mouths (no ocean bleed), occasional braided deltas (`DELTA_MIN_VOL`). Tunable constants are grouped at ~L70-85; the render threshold is now `CFG.riverAccumThreshold` (default 14) with a live "River Density" slider (Terrain panel, inverted + regenerates rivers). Flora/fauna are skipped on lake tiles in `draw`. NOTE: rivers are GATE-BLIND (render); verify visually via the `?debug` `window.__wb` handle + `scripts/make-preview-world.mjs` (see Engineering Lessons).
- **Beaches:** `beachStep` (organic erosion process, cap, spread), `clearBeaches`. Render is inside `draw`.
- **Species naming:** `generateSpeciesName`, `getSpeciesName` (binomial, shown at lineage gen >= 5).
- **Ecology - flora:** `makeFlora`, `BIOME_FLORA_HARSHNESS`, `computeFloraHealth` (now also × an aridity desert brake + a `waterDist` brake), `floraMoistureSuit` + `pickFloraTile` (fixed-count weighted placement, draw-stable), `mutateFloraChild` / `cloneFloraChild`, `seedFloraCluster`, `naturalFloraSpawn`, `floraStep` (computes `floraLandVigor` = land-adaptive maturity-thinning scaling spread/spawn). Water-clustering field: `waterDist` + `computeWaterDist` (BFS from ocean/coast/river/lake; in `computeAridity` + on restore). New CFG: `floraWaterDistK/Free/Penalty`, `floraMoisturePenalty`, `floraAridTolerance`, `floraWaterWeight`, `floraLandThin/Start`, `floraPlaceSamples`. Live Ecology sliders: Flora Thinning / Water Clustering / Desert Harshness.
- **Ecology - fauna:** `makeFauna`, `computeFaunaClimateFit`, `seedFaunaGroup`, `naturalFaunaSpawn`, `buildSpatialIndex`, `scoreTileForFauna` (foraging / predator-avoidance scoring - central to balance), `mutateFaunaChild` / `cloneFaunaChild`, `faunaStep`. **Genome carries two COSMETIC genes (chunk 2):** `size` (heritable, founders start 1.0, drifts via `cRandn()*CFG.faunaSizeMutationMag` in `mutateFaunaChild`, clamped [0.5,2.2]) and `lineageId` (founder = own id, inherited by children -> living kin are countable). Both are NEVER read by `faunaStep`/`scoreTileForFauna` (balance-safe) and round-trip through snapshot/restore automatically (they live on the fauna objects).
- **Rendering:** `hexToRGB` / `rgbToHex` / `blendColors`, `draw` (terrain + 9 overlays + ecotone blend + beach render + river render + flora / fauna render + death particles). Fauna markers are scaled by the `size` gene (`dim`); a follow-highlight accent ring is drawn around the `followId` creature; `draw()` ends with `drawHUD();renderChronicle();updateFollow();`.
- **Inspector / tooltip:** `inspectTile` (now shows each creature's `size` + a per-creature `.follow-btn`), `pct01`, `updateTooltip`.
- **Export / import:** `exportPNG`, `exportJSON`, `importJSON` (snapshot version `wb-eco-1`).
- **Shareable worlds (chunk 4, thread 3):** a world is a `?w=` permalink. `buildWorldCode` (pure recipe
  `{v,seed,preset,cfg}` where `cfg`=diff-from-`DEFAULT_CFG` MINUS the `_DERIVED_CFG_KEYS` recomputed from
  `elevationIntensity` -> a default world = empty diff) / `applyWorldCode` (pure: reset CFG to default, layer the
  diff for KNOWN + matching-typed keys only since a URL is untrusted, restore the preset, `initWorld(seed)`;
  throws on a bad code). `encodeWorldCode`/`decodeWorldCode` (URL-safe base64), `worldPermalink`, `getWorldCodeParam`.
  DOM wrappers: `copyWorldLink` (clipboard + `history.replaceState`), `worldPostcard`/`copyPostcard` (a
  Chronicle-driven blurb), `_flashBtn`. Boot restore: `init()` consumes `_pendingWorldCode` (the `?w=` param
  captured at load) ONCE, so a later preset/reset rolls fresh. Balance-safe: the only sim mutation is the same
  `initWorld` re-genesis the preset selector uses; nothing runs in `step()`. Pure cores gate-tested
  (`sim.test.js` shareable-worlds block); the buttons/clipboard/address-bar + `init()` boot branch are gate-blind.
- **HUD:** `drawPopGraph`, `drawHUD`.
- **Chronicle (the world's memory):** `chronicleSample` (pure, runs at the end of `step()` on a 10-tick
  cadence), `chronicleStats`, `chronicleAdd`/`chronicleNote` (public hook for god-powers), `_crossLadder`
  (milestone ladders), `newChronicle`, `renderChronicle` (the only DOM part - feeds the `#panelChronicle`
  sidebar panel + `#chronicleRecords` strip). `chronicle` state round-trips through snapshot/restore and
  resets in `initWorld`. Pure core is gate-tested (`sim.test.js` chronicle block); render is gate-blind.
  Chunk 2 added a SIZE record (`CHRON_SIZE_LADDER`, `records.sizeRung`/`peakSize`; `chronicleStats` reports
  `maxSize`/`bigName`) so the visible size gene shows up in the feed + records strip.
- **God powers (chunk 3, pillar D):** deliberate interventions, all PURE sim-core mutations logging a `'god'`
  Chronicle event, defined just above `initWorld`. `brushTerrain(cx,cy,dir)` (land brush: raise/lower a soft
  disc, handling the land<->sea boundary, then refresh climate + `reclassTerrain`), `meteorStrike(tx,ty)`
  (`_pickStrikeTarget` aims at the densest life if no coords given; craters terrain + wipes fauna/flora in the
  blast), `droughtEvent` (withers flora, weighted by tile aridity), `bloomEvent` (a `seedFloraCluster` burst).
  Helpers `_killLifeAt`/`_compactLife` (null-then-filter + `deathParticles`). **NONE run inside `step()`** ->
  outside the measured loop -> harness balance byte-identical (see Engineering Lessons - God powers). CFG knobs:
  `godBrushRadius`/`godBrushDelta`, `meteorRadius`/`meteorCraterDepth`, `droughtSeverity`, `bloomCount`.
  Wired from the "God" deck seg (index.html): the brush is a `placeMode` (`'raise'`/`'lower'`, routed in the
  canvas click handler + `setPlaceMode`/`PLACE_BTN_IDS`/`PLACE_LABELS`); Meteor/Drought/Bloom fire once per
  button press. Gate-tested (`sim.test.js` god-powers block); exported for the tests.
- **Scenarios + objectives (chunk 5, pillar E):** named starting setups + a win/lose observer, defined just
  above `initWorld`. Data: `SCENARIOS` (genesis/balance/iceage/volcanic - each `{preset, seed, warmupLand,
  seedFlora/Herb/Carn, objective}`), `SCENARIO_SAMPLE_EVERY`, `SCENARIO_WARMUP_CAP`, live `activeScenario`
  (`{def,startTick,status}` or null). **Pure observer (the gate-testable core):** `evaluateScenario(def,stats,
  curTick,prevStatus)->newStatus` (goals `establish` = reach `need`; `endure` = reach `establish` then hold
  `floor` for `duration`, post-establishment collapse loses; terminal latch), helpers `_meetsTiers`/
  `_tierProgress`/`initialScenarioStatus`. **Setup:** `_applyPresetCfg` (pure preset-cfg core shared with
  `applyPreset`), `applyScenarioDef` (SYNC: preset + `initWorld(seed)` + step-to-`warmupLand` + `_seedScenarioLife`
  + arm - used by the gate + a scenario permalink boot), `clearScenario`. **Observer wrapper:** `scenarioSample()`
  runs at the END of `step()` right after `chronicleSample()` (read-only; narrates `'scenario'` Chronicle events;
  early-returns with no scenario -> harness byte-identical). **DOM (gate-blind):** `renderObjective`/`_objTierRow`
  (Objective panel, in the `draw()` tail), `startScenario`/`_scenWarmTimer` (deck button: ASYNC 40-step
  chunked warmup so the tab stays responsive + the world visibly forms, then seeds + arms). Wired from the
  "Scenario" deck seg (`scenarioSelect` + `btnStartScenario`) + the `#panelObjective` sidebar panel.
  **Shareable:** `buildWorldCode` adds a `scen` field; `applyWorldCode` re-arms the named built-in (trusted id
  + seed only, ignores URL cfg); `init()`'s `?w=` branch routes a scen-link through the async `startScenario`.
  Balance-safe (setup never in `step()`; observer read-only). Exports: `SCENARIOS, evaluateScenario,
  applyScenarioDef, clearScenario, activeScenario`.
- **Speciation (chunk 6, pillar C):** lineage drift -> named, diverging species. A species = a cluster of
  living fauna sharing a genome SIGNATURE - the SAME (tier, hue, climate-pref) buckets `generateSpeciesName`
  keys its binomial on, so one signature is 1:1 with one name; as drift shifts a lineage into a new bucket a
  new species appears. Pure cores: `speciesKey(f)` (the bucket string), `speciesCensus(list=fauna)` (buckets
  living fauna -> named per-species entries, pop desc), `updateSpeciesRegistry(census,reg,tick)` (pure reducer
  like `evaluateScenario`: registers a species once established `gen>=SPECIES_MIN_GEN(3)` & `pop>=SPECIES_MIN_POP(6)`,
  narrates divergence/extinction[latch]/re-emergence, returns events). Observer: `speciesSample()` at the END
  of `step()` (after `scenarioSample`), Chronicle cadence, read-only -> harness BYTE-IDENTICAL (proven 8-seed
  == C2). Memory: `speciesRegistry` (`newSpeciesRegistry()`, reset in `initWorld`, round-trips snapshot/restore).
  `getSpeciesName` gate coupled to `SPECIES_MIN_GEN`. DOM (gate-blind): `renderSpecies()` (Species sidebar
  panel: living census + emerged/extinct records) in the `draw()` tail. Exports: `speciesCensus, speciesKey,
  updateSpeciesRegistry, newSpeciesRegistry, speciesRegistry`.
- **Trophic depth: SCAVENGER tier (chunk 7, SHIPPED DEFAULT-ON `CFG.scavengersEnabled`):** a detritivore tier
  that eats CARRION (corpses). `carrion[]` (module state, reset in `initWorld`, snapshot/restore) is pushed by
  `_dropCarrion(x,y)` on fauna death in `faunaStep` (starve/age/carnivore-kill) and consumed by scavengers;
  it ages out at `CFG.carrionMaxAge` (chunk-7 take-2: 300). `makeFauna`/`mutateFaunaChild` have a scavenger
  branch (olive-brown, `scavenger*` CFG energy/speed/repro/eatGain); `buildSpatialIndex` adds
  `_scavAtTile`/`_carrionAtTile`; `scoreTileForFauna` has a scavenger branch (seek carrion + ring-2-4 carrion
  SCENT + mild self-crowding); `faunaStep` has a scavenger eat branch; `naturalFaunaSpawn` counts the three
  tiers SEPARATELY (so scavengers don't starve knob D's carnivore rescue) + has a carrion-dependent scavenger
  RESCUE (`scavengerRescue*` CFG, guarded on the flag). Render: hollow-square marker + dark carrion specks;
  `btnSpawnScav` seeds 4. Harness A/B via `--scav=N` (seeds N scavengers + toggles the flag in the measured
  window). **Flag OFF => no carrion, no scavenger code runs => eRng byte-identical to C2** (the `--scav=0` run
  is the C2 proof). Chunk-7 take-2 tuning made it viable + balance-neutral (harness `--scav=12` @ 12 seeds ==
  C2 with scavenger-persistence 100%); see Engineering Lessons + STATUS. Export: `carrion`.
- **Trophic depth: APEX predator tier (chunk 8, SHIPPED DEFAULT-ON `CFG.apexEnabled`):** a 4th-level predator
  that hunts the MID-tier consumers (carnivores + scavengers). `makeFauna`/`mutateFaunaChild` have an apex
  branch (dark-crimson 342-358 hue, `apex*` CFG energy/speed/repro/eatGain); `buildSpatialIndex` adds
  `_apexAtTile`; `scoreTileForFauna` has an apex branch (seek carn+scav via the existing indices + ring-2-4
  SCENT + mild self-crowding - NO new prey index); `faunaStep` has an apex hunt branch (kills a carn/scav,
  drops carrion, flashes a 'kill' particle); `naturalFaunaSpawn` counts FOUR tiers separately + has a
  mid-prey-dependent apex RESCUE (`apexRescue*` CFG, guarded on the flag). Render: solid DIAMOND marker; 🦁
  species/inspector icon; `btnSpawnApex` seeds 3. Harness A/B via `--apex=N`. Tuned WEAK+RARE (slow eat, high
  per-kill gain, low rescue cap) so predation stays light. **Flag OFF => no apex fauna => no apex code runs =>
  byte-identical to the chunk-7 baseline** (`--apex=0` is the proof). A/B `--scav=12 --apex=8` @ 12 seeds was
  neutral-to-BETTER (carn-persistence 75->83%, apex-persistence 100% rescue-sustained mean ~3.7, cap-hits 0);
  it DAMPS the carnivore boom-bust (a top-down cascade: total fauna 60->40, flora up). See Engineering Lessons + STATUS.
- **Trophic depth: OMNIVORE tier (chunk 9, SHIPPED DEFAULT-ON `CFG.omnivoreEnabled`):** a generalist that eats
  BOTH flora AND herbivore prey (competes with herbivores + carnivores at once). `makeFauna`/`mutateFaunaChild`
  have an omnivore branch (dusky-plum 288-306 hue, `omnivore*` CFG energy/speed/repro + `omnivoreFloraEatGain` /
  `omnivorePreyEatGain`); `buildSpatialIndex` adds `_omniAtTile`; `scoreTileForFauna` has an omnivore branch
  (seek flora WEAKER than a herbivore + herbivore-prey scent ring 0-2 + `omnivoreCrowding` self-dispersion +
  carn/apex avoidance); `faunaStep` has an omnivore eat branch (GRAZE flora on the tile as its staple, ELSE hunt
  a herbivore - predation SECONDARY, only when no flora); `naturalFaunaSpawn` counts FIVE tiers separately + has
  a broad-diet omnivore RESCUE (`omnivoreRescue*` CFG - prey OR flora, guarded on the flag). Render: solid
  upward-TRIANGLE marker; 🐗 species/inspector icon; `btnSpawnOmni` seeds 3. Harness A/B via `--omni=N`. Tuned
  RARE + INEFFICIENT (weaker per-feed than either specialist, slow breeding, low rescue cap) so it does not
  out-compete - the risk here is COMPETITION, not starvation (unlike scav/apex). **Flag OFF => no omnivore fauna
  => no omnivore code runs => byte-identical to the chunk-8 baseline** (`--omni=0` is the proof). A/B
  `--scav=12 --apex=8 --omni=8` @ 24 seeds vs the chunk-8 baseline was neutral-to-better (carn 79->75% NEUTRAL,
  apex 88->96%, scav 100%, omni-persistence 100% rare mean ~7.2, cap-hits 0); it re-crowds the world the apex
  thinned (fauna 51->71). The first tuning BOOMED (mean 32, carn->67%); take-4a made it rare. See Engineering Lessons + STATUS.
- **Living Food Web (chunk 11, legibility):** a PURE OBSERVER of the trophic structure, made visible as a
  canvas node-link diagram. Pure cores in `sim.js`: `foodWebCensus(list=fauna)` (per-tier pop + mean energy +
  the flora/carrion resource pools + the recent per-edge flux; gate-tested on synthetic fauna), `foodWebSample()`
  (END of `step()`, after `speciesSample`, Chronicle cadence: derives `recent = cum - prev` for the 7 flux
  counters - read-only, no eRng -> harness byte-identical), constants `FOOD_WEB_EDGES` (the fixed who-eats-whom
  topology) / `FOOD_WEB_FLUX_KEYS`, state `foodWeb={cum,prev,recent}` (`newFoodWeb()`, reset in `initWorld`,
  round-trips snapshot/restore, reset in `applySnapshot`). The 7 flux counters (`herbFlora/carnHerb/omniFlora/
  omniHerb/scavCarrion/apexCarn/apexScav`) are incremented at the eat sites in `faunaStep` with a bare `++` (NO
  eRng -> balance-safe by construction, proven byte-identical). DOM (gate-blind, `main.js`): `renderFoodWeb()`
  (a canvas diagram - node size = population, arrow thickness/opacity = recent flux, arrow points eater->prey)
  + `FOOD_WEB_NODES` (the fixed layout/colors) + `_fwText` (contrast-aware label color); `#panelFoodWeb` in
  index.html (canvas `#foodWebCanvas`, `#foodWebBadge`). Exports: `foodWeb, newFoodWeb, foodWebCensus,
  foodWebSample, FOOD_WEB_EDGES`. See Engineering Lessons (Living Food Web + step()-path counters).
- **Loop:** `init`, `step` (the per-tick pipeline; ends `chronicleSample();scenarioSample();speciesSample();foodWebSample()`), `loop`.
- **Tests:** `runTests` (the gate; about 60 assertions).
- **Boot:** `boot`, `dismissIntro`, intro start listener.

## Where to change things (the big work)
- **Ecosystem balance:** `floraStep` (regrowth + spread + competition), `faunaStep` (energy, movement, eating, reproduction), `scoreTileForFauna` (foraging / predator-avoidance - the traveling-wave cause), and the ecology block of `CFG` (spawn / eat / repro / mutation rates).
- **Rivers:** `generateRivers`.
- **Beaches:** `beachStep` + the beach branch of `draw`.
