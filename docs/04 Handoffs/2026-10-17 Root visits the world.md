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
  `visit/enter.ps1` (`npm run visit`) starts relay + a dedicated dev server on port 5181, opens the page, and runs
  `claude` from `~/root/visits` with `--setting-sources user --strict-mcp-config --tools= --allowedTools mcp__door`
  + `visit/visit-prompt.md`. Verified: the tool list is exactly the 8 door tools, and `--setting-sources user` keeps
  Root's global identity while dropping `~/CLAUDE.md` (the phone bridge's rules, an ancestor of `~/root/visits`).

## Third pass, same day: "Call Root" (owner ask: "the game functions as normal, then when it is selected you join")
This supersedes the `?visit` page, the shared `world.json`, and `visit/enter.ps1` described above (all removed):
- `npm run dev` starts the relay too (dev-only `visitRelay` plugin in `vite.config.js`; skipped under Vitest, which
  also runs Vite in serve mode and would otherwise never exit). If a relay already holds 7796 the new one bows out.
- On a page served from localhost/127.0.0.1 with a relay answering, `bootVisit` adds a toggle in the top bar, left of
  the Viewer/Developer switch: Call Root / Root is on the way / Send Root home / Root is leaving. The public site never
  probes the local network (no browser local-network prompt for visitors).
- Call Root: the relay launches `claude -p` (the real `claude.exe` behind the npm shim, no shell) with
  `--setting-sources user --strict-mcp-config --tools= --allowedTools mcp__door` and `visit-prompt.md`; transcript to
  `~/root/visits/<stamp>.session.jsonl`. `VISIT_MODEL` / `VISIT_MINUTES` / `VISIT_ROOT` override for rehearsals.
- Root joins the world ON SCREEN. While Root is here the speed is capped at 6 and restored on leaving; seasons are no
  longer forced on (the game stays the game).
- Send Root home: Root's next results say Kevin asked it to head home; only say, note and leave work; if it has not
  left within 3 minutes the session is ended (taskkill /T). Pressed during startup, it simply stops the session.
- Per-world memory replaces the shared world: `~/root/visits/worlds/s<seed>-<W>x<H>.json` holds Root's names,
  plantings, footsteps and position for that world. A world run again from the same seed keeps the names (terrain is
  seeded) but drops plantings and footsteps (`adoptWorldState`, tested). If Kevin starts a new world mid-visit, Root is
  told the world dissolved and re-formed, and gets that world's memory.
- A session that ends without `leave` is noticed by the page's status poll: speed restored, memory saved.
- Rehearsal (scratch `VISIT_ROOT`, `VISIT_MODEL=haiku`, 3-minute visit, real page): toggle appears; arrival 3.5s after
  the click; speed 60 -> 6 -> 60; Root answered Kevin, walked, planted; Send Root home -> goodbye + field note in 7s;
  per-world file written; real `~/root` record untouched.

## Also fixed (found while testing)
The intro's Space/Enter key listener stayed registered after the intro was dismissed by click, so it ate Space and
Enter page-wide (a typed space in any input, and likely Space-to-pause after clicking Start). `introKey` now removes
itself once the overlay is dismissing.

## Bug hunt (second pass, same day)
A critic review plus a hostile re-read. Fixed:
- Relay accepted any browser origin: a website could inject "Kevin says" into Root's context. Now Origin must be the
  visit page (port 5181), Host must be 127.0.0.1/localhost:7796, POSTs must be JSON (forces a preflight).
- Root loaded `~/CLAUDE.md` (bridge rules) as an ancestor file. Fixed with `--setting-sources user`.
- A dead session's visit stayed open; each door process now carries a session id and a new one arrives fresh.
- Two tabs fought over the poll and a stale tab could overwrite the world: the newest page (by `/page/load`) owns the
  world; older tabs get 409 and stand down.
- A failed load (relay down, unreadable file, import that did not take) fell through to a fresh world that the autosave
  then wrote over the real one. Only a clean 404 starts a new world; anything else refuses to save.
- One throw in the page's action loop stalled every later call; the loop now catches per action.
- An action the page had taken but answered late was reported "page down", so Root would retry it (walk twice). Taken
  actions now get 60s more; a closed poll socket is dropped instead of being handed an action.
- Planted-plant tracking matched by id alone, which a load can reuse. Plants carry `byRoot` and match on id + tile.
- A point was worded from Root's position at click time; it is now worded when Root hears it, with its age. Typed
  lines carry their age too.
- Concurrent or abandoned `listen` calls shared one wake slot; now a set.
- No hard stop at the visit limit: 5 minutes past it, only say, note and leave work.
- Plant budget reset on page reload instead of on arrival; saves stopped after Root left; field-note title could
  break the markdown header; non-ASCII bodies could split across chunks; a damaged notes line blocked arrival;
  Windows rename-onto-open-file during a load. All fixed.
- Shift+double-click reset the zoom; the seasons checkbox did not show seasons as on. Fixed.
Not fixed, deliberately: the save format does not carry active vents (true for every world, not the visit's), and the
season clock jumps once on a fresh world's first reload.

Added for Kevin: a faint footprint trail, minutes left in the panel header, "the world has run N ticks since you left"
on arrival, Root stepping to the nearest ground (not the centre) if the sea took its tile, and a collapsed "how this
works" guide in the panel.

## Verification
- `src/visit.test.js`: 14 tests (added: trail cap, nearest-ground arrival, time away, id-reuse imposter) (sight square exact, creature one tile outside sight unseen, stride clamp, sea stops,
  steep stops, bad direction, arrival on land, planting into real flora + seed limit + no water, naming, pointing).
- Rehearsal against a scratch `VISIT_ROOT`, real page in Playwright: door driven over stdio (arrive, look, walk, name,
  plant, say, note, hear the owner's typed line and Shift+click point, leave -> world saved, field note written to
  scratch only); page reload restores the saved world; a headless `claude -p` with the launcher's flags looked, spoke
  and heard the owner. Real `~/root` record untouched.
- Second rehearsal (scratch `VISIT_ROOT`, port 5181): foreign Origin 403, text/plain 415, spoofed Host 403; a second
  tab retires the first; a point is worded at delivery; a new door process arrives fresh and logs the old visit
  abandoned; the help panel renders collapsed by default.
- Full gate: see STATUS.

## Not done, deliberately
- The world lives only while the page is open (browser-owned sim). A world that runs while nobody watches would need
  a server-side sim; not built until a visit shows it is wanted.
- Not in the orrery. The planet screen there runs its own random world; putting Root on it is a later step.
- No phone path. A visit is a desktop act: the owner watches the page and calls Root in from it.
- First-visit worlds are young (tick ~800 when land reaches 30%), so life is sparse on arrival.
