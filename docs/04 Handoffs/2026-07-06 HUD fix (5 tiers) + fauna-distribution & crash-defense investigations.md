# 2026-07-06 - HUD fix (5 tiers) + fauna-distribution & crash-defense investigations

Self-contained brief for this unit of work. Prior handoff: `2026-07-03 Chunk 10 - split sim core into src-sim.js`.
STATUS.md holds current truth. This session was a 4-item program Kevin greenlit ("go for 1 through 4"):
(1) visual-verification pass, (2) fauna distribution, (3) crash defense, (4) creature AI. Outcome: 1 shipped
fix, 2 documented dead-ends, 1 not started. Details below.

## Chunk 1 (= "chunk 11") - Visual-verification pass + HUD fix - SHIPPED to branch (447356a), NOT deployed
Drove the live app via the Playwright MCP (bounded one-time audit; the "MCP paused" rule is about long
refactor loops, not a single screenshot pass) through every gate-blind Living World surface. **Verdict: the
Living World UI works and looks good.** Verified working: map/biomes, **rivers** (clean dendritic + lakes at
high land - resolves the recurring "no rivers" complaint), **Chronicle** (real storytelling - species
divergences, gen milestones, land/pop beats), **Species panel** (named binomials), **Inspector** (deep
per-creature + per-plant genomes), **Follow + Lineage** panel, **Scenarios + Objective** (Genesis ran to a
green "Complete"), **god powers** (Meteor craters + logs), **Share** (Copy Link gives a correct `?w=` permalink;
buttons flash "link copied" via `_flashBtn` for real trusted clicks - a synthetic-click test falsely read them
as silent).

**The one real defect, fixed:** `drawHUD` counted fauna as herbivore/else, so the red **Carnivore** chip + graph
line silently folded scavenger+apex+omnivore into the carnivore count (a true carn of 4 read as ~14). The HUD was
never updated when chunks 7-9 added the tiers. Fix (`447356a`): count all 5 tiers separately (carnivore honest
again) + added scav/apex/omni to the telemetry chips, the Population graph (dim/thin so flora/herb/carn stays the
readable foreground) + legend, and the Map Legend, with distinct amber/crimson/violet identities. UI-only + a
pure-data `popHistory` extension (scav/apex/omni arrays, guarded for old snapshots). Gate GREEN (40/40), visually
confirmed the 6-tier chips + legend render clean. Files: `src/main.js` (drawHUD, drawPopGraph), `index.html`
(chips + CSS + 2 legends), `src/sim.js` (popHistory).
- **Minor, left for Kevin:** the intro tagline "SIMULATE MOLD & DISCOVER" reads ambiguously (mold-verb?) - hero
  copy, his taste call.

## Chunk 2 - Fauna distribution ("rarer / crowd water / rare in deserts") - DROPPED (dead-end), lesson 670a03b
Tried a land-adaptive fauna SURVIVAL brake (energy drain in dry/far-from-water tiles), NOT a movement-score
change (that's knob C's dispersion lever - the documented C2-regressing trap). Gated to high land via the
floraLandThin pattern -> **low-land C2 byte-identical (proven: off==on A/B at ~18% land, identical every metric).**
At high land it stayed balance-neutral even at 5x strength but produced **no distribution shift** (fauna
near-water 25.0% -> 22.7-26.1%, within noise) on Balanced AND Desert presets. Root cause: on a lush full-continent
world flora is everywhere, so fauna eat back any drain and fill to the `faunaMaxPop` cap, distributing like their
food. **Where fauna live is a FLORA problem, not a fauna problem** - the only lever that would work is barren-ing
the high-land interior on the flora side (fauna follow food). Kevin chose to drop the fauna-only approach; flora
version left on the shelf. New A/B tool (`scripts/fauna-ab.mjs`) was written then removed with the reverted code.
Lesson recorded in Engineering Lessons (4th bullet under "Fauna distribution vs the balance").

## Chunk 3 - Crash defense (paradox-of-enrichment) - INVESTIGATED + REVERTED, lesson 8e84451
Kevin's steer mid-session: keep the full-continent default (do NOT cap land), occasional crashes are fine, but a
defense is "ok". Built a high-land-gated PREY REFUGE (grazers at/below a floor become un-huntable; then upgraded
to full dormancy = also skip starvation + aging). Low-land C2 byte-identical (gate + 40/40 tests). **Measured over
a long high-land window (8 seeds, warmup 3000 + 6000t): ~no effect** - herb-hit-zero 100% and full-fauna-crash 50%
both off and on. Two root causes: (1) crashes are FOOD-driven (grazers starve, not hunted), so predation-immunity
is moot; (2) BLOW-THROUGH - the start-of-step floor check is outrun because at high land hundreds of predators
wipe the scarce grazers within one step. A robust fix needs a mid-step DYNAMIC live-counter floor - complex, risks
the high-land balance, artificial. **Crucially the crashes SELF-RECOVER via immigration (final fauna ~270 even
after a full crash) - transient dips, not permanent death.** Kevin's stance already tolerates occasional crashes,
so reverted as disproportionate. Lesson recorded next to the paradox-of-enrichment note.

## Chunk 4 - Creature AI - NOT STARTED
Large, open-ended, measured effort (better foraging / herd / pursuit / evasion, measured against C2). Recommended
as its own focused session rather than starting it at the tail of this long one.

## State + NEXT
- Branch `ecology-balance`: three commits ahead of the deployed `main` - `447356a` (HUD fix, code),
  `670a03b` + `8e84451` (docs/lessons). **`main` (deployed, live bundle index-C_LGWuYk.js) is UNCHANGED.**
- **Deploy decision pending (Kevin):** the HUD fix (`447356a`) is a real correctness improvement (the live app
  currently shows a wrong/inflated carnivore count + hides 3 tiers), balance-safe, gate-green. Recommend deploying
  (ff main + push, Pages CI). Held per the no-surprise-Vercel/Pages rule.
- If crash defense is ever wanted for real: the robust path is a mid-step dynamic live-counter prey floor (see
  the 8e84451 lesson), or bound-K generation-side (Kevin declined capping land).
- The reusable audit method: `npm run dev` + Playwright MCP for a bounded visual pass; screenshots to disk.
