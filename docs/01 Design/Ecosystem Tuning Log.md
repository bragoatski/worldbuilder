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

Decision: **KEEP.** Positive lag emerged with no starvation cost and cap-hits 0; a clean directional win that sets up D. Persistence lift deferred to D per plan. (Kevin then handed over full autonomy to run the loop.)

---
