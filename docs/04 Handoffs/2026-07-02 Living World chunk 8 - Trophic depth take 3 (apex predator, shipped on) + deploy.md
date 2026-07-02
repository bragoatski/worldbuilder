# 2026-07-02 - Living World chunk 8: Trophic depth take 3 (APEX predator, shipped ON) + deploy

Self-contained handoff. Read STATUS.md for current truth and `docs/01 Design/Living World Roadmap.md` for the
direction + chunk sequence. Prior handoff: `2026-07-01 Living World chunk 7 - Trophic depth take 2 (scavenger viable, shipped on) + deploy.md`.

## The direction (unchanged)
Worldbuilder's moat is the SIMULATION. The roadmap AMPLIFIES it. Per-chunk workflow: one chunk -> full gate ->
docs -> commit -> deploy -> next-session prompt. Chunks 1-7 = Chronicle / evolution-visible / god powers /
shareable worlds / scenarios / speciation / trophic-scavenger. Chunk 8 (this one) = trophic depth TAKE 3: the
APEX predator - the harder fight (it stacks a 4th level on the fragile carnivore tier).

## What shipped (one feat commit): the APEX predator tier, default ON
A 4th trophic level: an APEX predator (`type:'apex'`, dark-crimson solid-diamond marker, 🦁 in the panels) that
hunts the MID-tier consumers - carnivores AND scavengers. Built default-off behind `CFG.apexEnabled`, mirroring
the chunk-7 scavenger recipe, A/B'd, then flipped ON after it cleared the bar. All in `src/main.js` (+ an `Apex`
button in `index.html`, harness `--apex` in `scripts/harness.mjs`, tests in `src/sim.test.js`).

### The design that cleared the bar: LIGHT predation
The apex's prey (live carnivores/scavengers) is a THIN, oscillating, self-depleting population (unlike carrion,
a regenerating waste flux), so the tier is intrinsically hard to keep viable WITHOUT crashing carnivores. The
winning approach makes each kill count for a lot so FEW kills are needed (the scavenger take-2 lesson, applied
to a predator):
- **Rare + slow + high-yield:** `apexEatSpeed` 26 (slow, vs carnivore 18), `apexEatGain` 95 + `apexMaxEnergy`
  180 (bank a lot per rare kill), `apexReproThreshold` 135 / cost 72 (breeds slowly -> stays rare).
- **Prey base = carnivores + scavengers** via the EXISTING `_carnAtTile`/`_scavAtTile` indices (no new prey
  index) + a ring-2-4 carrion-style SCENT scan in `scoreTileForFauna` to find dispersed prey. A kill drops
  carrion (feeds the scavengers) + flashes a 'kill' particle.
- **Mid-prey-dependent immigration RESCUE** (`apexRescueRate` 0.0008 / `MinPrey` 5 / `ApexCap` 5) in
  `naturalFaunaSpawn`, a knob-D analog guarded on `apexEnabled`. (The FIRST attempt's rescue was 4x too weak at
  rate 0.00025 -> smoke apex-persistence 25%, mean 0.3; raising it + the eatGain/maxEnergy fixed viability.)
- **Confound generalized:** `naturalFaunaSpawn` now counts FOUR tiers separately (`hc`/`cc`/`sc`/`ac`) so the
  apex is not lumped into the carnivore count - otherwise it would starve knob D's carnivore-rescue headroom
  (the same confound chunk 7 fixed for scavengers; every new tier sharing `faunaMaxPop` needs this).

### The A/B (measure -> A/B -> keep-if-better; 12 seeds)
Reference `--scav=12` (apex off) == the chunk-7 shipped baseline exactly (byte-identity re-confirmed):

| run | extinction | carn-persist | scav-persist | apex-persist | cap-hits | final fauna / flora |
|---|---|---|---|---|---|---|
| reference (`--scav=12`) | 0% | 75% (9/12) | 100% (11.1) | - | 0 | 60.5 / 2210 |
| **treatment (`--scav=12 --apex=8`)** | **0%** | **83% (10/12)** | **100% (11.3)** | **100% (3.7)** | **0** | **40.5 / 2252** |

Every existing tier is neutral-to-BETTER (carn-persistence ROSE 75->83; carn oscillation amplitude fell 6.7->4.7
- the apex CROPS the carnivore peaks so it overshoots-then-crashes less), the new tier persists 100%, cap-hits 0.
Bar cleared -> `apexEnabled` defaults ON. Flag OFF is byte-identical to the chunk-7 baseline (`--apex=0` proof).

### Two honest caveats (Tier B - for Kevin's eyeball / call)
1. **The apex is RESCUE-SUSTAINED, not self-reproducing** (mean 3.7 sits at the rescue floor ~5; contrast the
   scavenger's mean 11 >> cap 6). It clears the "non-zero persistence" bar and is ecologically honest (apex
   predators are rare + often immigration-sustained), but a genuinely self-reproducing apex would need a richer
   prey base (e.g. also taking herbivores) - which risks the balance, so it was DEFERRED.
2. **It is a real TROPHIC CASCADE:** total fauna ~60 -> ~40 (and STEADIER: sd 49 -> 26), flora up ~2210 -> 2252.
   That is the textbook top-down effect (a stabilizing trim of the boom-bust), not a collapse - but the world
   reads as somewhat LESS crowded. If you dislike the thinner feel, the flag flips back off (byte-identical) or
   the apex can be made even rarer (lower `apexRescueApexCap` / higher `apexEatSpeed`).

## Gate (full, green)
`npm run typecheck` (clean) + `npm run lint` (0 errors; 32 warnings, unchanged legacy) + `npm test`
(**37 tests**, was 34; +3 apex: shipped-default-ON, flag-OFF byte-identical no-apex-arises, flag-ON
hunt+deterministic) + `npm run build` (ok, bundle `index-Dootdbvb.js`). Test housekeeping: the chunk-2
single-seed inheritance test (seed 909090) now disables BOTH scavengers AND apex to dodge the eRng reshuffle
(it tests a mechanic orthogonal to the trophic tiers); the chunk-7 scavenger tests are unchanged and green.

## Gate-blind (DOM), eyeball in the live app
Dark-crimson solid-DIAMOND apex appear by default (🦁 in the Species + Inspector panels). Click `Apex` in the
Populate deck to seed some. Watch the apex crop carnivores/scavengers, the total population settle lower +
steadier, and an apex species row appear in the Species panel. The apex render + the `Apex` button are gate-blind.

## Concurrent-session note
`src/main.js` + `index.html` are shared across sessions. Working tree was clean at start (branch
`ecology-balance`, at `main == 16be8b4`). Only `src/main.js`, `index.html`, `scripts/harness.mjs`,
`src/sim.test.js` + docs were touched. Check `git status` + mtime before editing if another session may be active.

## Deploy
Deploy = ff `main` to the reviewed SHA (this chunk's feat commit + docs) + push; GitHub Pages CI builds +
publishes. Live: https://bragoatski.github.io/worldbuilder/ (chunk-8 bundle `index-Dootdbvb.js`).

## NEXT (chunk 9): Trophic depth take 4 - the OMNIVORE tier
The last planned trophic tier and a different kind of hard: an omnivore eats BOTH flora and fauna, so it
competes with herbivores AND carnivores at once (blurs the herb/carn coupling). Same default-off
measure -> A/B -> keep-if-better loop, same bar (neutral-to-better on ALL existing tiers - herb/carn/scav/apex -
+ non-zero omnivore persistence + 0 cap-hits). Reuse the `--scav`/`--apex`-style harness instrument (add
`--omni=N` + an `omnivoreEnabled` flag + count it as a 5th separate tier in `naturalFaunaSpawn`). Likely balance
risk: competition-with-herbivores. (Optional side quest: make the APEX self-reproducing via a broader prey base -
deferred from chunk 8.) See STATUS + the Engineering Lessons "Speciation / trophic depth" entry (the apex lesson
records the light-predation recipe + the count-tiers-separately generalization).
