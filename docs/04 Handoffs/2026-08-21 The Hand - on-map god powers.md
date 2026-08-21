# 2026-08-21 - The Hand: on-map god powers

Self-contained brief for this unit of work. Prior handoff: `2026-07-15 Code review fixes + Living Food Web (chunk 11).md`.

## Why this happened

The owner asked whether the project was worth putting on itch.io. The answer was no, on the grounds that a
visitor could only WATCH the world: play, pause, speed, inspect a tile, follow a creature. That diagnosis was
half wrong and the correction matters. The god powers from chunk 3 (`brushTerrain`, `meteorStrike`,
`droughtEvent`, `bloomEvent`, creature placement) already existed and were gate-tested. They were unreachable,
because they live in the setup deck and `body.mode-viewer .deck-setup{display:none}` blanks that deck in the
default view. The work was therefore mostly reach and feel, not new systems.

Owner rulings that shaped it:
- ADDITIVE ONLY. Nothing may be removed. An earlier proposal to fold Drought and Bloom into a moisture brush
  was rejected: "I dont want to take option away." The whole Developer cockpit is untouched.
- Direct map impact AND subtle tuning, both. "good ui, tools, and inter activity will make it feel like god mode."
- On-map narration captions were proposed and REJECTED. The map already shows consequence (a ridge raises a
  rain shadow, and the desert appears behind it unaided); the Chronicle panel covers the rest passively.
- Undo approved, single level.

## What shipped

A tool rail pinned to the left of the map, present in Viewer, carrying nine powers plus undo. Every brush is a
PAIR: `Alt` inverts it, so six verbs occupy three buttons without hiding any behind a menu.

| Power | Key | Kind | Verb / Alt-verb |
|---|---|---|---|
| Shape land | `1` | drag | raise / sink |
| Rain | `2` | drag | rain / parch |
| Warmth | `3` | drag | warm / chill |
| Ember | `4` | click | volcano on high ground, meteor lower |
| Spring | `5` | click | opens a headwater |
| Seed life | `6` | click | contextual: plants, then a herd, then a predator |
| Sea level | rail | click | rise / withdraw |
| The Laws | rail | toggle | reveals the tuning sliders inside Viewer |

`e` still works as an alias for Shape land. `[` and `]` size the brush. `Ctrl+Z` undoes.

## The three problems worth remembering

**1. A drag cannot afford the settle.** `brushTerrain` ran four full-world passes (`computeTemperature`,
`computeAridity`, `applyClimate`, `reclassTerrain`) on every call. Fine for one click, ruinous at mouse-move
rate. Split into `brushTerrainRaw` (the field edit alone) plus `settleTerrain` (the recompute), with the shell
settling on a 90ms throttle mid-stroke and once on release. The 3-argument signature is unchanged, so the old
deck buttons and the tests hit the identical path.

**2. Painted climate had nowhere honest to live.** `step()` rebuilds `baseTemp`/`baseArid` from terrain every
~20 ticks, and `applyClimate` overwrites the live fields every single tick. An edit to either is erased within
a second of play. The fix makes painting a FIRST-CLASS climate forcing: `godTemp`/`godArid` are per-tile offsets
that `applyClimate` adds on top of the base, exactly like the seasonal / anomaly / volcano offsets already do.
A `_godClimatePainted` flag gates the whole path, so an unpainted world executes the original arithmetic
untouched. That is what makes the balance proof structural rather than lucky.

**3. Sea level had no coherent home in this terrain model.** The first attempt was destructive: raising the sea
zeroed the drowned elevation, so lowering it back gave almost nothing. It is now a true LEVEL. `seaSteps` counts
how far the sea stands above its original line; `drownedElev` remembers the height each tile drowned at and
`drownedAt` remembers WHICH rise took it, so a withdrawal returns exactly that ring. N rises then N falls is an
exact round trip (verified 62.66% -> 59.17% -> 62.66%). Below the original shoreline there is nothing owed, so
new shore is won from the shelf, one ring per step.

## Adversarial review

Three reviewers (balance safety / state lifecycle / input handling) produced eleven findings. Eight were
confirmed by reproduction and fixed. Two were downgraded on evidence and one comment was corrected as
overclaiming. The four that mattered:

- A click power landing on invalid ground destroyed the undo for the previous real act. `godMark` now returns
  the mark it displaced and `godCancelMark` puts it back.
- Undo after a JSON load reverted the LOAD. Painting never changes the seed, so the seed-equality guard passed.
  Reproduced: load a tick-140 checkpoint, press undo, land at tick 60. `applySnapshot` now drops the mark.
- Every legacy deck button silently did nothing while a Hand tool was armed. Exclusivity ran one way only and
  the canvas checks `handTool` first, so "Place Herbivore" lit up, showed its banner, and sculpted terrain.
  `setPlaceMode` now disarms the Hand.
- A stroke could change identity mid-drag (Escape or a number key), settling an elevation edit down the climate
  path and skipping the terrain recompute. Strokes now bind to `_strokeTool` at mousedown.

Also fixed: sea-level bookkeeping missing from the save file; the undo button lying for one interaction after a
Reset (`refreshUndoBtn` ran BEFORE the rebuild that clears the mark); `Ctrl+Z` mid-drag leaving unundoable edits;
the Laws drawer not subtracting the sidebar width in `fitCanvas`; a stale brush ring after a keyboard switch.

Rejected or downgraded on evidence:
- "Sea level violates the ocean-elevation-is-zero invariant." The sea-level path was leaking and is fixed
  (a clean world takes two withdrawals and leaks zero), but the invariant is NOT absolute: the land brush leaves
  304 such tiles and always has, because that accumulation is what makes raising ground out of the sea gradual.
  The code comment asserting the absolute invariant was corrected.
- "The rise branch records a fabricated height for tiles below the step size." The logic error was real and is
  fixed, but a scan of five worlds and 108 land tiles found the lowest land elevation to be 1.49, far above the
  0.35 step. Unreachable in practice; the fix is correctness insurance.

## Verification

- Full gate green: typecheck, lint (0 errors, 31 warnings = unchanged baseline), 50/50 tests, build.
- `npm run measure` BYTE-IDENTICAL to the pre-change baseline on every simulation number. The C2 balance did
  not move.
- Every power driven in a real browser via Playwright, not assumed. The browser pass caught a crash the headless
  gate cannot see: a control-wiring block read `brushStrength` at module-eval time before its assignment ran
  (`var` hoists the declaration, not the value).
- Each adversarial fix has a regression check that fails against the pre-fix code.

## Where the code lives

- `src/sim.js`: `brushTerrainRaw` / `settleTerrain` / `brushClimateRaw` / `settleClimate` / `emberStrike` /
  `addSpring` / `seedLifeAt` / `shiftSeaLevel`, and the undo trio `godMark` / `godCancelMark` / `godUndo`.
  New state: `godTemp`, `godArid`, `_godClimatePainted`, `springs`, `drownedElev`, `drownedAt`, `seaSteps`.
- `src/main.js`: the `TOOLS` table (a `kind` of `brush` or `click` decides whether a press paints or fires once),
  `setHandTool`, `handStrokeStart/Move/End`, `handClickPower`, `updateBrushRing`, `_syncFlyout`, `seaLevel`.
- `index.html`: the `.hand-rail` markup and CSS. It sits inside `.canvas-wrap`, deliberately NOT in
  `.deck-setup`, or Viewer would blank it. The Laws drawer works by making the Viewer hiding rules conditional
  on `:not(.laws-open)`, so the SAME sliders with the SAME listeners become reachable. Nothing is duplicated.

## Next

The owner deferred the itch.io decision. If it goes ahead, the store page needs a cover image, three or four
screenshots and a short clip; the MP4 pipeline from the Taipan launch assets applies. Otherwise the open
backlog is unchanged: steady-state long-run ecosystem balance, and richer creature AI.
