# 2026-06-29 - Living World chunk 1: the Chronicle (the world's memory) + deploy

Self-contained handoff. Read STATUS.md for current truth and `docs/01 Design/Living World Roadmap.md` for
the full direction + chunk sequence. Prior handoff: `2026-06-25 session ...` (and the seasons rebuild is
recorded in STATUS + Engineering Lessons, landed by a parallel session as `28ebcce`).

## The direction (new this session, set with Kevin)
Worldbuilder's rare asset is the SIMULATION (deterministic, balanced, evolving living world). The chosen
direction AMPLIFIES it rather than discarding it. Three threads: (1) deepen the living-world sim and make
the evolution it already runs VISIBLE + legible; (2) god-game agency (intervention as play); (3) shareable
worlds. Threads 1+2 first, 3 folds in. Parked: full RPG and a click-a-tile AI-image map (both waste the
moat); a survival-roguelike "you ARE one creature in the food web" is kept as a someday option. The roadmap
doc holds pillars A-E and the chunk list. Per-chunk workflow (Kevin's): one large chunk -> full gate ->
docs -> commit -> deploy -> next-session prompt.

## What shipped: chunk 1 = the Chronicle
The world now keeps a memory and shows it. A PURE event engine in the sim core plus a sidebar panel.
- **`chronicleSample()`** runs at the END of `step()` on a 10-tick cadence. It derives population/lineage
  stats (`chronicleStats`) and emits typed events by comparing to the previous sample + all-time records.
  NO DOM, NO RNG -> Worker-safe + deterministic.
- **Event kinds** (off round-number milestone LADDERS so the feed reads as a story, not +1 spam):
  `terrain` (land 25/50/75/90% + "a new world begins"), `record` (herb/carn/flora population rungs +
  longevity), `lineage` (every 5th generation, named once gen>=5 via `getSpeciesName`), `milestone`
  (first predators), `arrival`/`extinct` (type returns / dies out), `crash` (>45% drop above a floor),
  `vivid` (a bright mutant lineage takes hold). 200-entry ring buffer.
- **`renderChronicle()`** is the ONLY DOM part (draw path): a new "Chronicle" sidebar panel
  (`#panelChronicle`) with a notable-life records strip (`#chronicleRecords`) + a scrolling feed
  (`#chronicleFeed`) + an event-count `#chronicleBadge`. CSS uses the existing design tokens.
- **`chronicleNote(kind,text,color)`** is exposed for chunk-3 god-powers to log deliberate acts.
- State plumbing: `chronicle` resets in `initWorld`, round-trips through `snapshotState`/`restoreState`
  (with an `|| newChronicle()` guard for old snapshots), and is exported (`chronicle`, `chronicleNote`,
  `_crossLadder`) for the gate.

## Why it is balance-safe
Read-only observation. It touches NO fauna rate or behavior (`scoreTileForFauna`/`faunaStep` untouched),
so the C2 predator-prey balance is byte-untouched. It only reads state and appends to its own log.

## Gate (full, green)
`npm run typecheck` (clean) + `npm run lint` (0 errors, 23 pre-existing warnings, none new) + `npm test`
(**10 tests**, was 7; new: ladder-monotone, `chronicleNote` contract, determinism-through-snapshot) +
`npm run build` (ok). The pure core is gate-covered; the determinism-through-snapshot test is the property
that proves the sampler is pure. **The panel RENDER is gate-blind** - it needs an eyeball in the live app
(press play, watch the Chronicle panel fill; check the records strip + badge update).

## Concurrent-session note (important)
A parallel session rewrote the climate system in `src/main.js` DURING this session and deployed it
(`28ebcce`, live bundle `index-DTrtWU3A.js`). It was handled cleanly: stopped, surfaced, the unrelated WIP
season-probe tooling found in the tree was preserved as its own commit (`7ab8ffc`), and only the
Chronicle's own files were staged. New Engineering Lessons entry records the gotcha. Expect `main.js` to be
shared; check `git status` + mtime before editing.

## Deploy
ff `main` -> the Chronicle commit + push (GitHub Pages CI publishes). `main` was at `28ebcce` (climate
fix). [Fill in the deployed commit + live bundle hash after pushing.]

## NEXT (chunk 2): make evolution VISIBLE (pillar A)
Heritable SIZE gene (cosmetic-first = balance-safe) + size-scaled fauna render, and a follow-a-creature
camera + ancestry panel. The genome (climate prefs + color genes) already mutates + inherits via
`mutateFaunaChild`; chunk 2 makes it watchable, and feeds the Chronicle (size/speciation records). If size
ever affects energy/eat, that part goes through the harness (`npm run measure`). See the roadmap.
