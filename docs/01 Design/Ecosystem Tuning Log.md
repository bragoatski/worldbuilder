# Ecosystem Tuning Log

Append-only ledger of the knob-by-knob tuning loop (the A/B experiments behind Balance Proposal -> Item 1). Each entry: the one knob changed, before/after cycle metrics vs the prior best, the CASCADE observed (what else moved), and the keep/revert call. Goal (Decision 1): a bounded coexisting oscillation - full-extinction 0%, BOTH trophic levels persist >= ~90% of seeds, floored/bounded amplitude, cap-hits 0.

Protocol per step: change ONE knob -> `npm run measure --seeds=6 --warmup=3000 --ticks=1000 --sample=5` (non-snapshot, matches the baseline table) -> compare -> keep/revert -> note the cascade. Mandate (Kevin, 2026-06-22): tune autonomously until balance or a clearly better baseline; watch how knobs cascade so later tuning is informed.

## Reference: seeded baseline (the "before" everything is measured against)

`npm run measure --seeds=6 --warmup=3000 --ticks=1000 --sample=5`, deterministic.

| cycle metric | seeded baseline |
|---|---|
| carnivore-persistence | 0% (0/6) |
| min floor (carn / herb) | 0.0 / 18.0 (worst 0) |
| phase lag (coupled seeds, r>0.3) | -44t (5 seeds); no positive-lag seed |
| oscillation amplitude (herb / carn) | 70.6 / 13.0 |
| amplitude trend (herb 1st->2nd half) | 67.2 -> 41.1 |
| completed cycles (herb peaks) | 4.5 |
| spatial dispersion (clusters / meanDist) | 4.8 / 12.7 |
| cap-hits | 0 |
| full-extinction rate | 17% (1/6) |
| final fauna mean / sd | 52.3 / 33.4 |

Dominant failure: predator STARVATION (5/6 seeds carn->0), not overshoot (1/6). carn-persistence 0/6 is the headline blocker. Flora abundant and rising; caps never bind. Diagnosis (proposal): no local density-dependence + global spatial synchrony + no refugia + a too-hot (no-lag) predator numerical response.

---

## Step A1 - carnivoreEatGain 50 -> 40 (knob A: predator numerical-response lag)

Mechanism: less energy per kill -> predators need more kills (more time) to reach the repro threshold -> numerical response TRAILS prey instead of racing -> introduces phase lag, damps overshoot. Conservative -20% single step. Risk (two-sided): pushes toward the predator-starvation side.

Result (`--seeds=6`, 402.7s):

| metric | baseline | eatGain 40 | read |
|---|---|---|---|
| carn-persistence | 0/6 | 0/6 | unchanged - predators still die in all 6 (D's job to lift) |
| phase lag (coupled, r>0.3) | -44t (5) | -8t (4) | moved toward target (+) |
| per-seed +lag emergence | none | seed1000 +165t (r.96), seed1101 +175t (r.93) | NEW - genuine carn-after-prey coupling appeared for the first time |
| herb amplitude | 70.6 | 70.8 | unchanged (overshoot not damped) |
| amp-trend (herb) | 67.2->41.1 | 67.2->38.0 | not growing (slightly more damped 2nd half) |
| carn min-floor | 0.0 | 0.0 | unchanged - NO extra starvation (the risk did not bite) |
| extinction rate | 17% (1/6) | 17% (1/6) | unchanged; extinct seed shifted 1505->1303 (old overshoot seed 1505 now SURVIVES) |
| cap-hits | 0 | 0 | clean |
| final fauna mean | 52.3 | 67.7 | higher (fewer predators -> herb booms more) |

CASCADE notes:
- The lever did exactly what knob A is for: predator response now TRAILS prey. Two seeds developed a clean positive (carn-after-prey) lag at r>0.9 - coupling that existed in zero baseline seeds.
- BIMODAL, not uniform: 2 seeds found +lag (+165, +175), 2 still collapse-before-peak (-185, -185). Aggregate -8t is a mean of that split, not a uniform shift. Read per-seed r, never just the aggregate.
- Costless on the starvation side: carn min-floor / persistence / extinction all held flat. The two-sided risk did NOT bite at -20%.
- Knob A alone CANNOT lift persistence (predators still die regardless of lag once a local herd is stripped) - that is structurally D's (rescue) and C's (dispersion) job. Confirmed: persistence stayed 0/6.
- Fewer predators -> higher final herbivore load (52->68 fauna). Watch that herb overshoot does not worsen as A is pushed.

Decision: **KEEP.** Positive lag emerged with no starvation cost and cap-hits 0; a clean directional win that sets up D. Persistence lift deferred to D per plan. (Kevin then handed over full autonomy to run the loop.) Committed `5827511`.

---

## Step D1 - add knob D: prey-dependent carnivore rescue (rate 5e-5, minPrey 8, cap 4)

Mechanism: new `naturalFaunaSpawn` term - carnivore immigration probability = `rescueRate * herbCount`, fires only while `carnCount < rescueCarnCap` and `herbCount >= rescueMinPrey`. Intent: predators cannot go permanently extinct while prey are plentiful (the absorbing-zero failure). Prior best = eatGain 40 (Step A1).

Result (`--seeds=6`, 425s):

| metric | eatGain 40 (prior best) | + knob D (5e-5/8/4) | read |
|---|---|---|---|
| carn-persistence | 0/6 | **3/6 (50%)** | D lifts persistence off zero - the mechanism works |
| extinction rate | 17% (1/6) | **33% (2/6)** | WORSE - the cardinal Decision-1 sin |
| herb amplitude | 70.8 | 49.9 | overshoot damped (predators now present to thin booms) |
| amp-trend (herb) | 67->38 | 40->40 | bounded, but everything is smaller |
| final fauna mean | 67.7 | 15.0 | populations CRASHED - system runs much colder |
| phase lag (coupled) | -8t (4) | -113t (6); but seed1505 +185t r.70 | mostly negative; high-r now |
| carn min-floor | 0.0 | 0.2 (worst 0) | barely off zero |
| completed cycles | 4.7 | 2.0 | fewer |
| cap-hits | 0 | 0 | clean |

CASCADE notes (the key learning):
- D's lever is RIGHT but TOO HOT. It bought persistence (0->50%) and damped overshoot, but OVER-SUPPRESSED prey: a maintained pack of up to 4 rescued predators (eatGain 40, kill every 18t -> on the order of ~0.9 kills/tick if prey are found) grinds herbivores down, crashing final fauna 68->15 and tipping 2 seeds (1101, 1202) into MUTUAL extinction.
- **`minPrey=8` is the culprit**: rescue keeps replenishing predators down to near-collapse prey levels, so as prey decline predators are NOT released - they cling on and finish the prey off. The rescue converted "predator extinction" into "mutual extinction" in 2 seeds.
- **Cascade insight - minPrey is a prey SET-POINT.** Because rescue only fires above minPrey and a standing pack suppresses prey below it, the system should cycle AROUND minPrey: prey crash -> predators not rescued, fade -> prey rebound past minPrey -> predators return. A LOW minPrey short-circuits the prey rebound (no refuge window); a higher one gives prey room to recover before predators come back. The standing pack size (`cap`) sets suppression STRENGTH; `minPrey` sets the prey floor the cycle orbits.
- Trade as-is: persistence up but extinction up = wrong direction on Decision 1's primary metric. NOT kept at these settings.

Decision: **SOFTEN, do not revert** (the mechanism is needed for persistence; it is just too aggressive). Next A/B: raise `carnivoreRescueMinPrey` 8 -> 30 so predators only return to an abundant herd, preserving the prey rebound refuge. Predict: fewer extinctions, persistence stays >0, higher/warmer populations.

---

## Step D2 - carnivoreRescueMinPrey 8 -> 30 (soften the rescue)

Result (`--seeds=6`, 493s):

| metric | baseline (eatGain40) | D1 (minPrey 8) | D2 (minPrey 30) | read |
|---|---|---|---|---|
| carn-persistence | 0/6 | 3/6 | 2/6 | above baseline, below D1 |
| extinction rate | 17% (1/6) | 33% (2/6) | 17% (1/6) | back to baseline - the regression is GONE |
| final fauna mean | 67.7 | 15.0 | 22.7 | warmer than D1, still suppressed |
| herb amplitude | 70.8 | 49.9 | 52.9 | bounded |
| carn min-floor | 0.0 | 0.2 | 0.2 | barely off zero |
| cap-hits | 0 | 0 | 0 | clean |

CASCADE notes:
- Prediction confirmed: raising minPrey traded a little persistence (3/6->2/6) for removing the extra extinctions (33%->17%). minPrey behaves as the prey set-point as theorized.
- BUT the per-seed detail exposes the real limit: seed1303 ends 0H/1C (a carnivore with no prey - a DYING state that happens to be nonzero at tick 1000), seed1101 ends 1H/0C. These are FRAGILE STRAGGLERS, not robust coexistence. herbClusters ~3 = still a single moving mass.
- **Conclusion - A and D tune RATES but cannot fix SPATIAL SYNCHRONY.** With one herd and no refugia, stripping it crashes everything together, so a rescued predator just re-triggers the global crash. Knob C (dispersion / asynchrony) is the load-bearing lever for robust coexistence, exactly as the proposal predicted ("likely load-bearing for never-extinct"). Further D-magnitude tuning now is premature - C will reshape the predation dynamics and move D's sweet spot.

Decision: **KEEP D at minPrey 30** as a net-positive intermediate (persistence 0->2/6, extinction flat, overshoot bounded), magnitude TO BE RE-TUNED after C. Move to knob C next. Committed with knob A.

---

## Step C1 - add knob C: herbivore conspecific crowding (crowding 1.0)

Mechanism: NEW term in `scoreTileForFauna` (herbivore branch) - subtract `crowding * herbCount` for herbivores on the tile, half-weight for adjacent tiles. Targets BOTH root causes at once: fragments the single moving mass into spaced groups (dispersion / reason 2) AND makes a patch unattractive before it is fully stripped (local density-dependence / reason 1). Prior best = A+D (minPrey 30).

Result (`--seeds=6`, 545s):

| metric | A+D (minPrey 30) | + C crowding 1.0 | read |
|---|---|---|---|
| carn-persistence | 2/6 | **3/6** | up |
| extinction rate | 17% (1/6) | 17% (1/6) | flat |
| final fauna mean | 22.7 | 35.7 | warmer (less over-suppression) |
| herbClusters | 3.3 | 4.8 | fragmenting, but modestly |
| carn min-floor | 0.2 | 0.7 | up |
| herb amplitude | 52.9 | 73.9 | ROSE (not yet smoothed) |
| completed cycles | 1.8 | 2.8 | more |
| cap-hits | 0 | 0 | clean |

CASCADE notes:
- Modest net improvement across the board (persistence, warmth, dispersion, carn-floor all up; extinction flat).
- **seed 1000 is the proof-of-concept**: 128H in 13 CLUSTERS, 3C persisting, 6 completed cycles - the dispersed-herds + coexisting-predators target dynamic, achieved in one seed.
- But aggregate herbClusters only 3.3->4.8: most seeds barely fragmented, and amplitude ROSE (52.9->73.9). Reads as crowding=1.0 sitting at the fragmentation THRESHOLD - it tips one seed over but is not strong enough to reliably fragment all, so out-of-phase smoothing has not kicked in.

Decision: **KEEP direction, push harder.** Next A/B: crowding 1.0 -> 2.0 to fragment across all seeds. Predict: clusters up broadly, amplitude smooths (out-of-phase patches), persistence up. Two-sided risk: too thin and predators cannot find prey.

---

## Step C2 - herbivoreCrowding 1.0 -> 2.0 (BREAKTHROUGH)

Result (`--seeds=6`, 475s):

| metric | C1 (crowding 1.0) | **C2 (crowding 2.0)** | target |
|---|---|---|---|
| extinction rate | 17% (1/6) | **0% (0/6)** | 0% MET |
| carn-persistence | 3/6 (50%) | **5/6 (83%)** | >=90% (close) |
| phase lag (coupled) | -202t | **+68t** | positive - MET |
| carn amplitude | 6.0 | 27.4 | predators now genuinely cycle |
| final fauna mean | 35.7 | 87.2 | warm, healthy |
| herbClusters | 4.8 | 5.8 | up |
| herb amplitude | 73.9 | 86.3 | still large / growing |
| carn min-floor | 0.7 | 0.3 | dips to ~0 at troughs |
| cap-hits | 0 | 0 | 0 MET |

CASCADE notes (the big one):
- Crowding/dispersion was the LOAD-BEARING lever, as the proposal predicted. Doubling it flipped the system from "fragile stragglers, predators mostly dying" to 0 extinctions / 83% persistence / +68t phase lag (carnivores peaking AFTER prey - the healthy coupled-cycle signature, achieved for the first time in aggregate).
- 3 seeds show real coexistence with substantial predator populations and strong +lag: 1000 (127H/62C, 14 clusters, +300 r.85), 1404 (64H/129C, 10 clusters, +260 r.80), 1505 (31H/79C, +300 r.77).
- WHY it works: enough out-of-phase patches finally exist that a local crash leaves neighbors to recolonize from -> no global synchronous collapse -> predators survive the troughs. This is reason-2 (synchrony) being broken.
- Remaining problems: (1) amplitude large + trending up (herb 61.6->70.4; per-seed swings 30->230) - boom-bust, not gentle; Decision 1 wants bounded/non-growing. (2) carn min-floor ~0.3 - predators graze zero at troughs (stochastic-extinction risk on longer runs). (3) 2 fragile seeds (1101 5H/1C, 1303 0H/1C). (4) some seeds predator-heavy (1404 129C vs 64H) = predator overshoot still happening.

Decision: **KEEP crowding 2.0** - the best baseline by far, hits the extinction + phase-lag + cap-hit targets, near the persistence target. Committed as the knob-C milestone. Remaining work: tame AMPLITUDE and lift the 2 fragile seeds (push crowding further? revisit knob A eatGain for predator overshoot? knob B prey recruitment?).

---

## Step A2 - revisit knob A: carnivoreEatGain 40 -> 32 on top of C (REVERTED - key cascade lesson)

Hypothesis: lower energy-per-kill -> smaller predator booms -> shallower prey crashes -> bounded amplitude + fewer fragile seeds (D insures against over-weakening).

Result (`--seeds=6`, 463s) vs C2 baseline (eatGain 40):

| metric | C2 (eatGain 40) | A2 (eatGain 32) | read |
|---|---|---|---|
| extinction rate | 0% (0/6) | 17% (1/6) | REGRESSED (seed 1202 collapsed) |
| carn-persistence | 5/6 | 5/6 | flat |
| phase lag (coupled) | +68t | +27t | weaker |
| herb amplitude | 86.3 | 88.9 | NOT damped |
| final fauna mean | 87.2 | 66.8 | lower |
| amp-trend | 61.6->70.4 | 61.5->75.9 | slightly worse |

CASCADE LESSON (important, non-obvious - promote to Engineering Lessons):
- **`carnivoreEatGain` does NOT control the per-capita KILL RATE.** Predators kill whenever `eatCD` (carnivoreEatSpeed=18t cooldown) is ready and prey are present, regardless of energy-per-kill. Lowering eatGain just makes predators HUNGRIER: same kill rate, less energy banked, so they need MORE kills to survive/reproduce = MORE predation pressure per predator, not less. seed1000 still boomed to 104C with herb crashed to 29.
- So eatGain tunes the predator NUMERICAL response (how fast predator NUMBERS grow) + starvation; it is the WRONG lever for predation PRESSURE / overshoot / amplitude. The right lever is **`carnivoreEatSpeed`** (lengthen the kill cooldown to actually cut kill rate).

Decision: **REVERT eatGain to 40.** Next A/B: lengthen `carnivoreEatSpeed` 18 -> 26 (single knob vs committed C2 baseline) to reduce predation pressure and tame amplitude. Predict: smaller predator booms, shallower prey crashes, bounded amplitude; risk - too slow and predators starve (D should catch it).

---

## Step A3 - carnivoreEatSpeed 18 -> 26 on top of C (NEUTRAL - reverted)

Result (`--seeds=6`, 460s) vs C2 baseline:

| metric | C2 (eatSpeed 18) | eatSpeed 26 | read |
|---|---|---|---|
| extinction rate | 0% (0/6) | 0% (0/6) | flat |
| carn-persistence | 5/6 | 5/6 | flat |
| phase lag | +68t | +66t | flat |
| herb amplitude | 86.3 | 86.3 | IDENTICAL |
| carn amplitude | 27.4 | 27.5 | flat |
| final fauna mean | 87.2 | 95.7 | marginally higher (noise?) |
| amp-trend | 61.6->70.4 | 61.6->67.0 | marginally less growing (noise?) |

CASCADE notes:
- eatSpeed 18->26 (-31% kill rate) was essentially a NO-OP. Reason: with eatGain 40 nearly filling the tank (maxEnergy 120) in ONE kill, a slower cooldown still lets a predator near a herd kill-fill-reproduce. The cooldown is not the binding constraint on the numerical response in this regime either.
- CONCLUSION: amplitude is driven by the predator (large-eatGain, cheap-repro) ECONOMICS - predators boom whenever prey are available - not by per-capita kill rate. Neither eatGain nor eatSpeed alone is the amplitude lever in this regime.

Decision: **REVERT eatSpeed to 18** (do not keep a neutral change). Pivot: the persistence gap is seed 1202 (24H/0C) where D's minPrey=30 gate blocks rescue. C's dispersion now protects prey, so re-tune D: minPrey 30 -> 20 to rescue moderate-prey seeds. Predict: persistence -> ~6/6, extinction stays 0 (dispersion guards over-suppression).

---

## Step D3 - carnivoreRescueMinPrey 30 -> 20 on top of C (NEUTRAL)

Result (`--seeds=6`, 466s) vs C2: persistence 5/6 (unchanged), extinction 0%, herb amp 86.3, lag +68t - essentially IDENTICAL to C2. seed 1202 STILL ends 29H/0C.

CASCADE notes:
- minPrey was NOT the binding constraint. The rescue RATE (5e-5) is so low that even when eligible (hc>=20), expected rescues over the window are < 1. So the 5/6 persistence comes mainly from predator REPRODUCTION through the cycle, not rescue; 1202 is a seed where the predator cycle died and the weak rescue cannot re-establish them.
- The lever to fix the last seed is the rescue RATE, not the minPrey gate.

Decision: keep minPrey 20 (neutral, makes 1202 eligible), raise `carnivoreRescueRate` 5e-5 -> 1e-4 so the rescue actually fires in a predator-poor / prey-present seed. cap<4 guard prevents over-rescue in healthy seeds; C's dispersion guards over-suppression. Predict: 1202 -> coexistence (persistence 6/6), extinction stays 0.

---

## Step D4 - carnivoreRescueRate 5e-5 -> 1e-4 on top of C (REGRESSED - reverted; key METHOD lesson)

Result (`--seeds=6`, 469s) vs C2:

| metric | C2 (rate 5e-5) | rate 1e-4 | read |
|---|---|---|---|
| persistence | 5/6 | 5/6 | unchanged (1202 still 0C) |
| phase lag | +68t | -66t | LOST the positive lag |
| carn amplitude | 27.4 | 6.4 | predators pinned ~4, no longer cycling |
| final fauna | 87.2 | 62.3 | lower |
| extinction | 0% | 0% | held |

CASCADE + METHOD lesson (CRITICAL - promote to Engineering Lessons):
- Stronger rescue did NOT fix 1202: a rescued lone immigrant in a low/dispersed-prey seed STARVES before finding the fragmented herd, so rescue cannot re-establish a DEAD predator cycle (it only insures a live one against dipping to 0).
- More important - **RNG-stream reshuffle**: knob D's rescue branch draws a CONDITIONAL `eRng()` (`...&&eRng()<rate*hc`). Changing minPrey/rate/cap changes how often that eRng() is drawn -> changes the per-tick RNG draw COUNT -> shifts the ENTIRE downstream RNG stream. So D-parameter A/Bs are NOT "same world, different rule" - they are different RNG draws entirely (seed 1000 went 62C->4C, 1404 129C->4C purely from reshuffle). Per-seed comparison across D settings is unreliable, and even aggregates carry reshuffle noise.
- By contrast, knob A (eatGain) and knob C (crowding scoring) do NOT gate an eRng() call, so those A/Bs WERE clean same-world comparisons - which is why C read so cleanly and D so noisily.

Decision: **REVERT D to committed C2** (minPrey 30, rate 5e-5). C2 is the best balanced baseline; further 6-seed D-rate tuning is chasing RNG noise. Next: validate C2 on a LONG run (ticks=3000) to test whether the large amplitude is BOUNDED (C2 genuinely balanced) or DIVERGING (needs prey-side density-dependence / knob B).

---

## Step V1 - LONG-RUN validation of committed C2 (ticks=3000) - MAJOR FINDING: non-stationary world

Result (`--seeds=6 --warmup=3000 --ticks=3000`, 734s):

| metric | C2 @1000t | C2 @3000t | reading |
|---|---|---|---|
| extinction rate | 0% (0/6) | 33% (2/6) | 2 seeds crash ~tick 1300 (BEYOND the tuning window) |
| carn-persistence | 83% (5/6) | 50% (3/6) | degrades over the longer horizon |
| cap-hits | 0 | **27** | seed 1202 herbivores hit the 400 cap = Decision-1 FAILURE |
| herb amplitude | 86 | 128 (swings to 400) | larger |
| land coverage | ~24% | **~54%** | terrain DOUBLED during the measured window |
| flora total | ~2,000 | **~11,000** | food base 5x'd |

THE BIG CASCADE (reframes the whole exercise):
- **The world is NON-STATIONARY.** Terrain genesis does not stop after warmup - `step()` keeps growing land every tick. warmup=3000 -> ~24% land; +3000 measured ticks -> ~54% land, flora ~2,000 -> ~11,000. So the standard 1000-tick protocol measures the ecology against a near-static SNAPSHOT (land ~24%); a longer horizon measures it against a steadily RISING carrying capacity.
- Consequence: as flora 5x's, herbivores boom toward the population CAP (seed 1202: 392H/400, 27 cap-hits) - a Decision-1 failure that the 1000-tick window structurally cannot reveal (caps never bound there). And the large-amplitude cycles wander 2/6 seeds to extinction at tick ~1300, past the tuning window.
- So **C2 is WINDOW-balanced (excellent at land ~24%) but NOT steady-state balanced.** The two blockers are beyond knob-tuning of the existing levers: (1) the rising carrying capacity (non-stationary terrain), and (2) residual large amplitude that needs PREY-SIDE density-dependence (self-limit below the food base) to bound regardless of flora level.

Decision: **STOP the autonomous knob loop here.** C2 is the delivered "much better baseline to work off of" (committed `2c24af7`); it is a large, real improvement on the proposal's own protocol. The remaining gap is a SCOPE/DESIGN fork for Kevin (accept window-balance / add prey density-dependence mechanism / re-baseline against a plateaued long-warmup world / bound terrain growth) - not more turning of the current knobs. Surfaced to Kevin with a recommendation.

---

## SUMMARY - where the loop landed (for the next session)

**Committed best = C2 (`2c24af7`):** `carnivoreEatGain 40`, `carnivoreEatSpeed 18`, `herbivoreCrowding 2.0`, knob D rescue (`rate 5e-5, minPrey 30, cap 4`). Three commits: A (`5827511`), D (`4518b43`), C (`2c24af7`).

**vs the seeded baseline, on the standard 1000-tick protocol:**
| metric | baseline | C2 | 
|---|---|---|
| full-extinction | 17% (1/6) | **0% (0/6)** |
| carn-persistence | 0% (0/6) | **83% (5/6)** |
| phase lag | -44t (no +lag) | **+68t (carn after prey)** |
| final fauna mean | 52 | 87 |
| cap-hits | 0 | 0 |

**What each knob taught us (the cascade map):**
- **A (eatGain):** tunes the predator NUMERICAL response + starvation, NOT kill rate. 50->40 introduced lag at no starvation cost. Lower (32) backfired (hungrier predators kill the same, destabilize). 
- **eatSpeed:** the kill-RATE lever, but a NO-OP here because one kill (eatGain 40) nearly fills the tank, so cooldown is not the binding constraint. Amplitude is predator-ECONOMICS-driven, not kill-rate-driven.
- **D (rescue):** lifts persistence off zero but cannot RESTART a dead predator cycle (lone immigrant starves in dispersed prey); insures a live cycle. Its parameter A/Bs are RNG-confounded (conditional eRng() gate changes draw count -> reshuffles the stream). Kept as light insurance.
- **C (crowding/dispersion):** THE load-bearing lever. 1.0 at threshold, 2.0 broke global synchrony -> 0% extinction, +lag, coexistence. Clean A/B (no eRng gate).
- **V1 (long run):** the world is non-stationary; window-balance != steady-state balance.

**Recommended next (Kevin's call):** add PREY-SIDE density-dependence (herbivore reproduction suppressed by local crowding, not just movement) - the proposal's reason-1 fix - to bound amplitude + prevent cap-hits regardless of flora level; validate in the long/high-flora regime, and decide the warmup/measurement protocol for a non-stationary world (warm up to a land plateau, or define balance per development stage).

---

## Step B1/B2 - knob B: local density-dependent herbivore birth (cap 8, then 12) - NEGATIVE RESULT (reverted)

Kevin chose the prey-density-dependence direction. Implemented as a DETERMINISTIC gate: a herbivore does not reproduce if its local 5-tile neighborhood already holds >= `herbivoreLocalCap` herbivores (logistic self-limit below the flora food base). Validated in BOTH regimes.

| run | extinction | persistence | cap-hits | final fauna | note |
|---|---|---|---|---|---|
| C2 @1000t | 0% | 5/6 | 0 | 87 | baseline window |
| B cap 8 @1000t | 17% | 4/6 | 0 | 41 | REGRESSED - cap 8 bites healthy clusters, cools prey, starves predators |
| C2 @3000t (V1) | 33% | 3/6 | 27 | 121 | baseline long-run |
| B cap 12 @3000t | 50% | 2/6 | 27 | 121 | INERT - 5/6 seeds byte-identical to V1; only reshuffle where it bound |

CASCADE - why knob B is the WRONG lever here (key finding):
- **Local density-dependent birth is INERT under knob C.** C (crowding) makes herbivores actively SPREAD to keep local density low, so even when total herbivores boom to the 400 cap (seed 1202), the local 5-tile neighborhood stays BELOW 12 - the cap never binds (5/6 seeds at cap 12 byte-identical to no-knob-B). They boom by COVERING MORE AREA (more clusters across the growing map), not by getting locally denser. So a local-density birth cap cannot distinguish a healthy window from a long-run boom: lower it enough to bind the boom (cap 8) and it also bites healthy clusters (window regression); raise it to spare the window (cap 12) and it never binds.
- **The cap-hit reframes as a BACKSTOP ARTIFACT, not a rate failure.** seed 1202 @3000t = 392H/8C over ~2700 land tiles with saturated flora = a SPARSE, COEXISTING population (~0.15 herb/tile) bumping the arbitrary faunaMaxPop=400 ceiling, not a starvation overshoot. Decision 1 itself says to raise the backstop well above any healthy band.
- **The REAL long-run failure is the 2 EXTINCTIONS (~tick 1300):** large-amplitude predator-prey cycles wandering to the absorbing-zero wall (min floors hit 0). This is the proposal's reason-2 "neutrally-stable orbit wanders to zero," whose named fix is out-of-phase REFUGIA = knob C. So the lever is MORE dispersion (push C), not prey birth control.

Decision: **REVERT knob B entirely** (removed mechanism + config - clean negative result, no dead code). Pivot: push knob C `herbivoreCrowding` 2.0 -> 2.5 (more refugia for the absorbing-wall extinctions; a CLEAN non-eRng A/B), tested at 3000t where the real failure lives. The cap-hit, if it persists, is fixed separately by raising the faunaMaxPop backstop per Decision 1.

---

## Step C3 - herbivoreCrowding 2.0 -> 2.5 at 3000t (BACKFIRED - reverted; ROOT diagnosis: paradox of enrichment)

Result (`--seeds=6 --ticks=3000`, 660s) vs C2 @3000t (V1):

| metric | C2 (crowding 2.0) | crowding 2.5 | read |
|---|---|---|---|
| extinction rate | 33% (2/6) | 33% (2/6) | no help |
| carn-persistence | 3/6 | 3/6 | no help |
| cap-hits | 27 | **388** | 14x WORSE (3 seeds slam the 400 cap) |
| herb amplitude | 128 | 160 | LARGER |
| amp-trend | 90->71 | 88->152 | MORE diverging |

ROOT DIAGNOSIS - the paradox of enrichment (the real wall):
- More dispersion made the long run WORSE: herbivores spread over even more of the big map, exploit even more of the food base, boom BIGGER, crash harder. Dispersion RAISES effective carrying capacity, so it amplifies the instability it was meant to cure.
- **This is the PARADOX OF ENRICHMENT** (Rosenzweig 1971): raising the prey carrying capacity K ENLARGES the predator-prey limit-cycle amplitude until troughs hit the absorbing-zero wall -> extinction. The non-stationary world raises K without bound (land 24->54%, flora 5x), so the cycle amplitude grows over time (amp-trend diverging) and seeds wander to zero. The destabilizer is K ITSELF, not the rates.
- Consequence: **no fixed set of rate knobs gives steady-state balance in a world with unbounded-growing K.** Both prey-side rate levers fail for the same root reason - local birth control is inert (C disperses prey), more dispersion backfires (raises K). The clean rate-knob search for LONG-RUN balance is exhausted.

Decision: **REVERT crowding to 2.0** (C2 is strictly better long-run: 27 vs 388 cap-hits, smaller amplitude). STOP the autonomous knob loop. The remaining levers are design forks beyond rate tuning, brought to Kevin:
1. ACCEPT C2 + window-balance; treat the long-run boom/bust as ORGANIC (worlds enrich, destabilize, reseed) - cheapest, fits a living-world sim; just raise the faunaMaxPop backstop so the cap-hit artifact stops counting as failure.
2. BOUND the carrying capacity (generation-side: cap land/flora growth so K stabilizes) - root fix; then the existing knobs give steady-state balance. Touches terrain generation, not ecology.
3. Add an ENRICHMENT-ROBUST mechanism (predator interference / a prey predation-refuge) that stabilizes predator-prey cycles at high K - more ecological modeling, uncertain against unbounded K.

## FINAL STATE (loop complete)

**Committed best = C2 (`2c24af7`), unchanged by the post-V1 experiments** (all of B, the D re-tunes, eatGain 32, eatSpeed 26, crowding 2.5 were reverted as no-improvement/regressions). C2 = `eatGain 40` + knob D rescue (`5e-5/30/4`) + `herbivoreCrowding 2.0`.

- **1000t (window, land ~24%):** 0% extinction, 83% carn-persistence, +68t phase lag, cap-hits 0 - a large, real win vs the seeded baseline (17% / 0% / -44t).
- **3000t (long, land ~54%):** 33% extinction, 50% persistence, cap-hits from the rising food base - WINDOW-balanced, not steady-state, blocked by the paradox of enrichment under non-stationary K.

The clean rate-knob search is DONE. Long-run steady-state balance is a Kevin design fork (above).
