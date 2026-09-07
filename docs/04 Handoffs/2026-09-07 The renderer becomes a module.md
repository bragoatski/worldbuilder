# 2026-09-07 - The renderer becomes a module

## Why
The owner asked for a live Worldbuilder world on a curved screen in the ops dashboard's 3D orrery: a new
random world on a 98x96 grid, land at 70% of its slider, coastal growth, volcanoes and speed all at the
top, every setting jittered a little. The orrery must run the REAL simulation, not a copy, so the only
change here is making Worldbuilder's renderer callable from somewhere other than this page.

## What changed (browser shell + one signature; the simulation is untouched)
- `src/render.js` (new): `drawWorld(ctx, PIX, {overlayMode, followId})` and `drawRivers(ctx, PIX)`, moved
  verbatim out of `main.js`. Reads sim.js live bindings; draws into any 2D context (a page canvas, an
  OffscreenCanvas in a worker). `RIVER_COLOR` / `LAKE_COLOR` moved with them.
- `src/main.js`: `draw()` is now `drawWorld(ctx,PIX,{overlayMode,followId})` followed by the HUD/panel
  calls it always made; the now-unused imports were pruned. Pixels are identical.
- `src/sim.js`: `setWorldSize(w, h)`; `h` defaults to `w`, so every existing caller is unchanged. The
  arrays were already sized `W*H` with `x%W` / `(i/W)|0` throughout; nothing assumed a square grid.

## Consumer (lives in the ops-dashboard repo, not here)
`server.js` serves `src/sim.js` and `src/render.js` under `/wb/` (allowlisted names, read-only,
no-store); `wb-worker.js` imports both in a module worker, applies the owner's settings, and posts
frames as ImageBitmaps onto a sphere patch in the orrery. If a future change here renames an export
that the worker uses (`setWorldSize`, `initWorld`, `step`, `CFG`, `W`, `H`, `tick`, `landCoverage`,
`_seed`, `drawWorld`), the orrery screen goes dark; nothing in this repo's gate would notice.

## Gate
typecheck, lint (0 errors; the 5 warnings are pre-existing unused catch params), build, and the full
vitest run: see the commit. Verified visually: the orrery screen renders the world with rivers, flora
and fauna exactly as the page does.

## Not done, deliberately
No headless mode, no export of the HUD, no changes to any slider or preset. The worker's parameter
jitter is the orrery's business and lives with it.
