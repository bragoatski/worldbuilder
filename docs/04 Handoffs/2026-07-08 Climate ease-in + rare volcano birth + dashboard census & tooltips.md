# 2026-07-08 - Climate ease-in + rare volcano birth + dashboard census & tooltips

Self-contained brief for this unit of work. Prior handoff: `2026-07-06 HUD fix (5 tiers) + fauna-distribution & crash-defense investigations.md`.
STATUS.md holds current truth. Four asks from Kevin, all landed on the branch (NOT deployed):
(1) improve/reorganize the top dashboard, (2) make the deck tooltips match the app's styled tooltips,
(3) the Seasonal Tilt / Transient Anomalies "instant map jump" on enable, (4) a rare elev-10 volcano emergence.

## 1 + 2 - Dashboard redesign + styled deck tooltips (UI, gate-blind, verified live)
- **Life census as one instrument.** The six trophic counts (flora + herb/carn/scav/apex/omni) were six identical
  loose colored squares in the top-right with no visible labels - unreadable. Regrouped into a single bordered,
  inset `.census` panel (world-state chips `t`/`Seed`/`Land`/`Season`/`Zoom` split into their own `.tgroup`), each
  tier a color-coded cell with a subtly glowing dot, in trophic order. Reads as a HUD readout now, not a cryptic
  row. Every `id=` preserved so `drawHUD` is untouched. Primary deck got a subtle top-lit gradient for depth.
- **Styled deck tooltips.** Every deck control's native `title=` became `data-tip="Title|Description"` (+ optional
  `data-tipk` hotkey badge). A new `.deck-tip` element + delegated hover handler (`src/main.js`, after the legend
  tooltip IIFE) renders them in the SAME dark/blurred/bordered language as the map + legend tooltips, positioned
  below the control. Verified live (Playwright): Meteor shows title+description; Reset shows an "R" hotkey badge;
  0 console errors.
- **Season HUD label:** the `Season` chip now names the phase (Spring/Summer/Autumn/Winter) instead of a raw %.
- Files: `index.html` (deck markup + `.census`/`.tgroup`/`.deck-tip` CSS + `#deckTip`), `src/main.js` (deck-tip
  handler + season label). Before/after screenshots were captured this session.

## 3 - Climate ease-in on mid-run toggle (sim, balance-safe)
- **Root cause:** `seasonPhase()` was `(tick%L)/L`, so checking Seasonal Tilt at a large tick landed on an
  arbitrary phase (instant jump); anomaly blobs spawned at full strength.
- **Fix:** a `seasonAnchorTick` + a rising-EDGE detector in `applyClimate` (`CFG.seasonalTilt && !_prevSeasonalTilt
  && tick>0` -> anchor=tick), so a mid-run enable starts at phase 0 (zero offset) and eases toward the first
  summer. Anomaly blobs gained a `born`/`life` lifecycle + `_blobEnv()` fade-in/out envelope, re-stamped on the
  edge so they ramp from zero; expired blobs respawn -> anomalies are now genuinely TRANSIENT spells (matching the
  name), not permanent dipoles. The `tick>0` guard keeps genesis-ON worlds (iceage seasons, any anomalies preset)
  byte-identical.
- **Balance:** default `npm run measure` (climate off) is byte-identical to the documented C2 baseline
  (extinction 0%, carn-persistence 50% 3/6, final fauna 49.3, flora 2119.2, cap-hits 0). Only climate-OFF is the
  balance reference; the anomaly lifecycle DOES change anomaly-on worlds (an improvement - transient + eased), but
  no built-in preset enables anomalies from genesis (checked: only iceage=seasons, volcanic=volcanoAsh), so no
  preset's genesis stream is touched.
- **Critic-found blocker, FIXED:** `runAssertions()` (the "Run Tests" button) force-toggles the climate flags and
  left `_prevSeasonalTilt`/`_prevAnomalies` stuck true, so a user who ran the self-test then checked a climate box
  (no reset) saw NO edge fire -> the map snapped anyway (the bug, via the test button). Now save+restored around
  the block; `applySnapshot`/`restoreState` also reset `seasonAnchorTick` + sync the edge flags (a load is not an
  edge). Regression test added.
- **Proposal (answered Kevin's "let's review it"):** the ease-in IS the recommended UX (start acting from now,
  work toward the outcome, no jump) - shipped. Files: `src/sim.js` (seasonPhase/applyClimate/initAnomalyBlobs/
  updateAnomalyBlobs/_blobEnv/snapshot+restore/runAssertions), `src/sim.test.js`.

## 4 - Rare in-run VOLCANO BIRTH (sim, balance-neutral A/B, shipped ON)
- **Why nothing emerged:** `eruptionPromotionPass` promotes a mountain to a permanent elev-10 volcano only at
  elev>=9.95, but mountains never climb there on their own (probe `scripts/volcano-diag.mjs peaks`: max elev ~5-7
  at moderate land, ZERO tiles >=9.5). So the elev-10 volcano was effectively unreachable - exactly Kevin's report.
- **Feature:** `tryVolcanoBirth()` in `step()` (after eruptionPromotionPass): on a 40-tick cadence, a rare gate
  `_eventRand(salt) < CFG.volcanoBirthRate` promotes the highest eligible highland tile (elev>=`volcanoBirthMinElev`
  4.8, spacing/cap respected) to a full elev-10 volcano via the existing `promoteVolcanoAt` (rings + ash + dark
  render), plus a Chronicle beat "A volcano rose from the highlands...". Instant (not a gradual rise) - a clean
  follow-up if Kevin wants the slow build-up.
- **Balance-safe BY CONSTRUCTION:** `_eventRand` is a stream-free splitmix32 hash of (`_seed`,`tick`) - it draws
  NONE of sRng/eRng/cRng, so enabling the feature leaves the RNG draw sequences byte-identical; only the rare
  volcano's own terrain change touches ecology. A/B (`--birth=0` vs `--birth=0.008`, 8 seeds): NEUTRAL - extinction
  0/0%, carn-persistence 63/63%, cap-hits 0/0, final fauna 63.8/64.3; and no-birth seeds were bit-identical to
  baseline (proving the stream-freedom). `volcanoBirthRate=0` short-circuits => byte-identical.
- **Rate = pure taste dial, default 0.005.** Frequency probe: 0.0025 -> 17% of maps, 0.008 -> 58%, so 0.005
  (~40% of long sessions) is "once in a while, not every map" per Kevin. Balance holds for any rate <= 0.008
  (fewer births is strictly closer to baseline). One-line CFG knob; bump up for more drama, down for rarer.
- Files: `src/sim.js` (CFG knobs + `_eventRand` + `tryVolcanoBirth` + step wiring), `scripts/harness.mjs`
  (`--birth=RATE`), `scripts/volcano-diag.mjs` (new probe), `src/sim.test.js` (3 tests incl. a stream-free proof).

## Gate + state
- Gate GREEN: typecheck clean + lint 0 errors (32 pre-existing warnings) + **47 tests** (was 40: +3 climate easing,
  +1 runAssertions-edge regression, +3 volcano birth) + build. Critic pass run on the sim diff (1 blocker + 2 risks
  fixed, nits adjudicated).
- Branch `ecology-balance` (working branch, ahead of the deployed `main`). NOT deployed - held per the
  no-surprise-Pages rule. The prior HUD fix (`447356a`) is also still on the branch awaiting deploy.
- **Gate-blind, for Kevin's eyeball (low risk - reuse proven render paths):** the new census + deck tooltips (seen
  live this session, look good); the volcano-birth dark peak + Chronicle beat (reuses the existing volcano render +
  chronicleNote, both proven); the seasonal ease-in motion (needs watching a mid-run enable).
- **Deploy decision (Kevin):** these are real improvements, all balance-proven. Recommend deploying the branch
  (ff main + push, Pages CI) together with the pending HUD fix. Frequency + the "instant vs gradual" volcano and
  the census/tooltip look are taste dials to confirm live.

## NEXT
- Optional: gradual volcano RISE (grow a highland to 10 over ~hundreds of ticks so it visibly builds, letting the
  existing 9.95 promotion fire naturally) instead of the instant promote - a clean follow-up if the pop-in reads
  abrupt.
- The pre-existing Living World Roadmap backlog (fauna distribution as a measured task; optional trophic
  follow-ups) is unchanged - see the prior handoff + STATUS.
