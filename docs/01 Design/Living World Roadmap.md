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
2. **Make evolution visible (pillar A).** Heritable size gene + size-scaled render; follow-a-
   creature camera + ancestry panel. Size cosmetic-first (balance-safe); if it later affects
   energy/eat it goes through the harness.
3. **God powers (pillar D).** Land brush + a few dramatic events (meteor / drought / bloom),
   each logging to the Chronicle. Behavior-touching -> harness sanity pass.
4. **Shareable worlds (thread 3).** Seed + CFG -> URL permalink (builds on JSON export); a
   "copy world link" action. Optionally a Chronicle-driven "postcard". Balance-safe.
5. **Scenarios + objectives (pillar E).** A few setups + win-checks on top of the sandbox.
6. **Speciation (pillar C)** and **trophic depth** - the harness-heavy chunks, last.

## Done
- **Chunk 1 - The Chronicle** (2026-06-29, deployed). Pure event engine on the step path + Chronicle
  sidebar panel + notable-life records + vivid-lineage announcements. Balance-safe. See STATUS + the
  2026-06-29 Chronicle handoff.
