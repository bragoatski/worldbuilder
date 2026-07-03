# Chunk 10 - split the sim core into src/sim.js (DOM-free) + delete the DOM stub (2026-07-03)

Self-contained brief for this unit of work. Prior context: the Living World trophic arc is complete
(see `2026-07-02 Living World chunk 9 - Trophic depth take 4 (omnivore, shipped on) + deploy.md`).
This chunk is the pre-roadmap "optional deep cleanup" (old STATUS NEXT item 3), NOT a roadmap chunk.
STATUS.md holds current truth; this is the append-only record.

## What & why
Split the DOM-free SIMULATION out of the 2362-line `src/main.js` into its own `src/sim.js`, removed the
interim Proxy DOM stub (`scripts/headless-dom.mjs`), and repointed every headless consumer to import the
pure core directly. Goal: `sim.js` imports cleanly in Node with no stub (cleaner headless story + a real
per-module TS target), and `main.js` is a thin browser shell. A PURE refactor - no rate/behavior change.

## Result
- **`src/sim.js` (~1650 lines)** = the DOM-free core. State + the 3 RNG streams, PRESETS/CFG, climate,
  biomes, terrain genesis, river GENERATION, ecology (flora/fauna + scavenger/apex/omnivore), the chronicle
  SAMPLER, speciation, scenarios CORE, god powers, snapshot/restore, `initWorld`/`step`/`runAssertions`,
  world-code cores. Touches NO document/window/canvas. Exports ~130 names (live state bindings + pure fns).
- **`src/main.js` (~800 lines)** = the browser UI shell. Rendering (`draw`/`drawRivers`/`drawHUD`/`draw
  PopGraph`/`renderChronicle`/`renderSpecies`/`renderObjective`/`renderLineagePanel`), canvas + zoom/pan +
  follow-camera, all DOM wiring + sliders + panels, inspector/tooltip, export/import DOM wrappers,
  `applyPreset`/`syncUIToConfig`, `startScenario`, `init`/`loop`/`boot`, `?w=` boot restore. Imports the
  sim core at the top. The ONLY file touching the DOM.
- **`scripts/headless-dom.mjs` DELETED.** `sim.test.js`, `harness.mjs`, `flora-ab.mjs`, `river-diag.mjs`,
  `season-probe.mjs`, `make-preview-world.mjs` now `import` the pure `sim.js` directly (no stub).

## Split seams (the only non-mechanical parts)
ES module bindings are read-only from the importer, so the shell cannot reassign a sim binding it imports.
Handled with:
- **Three setters exported from sim.js:** `setWorldSize(n)` (mapSize handler's `W=H=n`),
  `setActiveScenario(v)` (startScenario's placeholder rebind), `setDeathParticles(v)` (draw's per-frame
  prune). Object *mutation* (`CFG.x=y`, `flora.push`, `activeScenario.status=...`) needs no setter - only
  rebinding the imported name is illegal.
- **`applySnapshot(data)`** - a pure DOM-free core extracted from `importJSON` (does all the state
  reassignment + field re-derivation); the shell's `importJSON` is now a thin wrapper (applySnapshot + the
  seed/preset/slider DOM sync + resize + draw). Mirrors the existing `buildSnapshot`/`exportJSON` split.
- **Two view-couplings relocated out of `initWorld`:** it used to call `resetZoomPan()` (DOM) + set
  `placeMode` (UI state). Those moved to the browser new-world callers (`init` both branches +
  `startScenario`), preserving the UX exactly. `initWorld` is now fully DOM-free.

## How it was done (reusable method)
1. Read + classified every top-level construct as sim vs DOM (the seam is `step()` pure vs `draw()`/`loop()`
   DOM; `loop` calls both). Confirmed the ambiguous ones (step, initWorld, applyScenarioDef, god powers,
   snapshot/restore) are DOM-free by reading their bodies.
2. A deterministic splitter routed each source line to sim/main by its nearest col-0 declaration boundary
   (indented bodies auto-attach to their owner), with a line-conservation assertion; the two physical lines
   that mix sim+UI state were hand-split. `node --check` on both outputs caught nothing (no misrouted brace).
3. Applied the seam patches, then let the eslint nets drive correctness: `no-undef` generated the exact
   import list for `main.js` (paste + iterate to clean), `no-import-assign` flagged all 5 illegal
   reassignments (the setters/applySnapshot above). A DOM-token grep on `sim.js` + a standalone
   `node import` proved no DOM leaked in (eslint can't catch that - browser globals are defined there too).

## Gate (full, green)
`npm run typecheck` (clean) + `npm run lint` (0 errors; 32 warnings, unchanged legacy) + `npm test`
(**40 tests**, all pass, imported through `sim.js` with no stub; ~294s incl. the flag-ON trophic replays)
+ `npm run build` (ok; bundle `index-C_LGWuYk.js`). **Pure-refactor proof:** `npm run measure` was
BYTE-IDENTICAL before/after (diff empty ignoring the wall-clock line): extinction 0%, carn-persistence
50% (3/6), phase lag +65t, final fauna 49.3 sd 50.4, flora 2119.2, cap-hits 0. So the C2 balance is
provably untouched.

## NOT YET DEPLOYED - one browser eyeball wanted (Tier B for Kevin)
The render/UI shell is gate-blind. Confidence is high: build resolves the module graph, eslint `no-undef`
proves every shell reference is imported (no boot-time ReferenceError), all DOM code moved verbatim, and
the only behavior changes are the setters + relocated resets + the importJSON split (all behavior-
preserving). But per the gate-blind rule (Playwright paused), before deploy: open the app, confirm it
BOOTS + DRAWS, then reset / roll-seed / change map-size, save+load a JSON world, and start a scenario.
Then deploy = ff `main` + push (Pages CI publishes). Committed on branch `ecology-balance`; `main` is at
`2e8fb4b` (chunk-9 code) + the chunk-9 deploy marker.

## Concurrent-session note
`src/main.js` is shared across sessions; this chunk rewrote it wholesale (split) + created `src/sim.js`.
Check `git status` + mtime before editing if another session may be active.

## Follow-ups
- The optional TS strictening (`// @ts-check` or a `.ts` rename on `sim.js`) is now a small, isolated task
  the split unlocked - not done here.
- Then back to the pre-cleanup menu (STATUS NEXT): fauna distribution as a measured task (item 1), or the
  optional trophic follow-ups (item 0).
