# 2026-06-30 - Living World chunk 5: Scenarios + light objectives (pillar E) + deploy

Self-contained handoff. Read STATUS.md for current truth and `docs/01 Design/Living World Roadmap.md` for the
direction + chunk sequence. Prior handoff: `2026-06-30 Living World chunk 4 - Shareable worlds (seed+CFG permalink) + deploy.md`.

## The direction (unchanged)
Worldbuilder's moat is the SIMULATION. The roadmap AMPLIFIES it: (1) deepen the sim + make its evolution
VISIBLE, (2) god-game agency, (3) shareable worlds. Per-chunk workflow: one large chunk -> full gate -> docs
-> commit -> deploy -> next-session prompt. Chunks 1-4 = Chronicle / evolution-visible / god powers / shareable
worlds. Chunk 5 (this one) = SCENARIOS + OBJECTIVES (pillar E).

## What shipped: chunk 5 = scenarios + objectives
Named starting setups + win/lose objectives on top of the sandbox. All new code is in `src/main.js` just above
`initWorld` (the "Scenarios + objectives" section); a "Scenario" deck seg + an "Objective" sidebar panel in
`index.html`.

- **Four scenarios** (`SCENARIOS`), each = a preset + a FIXED seed + a small terrain warmup + a burst of
  initial life + an objective:
  - **Genesis** (balanced, seed 777): `establish` - coax a barren world into a full 3-tier web (flora 800 /
    herb 60 / carn 20). No lose; a "watch it come alive" scenario.
  - **The Long Balance** (balanced, seed 2024): `endure` - once life establishes (flora 500 / herb 40 /
    carn 12), keep all three alive for 4000 ticks.
  - **Ice Age Refuge** (iceage, seed 1888): `endure` - keep grazers alive for 3000 ticks after they establish.
  - **Trial by Fire** (volcanic, seed 909): `endure` - keep a full web alive on volcanic ground for 3000 ticks.
- **One PURE observer, two goal shapes.** `evaluateScenario(def, stats, curTick, prevStatus) -> newStatus` is
  the gate-testable core (no side effects, no RNG, no DOM). `establish` = REACH `need` tier counts (no lose).
  `endure` = REACH `establish`, THEN HOLD `floor` for `duration` ticks; a drop below the floor AFTER
  establishment loses. The two-phase shape sidesteps the cold start (a world still warming up is never a
  failure). Terminal states latch. Helpers: `_meetsTiers`, `_tierProgress`, `initialScenarioStatus`.
- **Read-only observer on the step path.** `scenarioSample()` runs at the END of `step()` right after
  `chronicleSample()`, on the same 10-tick cadence: derives `chronicleStats()`, advances the pure evaluator,
  and narrates transitions (`'scenario'` Chronicle events: begun / established / complete / failed). It never
  touches fauna/flora/RNG and early-returns when no scenario is armed.
- **Setup is a small ASYNC warmup.** A fresh world is all ocean (land forms only via `step()`), so a scenario
  must warm terrain before seeding life. `startScenario` (deck button) warms in 40-step `setTimeout` chunks
  (tab stays responsive, the world visibly forms + a progress bar) to a LOW land target (~1%), then
  `_seedScenarioLife` + arms the objective. Kept low on purpose: a scenario starts small and DEVELOPS during
  play toward the establish thresholds. The pure `applyScenarioDef` (sync, same deterministic path -
  `_applyPresetCfg` + `initWorld(seed)` + step-to-target + seed + arm) is used by the gate + a scenario
  permalink boot. `clearScenario` drops back to the sandbox (called by a plain reset / roll / preset change /
  plain world code).
- **Shareable.** A scenario is a permalink: `buildWorldCode` adds a `scen` field; `applyWorldCode` re-arms the
  named built-in scenario (rebuilding from OUR OWN def, ignoring the URL cfg diff - only the trusted id +
  seed ride along). `init()`'s `?w=` branch routes a scenario link through the async `startScenario`.
- **UI.** A "Scenario" deck seg (`scenarioSelect` dropdown + `btnStartScenario`) and an "Objective" sidebar
  panel (`#panelObjective` / `renderObjective`): goal + phase (Preparing / Establishing / Holding / Complete /
  Failed) + a progress bar + a per-tier readout + a hold timer. No exclamation marks (UI rule).

## Why it is balance-safe (harness before/after byte-identical)
Same proof shape as chunks 3-4. The only sim mutations from scenarios are (a) the SETUP (`applyScenarioDef` /
`startScenario`), which runs `initWorld` + `step()` warmup + seeding only from a button / a permalink boot,
NEVER inside `step()`; and (b) the OBSERVER (`scenarioSample`), which is read-only (no eRng, no fauna/flora
mutation) and early-returns with no scenario armed. The harness/tests never arm a scenario, so the measured
`eRng` loop is untouched. Proof: `node scripts/harness.mjs --seeds=8` before vs after = BYTE-IDENTICAL:
extinction 0% (0/8), carnivore-persistence 75% (6/8), phase lag +127t, final fauna 73.6, final flora 2263.8,
cap-hits 0 (== the C2 chunk-3/4 numbers).

## Gate (full, green)
`npm run typecheck` (clean) + `npm run lint` (0 errors; 32 warnings, unchanged legacy patterns) + `npm test`
(**28 tests**, was 22; new "scenarios + objectives" block: the pure evaluator's establish/endure/lose/latch
logic across synthetic stats; `applyScenarioDef` warms + seeds + arms + reproduces the same world; the scenario
permalink round-trips through the codec + re-arms the objective + reproduces the same world; a scenario run
replays identically) + `npm run build` (ok, bundle `index-CEEBKIas.js`).
**Gate-blind (DOM):** the Scenario deck + Start button, the Objective panel render, the async warmup animation,
and the `?w=scen` boot branch. The pure cores they delegate to are gate-covered; verify in the live app.

## Live eyeball checklist (for Kevin, gate-blind)
1. Open the app. In the Scenario deck, pick **The Long Balance** and press **Start**. The world should warm
   for ~5-12s (terrain visibly forming, Objective panel showing "Preparing world" + a progress bar), then life
   seeds and play begins with the Objective panel showing "Establishing" + the per-tier readout, and a
   "Scenario begun" beat in the Chronicle.
2. Let it run. As the world develops the panel should flip to "Holding" (a Chronicle "life has established"
   beat), then count the hold timer; if a tier collapses it should read "Failed" (a Chronicle beat).
3. Try **Genesis** (establish goal, no lose) and **Ice Age Refuge** / **Trial by Fire**.
4. With a scenario active, press **Copy Link** (Share deck) and open it in a new tab: it should re-arm the
   SAME scenario (async warmup) and reach the same world. A plain reset / preset change / "Sandbox" Start
   should clear the Objective panel back to the empty state.

## Open follow-ups (Tier B, for Kevin)
- The win/lose THRESHOLDS + warmup targets are best-effort defaults. They are balance-safe regardless (they
  only affect win/lose FEEL, not the ecology), so tuning them is a taste call: eyeball whether each scenario is
  actually winnable and fun, and adjust the `SCENARIOS` numbers. In particular confirm the `endure` scenarios
  can be won and that Genesis's `establish` targets are reachable at the balanced preset.
- The async warmup is ~5-12s of visible world-forming; if that feels long, lower `warmupLand` per scenario.
- Still-valid pre-roadmap backlog: fauna distribution as a MEASURED ecology task; the optional sim-core split.

## Concurrent-session note
`src/main.js` + `index.html` are shared across sessions. Working tree was clean at start (branch
`ecology-balance`, one deploy-marker commit `fbdc247` ahead of `main` == `ecd62a8`). Changes are additive
(the Scenarios section + a step()/draw() tail call + the deck seg + Objective panel + CSS + tests); staged only
my own paths. Check `git status` + mtime before editing if another session may be active.

## Deploy
Deploy = ff `main` to the reviewed SHA (sweeping in the `fbdc247` chunk-4 deploy-marker lead + this chunk's
code + docs) + push; GitHub Pages CI builds + publishes. Live: https://bragoatski.github.io/worldbuilder/

## NEXT (chunk 6): Speciation (pillar C) + trophic depth - the harness-heavy chunks (last in the roadmap)
Speciation: lineage drift becomes named, diverging species (tracking + naming first; reproductive isolation as
a separate measured experiment). Trophic depth: apex / scavenger / omnivore tiers - richest story fuel but most
likely to break the C2 balance, so each goes through the harness measure -> A/B -> keep-if-better loop (like
flora distribution + herbivore desync did). See the roadmap. Still-valid pre-roadmap backlog: fauna
distribution as a MEASURED ecology task; the optional sim-core file split.
