# STATUS - Worldbuilder

_Current truth. Overwritten each checkpoint. The newest handoff in `docs/04 Handoffs/` has the narrative._

## Where things are (2026-06-21)
Bootstrapped, game committed, and DEPLOYED LIVE. The global `~/.claude/` brain layer was built (operating model + methodology + cross-project lessons + a promotion inbox); this Worldbuilder repo + dev system were stood up; `index.html` (the full sim) is committed; and the repo is on GitHub (public) with Pages live.
- Repo: https://github.com/bragoatski/worldbuilder (default branch `main`)
- Live: https://bragoatski.github.io/worldbuilder/ (confirmed serving, HTTP 200)

Taipan was left untouched except an authorized `CLAUDE.md` slim (it now inherits the global layer).

## NEXT (in order)
1. **Verify the game in a browser** (the runtime gate, which can't run headless): open the live link, press `T`, confirm the test badge is green. Eyeball the toolbar/legend glyphs - a few emoji were best-guessed during reproduction (herbivore, fauna-header, Load, zoom, the avg-stat marker, place-pin); fix any that look wrong, or overwrite `index.html` with the authoritative on-disk file (the logic is identical).
2. **Measurement harness.** A headless multi-seed runner: run the sim N seeds x M ticks and report population trajectories / extinction rate / variance. This is the gate's CLI form AND the unlock for tuning the ecosystem.
3. **The big changes**, in value order: **ecosystem balance >> rivers > beaches** (full diagnosis in `docs/01 Design/North Star and Roadmap.md`).

## Known gaps
- Gate is MANUAL (in-browser `runTests()`); no headless runner yet (NEXT step 2).
- A few reproduced emoji glyphs are best-guesses pending a visual check (NEXT step 1).
- Partial reproducibility: terrain seeded, ecology / climate / mutation on raw `Math.random()`.

## Open decisions (Kevin's)
- North star: income / community / portfolio / love-of-it. Drives priority. Until set, the goal is harden + understand.
- Definition of "balanced" for the ecosystem (never-extinct over N ticks? persistent oscillation? stable bands?) - needed before the ecosystem tuning work.
