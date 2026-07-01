# Living World Roadmap - Worldbuilder

Set 2026-06-29 with Kevin. This is the committed direction for Worldbuilder and the spine the
per-chunk handoffs hang off. STATUS.md holds current truth; this holds the plan.

## The decision
Worldbuilder's rare asset is the SIMULATION: a deterministic, balanced, evolving living world
(real hydrology, mutating flora/fauna with lineages + species names, a measured predator-prey
balance). That is the moat. The chosen direction AMPLIFIES the sim rather than discarding it.

Three threads, picked by Kevin:
1. **Deepen the living-world sim** - make the evolution the engine already runs VISIBLE and
   legible, and let the world tell its own story.
2. **God-game agency** - turn intervention (already half-built: placement, force-genesis,
   presets, sliders) into play, with consequence feedback and light objectives.
3. **Shareable worlds** - a world is a unique seed + history; make it shareable. A cheap
   multiplier on 1 + 2.

Order: 1 and 2 first, 3 folds in as it becomes cheap. The full-RPG pivot and the click-a-tile
AI-image map were considered and parked: both waste the moat (the sim becomes wallpaper). A
narrow survival-roguelike ("you ARE one creature in the real food web") is kept as a someday
option because it would genuinely use the sim.

## The pillars (where the work lands)
- **A. Make evolution visible + followable** - heritable size (and maybe speed) genes that
  render; a follow-a-creature / lineage inspector. The genome already exists (climate prefs +
  color genes, both inherited via `mutateFaunaChild`); it is invisible today.
- **B. The Chronicle** - the world keeps a memory: a typed event log (extinctions, booms,
  crashes, new vivid lineages, generation + population + land milestones, longevity records).
  Pure + headless-testable. The bridge into thread 3.
- **C. Real speciation** - lineage drift becomes named, diverging species (tracking + naming
  first; reproductive isolation as a separate measured experiment).
- **D. God powers + the intervention->consequence loop** - a land brush, rain/drought, meteor,
  bloom; the Chronicle/telemetry as the feedback that closes the loop.
- **E. Scenarios + light objectives** - starting setups + win-conditions on top of the sandbox
  (Genesis, Ice Age, "keep 3 trophic levels alive 10k ticks"). Depends on B.
- (Parked: more trophic levels - apex/scavenger/omnivore. Richest story fuel but most likely to
  break the C2 balance, so it gets its own measured loop later, not the first push.)

## The balance constraint (non-negotiable)
The hard-won C2 predator-prey balance must not silently regress. So:
- Anything that touches fauna RATES or BEHAVIOR goes through the harness (measure -> A/B ->
  keep-if-better), exactly as flora distribution and herbivore desync did.
- Anything purely VISUAL / UI / additive-observation is balance-safe and the automated gate
  (typecheck + lint + test + build) covers its pure core. The render itself is gate-blind and
  needs a browser eyeball (the `?debug` `window.__wb` handle / Kevin's sign-off).
- Design each feature as a PURE testable core + a thin DOM render, mirroring the existing
  `initWorld`/`runAssertions` split, so the gate keeps meaning.

## The workflow (per chunk)
Kevin's loop: take one large coherent chunk, then Complete -> Test (full gate, full output) ->
Update docs (STATUS + this roadmap's chunk status + CodeMap + Engineering Lessons + a handoff)
-> Commit (small steps) -> Deploy (ff `main` + push; Pages CI publishes) -> hand back a
next-session prompt for the following chunk. One chunk per cycle.

## Chunk sequence (living; update status as each lands)
1. **The Chronicle (pillar B).** DONE 2026-06-29 (deployed). Pure event engine in the sim core
   (`chronicleSample()` on the step path) + a Chronicle sidebar panel + a notable-life records
   readout + vivid-lineage announcements. Balance-safe (read-only observation). Exposes
   `chronicleNote()` for later god-powers (D) to log deliberate acts. Gate-covered pure core
   (ladder + determinism-through-snapshot); panel render is gate-blind.
2. **Make evolution visible (pillar A).** DONE 2026-06-30 (deployed). Heritable cosmetic `size` gene
   (founders 1.0, drifts on the isolated `cRng` stream, rendered as marker scale) + `lineageId` for
   kin-tracking; a follow-a-creature camera (`followId`/`updateFollow`) + a Lineage inspector panel +
   per-creature Follow buttons; a Chronicle size record. Balance PROVED safe (harness byte-identical
   before/after, since `cRng` leaves `eRng` untouched). If size later affects energy/eat it moves to
   `eRng` and goes through the harness.
3. **God powers (pillar D).** DONE 2026-06-30 (deployed). Land brush (raise/lower a soft disc, `brushTerrain`)
   + three one-press events - meteor (`meteorStrike`: crater + wipe life in the blast), drought (`droughtEvent`:
   aridity-weighted flora dieback), bloom (`bloomEvent`: a flora burst) - each logging a `'god'` Chronicle event.
   Balance-safe BY CONSTRUCTION: the interventions run only from UI hooks, never inside `step()`, so the harness
   (which only exercises `step()`) is byte-identical before/after (verified). See STATUS + the chunk-3 handoff.
4. **Shareable worlds (thread 3).** DONE 2026-06-30 (deployed). A world is a permalink: a compact world code
   `{ seed, preset, cfg-diff-from-default }` (WORLD is re-derived from the seed) encoded into a `?w=` URL
   (`buildWorldCode`/`applyWorldCode` + a base64 codec), a boot-time one-shot restore, and a Share deck seg
   (Copy Link + a Chronicle-driven Postcard). Balance-safe (the only sim mutation is the same `initWorld`
   re-genesis the preset selector uses; nothing in `step()`).
5. **Scenarios + objectives (pillar E).** A few setups + win-checks on top of the sandbox.
6. **Speciation (pillar C)** and **trophic depth** - the harness-heavy chunks, last.

## Done
- **Chunk 1 - The Chronicle** (2026-06-29, deployed). Pure event engine on the step path + Chronicle
  sidebar panel + notable-life records + vivid-lineage announcements. Balance-safe. See STATUS + the
  2026-06-29 Chronicle handoff.
- **Chunk 2 - Make evolution visible** (2026-06-30, deployed). Heritable cosmetic `size` gene on a new
  isolated `cRng` stream (rendered as creature scale) + `lineageId` kin-tracking + a follow-a-creature
  camera + a Lineage inspector panel + a Chronicle size record. Balance byte-identical (harness A/B). See
  STATUS + the 2026-06-30 evolution-visibility handoff.
- **Chunk 3 - God powers** (2026-06-30, deployed). Land brush (`brushTerrain` raise/lower) + meteor / drought /
  bloom events, each logging a `'god'` Chronicle event. First BEHAVIOR-touching chunk, but balance-safe by
  construction (interventions never run in `step()`, so the harness is byte-identical before/after). See STATUS
  + the 2026-06-30 god-powers handoff.
- **Chunk 4 - Shareable worlds** (2026-06-30, deployed). A world is a permalink: a compact world code
  `{ seed, preset, cfg-diff-from-default }` (terrain + ecology are deterministic from the seed; `WORLD` is
  re-derived) encoded into a `?w=` URL via `buildWorldCode`/`applyWorldCode` + a base64 codec, restored once at
  boot, with a Share deck seg (Copy Link + a Chronicle-driven Postcard). Balance-safe (the only sim mutation is
  the `initWorld` re-genesis the preset selector already uses; nothing in `step()`). See STATUS + the
  2026-06-30 shareable-worlds handoff.
