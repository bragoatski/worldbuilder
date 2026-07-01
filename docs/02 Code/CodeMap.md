# CodeMap - Worldbuilder

## Project structure (as of 2026-06-22, branch `professionalize-codebase`)
The app is now a Vite + TS project, not a single file:
- **`index.html`** - HTML shell + CSS; loads `src/main.js` as an ES module.
- **`src/main.js`** (~1670 lines) - the whole sim + UI, top-level module scope (former IIFE). Sections + key symbols are mapped below. Pure entry points are EXPORTED at the bottom: `initWorld(seed)`, `runAssertions()`, `step`, `seedFloraCluster`, `seedFaunaGroup`, `landCoverage`, `snapshotState()`/`restoreState(snap)` (warm-once ecology replay; see Engineering Lessons - Snapshot/restore), and live `flora`/`fauna`/`tick`/`CFG`/`W`/`H`. `init` = DOM wrapper over `initWorld`; `runTests` = DOM wrapper over `runAssertions`.
- **`src/sim.test.js`** - vitest: runs the ~52 in-page assertions headless (the automated gate).
- **`scripts/harness.mjs`** - `npm run measure`, the multi-seed ecosystem measurement tool (also reports a flora-distribution block: coverage, flora-vs-land aridity, desert/near-water share).
- **`scripts/flora-ab.mjs`** - warm-per-variant high-land A/B for flora distribution + balance (the instrument for the flora-clustering/thinning work; edit its VARIANTS to sweep knobs).
- **`scripts/headless-dom.mjs`** - permissive Proxy DOM stub so `main.js` imports cleanly in Node (interim, until the sim core splits into its own `sim.js`).
- **`eslint.config.js`, `vite.config.js`, `tsconfig.json`, `.github/workflows/ci.yml`** - toolchain.

Gate: `npm run typecheck && npm run lint && npm test` (+ `npm run build`). The function inventory below is still accurate for `src/main.js`; line numbers are approximate (re-grep by function name).

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
- **Climate (OFFSET model, 2026-06-29):** `climateInit`, `initAnomalyBlobs`, `updateAnomalyBlobs`, `seasonPhase`, `seasonWave` (zero-mean trapezoid), `climateStep` (advances time scalars + blob drift only), `applyClimate` (writes live temp/aridity = genesis base + bounded offsets, EVERY tick). `computeTemperature`/`computeAridity` write `baseTemp`/`baseArid`; the live fields are base + seasonal/anomaly/volcano OFFSETS, so climate forcings never accumulate or drift (the pre-2026-06-29 model integrated a delta onto the field and drifted once genesis stopped). Amplitude knobs in CFG: `seasonalTempAmp`/`seasonalAridAmp` + `anomaly*`/`volcano*` variants.
- **UI hooks:** `hook()` + all button bindings, placement mode, overlay selector, canvas click/move/wheel/pan, climate + ecology slider hooks, legend tooltips, hotkeys.
- **Sliders:** `SLIDER_SCHEMA`, `buildSliders`, `applyElevationIntensity`.
- **Climate fields:** `computeSunlight` (+ `reseedSunlight`, `addHotColdBlobs`), `computeTemperature`, `computeAridity` (BFS from coast + river moisture).
- **Biomes:** `classifyTile` (the 16-biome rule ladder), `reclassTerrain` (+ ecotone boundary cache).
- **Terrain generation:** `pickWorldMeta`, `currentCoreHeight`, `landCoverage`, `tryVolcano`, `coolVolcano`, `tryCoastal`, `erosionStep`, `promoteVolcanoAt`, `clusterSpikePass`, `eruptionPromotionPass`, `mountainFringePass`, `isolatedHillDecayPass`.
- **Rivers** (`generateRivers` ~L594, `clearRivers` ~L794, `drawRivers` ~L799): the hydrology pipeline that replaced the old greedy downhill tracer. `generateRivers` = Step 0 smooth the routing surface (`RIVER_SMOOTH_PASSES`) -> 1 priority-flood depression fill + D8 receivers (Barnes 2014, binary min-heap seeded from ocean+border) -> 2 flow accumulation + upstream-length `ul` -> 3 natural lakes (depth+size+highland filter) -> 4 build riverData (river where `acc>=RIVER_ACCUM_THRESHOLD`; entry/exit dirs; estuary) -> 5 source lakes (`SOURCE_LAKE_*`: big lakes flooded at the highest, spaced river heads) -> 6 main-stem decomposition giving each river ONE length-based width (`volume`). `drawRivers` renders smooth per-lake blobs (`lakeShapes`), per-river-uniform width, coast-clipped mouths (no ocean bleed), occasional braided deltas (`DELTA_MIN_VOL`). Tunable constants are grouped at ~L70-85; the render threshold is now `CFG.riverAccumThreshold` (default 14) with a live "River Density" slider (Terrain panel, inverted + regenerates rivers). Flora/fauna are skipped on lake tiles in `draw`. NOTE: rivers are GATE-BLIND (render); verify visually via the `?debug` `window.__wb` handle + `scripts/make-preview-world.mjs` (see Engineering Lessons).
- **Beaches:** `beachStep` (organic erosion process, cap, spread), `clearBeaches`. Render is inside `draw`.
- **Species naming:** `generateSpeciesName`, `getSpeciesName` (binomial, shown at lineage gen >= 5).
- **Ecology - flora:** `makeFlora`, `BIOME_FLORA_HARSHNESS`, `computeFloraHealth` (now also × an aridity desert brake + a `waterDist` brake), `floraMoistureSuit` + `pickFloraTile` (fixed-count weighted placement, draw-stable), `mutateFloraChild` / `cloneFloraChild`, `seedFloraCluster`, `naturalFloraSpawn`, `floraStep` (computes `floraLandVigor` = land-adaptive maturity-thinning scaling spread/spawn). Water-clustering field: `waterDist` + `computeWaterDist` (BFS from ocean/coast/river/lake; in `computeAridity` + on restore). New CFG: `floraWaterDistK/Free/Penalty`, `floraMoisturePenalty`, `floraAridTolerance`, `floraWaterWeight`, `floraLandThin/Start`, `floraPlaceSamples`. Live Ecology sliders: Flora Thinning / Water Clustering / Desert Harshness.
- **Ecology - fauna:** `makeFauna`, `computeFaunaClimateFit`, `seedFaunaGroup`, `naturalFaunaSpawn`, `buildSpatialIndex`, `scoreTileForFauna` (foraging / predator-avoidance scoring - central to balance), `mutateFaunaChild` / `cloneFaunaChild`, `faunaStep`. **Genome carries two COSMETIC genes (chunk 2):** `size` (heritable, founders start 1.0, drifts via `cRandn()*CFG.faunaSizeMutationMag` in `mutateFaunaChild`, clamped [0.5,2.2]) and `lineageId` (founder = own id, inherited by children -> living kin are countable). Both are NEVER read by `faunaStep`/`scoreTileForFauna` (balance-safe) and round-trip through snapshot/restore automatically (they live on the fauna objects).
- **Rendering:** `hexToRGB` / `rgbToHex` / `blendColors`, `draw` (terrain + 9 overlays + ecotone blend + beach render + river render + flora / fauna render + death particles). Fauna markers are scaled by the `size` gene (`dim`); a follow-highlight accent ring is drawn around the `followId` creature; `draw()` ends with `drawHUD();renderChronicle();updateFollow();`.
- **Inspector / tooltip:** `inspectTile` (now shows each creature's `size` + a per-creature `.follow-btn`), `pct01`, `updateTooltip`.
- **Export / import:** `exportPNG`, `exportJSON`, `importJSON` (snapshot version `wb-eco-1`).
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
- **Loop:** `init`, `step` (the per-tick pipeline; ends with `chronicleSample()`), `loop`.
- **Tests:** `runTests` (the gate; about 60 assertions).
- **Boot:** `boot`, `dismissIntro`, intro start listener.

## Where to change things (the big work)
- **Ecosystem balance:** `floraStep` (regrowth + spread + competition), `faunaStep` (energy, movement, eating, reproduction), `scoreTileForFauna` (foraging / predator-avoidance - the traveling-wave cause), and the ecology block of `CFG` (spawn / eat / repro / mutation rates).
- **Rivers:** `generateRivers`.
- **Beaches:** `beachStep` + the beach branch of `draw`.
