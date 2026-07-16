# Handoff — 2026-07-15: Code-review fixes (7) + Living Food Web (chunk 11)

Self-contained brief for this unit of work. Prior context: the trophic-depth arc is complete (5 tiers shipped);
see the 2026-07-08 handoff for the last session. Branch: `ecology-balance`.

## What this session did
A fresh-eyes code review (3 parallel reviewers + adjudication + 2 adversarial critic passes) that fixed 7 real
bugs, then built the **Living Food Web** panel (Kevin approved v1+v2). All balance-safe; gate green; deployed.

## Part 1 — the 7 bug fixes (all in observer / load / UI-shell paths; zero eRng; C2 untouched)
1. **`init()` never cancelled the async scenario warmup timer** (`main.js`). Reset/roll-seed/map-size/preset
   during a scenario's "Preparing world" left `_scenWarmTimer` firing into the fresh world, then threw an
   uncaught TypeError on the now-null `activeScenario`. Fixed: `init()` clears the timer (HIGHEST severity).
2. **Follow-camera re-attached to an unrelated creature after a rebuild** (`main.js`). `initWorld` re-issues
   fauna ids from 1, so a stale `followId` matched a new creature. Cleared `followId` in `init()`, `importJSON()`,
   AND `startScenario()` (the deck launch path bypasses `init()` — caught by the first critic pass, not the gate).
3. **JSON world load inherited the previous world's narrative** (`sim.js applySnapshot`). The wb-eco-1 format
   doesn't carry chronicle / species registry / popHistory / carrion / id-counters, so they bled across loads
   (phantom "carnivores extinct" beats, ghost species deaths, follow/lineage id collisions). Now reset + id
   counters reconciled past the loaded life.
4. **Chronicle / postcard / scenarios counted every non-herbivore as a "carnivore"** (`sim.js chronicleStats`).
   scav/apex/omni inflated `carn` (feed announced "Carnivores passed 20" with a handful of true carnivores).
   Now counts carnivores honestly. NOTE: the scenarios were authored at chunk 5 BEFORE the extra tiers existed,
   so `carn:20/12/10` were calibrated for true carnivores — this fix RESTORES their original intent, not a
   difficulty regression. (Kevin's call 2026-07-15: keep the honest count.) Scenario thresholds still merit a
   live winnability eyeball, an item already open in STATUS.
5. **Population graph clipped scav/apex/omni** — the auto-scale ignored them though they're drawn at ×4. Folded in.
6. **`applyWorldCode` accepted a non-finite CFG value** from an untrusted `?w=` link (a `NaN` could silently
   disable the land cap). Added an `isFinite` guard.

## Part 2 — Living Food Web (chunk 11): the trophic structure made visible
A new "Food Web" sidebar panel — a canvas node-link diagram of the 5 tiers + flora/carrion resource nodes, node
size = population, arrow thickness/opacity = RECENT feeding flux. Makes the documented cascades (apex damps the
carnivore boom-bust; omnivore re-crowds the base) watchable. A PURE OBSERVER — same balance-safe shape as the
Chronicle / Species panels.
- **v1 (pure observer):** `foodWebCensus()` (sim.js) — per-tier pop + mean energy + the fixed 7-edge topology.
  `renderFoodWeb()` (main.js) draws the canvas; `#panelFoodWeb` in index.html.
- **v2 (feeding flux):** 7 plain integer counters incremented at the eat sites in `faunaStep` (herbFlora,
  carnHerb, omniFlora, omniHerb, scavCarrion, apexCarn, apexScav). `foodWebSample()` (end of `step()`, Chronicle
  cadence) derives the recent-window delta the panel renders. **Balance-safe BY CONSTRUCTION:** a bare `++`
  draws no eRng, so the measured stream is byte-identical.
- **State lifecycle:** `foodWeb` resets in `initWorld`, round-trips snapshot/restore, resets in `applySnapshot`,
  and is exported. Gate-tested pure core (`foodWebCensus` bucketing + flux-reads-recent + flux determinism).

## The gate (all green)
`npm run typecheck` 0 errors · `npm run lint` 0 errors (32 legacy warnings) · **50 tests** (was 48; +2 food-web) ·
`npm run build` OK. **`npm run measure` BYTE-IDENTICAL before/after** (extinction 0%, carn-persistence 50% 3/6,
final fauna 49.3, flora 2119.2, cap-hits 0, per-seed 45/94/6/12/2/137) — the proof the v2 flux counters do not
shift the eRng stream. The chunk-10 C2 baseline is untouched.

## Gate-blind (eyeball live)
The Food Web panel RENDER is DOM (not exercised by the gate). Verified structurally by a critic (no undefined
node/tier lookups, no NaN, canvas-absent no-op, ids exist). Eyeball live: open the Food Web panel, press play,
watch the nodes resize + the arrows thicken/thin as tiers boom and bust; check a carnivore boom swells its node
and the apex crops it.

## Next-session prompt
Trophic-depth arc + Food Web are complete. Open: (a) live eyeball of the Food Web panel; (b) scenario-threshold
winnability check (Genesis carn:20 / Balance carn:12 / Volcanic carn:10 now honest); (c) optional Food Web v2+
(mate-choice / fauna-distribution remain the harness-gated backlog). See STATUS "NEXT".
