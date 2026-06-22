# STATUS - Worldbuilder

_Current truth. Overwritten each checkpoint. The newest handoff in `docs/04 Handoffs/` has the narrative._

## Where things are (2026-06-21)
Codebase just bootstrapped. The global `~/.claude/` brain layer was built (operating model + methodology + cross-project lessons + a promotion inbox), and this Worldbuilder repo + dev system were stood up. Taipan was deliberately left untouched.

## NEXT (in order)
1. **Add `index.html`.** The game file is not in the repo yet. Kevin drops his authoritative on-disk file in (it is clean UTF-8; the copy pasted into chat had mangled emoji). Command:
   `cp "<path-to-your-file>/worldbuilder_3-31-26_beaches.html" "C:/Users/KevinReilly/worldbuilder/index.html"`
   Then commit it.
2. **GitHub.** Create the remote and push (history, backup, and free GitHub Pages hosting so it is playable via a link).
3. **Measurement harness.** A headless multi-seed runner: run the sim N seeds x M ticks and report population trajectories / extinction rate / variance. This is the gate's CLI form AND the unlock for tuning the ecosystem.
4. **Quick bug sweep:** confirm encoding renders, obvious correctness.
5. **The big changes**, in value order: **ecosystem balance >> rivers > beaches** (full diagnosis in `docs/01 Design/North Star and Roadmap.md`).

## Known gaps
- `index.html` not yet in the repo (step 1).
- Gate is MANUAL (in-browser `runTests()`); no headless runner yet (step 3).
- Partial reproducibility: terrain seeded, ecology / climate / mutation on raw `Math.random()`.

## Open decisions (Kevin's)
- North star: income / community / portfolio / love-of-it. Drives priority. Until set, the goal is harden + understand.
- Definition of "balanced" for the ecosystem (never-extinct over N ticks? persistent oscillation? stable bands?) - needed before the ecosystem tuning work.
