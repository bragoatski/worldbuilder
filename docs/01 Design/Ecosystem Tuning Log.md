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
