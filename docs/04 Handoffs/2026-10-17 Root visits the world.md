# 2026-10-17 - Root visits the world

## Why
Owner ask (2026-10-17): could the AI itself, Root, not a scripted character, "port in" and act with agency inside the
world's rules, as "a space a person could physically interact with an AI agent". Owner ruling the same night: build it.
Design positions agreed in conversation:
- Root sees only a few tiles around itself; the owner sees the whole map from above (the asymmetry is the point).
- No designed motive or goal. Root gets a body, senses and a record; what it chooses to do is the observation.
- Root's stamina is its real token cost, not an invented hunger meter.
- No cheating: during a visit the world reaches Root only through the door's tools.

## What it is (three pieces)
- `src/visit.js` - pure cores, DOM-free and gate-tested in `src/visit.test.js`: `perceive` (a 9x9 ground grid + a life
  grid + creatures/plants/names in sight, as compact text), `walkFrom` (1-3 tiles; ocean, coast, lakes, the edge and
  active vents block; mountain/glacier/volcanic stop you after one step), `plantAt` (a real `makeFlora` into `flora`,
  5 per visit, tracked by id so Root can learn later whether its plantings lived), `namePlace` (persists, also a
  Chronicle line), `pointText` (the owner pointing: exact in sight, a bearing beyond it), `arrivalText`.
  Plus the browser shell `bootVisit`/`visitDraw`, active only on `?visit`: loads the shared world from the relay (or
  waits for a fresh hero world to reach 30% land), turns seasons on, slows the sim to speed 6, draws Root (amber dot),
  its sight square, named places and speech, and adds a chat panel (bottom right; Shift+click the map to point).
- `visit/relay.mjs` - zero-dep Node mailbox on 127.0.0.1:7796. Queues Root's actions for the page (long-poll), carries
  results back, holds what the owner said, times the visit (`VISIT_MINUTES`, default 20). Root's record lives OUTSIDE
  this repo under `~/root/visits/`: `world.json` (snapshot + Root's state), `notes.jsonl`, one `<stamp>.jsonl` log per
  visit. `leave` appends the field note to `~/root/field-notes/field-notes.md`. `VISIT_ROOT` redirects all of it to a
  scratch folder for rehearsals.
- `visit/door.mjs` - zero-dep stdio MCP server with 8 tools: look, walk, plant, name_place, say, listen, note, leave.
  `visit/enter.ps1` (`npm run visit`) starts relay + dev server, opens the page, and runs `claude` from `~/root/visits`
  with `--strict-mcp-config --tools= --allowedTools mcp__door` + `visit/visit-prompt.md`. Verified: under those
  flags the session's tool list is exactly the 8 door tools.

## Also fixed (found while testing)
The intro's Space/Enter key listener stayed registered after the intro was dismissed by click, so it ate Space and
Enter page-wide (a typed space in any input, and likely Space-to-pause after clicking Start). `introKey` now removes
itself once the overlay is dismissing.

## Verification
- `src/visit.test.js`: 10 tests (sight square exact, creature one tile outside sight unseen, stride clamp, sea stops,
  steep stops, bad direction, arrival on land, planting into real flora + seed limit + no water, naming, pointing).
- Rehearsal against a scratch `VISIT_ROOT`, real page in Playwright: door driven over stdio (arrive, look, walk, name,
  plant, say, note, hear the owner's typed line and Shift+click point, leave -> world saved, field note written to
  scratch only); page reload restores the saved world; a headless `claude -p` with the launcher's flags looked, spoke
  and heard the owner. Real `~/root` record untouched.
- Full gate: see STATUS.

## Not done, deliberately
- The world lives only while the page is open (browser-owned sim). A world that runs while nobody watches would need
  a server-side sim; not built until a visit shows it is wanted.
- Not in the orrery. The planet screen there runs its own random world; putting Root on it is a later step.
- No phone path. A visit is a desktop act: the owner watches the page and Root runs in a terminal.
- First-visit worlds are young (tick ~800 when land reaches 30%), so life is sparse on arrival.
