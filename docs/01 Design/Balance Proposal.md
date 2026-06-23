# Balance Proposal - Ecosystem, Rivers, Beaches

Status: PROPOSAL for discussion. No code changes yet. Drafted 2026-06-22 against `main` (`ff515b4`, professionalization merged). Both gating decisions are now RESOLVED (Kevin, 2026-06-22); the ecosystem approach below is reframed around them. Implementation still waits on agreement on the tuning plan.

Value order (from the North Star doc): ECOSYSTEM BALANCE >> RIVERS > BEACHES. This doc keeps that order: ecosystem is the long section, rivers and beaches are short recommendations.

Method note: this is a measure-first plan. Every claim below is backed by `npm run measure` numbers, and every proposed change names the harness metric that will tell us whether it worked. Nothing is hand-tuned blind.

---

## Design decisions (resolved 2026-06-22)

### Decision 1: "Balanced" = a natural, self-sustaining oscillation - achieved by TUNING RATES, not caps

Kevin's call: balance is NOT a population ceiling. The target is a genuine predator-prey limit cycle that emerges from the coupled rates: as prey grow, predator recruitment grows; as predators grow, they thin the prey; as prey fall, predators fall; prey recover. The constraint is that predators must not convert prey into predators so fast that they overshoot and annihilate everything. Balance is reached by tuning the rates (and adding metrics that can SEE the cycle), never by a hard population cap.

Operational consequence: the existing global cap `faunaMaxPop` (400) is demoted to a non-binding safety backstop, and **a run that ever touches a cap counts as a FAILURE**, not a success. The pass target: over K seeds x N ticks, full-extinction rate 0%, BOTH trophic levels persist in >= 90% of seeds, and both populations oscillate within a floored, bounded band (min above a floor, amplitude bounded and not growing). Numbers to lock in discussion: K ~ 12, N ~ 5000 measured ticks, min-fauna floor ~ 10. (Flora's per-tile resource limit is NOT a "cap" in this sense - it is the food base / land carrying capacity at the bottom of the chain; see the open question at the end.)

### Decision 2: Seed the ecology RNG - YES

Kevin's call: yes. Today terrain is seeded but `floraStep`/`faunaStep`/mutation/spawn use raw `Math.random()`, so the same terrain seed yields a different ecology every run (Engineering Lessons - reproducibility gap). Seeding it is the **first implementation step**, as one isolated, gate-checked commit, BEFORE any tuning, so every subsequent A/B is reproducible (identical world before vs after a knob change - far sharper than aggregate-over-noise). Accepted tradeoff: it swaps the RNG stream, so it is behavior-affecting; re-baseline once immediately after.

(The eat-speed feasibility run below was limited by exactly this gap - it is directional only, because we could not yet hold the ecology RNG fixed across the A and B conditions. After this step we can.)

---

## Baseline characterization (current behavior, by the numbers)

Protocol: `npm run measure --seeds=6 --traj` (warmup 3000 ticks to grow ~24% land + flora, then seed 24 herbivores / 8 carnivores / 40 flora clusters, run 1000 measured ticks). Grid 96x96.

Summary over 6 seeds:
- full-extinction rate: **17% (1/6)**, mean time-to-extinction 838 ticks
- final fauna: mean 60.8, **sd 56.7, range 0..163** (enormous variance - the signature of an unregulated system)
- final flora: mean 2163, sd 339 (flora climbs nearly monotonically toward its cap in every run)
- fauna oscillation (max-min within a run): mean 115.7

The headline 17% understates the problem. The real finding is in the per-seed trajectories: **the predator layer collapses in essentially every run.** Carnivores reach 0 or near-0 in 5 of 6 seeds (final carn counts: 3, 0, 0, 0, 1, 0). Two distinct failure modes are visible:

- **Herbivore runaway / carnivore starvation** (seeds 1101, 1202, 1303, 1404). Carnivores cannot sustain, dwindle to 0; herbivores then boom and either flood or overshoot their food and crash. Seed 1101: herb climbs 26 -> 145, carn falls 8 -> 0, then herb crashes 145 -> 13 (a traveling-wave overgraze). Seed 1404: herb 22 -> 193, carn 10 -> 1.
- **Predator overshoot / total crash** (seed 1505, the one full extinction). Carnivores boom 9 -> 68, strip herbivores 80 -> single digits, then starve together: herb and carn both reach 0 by tick ~3850. Classic unregulated predator-prey collapse.

Coexistence (both trophic levels healthy at the end) occurs in **0 of 6 seeds**. Flora is NOT the binding constraint - it is abundant and still rising in every run, so the dynamics are driven by the spatial foraging front and the predator-prey coupling, not food scarcity. Fauna also sits far below its population cap (final ~60 vs cap 400), so caps are not binding either. The system simply has no stable coexistence attractor.

Runtime note: 6 seeds took 414s (~70s/seed), dominated by the 3000-tick terrain warmup. This matters for iteration speed (see Harness enhancements).

---

## Item 1: Ecosystem balance (the heart)

### Root cause

The diagnosis in the North Star doc is confirmed by the data: **the system lacks local negative feedback, so collapses are globally synchronous and total.** Concretely, three reinforcing causes in the current code:

1. **No density-dependence in vital rates.** Reproduction (`faunaStep`, ~main.js:958) fires whenever an individual's energy crosses a threshold; death is energy<=0 or old age. Neither depends on local crowding. So when food is locally abundant, every animal in a cluster reproduces at once (boom); when the patch is exhausted, every animal there starves at once (bust). Nothing damps a local cluster before it overshoots.
2. **Foraging creates a coherent front, not dispersion.** `scoreTileForFauna` (~main.js:908) rewards herbivores for moving toward the densest flora (+2.5 per flora, +0.4 per adjacent flora, -5 for depleted tiles). The herd therefore moves together onto the richest patch, strips it, and moves together to the next - a traveling wave of depletion with global synchrony. Carnivores track herbivore scent out to ring 2-3 (~main.js:922), so they converge on the herd and amplify the same synchrony.
3. **No spatial refugia.** The map is uniform with respect to predation. Herbivores avoid carnivores only by the scoring gradient; there is nowhere a prey reservoir survives a predator sweep. So a crash is total, and recovery needs a reseed rather than regrowing from a surviving refuge population.

`herbivoreEatSpeed == herbivoreSpeed` (both 20) is a contributing aggravator: a herbivore can graze every tile it steps onto, so the moving front strips flora completely rather than leaving residual plants to reseed. (This is the lever the test gate already surfaced - the relaxed `>=` assertion at ~main.js:1247.)

### The dynamics we are tuning toward

The system is already a three-level Rosenzweig-MacArthur predator-prey model, and the coupling Kevin describes already exists: herbivore reproduction scales with flora (energy from grazing), carnivore reproduction scales with herbivores (energy from kills). It does not cycle for two reasons:

1. **Predator conversion runs too hot (no lag).** Carnivore eatGain 50, reproThreshold 80, reproCost 40, eatCD 18: a carnivore that finds a herd converts roughly every ~2 kills into a new predator with almost no delay. So when prey are abundant the predator NUMERICAL RESPONSE races rather than trails the prey, overshoots, and annihilates them (seed 1505). This is exactly Kevin's "predators must not grow too fast."
2. **Global spatial synchrony -> a well-mixed oscillator drifts to zero.** Herbivores all chase the densest flora as one front; carnivores all track the same scent. The whole map is phase-locked, so a local crash is a global crash. A well-mixed Lotka-Volterra cycle is only NEUTRALLY stable - it orbits but noise makes it wander, and zero is an absorbing wall. So even perfectly centered rates drift to extinction over a long run unless something keeps patches out of phase OR damps the prey at its food base.

Both fixes stay inside "tune the rates, no caps." The plan is four knob families, tuned and measured in order.

### Knob family A - predator numerical-response lag (the "do not grow too fast" knob; START HERE)

Slow how fast prey convert into predators so predator growth TRAILS prey growth: lower carnivore `eatGain`, raise `carnivoreReproThreshold` / `carnivoreReproCost`, and/or lengthen `carnivoreEatSpeed`. This is the single most direct lever on the overshoot-to-extinction mode (seed 1505) and on the predator-prey PHASE LAG that defines a healthy cycle. Pure rate tuning, zero new mechanism. Risk: too much lag and predators never catch up (starve out, the other failure mode) - so this is a two-sided search, measured by the phase-lag and carnivore-persistence metrics below.

### Knob family B - prey recruitment vs food base (sets the prey growth rate)

Herbivore `herbivoreEatGain` / repro threshold / `herbivoreEatSpeed`, and the flora regrowth rate, jointly set how fast prey rebound when predators are scarce. This is where the eat-speed lever lives. Feasibility A/B already run (4 seeds, eat-speed 20 vs 35; directional only, ecology RNG not yet seeded):

| condition | full-extinction | carnivore-gone | notes |
|---|---|---|---|
| eat==move (20) | 0/4 | 3/4 | herbivores persist, predators mostly die |
| eat>move (35) | 1/4 | 4/4 | one new full collapse; predators die in all 4 |

The eat-speed knob ALONE nudged the wrong way - it does nothing for the predator-starvation mode (a herbivore eat-rate change does not feed predators). Lesson for the plan: NO single global knob stabilizes; B is tuned jointly with A, not alone. (The run also shows the RNG gap live: seed 1303 survived here but ended 0 carnivores in the 6-seed baseline, same terrain. That is why Decision 2 - seed the RNG - is step 1.)

### Knob family C - spatial asynchrony (now a DESIRED feature, not just a stabilizer)

This is the fix for reason 2 above, and it is a TUNING change, not a cap. Kevin's call (2026-06-22): he explicitly WANTS the opposite of today's single moving mass - clumps that break off and cover the map as many spaced-out groups. So C is now a primary design goal in its own right, not a fallback. Mechanism: weaken how hard herbivores clump to the single densest flora tile (lower the flora-attraction weights in `scoreTileForFauna`, raise the movement jitter) and shorten carnivore scent range, so herds fragment and disperse. The ecological payoff falls out of the aesthetic one: dispersed patches cycle out of phase, so a local crash leaves out-of-phase neighbors to recolonize from, which is what stops the global oscillation drifting to zero. Optional stronger version (flora-cover concealment: prey harder to catch where flora is dense) adds refuge structure and couples back to food. Because Kevin wants the dispersed look regardless, treat C as load-bearing for BOTH persistence and feel, and add a harness metric for spatial dispersion (e.g. number of occupied clusters, or mean pairwise distance) so we can SEE the herd fragmenting, not just guess.

### Knob family D - prey-dependent predator rescue (Kevin's spawn idea)

Make carnivore natural-spawn probability scale with herbivore count instead of the current flat 0.1% with a >=3-herbivore gate (`naturalFaunaSpawn`). This is a prey-density-dependent predator RECRUITMENT / immigration term: predators reappear when prey are plentiful, which directly prevents PERMANENT predator extinction (the dominant failure today) and adds the lagged restoring force Kevin described. Cheap (a few lines). Tradeoff to note: it is a soft rescue (immigration), slightly less "pure emergence" than recruitment from reproduction alone - see the open question. Recommend including it; it is the cheapest insurance against the absorbing-zero state.

### Caps: demote, do not rely on

`faunaMaxPop` (400) becomes a non-binding safety backstop (raise it well above any healthy band, or treat hitting it as a hard failure). Per Decision 1, a run that touches a cap has failed. The flora per-tile resource limit stays as the food base (open question below).

### Success metrics (how the harness tells us we have a cycle, not a crash)

Today's harness reports survival but cannot SEE a cycle. The tuning program needs metrics that distinguish a healthy bounded limit cycle from a flatline, a diverging boom/bust, or extinction. Add to the harness:
- **predator-prey phase lag** - in a real cycle predators peak AFTER prey; measuring the lag confirms the coupling works (the single most diagnostic metric for Kevin's model)
- **oscillation period + amplitude per trophic level** (peak-counting or autocorrelation on `popHistory`)
- **completed cycles without extinction** over N ticks (persistence-through-cycling)
- **amplitude trend** - bounded (healthy) vs growing (diverging toward a crash)
- **carnivore-persistence rate** (carn > 0 at end across seeds) - the metric today's headline hides
- **min floor per trophic level** - stays above the agreed floor, never approaches 0
- **cap-hit count** - must be 0 (caps never bind)

Order of operations: seed RNG (step 1) -> re-baseline -> add metrics -> tune A (predator lag) -> add D (rescue) -> tune C (asynchrony) -> fine-tune B alongside -> stop when the Decision-1 target is met. Each knob change is one reproducible A/B against the prior best, kept only if the metrics improve.

### Effort / risk summary

| Knob family | Effort | Risk | Why |
|---|---|---|---|
| A predator lag | trivial (rate numbers) | low-med | two-sided: too much lag starves predators |
| B prey recruitment | trivial (rate numbers) | low | no single global knob stabilizes alone |
| C spatial asynchrony | low-moderate (scoring weights) | medium | likely load-bearing for never-extinct |
| D spawn rescue | low (a few lines) | low | prevents permanent predator extinction; purity tradeoff |

---

## Item 2: Rivers

Recommendation: **DO IT, second priority (after ecosystem).** Use the standard hydrology pipeline, not a third bespoke tracer.

Root cause of the two prior failures: `generateRivers` (~main.js:572) is a greedy downhill tracer from high-elevation sources. When it reaches a tile with no lower neighbor it STOPS and marks a "basin lake" (~main.js:638). On fractal terrain with many local minima, rivers terminate prematurely in tiny basins instead of flowing to the ocean, so coherent dendritic networks rarely form and the feature cannot even be evaluated. The terrain has no enforced drainage.

Proposed approach (textbook, guarantees dendritic rivers by construction):
1. Priority-flood depression fill (Barnes et al.) so every land cell has a downhill path to the ocean boundary - no more dead-end basins.
2. D8 flow direction per cell (steepest descent on the filled surface).
3. Flow accumulation (drainage area per cell).
4. Threshold accumulation for where a river appears; map accumulation to width.

Self-contained rewrite of one function. Already on the seeded RNG and pure (no DOM), so it is gate-testable: add structural assertions to `sim.test.js` (every river tile reaches ocean or a filled overflow; no orphaned single-tile rivers). Effort: moderate. Risk: low-moderate - isolated function, but the render is gate-blind, so it needs a browser visual verify + redeploy (the gate cannot see a river drawn wrong). Highest-value non-ecology feature, with a known algorithm; gate it behind the ecosystem work since that is the heart.

Success signal: not a harness metric (rivers are not ecology). Use the new connectivity assertions for correctness, plus a visual verify that rivers run source-to-sea dendritically.

---

## Item 3: Beaches

Recommendation: **DEFER, leaning CUT.** Weakest ROI by a wide margin; do not invest sim effort.

Root cause: the intent is sub-tile (part of a tile is sand, varying size, straight or curved, only in some places, forming gradually). The implementation is a whole-tile `beachLevel` float (`beachStep`, ~main.js:744) rendered as a yellow tile. At 6px per tile the grid cannot express a partial-tile coastline, so the result is the uniform yellow ring the roadmap describes. This is fundamentally a sub-tile rendering problem the current resolution cannot represent, plus an erosion coupling (beachLevel erodes elevation and converts tiles to ocean, ~main.js:778) that adds sim risk for cosmetic gain.

Options, cheapest first:
- **Cut it.** Remove `beachStep` from the tick and the beach branch of `draw`; reclaim the complexity. The sim loses nothing functional.
- **Cosmetic-only coastline (if Kevin wants the look).** A render-time sand fringe on coastal tiles with per-tile noise/variation so it is not uniform, fully decoupled from the erosion sim. Low effort, no sim risk, but still low value and below rivers.
- **Do it "properly"** (sub-tile compositing or higher render resolution): high effort for low value. Not recommended.

No harness metric applies. Recommendation stands: park it until ecosystem and rivers are done, then cut or do the cosmetic pass only if there is appetite.

---

## Harness enhancements needed to run this program

The harness is the instrument; two gaps to close before serious tuning:

1. **Metrics.** Add the cycle-aware metrics listed in the ecosystem section: predator-prey phase lag, per-trophic oscillation period + amplitude, completed-cycles-without-extinction, amplitude trend, carnivore-persistence rate, per-trophic min floor, and cap-hit count. Today's single max-min "oscillation" conflates a healthy cycle with a crash-to-zero, and the headline extinction rate hides the predator-layer collapse that is the actual problem. These additions make the Decision-1 pass/fail directly readable and let us SEE a limit cycle rather than only survival.
2. **Speed (terrain snapshot).** The 3000-tick warmup (terrain genesis) dominates runtime (~70s/seed) and is identical across ecology params. Serialize the post-warmup terrain state (grid / elev / climate fields) once per seed and restore it per condition, cutting A/B cost roughly 4-6x and making iterative tuning practical. Connects to the "fast terrain-gen / snapshot path" idea already noted in Engineering Lessons.
3. Once the ecology RNG is seeded (Decision 2), raise the default seed count K for stabler aggregates.

---

## Recommended order of operations (all three items)

1. **Seed the ecology RNG** (Decision 2, approved) - one isolated commit; re-baseline after.
2. **Add harness metrics + terrain snapshot** - the instrument the rest depends on.
3. **Ecosystem balance** - tune knob family A (predator lag) -> add D (spawn rescue) -> tune C (asynchrony) -> fine-tune B alongside. Each step one reproducible A/B, kept only if the cycle metrics improve. Stop when the Decision-1 target (bounded coexisting oscillation, no cap-hits) is met.
4. **Rivers** - priority-flood -> flow accumulation rewrite of `generateRivers`, with connectivity assertions + a visual verify.
5. **Beaches** - cut, or a cosmetic-only coastline pass, only if there is appetite after 1-4.

## Guardrails

- This is Tier-B (sim/taste): the output is this proposal, not autonomous sim edits. Decisions 1 and 2 are resolved; implementation of the tuning plan waits on agreement on this approach.
- Every future change keeps the gate green (`npm run typecheck && npm run lint && npm test`) and is validated with the harness, never hand-tuned blind.
- Engine purity and the no-emoji / no-em-dash docs convention hold throughout.

## Resolved follow-ups (Kevin, 2026-06-22)

- **Flora per-tile resource limit** (`floraPerTileMax`, currently 4): KEEP. It is the food base / land carrying capacity at the bottom of the chain, not a population band-aid; prey need a finite food supply for the cycle to mean anything. (This is the one legitimate per-tile limit; it is not one of the "caps" Decision 1 forbids.)
- **Spawn rescue (knob D):** INCLUDE. Carnivore spawn-likelihood scales with prey count - a prey-dependent predator immigration term that prevents permanent predator extinction. Accepted as part of the plan rather than holding out for pure reproduction-only emergence.

## Resolved: spatial dispersion is a goal (Kevin, 2026-06-22)

Kevin wants herds to fragment into many spaced-out groups covering the map, not one mass moving around. This RESOLVES the earlier open question on knob family C: pursue it as a primary design goal (see the reframed C section), not a fallback. It happens to also be the load-bearing piece for long-run persistence, so aesthetics and stability point the same way.

## Implementation status

- **Step 1 (seed the ecology RNG): DONE 2026-06-22.** Added the `eRng` dynamics stream (seeded in `initWorld` from `_seed ^ 0x9E3779B9`); routed all per-tick stochasticity (flora/fauna/beach/anomaly-drift + `randn()`) through it; left terrain generation (`sRng`) byte-identical; kept the random-seed picker on raw `Math.random()`. Gate green (typecheck + lint + test); a new `is deterministic for a fixed seed (ecology)` test proves two identical-seed runs land on identical flora/fauna counts. Re-baseline numbers below.
- **Next:** harness metrics + terrain snapshot, then the A/D/C/B tuning loop. Awaiting Kevin's go per step.

### Re-baseline after seeding (reproducible from here on)

`npm run measure --seeds=6` (same protocol as the original baseline), now deterministic:

| metric | original (unseeded) | re-baseline (seeded) |
|---|---|---|
| full-extinction rate | 17% (1/6) | 17% (1/6) |
| carnivore collapse (0C at end) | 5/6 | 6/6 |
| final fauna mean / sd | 60.8 / 56.7 | 52.3 / 33.4 |
| fauna oscillation (max-min) | 115.7 | 144.2 |
| land coverage per seed | 21-25% | identical (terrain unchanged) |

Seeding did NOT change the qualitative dynamics, as expected - same ~17% extinction, the same total predator-layer collapse (now 6/6), similar oscillation. It only made runs reproducible: the harness now returns identical numbers run-to-run, so from here every tuning A/B is a clean comparison rather than a draw from noise. This seeded set is the baseline all tuning is measured against.
