# 2026-06-30 - Living World chunk 2: make evolution VISIBLE (size gene + follow camera) + deploy

Self-contained handoff. Read STATUS.md for current truth and `docs/01 Design/Living World Roadmap.md` for
the direction + chunk sequence. Prior handoff: `2026-06-29 Living World chunk 1 - Chronicle + deploy.md`.

## The direction (unchanged from chunk 1)
Worldbuilder's moat is the SIMULATION. The roadmap AMPLIFIES it: (1) deepen the living-world sim + make its
evolution VISIBLE, (2) god-game agency, (3) shareable worlds. Per-chunk workflow: one large chunk -> full
gate -> docs -> commit -> deploy -> next-session prompt. Chunk 1 was the Chronicle (the world's memory).

## What shipped: chunk 2 = make evolution visible (pillar A)
The evolution the engine already runs (mutating, inherited genomes) is now watchable.

- **Heritable cosmetic `size` gene.** Founders start at exactly 1.0; the gene only diversifies through
  inherited drift in `mutateFaunaChild` (so a large lineage is visibly EVOLVED, not initial luck).
  `cloneFaunaChild` copies it; clamped [0.5,2.2]. Rendered as the fauna marker dimension (`dim` in `draw`),
  so big creatures literally look big. Knob: `CFG.faunaSizeMutationMag` (0.09, sd of the Gaussian step).
- **`lineageId` gene** (founder = its own id; children inherit the root) so living kin are countable.
- **Follow-a-creature camera.** `followId` + `updateFollow()` (last call in `draw()`) keeps the camera
  centered on the tracked creature each frame (`centerOnTile`: pan = canvasCenter - tileCenter, which is
  zoom-independent because `transform-origin` is center) and clears the follow when the creature dies.
  `startFollow` zooms in (>=3x) + expands the Lineage panel. An accent ring marks the followed creature.
- **Lineage inspector panel** (`#panelLineage` / `renderLineagePanel`): live size (+ a word: small/average/
  large/giant), generation, energy, age, position, climate prefs, color swatch, vivid tag, living-kin
  count, lineage top-gen, and a Stop button. Per-creature **Follow buttons** were added to the Inspector.
  Both are wired with DELEGATED listeners (bound once, so the per-frame innerHTML rewrites don't leak).
- **Chronicle size record.** `CHRON_SIZE_LADDER=[1.3,1.5,1.7,1.9,2.1]` + `records.sizeRung`/`peakSize`;
  `chronicleStats` now reports `maxSize`/`bigName`. Emits "a <species> grew to N× normal size" off the
  ladder + a "Biggest" entry in the records strip. Uses the existing `record` kind (no new event kind).

## Why it is balance-safe (the key decision)
The size gene is COSMETIC: it is never read by `faunaStep`/`scoreTileForFauna`/the energy/repro fields.
But there was a trap: the existing color-gene mutation already draws from `eRng`, and ANY added `eRng`
draw shifts the whole downstream ecology phase (the RNG-reshuffle gotcha), which would silently move the
hard-won C2 balance even though the gene does nothing. So the size gene drifts on a NEW, isolated RNG
stream `cRng` (`cRandn`, seeded in `initWorld`/`restoreState` from `_seed ^ 0x85EBCA6B`). With `eRng`
byte-untouched, the ecology run is PROVABLY identical. New Engineering Lessons entry records the pattern:
a future visual/observational gene draws only from `cRng` and is never read by the sim -> no harness re-tune.

## Gate (full, green) + the balance proof
`npm run typecheck` (clean) + `npm run lint` (0 errors, 23 pre-existing warnings, none new) + `npm test`
(**13 tests**, was 10; new block "evolution visibility": size/lineage validity in [0.5,2.2]+int id; kin
share a lineage + size drifts off 1.0 + chronicle tracked peakSize; balance-safe = ecology+genes identical
through a snapshot replay) + `npm run build` (ok). **Balance proof:** `node scripts/harness.mjs --seeds=8`
run BEFORE and AFTER the change returned identical numbers (0% extinction, carnivore-persistence 75% (6/8),
final fauna 73.6, final flora 2263.8, herb amp 37.8, carn amp 10.7, cycles 3.1, cap-hits 0) - confirming
`cRng` left `eRng` untouched. **The render + follow camera + panels are gate-blind DOM** - eyeball in the
live app: follow a creature (Inspector -> Follow), watch it stay centered as it moves; check the size
markers vary, the Lineage panel updates live, and size events appear in the Chronicle.

## Concurrent-session note
`src/main.js` is shared across sessions (climate + Chronicle landed from parallel sessions before). Working
tree was clean at start (branch `ecology-balance`, == `main` == `59bfe84`). Check `git status` + mtime
before editing if another session may be active.

## Deploy
ff `main` -> the chunk-2 commit(s) + push (GitHub Pages CI publishes the Vite `dist/`). `main` was at
`59bfe84`. [Fill in the deployed commit + live bundle hash after pushing.]

## NEXT (chunk 3): God powers (pillar D)
A land brush + a few dramatic events (meteor / drought / bloom), each logging to the Chronicle via the
existing `chronicleNote()` hook. Unlike chunks 1-2 this is BEHAVIOR-touching (changes terrain/fauna), so it
needs a harness sanity pass. See the roadmap for the remaining sequence (shareable permalinks, scenarios,
speciation + trophic depth).
