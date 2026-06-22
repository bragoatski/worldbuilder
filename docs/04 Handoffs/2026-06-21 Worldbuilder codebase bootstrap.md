# 2026-06-21 - Worldbuilder codebase bootstrap

Self-contained brief for the next session. Newest handoff; read `STATUS.md` for current truth.

## What this unit did
Two things, in one session:

1. **Built the global `~/.claude/` brain layer** (shared across all of Kevin's projects). Promoted the project-agnostic core out of Taipan so every project inherits it:
   - `~/.claude/CLAUDE.md` - expanded from routing-only to: operating model (principal dev, Tier A / B), working principles (ceremony-to-risk, YAGNI ladder + ponytail, two gates), navigating / memory discipline, agent workflow, the "no exclamation marks" taste rule (now a Kevin-wide preference), the model-routing block (verbatim), and pointers to the two files below.
   - `~/.claude/Engineering Lessons.md` - NEW, seeded with 5 universal lessons (gates, dead-code, deploy).
   - `~/.claude/PROMOTION-INBOX.md` - NEW, a temporary capture file for cross-project items we hit later; drains into the two above; deleted once the layer stabilizes.
   - DEFERRED (needs Kevin's OK to touch Taipan): slim Taipan's CLAUDE.md + shrink its duplicate memory files to pointers, so that global + slimmed-Taipan == today's Taipan. Until then the duplication is harmless.

2. **Bootstrapped this Worldbuilder repo + dev system** (this commit). Created the git repo, `CLAUDE.md` (project identity vs Taipan / Fork, layout, gate, working rules), `STATUS.md`, `CodeMap.md`, Engineering Lessons (seeded), North Star + parked roadmap, the workflow commands (gate / codemap / handoff / wrap / lesson), settings, and this handoff. Taipan was left completely untouched throughout.

## Key facts about the code
- `index.html` (~1150 lines, vanilla JS + canvas, no build) is the whole app. It is a generation of work ahead of the old roadmap / CodeMap PDFs: world seeds, presets, intro, rivers, population graph, zoom / pan are all DONE, plus a full predator-prey ECOLOGY (flora / herbivore / carnivore with evolution, mutation, species names), beaches, and ecotones. 16 biomes, 9 overlays. Title is now "Procedural Terrain & Ecology".
- Findings: (a) partial reproducibility - terrain seeded, ecology on raw `Math.random`; (b) the chat-pasted copy had mangled UTF-8 emoji (transit corruption), so the authoritative file should come from Kevin's disk; (c) base44 is already absent from the code (clean) - it only lived in the old planning PDFs.

## NEXT (see STATUS.md)
1. Add `index.html` (Kevin drops his clean file in) + commit.
2. GitHub remote + push (also enables Pages hosting).
3. Build the headless measurement harness (the gate's CLI form + the unlock for ecosystem tuning).
4. Quick bug sweep.
5. Big changes, ranked: ecosystem balance >> rivers > beaches (full diagnosis in `docs/01 Design/North Star and Roadmap.md`).

## Open decisions (Kevin's)
- North star (income / community / portfolio / love).
- Definition of "balanced" for the ecosystem - needed before tuning.
- Whether deterministic ecology is wanted (gates the reproducibility fix).

## UPDATE (2026-06-21, later same session) - cleanup + deploy DONE
The DEFERRED + NEXT(1,2) items above were completed in the same session:
- Taipan `CLAUDE.md` slimmed to inherit global, committed (`c656a02`); memory deduped (added a global pointer to the operating-model memory; added a `worldbuilder-project` sibling memory + MEMORY.md index line). Taipan otherwise untouched.
- `index.html` reproduced into the repo from the chat paste (what was provided), UTF-8 glyphs restored; JS syntax-validated (compiles clean), zero mojibake. A few paste-collapsed emoji were best-guessed (herbivore, fauna-header, Load, zoom, avg-stat marker, place-pin) - pending a visual check. Committed `93d2bfd`.
- Pushed to GitHub (public) `bragoatski/worldbuilder`, default branch `main`; Pages enabled and CONFIRMED LIVE (HTTP 200) at https://bragoatski.github.io/worldbuilder/.
Remaining NEXT is in STATUS.md: verify the game in-browser (press `T`), then the measurement harness, then ecosystem balance >> rivers > beaches.
