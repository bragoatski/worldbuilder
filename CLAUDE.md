# CLAUDE.md - Worldbuilder

## START HERE
You are working on **Worldbuilder**, a procedural terrain + ecology simulator. This is its own project and its own git repo - it is NOT Taipan. Taipan (a multiplayer board game) and Fork (a separate concept project) are SIBLING projects in adjacent folders; do not pull their code or context into this one. The only thing shared across all of Kevin's projects is the global layer at `~/.claude/` (operating model, working principles, model routing, cross-project lessons) - this project inherits all of it.

Read `STATUS.md` (current truth + the next step), then the newest file in `docs/04 Handoffs/` (a self-contained brief for the last unit of work). STATUS.md is overwritten to current truth; handoffs are the append-only log.

## What this is
- A single self-contained file: `index.html` (~1150 lines, vanilla JS + a 2D canvas, no build, no deps). Open it in a browser to run it.
- A seeded generation pipeline: volcanic terrain genesis, erosion, climate (sunlight / temperature / aridity), 16 biomes.
- A living ecosystem on top (NOT seeded - see the reproducibility lesson): flora with climate fitness + evolution, herbivores and carnivores with energy / aging / mutation, plus rivers and beaches.

## North star
TBD - see `docs/01 Design/North Star and Roadmap.md`. Until Kevin pins it, the working goal is: harden and understand the existing sim, no new feature commitments. Because this project has no automated gate yet (the test suite runs in-browser) and its hardest problems are design / tuning (ecosystem balance), MORE of the work here lands in **Tier B** (bring to Kevin with a recommendation) than on Taipan. Drive the clearly-safe Tier-A work; bring taste / scope / design calls to Kevin.

## Navigating the code
- **Never paste the whole file into context.** Navigate via `docs/02 Code/CodeMap.md`. Re-grep by function name if a line number is stale.
- The big systems and where they live: terrain generation (genesis / erosion / volcano passes), climate (`climateStep`), biome classification (`classifyTile` / `reclassTerrain`), rivers (`generateRivers` / `drawRivers`), beaches (`beachStep`), the ecosystem (`floraStep`, `faunaStep`, `scoreTileForFauna`), rendering (`draw`), tests (`runTests`).

## The gate
The authoritative "does it RUN" gate is the in-page test suite: open `index.html`, click **Test** (or press `T`), confirm 0 failed (the badge shows pass / fail). About 60 assertions covering biome classification, climate bounds, terrain, ecology, competition, grazing, and adaptive mutation.
- KNOWN GAP: there is no headless / CLI runner yet, so the gate is currently MANUAL. Building a headless multi-seed harness is an early priority (it is also the unlock for tuning the ecosystem - see STATUS). Until then, after any logic change, run the in-page tests and confirm green before considering it done.

## Working rules
- Inherit everything in `~/.claude/CLAUDE.md` (operating model, ceremony-to-risk, YAGNI ladder, two gates, docs-are-memory, agent workflow, taste). This file only adds Worldbuilder specifics.
- Match ceremony to risk: a cosmetic tweak is not a handoff-worthy event; an ecosystem-tuning or generation change is.
- Keep `STATUS.md`, the CodeMap, and the newest handoff current enough that a fresh session can resume cold.
- Capture durable, reusable gotchas in `docs/02 Code/Engineering Lessons.md` (rule + why + Verified date). Genuinely cross-project ones go to the global lessons / promotion inbox instead.
- Reproducibility: terrain generation uses the seeded RNG (`sRng` / mulberry32); the ecology, climate, and mutation code still call raw `Math.random()`. So a seed reproduces the same TERRAIN but not the same ecology run. Treat this as a known gap, not a surprise (see lessons).
- The name "Base44" is retired (an abandoned first build); do not reintroduce it.

## Memory
This project has its own memory namespace (auto-created by the harness when a session runs here) - separate from Taipan's. Cross-project knowledge does NOT go in project memory; it goes to the global layer.

## Docs map
- `docs/02 Code/CodeMap.md` - navigation index for index.html.
- `docs/02 Code/Engineering Lessons.md` - durable Worldbuilder-specific gotchas.
- `docs/01 Design/North Star and Roadmap.md` - the pending direction decision + parked exploratory ideas.
- `docs/04 Handoffs/` - dated, newest first.
