# 2026-08-21 - Viewer reachability, rail tooltips, narrow screens

Self-contained brief for this unit of work. Prior handoff: `2026-08-21 The Hand - on-map god powers.md`.

## Why this happened

The owner asked for launch thumbnails and, alongside them, for a read on what else needed cleaning up in
the gameplay and the interaction surface. Six problems were reported. The owner approved five of them
(owner ruling 2026-08-21) and declined the sixth.

Declined, deliberately: the opening 10 to 15 seconds show a nearly empty ocean because the default world
grows from tick-0 ocean at speed 60. That is the intended experience (see the prior handoff and commit
9c14136) and it stays. Do not "fix" it in a later session.

## Two findings were wrong, and the correction is the useful part

The first audit reported that Viewer hides the Legend, Chronicle, Species and Food Web outright, and that
a tile click teaches a visitor nothing. Both were overstated, and both were caught only by probing the
running app rather than reading the CSS.

- **The Laws button already reveals every information panel.** Measured under both toggle states: with
  `laws-open` absent all ten panels report hidden; with it present all ten report visible, Legend included.
  The real defect was one line of copy. The button's own tooltip advertised "the dials the world runs on:
  terrain, climate, ecology", which is about a third of what it opens, so nobody hunting for the Chronicle
  would ever press it.
- **Hovering a tile already reports it.** `updateTooltip` renders terrain, elevation, aridity, temperature,
  sunlight, water and any flora/fauna into `#tip`, which has no Viewer hiding rule and works today. A
  floating click-card was designed and then dropped as duplicate machinery.

The lesson generalised into `Engineering Lessons.md`: a reachability audit has to test every mode STATE,
not just the default one.

## What shipped

All five changes are browser-shell only. No file under the simulation was touched.

| Fix | Where | Effect |
|---|---|---|
| Rail tooltips fire | `src/main.js` tooltip IIFE | All ten rail tooltips display for the first time since the rail shipped |
| Tip sits beside the rail | same | A vertical strip needs a side tip; below would cover the next button |
| Intro copy | `index.html` `.intro-sub` | "Simulate, Mold & Discover" - without the comma it reads as simulating fungus |
| Laws tooltip honest | `index.html` `#handLaws` | Now names the chronicle, the legend and the inspector, not only the dials |
| Reset reachable in Viewer | `index.html` viewer rules | The core verb of a procedural generator had no button in the default view |
| Reset keeps running in Viewer | `src/main.js` `btnReset` hook | Rebuild starts as empty ocean and GROWS; pausing handed back a frozen blank map |
| Narrow screens | `index.html` media query + `fitCanvas` | Map fits and centres; rail becomes a horizontal bar under it |

## The narrow-screen bug had two independent causes

Worth remembering because the first one masked the second.

1. **A minimum tile size larger than a phone.** `fitCanvas` clamped `PIX` to at least 6, so a 96-tile world
   could never draw narrower than 576px on a 390px screen. A floor inside a "biggest tile that fits"
   computation only ever binds in the case where it does not fit. Floor is now 2.
2. **The deck, not the map.** With the map fixed it still measured as overflowing. It was not: the map was
   correctly sized and centred inside a document that was 537px wide, because `.deck-primary` is a
   non-wrapping flex row whose contents could not shrink below their natural width. Comparing
   `document.documentElement.scrollWidth` against `innerWidth` named the real culprit immediately.

The rail also had to stay `position:relative` in the media query rather than `static`. The flyout is
absolutely positioned against it, and a static rail would have handed that job to `.canvas-wrap` and
placed the flyout above the whole map.

## Verification

- Full gate green: typecheck clean, lint 0 errors + 31 warnings (unchanged baseline), 50/50 tests in
  596.87s, build green.
- `npm run measure` matches the recorded baseline on every number: extinction 0%, carnivore-persistence
  50% (3/6), final fauna 49.3, final flora 2119.2, cap-hits 0. Holds by construction as well: `harness.mjs`
  imports only `src/sim.js`, which this change never touches.
- 12 browser checks across a 1440x900 desktop and a 390x844 phone, zero console errors. The headless gate
  is blind to every change in this unit of work, so none of it was believed until driven in a real browser.

## Launch assets (separate deliverable, outside this repo)

`Desktop/worldbuilder-launch-assets/` holds 24 cover candidates at 630x500 (the itch.io spec) and six
source worlds at 1728x1728, plus the tooling that made them and a README. The worlds are real simulation
output: terrain warmed to a land target, life seeded the way `scripts/harness.mjs` seeds it, settled, with
rivers generated. Deliberately kept out of the game repo.

## Next

Unchanged from the prior handoff: steady-state long-run ecosystem balance, and richer creature AI. Two
optional follow-ups raised and not taken:
- Splitting the sidebar into a "story" drawer (chronicle, legend, inspector) and a "laws" drawer (the
  dials). The owner has seen the option; the retitled single button may well be enough.
- Sharing a world from Viewer. `btnCopyLink` exists but is unreachable there, in both drawer states.
