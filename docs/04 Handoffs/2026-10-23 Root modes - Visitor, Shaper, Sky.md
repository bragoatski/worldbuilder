# 2026-10-23 - Root modes: Visitor, Shaper, Sky

## Why
Owner, 2026-10-23, after rejecting four "internal action" bids (predict, watch, intent line, cairns): the general idea is
a Root MODE, many modes, each its own game, so the project is not limited to one version. The specific idea: Root is not
only a visitor; make it god in one mode (outside the map, shaping completely) and a shaper in another (the Hand in a
body with limited sight, living the changes). Ruling: "Build these 3 modes and an interface to begin them."
Root's prior objection (terraforming "blurs who is god") assumed one game; modes dissolve it, and it was withdrawn.

## What a mode is
A brief (what Root is told), a tool set (what it can do) and a way of seeing (what a look returns). Everything else
(door, relay, panel, record, per-world memory) is shared. `visit/modes.mjs` is the single registry: id, label, blurb
for the launch card, brief file, MCP tool definitions, door instructions. `toolsFor(id)` / `verbsFor(id)`.

| mode | sight | acts | look |
|---|---|---|---|
| **visitor** | 9x9 around the body | walk, plant, name_place, befriend (unchanged) | `perceive` |
| **shaper** | 9x9 around the body | visitor's, plus `shape` (raise/sink/rain/parch/warm/chill, r1-3), `ember`, `spring`, `seed`; each lands where Root stands or at a bearing in sight (`at: "2N1E"`) and returns a look | `perceive` |
| **sky** | the whole world, coarse | `survey`, `zoom x,y`, `shape` (r1-8), `ember`, `spring`, `seed`, `weather` (drought/bloom), `sea` (raise/lower), `name_place` at a tile; powers return words only | `survey` |

All three share guide, say, listen, note, leave. Field notes from shaper and sky are headed `title (as Shaper)` /
`(as Sky)`; a visitor's header is unchanged.

## How it is wired
- **Page (`src/visit.js`)**: Call Root opens a launch card (`launchCard`): three mode cards, the model select, Begin.
  Last mode and model remembered in localStorage. `/page/summon` carries `{model, mode}`. The relay's `arrive` carries
  the mode back (`arriveHere(mode)`), so the page follows the session that is actually running, including one another
  tab started (`/page/status.mode`). Panel status reads "Root is here as Shaper".
- **Pure cores (gate-tested)**: `tileAtBearing`, `shapeAt`, `emberAt`, `springAt`, `seedAt`, `weatherEvent`, `seaEvent`,
  `survey`, `gazeAt`; `namePlace(st, name, x, y)` now takes a tile; `pointText(..., mode)` words a point as a tile
  for the sky. Every power is the sim's own god power (`brushTerrainRaw` + `settleTerrain`, `brushClimateRaw` +
  `settleClimate`, `emberStrike`, `addSpring`, `seedLifeAt`, `droughtEvent`, `bloomEvent`, `shiftSeaLevel`), wrapped in
  `godMark()` so Kevin's Hand undo takes Root's act back; a power that did nothing (`springAt` on sea, `emberAt` off
  the map) cancels its mark. `main.js` passes `onGodMark: refreshUndoBtn` so the undo button wakes.
- **Survey**: at most `SKY_CELLS` (16) cells across; per cell the commonest biome glyph (`~` if a river runs through
  it) and a life digit 0-9 (plants + 3 per creature, log2) or the top creature's letter; a census head (tick, season,
  size, land %, plants, H/C/O/S/A, named species, cell size); a ruler of column starts; a `named` tail with tiles.
  About 1,000 characters on a 96x96 world. The sky's `st.x/st.y` is its gaze (last zoom), drawn as a dashed square.
- **Door (`visit/door.mjs`)**: reads `VISIT_MODE` (set in the MCP config `env` by the relay) and serves that mode's
  tools only; sends `mode` with every call.
- **Relay (`visit/relay.mjs`)**: `summon(model, mode)` composes the brief from `visit/briefs/common.md` +
  `<mode>.md` into `%TEMP%/root-brief-<mode>.md` at every launch (so a brief edit needs no relay restart), remembers
  `summonedMode`, and `door()` refuses any verb outside `verbsFor(summonedMode || door's mode)` with "nothing happens
  (... is not a thing a sky can do)", before any arrival. The old single `visit-prompt.md` is gone.
- **Sky arrival** waits for the world to exist (`grid && W > 0`), as the body waits for ground: on the first real Sky
  rehearsal, Begin pressed right after the intro threw on a grid that did not exist yet.

## Verification
- `src/visit.test.js`: 39 tests (21 before): bearings in/out of sight; raise crosses the coast and clamps the radius;
  sink drowns Root's own tile (and ground remains to step to); climate brushes leave the coast alone; meteor kill
  count; sea refusals for spring/seed; seeding words; drought/bloom/sea counts and bad-arg refusals; undo marks taken
  and cancelled; survey shape, census head, ruler, letter for a creature, under 1,200 chars; names by tile; zoom and
  gaze; sky point wording; the mode registry's tool sets; garbage coordinates never land on 0,0; diagonal bearings;
  arrival text by tile for the sky; the survey's name list capped; `modeOf` ignores prototype keys.
- Scripted rehearsal (scratch `VISIT_ROOT`, keepalive's page in headless Chromium, each mode's door driven over stdio
  with no model): launch card renders and closes; visitor refuses `shape` at the door; shaper raised, rained, seeded,
  sank its own tile and stood on new ground, meteor, spring; sky surveyed, zoomed, raised a hill at the centre, seeded,
  meteor, spring, bloom, sea rise, named a tile, refused `walk`, surveyed again (the hill now land with plants); three
  field notes with the right headers; undo button enabled afterwards; no page errors. Relay-level refusal checked by
  curl with a mismatched mode. Screenshots in the session scratchpad.
- Real-model rehearsals (haiku, scratch record, through the page's launch card): Sky arrived on an all-ocean fresh
  world, lowered the sea six times, zoomed, seeded plants, waited, seeded grazers (123k tokens in 2 minutes); Shaper
  arrived at a shore and raised a causeway east two strokes at a time (69k tokens). Both left properly on Send home.
- Gate: typecheck, lint (0 errors), build green; `npm test` run in full, see STATUS for the verdict.
- Real `~/root` record untouched (scratch relay replaced the keepalive's during rehearsal; keepalive restored the real
  one at 22:33 Pacific, log confirms `record in C:\Users\KevinReilly\root\visits`).

## Critic pass (Sonnet, adversarial, after the first rehearsal)
14 findings; fixed: the companion followed the sky's gaze (`visitTick` now skips sky); sky arrival loaded memory under
a stale key before the world existed (every arrival now waits for `grid` first); `a.x | 0` made a missing coordinate
tile 0,0 (`tileArg` requires whole numbers in the world); `modeOf('constructor')` passed (`Object.hasOwn`); `leave`
read `visit.mode` after an await that can null it; the sky's gaze was saved as the body's position (`saveState` keeps
`V.body` for sky); a drought that withered nothing spent the undo mark; a failed summon painted "coming"; `summonedMode`
was set before the spawn; `2NE` lost its E; radius 0 became 2; the survey's `named` tail was unbounded; the launch
card button did not toggle and keyboard radios did not highlight; the undo test never reached the cancel branch.
Accepted as is: the Hand's undo is single-level (sim design), so only Root's latest power is undoable and each Root
power displaces Kevin's earlier mark; a terrain brush over nothing but volcano cores still spends a mark; the ruler's
multi-digit column starts do not align glyph for glyph (it is a list of starts, as the brief says).

## Not done, deliberately
- No god-vs-god setting: Kevin keeps the Hand in every mode (owner question left open: watch only, or two gods).
- Sky `survey` has no elevation or climate layer; `zoom` is how it reads those. Add a layer only if a visit wants it.
- The visit log id is a minute stamp, so two visits begun in the same minute append to one log file (pre-existing).
- No cost comparison yet between modes; the Sky's survey is the largest single result (~1k chars) and is sent only
  on survey/listen.
- The Pages build still never shows the toggle (local-only, unchanged).

## Concurrent-session note
This session edited `src/visit.js`, `src/visit.test.js`, `src/main.js` (one hook line), `visit/*`, docs. The relay was
restarted; the keepalive owns it again. A relay code change still needs a relay restart (kill the process on 7796).
