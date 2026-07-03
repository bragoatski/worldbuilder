# 2026-07-02 - Living World chunk 9: Trophic depth take 4 (OMNIVORE, shipped ON) + deploy

Self-contained handoff. Read STATUS.md for current truth and `docs/01 Design/Living World Roadmap.md` for the
direction + chunk sequence. Prior handoff: `2026-07-02 Living World chunk 8 - Trophic depth take 3 (apex predator, shipped on) + deploy.md`.

## The direction (unchanged)
Worldbuilder's moat is the SIMULATION. The roadmap AMPLIFIES it. Per-chunk workflow: one chunk -> full gate ->
docs -> commit -> deploy -> next-session prompt. Chunks 1-8 = Chronicle / evolution-visible / god powers /
shareable worlds / scenarios / speciation / trophic-scavenger / trophic-apex. Chunk 9 (this one) = trophic depth
TAKE 4: the OMNIVORE - the 5th and LAST planned trophic tier, and a DIFFERENT kind of hard.

## What shipped (one feat commit): the OMNIVORE tier, default ON
A generalist (`type:'omnivore'`, dusky-plum solid-TRIANGLE marker, 🐗 in the panels) that eats BOTH flora AND
herbivore prey, so it competes with herbivores (for plants) AND carnivores (for prey) at once - blurring the
herb/carn coupling the C2 balance rests on. Built default-off behind `CFG.omnivoreEnabled`, A/B'd, then flipped ON
after it cleared the bar. All in `src/main.js` (+ an `Omni` button in `index.html`, harness `--omni` in
`scripts/harness.mjs`, tests in `src/sim.test.js`).

### The hard part: COMPETITION, not starvation (the inverse of scav/apex)
The scavenger (chunk 7) and apex (chunk 8) were sparse-food tiers - their risk was STARVATION, and the recipe was
"high per-find gain + food-scent + a rescue floor." The omnivore is the OPPOSITE: its staple (flora) is ABUNDANT,
and it has a SECOND food source (herbivores), so it accumulates energy faster than either specialist. Its risk is
OVER-SUCCESS (competition). Importing the scav/apex recipe was exactly wrong:
- **First tuning** (`omnivoreFloraEatGain` 9 / `omnivorePreyEatGain` 42 / `reproCost` 60): the tier BOOMED to omni
  mean 32 (>> the rescue cap of 5 => self-reproducing hard), out-foraging herbivores + starving carnivores
  (carn-persistence 83->67% @12 seeds; some seeds ended 0H/0C with the omnivore dominant).
- **Take-4a (shipped):** INVERT it - make the omnivore INEFFICIENT at BOTH foods (a generalist masters neither:
  `omnivoreFloraEatGain` 6 = half the herbivore's 12; `omnivorePreyEatGain` 32 << carnivore 55) AND breed slowly
  (`reproCost` 60->80 => a long post-breed refill climb). Now it stays RARE + rescue-sustained (mean ~7, near the
  rescue cap, like the apex - NOT self-booming), competing minimally.

### The design details
- It GRAZES flora on its tile as its staple (opportunistic), and only hunts a herbivore on the current/adjacent
  tile when NO flora is on its tile - so predation is SECONDARY and its pressure on the herd stays light. A kill
  drops carrion (feeds scavengers) + flashes a 'kill' particle, like the predators.
- `scoreTileForFauna` omnivore branch: seek flora WEAKER than a pure herbivore (weight 1.4 vs 2.5, so it does not
  out-forage the grazers) + a herbivore-prey scent (ring 0-2) + `omnivoreCrowding` self-dispersion + carn/apex
  avoidance.
- `naturalFaunaSpawn` now counts FIVE tiers separately (`hc`/`cc`/`sc`/`ac`/`oc`) - the count-tiers-separately
  confound generalizes again (every new tier sharing `faunaMaxPop` must be excluded from the carnivore count so
  knob D keeps its rescue headroom). The omnivore RESCUE is a BROAD-DIET knob-D analog: it immigrates while
  omnivores are scarce AND food exists - EITHER herbivore prey OR standing flora (a generalist survives on either)
  - scaled by prey abundance + a small flora-sustained floor, capped low. Guarded on `omnivoreEnabled`.

### The A/B (measure -> A/B -> keep-if-better; RE-RUN AT 24 SEEDS)
The 12-seed A/B first read a scary carn 83% (10/12) -> 67% (8/12), which looked like a real competition regression.
But seeding 8 omnivores reshuffles the eRng stream (which seeds crash differs), and 12 seeds is marginal for a
ship/no-ship call. Re-run at 24 seeds and it regressed to the mean (a durable lesson - see Engineering Lessons):

| run | extinction | carn-persist | scav-persist | apex-persist | omni-persist | cap-hits | final fauna |
|---|---|---|---|---|---|---|---|
| reference (`--scav=12 --apex=8`) | 0% | 79% (19/24) | 100% (10.7) | 88% (21/24) | - | 0 | 51.0 |
| **treatment (`+ --omni=8`)** | **0%** | **75% (18/24)** | **100% (17.5)** | **96% (23/24)** | **100% (7.2)** | **0** | **70.8** |

carn 79->75% is a ONE-seed difference (< 1 SE on 24 trials, and within the reference's own 12-vs-24-seed variance
83->79%) => NEUTRAL. apex 88->96% is BETTER. scav/extinction/cap-hits unchanged. omni-persistence 100% (mean 7.2,
rare + rescue-sustained). herb min-floor 10.3 (worst 0) vs ref 11.8 (worst 0) - herbivores dip to 0 momentarily +
recover in BOTH. Bar cleared (neutral-to-better on ALL existing tiers + non-zero omni + 0 cap-hits) ->
`omnivoreEnabled` defaults ON. The reference == the chunk-8 baseline byte-identical (final fauna 40.5 @12s / 51.0
@24s), re-confirming the flag-off byte-identity.

### One honest caveat (Tier B - for Kevin's eyeball / call)
carn-persistence is NEUTRAL by the numbers, but the omnivore adds a whisper of competition/predation on herbivores:
the world reads MORE crowded (fauna 51->71 - the inverse of the apex's top-down thinning; a consumer that recycles
the abundant flora into more fauna) and the herb min-floor sits a touch lower (10.3 vs 11.8). If it ever feels off,
the flag flips back off (byte-identical) or the omnivore can be made even rarer (lower `omnivoreRescueOmniCap` /
`omnivoreFloraEatGain`).

## Gate (full, green)
`npm run typecheck` (clean) + `npm run lint` (0 errors; 32 warnings, unchanged legacy) + `npm test`
(**40 tests**, was 37; +3 omnivore: shipped-default-ON, flag-OFF byte-identical no-omnivore-arises, flag-ON
eats+deterministic) + `npm run build` (ok). Test housekeeping: the chunk-2 single-seed inheritance test (seed
909090) now disables ALL THREE trophic tiers (scav + apex + omnivore) to dodge the eRng reshuffle (it tests a
mechanic orthogonal to the tiers); the chunk-7/8 tests are unchanged and green.

## Gate-blind (DOM), eyeball in the live app
Dusky-plum solid-TRIANGLE omnivore appear by default (🐗 in the Species + Inspector panels). Click `Omni` in the
Populate deck to seed some. Watch them graze flora + occasionally hunt a grazer, the world settle a touch more
crowded, and an omnivore species row appear in the Species panel. The omnivore render + the `Omni` button are
gate-blind.

## Concurrent-session note
`src/main.js` + `index.html` are shared across sessions. Working tree was clean at start (branch
`ecology-balance`, at `main == 7c13750` + the chunk-8 deploy-marker `d6c0b1f`). Only `src/main.js`, `index.html`,
`scripts/harness.mjs`, `src/sim.test.js` + docs were touched. Check `git status` + mtime before editing if another
session may be active.

## Deploy
Deploy = ff `main` to the reviewed SHA (this chunk's feat commit + docs) + push; GitHub Pages CI builds +
publishes. The chunk-8 deploy marker `d6c0b1f` is already in `main`, so there is NO marker to sweep. Live:
https://bragoatski.github.io/worldbuilder/.

## NEXT (chunk 10+): the trophic-depth arc is COMPLETE
All five planned tiers (herbivore / carnivore / scavenger / apex / omnivore) are shipped ON. Remaining work is the
still-valid pre-roadmap backlog (fauna distribution as a measured task; the optional sim-core `sim.js` split) plus
optional trophic follow-ups (Tier B, only if Kevin wants them): (a) make the APEX self-reproducing via a broader
prey base (deferred from chunk 8, balance-risky); (b) tune the crowded-vs-thin feel via the rescue caps; (c) let
the apex also crop omnivores (currently carn+scav only) to tie the 5 tiers into one web. Each is its own
measure -> A/B -> keep-if-better loop. See STATUS + the Engineering Lessons "Speciation / trophic depth" entries.
