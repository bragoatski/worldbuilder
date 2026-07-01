# 2026-06-30 - Living World chunk 3: God powers (land brush + meteor/drought/bloom) + deploy

Self-contained handoff. Read STATUS.md for current truth and `docs/01 Design/Living World Roadmap.md` for the
direction + chunk sequence. Prior handoff: `2026-06-30 Living World chunk 2 - evolution visible (size gene + follow camera) + deploy.md`.

## The direction (unchanged)
Worldbuilder's moat is the SIMULATION. The roadmap AMPLIFIES it: (1) deepen the living-world sim + make its
evolution VISIBLE, (2) god-game agency, (3) shareable worlds. Per-chunk workflow: one large chunk -> full gate
-> docs -> commit -> deploy -> next-session prompt. Chunk 1 = the Chronicle (the world's memory); chunk 2 = make
evolution visible (size gene + follow camera); chunk 3 (this one) = GOD POWERS (pillar D).

## What shipped: chunk 3 = god powers (pillar D)
Turn intervention into play, with the Chronicle as the consequence feedback. A new "God" deck seg (index.html)
plus pure sim-core cores in `src/main.js` (defined just above `initWorld`). Every intervention logs a `'god'`
Chronicle event so a deliberate act reads distinctly from the world's natural milestones.

- **Land brush** - `brushTerrain(cx,cy,dir)`. Raise / Lower buttons set a `placeMode` (`'raise'`/`'lower'`);
  clicking the map raises (+1) or lowers (-1) a soft elevation DISC (`godBrushRadius`=2, `godBrushDelta`=1.3,
  distance falloff). Handles the land<->sea boundary: ocean crossing elev>=0.5 becomes land (COAST, then
  reclassified); land dropping below 0.35 sinks to ocean (clearing any stranded flora/fauna). After a stroke it
  refreshes the climate base (`computeTemperature`/`computeAridity`/`applyClimate`) + `reclassTerrain`, exactly
  like the Rivers button. Logs "New land rose..." / "Land sank..." only on an actual coastline crossing (no spam
  on a pure elevation nudge). Volcano cores are left intact. NO RNG (purely geometric).
- **Meteor** - `meteorStrike(tx,ty)`. If no tile is given, `_pickStrikeTarget` aims at a random LIVING creature
  (max drama - it hits a herd), else a random land tile. Craters terrain (ocean basin at dist<=1, gouged rim to
  `meteorRadius`=4 via `meteorCraterDepth`=3.0) and wipes all fauna + flora in the blast (kill `deathParticles`
  flash). Logs the death toll. eRng only in the target pick (explicit coords = deterministic, used by the test).
- **Drought** - `droughtEvent()`. Withers each plant with prob `droughtSeverity`(0.5) scaled by tile aridity
  (`0.4 + A/6`), so the dry interior/deserts scorch worst and wet oases persist. Logs the loss. The downstream
  starvation cascade (fewer plants -> herbivores starve -> carnivores starve) is narrated FOR FREE by the
  existing `chronicleSample` crash/extinct detectors over the following ticks.
- **Bloom** - `bloomEvent()`. A `seedFloraCluster(bloomCount=250)` burst (the same weighted placement as a
  natural seed burst, just larger). Logs it. Herbivores then boom -> Chronicle narrates.

Helpers `_killLifeAt(i)` / `_compactLife()` use the established null-then-`.filter()` life-array convention.
CFG knobs added (all inert in `step()`): `godBrushRadius`/`godBrushDelta`, `meteorRadius`/`meteorCraterDepth`,
`droughtSeverity`, `bloomCount`. The four cores are exported for the tests.

## Why it is balance-safe (the key decision)
This is the first BEHAVIOR-touching chunk (it changes terrain/flora/fauna), so per the roadmap it needed a
harness sanity pass. The insight that made it clean: the interventions are called ONLY from UI hooks (button
click / canvas click), NEVER from `step()`/`floraStep`/`faunaStep`/`scoreTileForFauna`. The harness and the
tests only ever exercise `step()` in a loop with no user interaction, so the interventions run ZERO times there
and cannot advance the MEASURED `eRng` stream. Same proof shape as chunk 2's cosmetic genes, but even simpler:
there the gene lived in `mutateFaunaChild` (on the step path) and needed the isolated `cRng` stream; here the
whole feature is off the step path, so nothing special is needed. New Engineering Lessons entry records the rule
(an intervention needs the measure->A/B loop ONLY if it wires itself INTO the step path, as auto-rivers did and
were reverted for) and the durability trap (a direct `aridity[]` bump would be washed out by `applyClimate`
within ~20 ticks, so drought is a flora DIEBACK, not an aridity poke).

## Gate (full, green) + the balance proof
`npm run typecheck` (clean) + `npm run lint` (0 errors, 23 pre-existing warnings, none new) + `npm test`
(**17 tests**, was 13; new "god powers (chunk 3)" block: brush raises ocean->land + lowers land->ocean; meteor
wipes all fauna in the blast radius + craters the centre to ocean + logs a `'god'` event; drought withers flora
+ logs; bloom adds flora + logs) + `npm run build` (ok, bundle `index-CmijjgF9.js`).
**Balance proof:** `node scripts/harness.mjs --seeds=8` run BEFORE and AFTER the change returned BYTE-IDENTICAL
numbers - extinction 0% (0/8), carnivore-persistence 75% (6/8), phase lag +127t, final fauna 73.6, final flora
2263.8, cap-hits 0 (== the C2 chunk-2 baseline), confirming the interventions leave the measured loop untouched.
**Gate-blind:** the brush/event RENDER + feel are DOM - eyeball in the live app (Raise/Lower then click the map;
fire Meteor/Drought/Bloom and watch the map + the Chronicle react).

## Concurrent-session note
`src/main.js` is shared across sessions (climate + Chronicle + size gene landed from parallel sessions before).
Working tree was clean at start (branch `ecology-balance`, == `main` == `d7d0191`, one docs commit `fea8107`
ahead). Check `git status` + mtime before editing if another session may be active; stage only your own paths.

## Deploy
Code commit `a25978a`; local build bundle `index-CmijjgF9.js`. Deploying = ff `main` + push (GitHub Pages CI
builds + publishes `dist/`); a follow-up `docs(status): mark chunk 3 DEPLOYED` records the final main SHA +
the confirmed live bundle hash (the `fea8107` pattern). Live: https://bragoatski.github.io/worldbuilder/

## NEXT (chunk 4): Shareable worlds (thread 3)
Seed + CFG -> URL permalink (builds on the JSON export) + a "copy world link" action; optionally a
Chronicle-driven "postcard". Balance-safe (no `step()` changes). See the roadmap for the remaining sequence
(scenarios + objectives, then speciation + trophic depth - the harness-heavy chunks, last). Still-valid
pre-roadmap backlog: fauna distribution as a MEASURED ecology task; the optional sim-core file split.
