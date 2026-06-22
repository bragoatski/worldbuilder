# CodeMap - Worldbuilder (index.html)

Navigation index for the single-file app. Line numbers are PENDING the first `/codemap` run against the on-disk `index.html` (the file is not in the repo yet); the section ORDER and the key symbols below are accurate and are the primary navigation aid. Re-grep by function name; fill in line numbers once index.html lands.

## File shape (top to bottom)
1. **Head + CSS** - design tokens (`:root`), component styles (toolbar, status bar, sidebar panels, inspector, tooltip, legend, intro screen, population graph).
2. **Body / HTML** - intro overlay; toolbar (start/pause/step/reset/force, speed/map/px/preset, seed, flora/herb/carn/place/rivers, png/save/load/test); status bar; layout = canvas + sidebar (overlay selector + collapsible panels: Inspector, Terrain, Climate, Ecology, Population, Legend, Tests).
3. **Script (IIFE, 'use strict')** - everything below.

## Systems and key symbols
- **Error / util:** `togglePanel`, `window.onerror` HUD.
- **State:** grid / elev / aridity / tempField / sunlight + volcano fields; ecology state (`flora[]`, `fauna[]`, `deathParticles`, `placeMode`, species-name parts, `popHistory`, `biomeBoundary`, `floraRemnants`); river vars; beach vars.
- **Seeded PRNG:** `mulberry32`, `sRng`, `sRandn` / `sTruncNorm` / `sBeta` / `sGamma`. NOTE: the generation pipeline uses these; ecology / climate use raw `Math.random` (the reproducibility gap).
- **Presets:** `PRESETS` (8: balanced/desert/wetlands/iceage/volcanic/jungle/archipelago/pangaea), `applyPreset`, `syncUIToConfig`.
- **Config:** terrain enum `T` / `TNAME` / `TERRAIN_COLORS` (16 biomes), `WORLD`, `CFG` (all tunables incl. ecology + beach), `DEFAULT_CFG`.
- **Canvas helpers:** `idx`, `inb`, `neighbors4/8`, `clamp`, `resize`. **Zoom / pan:** `applyZoomPan`, `screenToTile`.
- **Climate:** `climateInit`, `initAnomalyBlobs`, `updateAnomalyBlobs`, `seasonPhase`, `climateStep`, `applyClimateIfEnabled`.
- **UI hooks:** `hook()` + all button bindings, placement mode, overlay selector, canvas click/move/wheel/pan, climate + ecology slider hooks, legend tooltips, hotkeys.
- **Sliders:** `SLIDER_SCHEMA`, `buildSliders`, `applyElevationIntensity`.
- **Climate fields:** `computeSunlight` (+ `reseedSunlight`, `addHotColdBlobs`), `computeTemperature`, `computeAridity` (BFS from coast + river moisture).
- **Biomes:** `classifyTile` (the 16-biome rule ladder), `reclassTerrain` (+ ecotone boundary cache).
- **Terrain generation:** `pickWorldMeta`, `currentCoreHeight`, `landCoverage`, `tryVolcano`, `coolVolcano`, `tryCoastal`, `erosionStep`, `promoteVolcanoAt`, `clusterSpikePass`, `eruptionPromotionPass`, `mountainFringePass`, `isolatedHillDecayPass`.
- **Rivers:** `generateRivers` (downhill trace from high-elev sources, spacing, volume accumulation, lakes, estuaries), `clearRivers`, `drawRivers` (bezier meanders).
- **Beaches:** `beachStep` (organic erosion process, cap, spread), `clearBeaches`. Render is inside `draw`.
- **Species naming:** `generateSpeciesName`, `getSpeciesName` (binomial, shown at lineage gen >= 5).
- **Ecology - flora:** `makeFlora`, `BIOME_FLORA_HARSHNESS`, `computeFloraHealth`, `mutateFloraChild` / `cloneFloraChild`, `seedFloraCluster`, `naturalFloraSpawn`, `floraStep`.
- **Ecology - fauna:** `makeFauna`, `computeFaunaClimateFit`, `seedFaunaGroup`, `naturalFaunaSpawn`, `buildSpatialIndex`, `scoreTileForFauna` (foraging / predator-avoidance scoring - central to balance), `mutateFaunaChild` / `cloneFaunaChild`, `faunaStep`.
- **Rendering:** `hexToRGB` / `rgbToHex` / `blendColors`, `draw` (terrain + 9 overlays + ecotone blend + beach render + river render + flora / fauna render + death particles).
- **Inspector / tooltip:** `inspectTile`, `pct01`, `updateTooltip`.
- **Export / import:** `exportPNG`, `exportJSON`, `importJSON` (snapshot version `wb-eco-1`).
- **HUD:** `drawPopGraph`, `drawHUD`.
- **Loop:** `init`, `step` (the per-tick pipeline), `loop`.
- **Tests:** `runTests` (the gate; about 60 assertions).
- **Boot:** `boot`, `dismissIntro`, intro start listener.

## Where to change things (the big work)
- **Ecosystem balance:** `floraStep` (regrowth + spread + competition), `faunaStep` (energy, movement, eating, reproduction), `scoreTileForFauna` (foraging / predator-avoidance - the traveling-wave cause), and the ecology block of `CFG` (spawn / eat / repro / mutation rates).
- **Rivers:** `generateRivers`.
- **Beaches:** `beachStep` + the beach branch of `draw`.
