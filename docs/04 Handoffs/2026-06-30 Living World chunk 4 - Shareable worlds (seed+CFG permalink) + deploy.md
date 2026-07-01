# 2026-06-30 - Living World chunk 4: Shareable worlds (seed + CFG permalink) + deploy

Self-contained handoff. Read STATUS.md for current truth and `docs/01 Design/Living World Roadmap.md` for the
direction + chunk sequence. Prior handoff: `2026-06-30 Living World chunk 3 - God powers (land brush + meteor drought bloom) + deploy.md`.

## The direction (unchanged)
Worldbuilder's moat is the SIMULATION. The roadmap AMPLIFIES it: (1) deepen the living-world sim + make its
evolution VISIBLE, (2) god-game agency, (3) shareable worlds. Per-chunk workflow: one large chunk -> full gate
-> docs -> commit -> deploy -> next-session prompt. Chunk 1 = the Chronicle; 2 = evolution visible; 3 = god
powers; chunk 4 (this one) = SHAREABLE WORLDS (thread 3).

## What shipped: chunk 4 = shareable worlds (thread 3)
A world is a shareable LINK. The key insight: a world is fully determined at GENESIS by its **seed + config** -
terrain and ecology are deterministic from the seeded RNG streams, and the `WORLD` meta is re-derived from the
seed by `pickWorldMeta`. So a compact "world code" of `{ v, seed, preset, cfg-diff-from-default }` reproduces the
same world when replayed, far smaller than the baked `wb-eco-1` JSON snapshot (which stays the download path for
an exact evolved state). Encoded into a `?w=` URL param, a world becomes a permalink. All new code is defined in
`src/main.js` between `importJSON` and the HUD section; a new "Share" deck seg (`index.html`) wires the buttons.

- **`buildWorldCode()`** (pure) - the current world's recipe. `cfg` holds only keys that DIFFER from
  `DEFAULT_CFG`, MINUS the derived elevation keys (`clusterSpikeRate`/`clusterPlusChance`/`mountainAdjUpliftProb`/
  `hillAdjUpliftProb`/`rareSurgeProb`), which `applyElevationIntensity` recomputes from `elevationIntensity` on
  every `initWorld`. So a default world encodes to an EMPTY diff (minimal URL) and a tuned one carries just its
  deltas + `elevationIntensity`, not its derivatives.
- **`applyWorldCode(data)`** (pure) - reset CFG to defaults, layer the diff (KNOWN keys + MATCHING type only -
  the code is untrusted URL input), restore the preset label, then `initWorld(seed)`. Throws on a malformed /
  unsupported-version / seedless code. Leaves DOM sync to the caller (mirrors the `initWorld`/`init` split).
- **`encodeWorldCode` / `decodeWorldCode`** - URL-safe base64 codec (btoa/atob; `+/`->`-_`, strip `=`). ASCII
  only (numeric CFG values + short preset names). `worldPermalink()` = `origin + pathname + '?w=' + code`.
- **Boot restore** - `init()` consumes a `?w=` param ONCE (`_pendingWorldCode`, captured at module load): on the
  first `init()` it applies the code + syncs the UI (seed input, preset dropdown, sliders) + notes the
  Chronicle, then returns; a later preset change / reset rolls a FRESH world (the one-shot guard is why the
  permalink does not re-trigger on every `init()`). A malformed code shows an error and falls through to a
  normal world.
- **Share deck seg** (index.html, after Data): **Copy Link** (`copyWorldLink` -> clipboard + `history.replaceState`
  so the address bar reflects the world for a manual bookmark, button flashes "link copied") and **Postcard**
  (`copyPostcard` -> `worldPostcard()`: a Chronicle-driven blurb - seed + preset, tick + land% + flora/herb/carn,
  biggest + oldest named creature, up to 3 recent story beats, and the permalink). No exclamation marks (UI rule).

## Why it is balance-safe (no harness A/B needed)
Kevin flagged this in the prompt: no `step()` changes -> like chunks 1-2, no A/B. Verified by construction: the
only sim mutation is `applyWorldCode` -> `initWorld`, the SAME re-genesis path the preset selector already uses
(`applyPreset; init()`), and it runs only from boot / a button, NEVER inside `step()`. The measured `eRng`
ecology loop is byte-identical. (Same proof shape as chunk 3's god powers.)

## Gate (full, green)
`npm run typecheck` (clean) + `npm run lint` (0 errors; 32 warnings, +9 vs 23 - all the same warn-only legacy
patterns the codebase already carries: `hasOwnProperty` access + unused catch vars) + `npm test` (**22 tests**,
was 17; new "shareable worlds" block: recipe round-trips through encode/decode carrying only non-default CFG;
applying a code reproduces the same EVOLVING world twice; applyWorldCode resets to defaults before layering the
diff; malformed codes rejected + unknown/wrong-typed CFG keys ignored (untrusted input); the postcard names the
world + embeds a permalink) + `npm run build` (ok, bundle `index-BBeJNJbL.js`).
**Gate-blind (DOM):** the Copy Link / Postcard buttons + clipboard + address-bar reflection, and `init()`'s
`?w=` boot branch (reads `location.search` + `document`). The PURE cores they delegate to are gate-covered;
verify the wrapper in the live app - load a shared link and confirm it restores the same world.

## Live eyeball checklist (for Kevin, gate-blind)
1. Open the app, tune a preset / sliders, note the seed. Click **Copy Link** - the address bar should update to
   `...?w=...` and the button flash "link copied". Paste the link in a new tab: it should restore the SAME seed
   + settings (check the seed chip + preset dropdown + sliders), and playing it should evolve the same world.
2. Click **Postcard** and paste somewhere: a readable blurb with stats, a couple of recent Chronicle beats, and
   the link.
3. A normal load (no `?w=`) still rolls a fresh world; changing the preset after loading a link rolls fresh too.

## Concurrent-session note
`src/main.js` is shared across sessions. Working tree was clean at start (branch `ecology-balance`, one docs
commit `39f3b65` ahead of `main` == `7ed0da8`). Changes are additive (Share section + `init()` wrapper + Share
seg + tests); staged only my own paths. Check `git status` + mtime before editing if another session may be active.

## Deploy
Code `30f9117` + this docs commit. Deploy = ff `main` to the reviewed docs SHA (sweeping in the `39f3b65`
deploy-marker lead + the code + docs) + push; GitHub Pages CI builds + publishes. Live:
https://bragoatski.github.io/worldbuilder/

## NEXT (chunk 5): Scenarios + light objectives (pillar E)
A few starting setups + win-checks on top of the sandbox (Genesis, Ice Age, "keep 3 trophic levels alive N
ticks"). Depends on the Chronicle (done). See the roadmap for the remaining sequence (then speciation + trophic
depth - the harness-heavy chunks, last). Still-valid pre-roadmap backlog: fauna distribution as a MEASURED
ecology task; the optional sim-core file split.
