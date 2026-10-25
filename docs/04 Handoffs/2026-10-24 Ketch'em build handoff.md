# 2026-10-24 - Ketch'em: the build handoff (all chunks, one campaign)

Owner ruling 2026-10-24: "I want to build it all in one go." This handoff is the self-contained brief for that
campaign. It assumes nothing from the design conversation: the two design files hold every decision, this file holds
the order of work, the architecture, the gates and the defaults for the few items the owner left open.

## 0. Read first, in this order
1. `STATUS.md` (current truth).
2. `docs/01 Design/Ketch'em.md`: the owner's spec and rulings, verbatim, in the order received. His words win over
   anything else, including the mechanics file, if they ever disagree.
3. `docs/01 Design/Ketch'em Mechanics.md`: 22 sections of tables. Every number the build needs is there. Do not
   invent a number; if one is missing, pick the simplest and record it in the mechanics file under the section.
4. `docs/04 Handoffs/2026-10-23 Root modes - Visitor, Shaper, Sky.md`: how a Root mode is wired (modes registry,
   briefs, door, relay allowlist, launch card, per-world memory, rehearsal protocol). Ketch'em is a fourth mode.
5. `docs/02 Code/CodeMap.md` for navigation; `docs/02 Code/Engineering Lessons.md` for the gotchas.

## 1. The contract
Goal: Ketch'em as a playable co-op game inside Worldbuilder: Kevin on keys, Root through the door, one shared fogged
world, saves. Everything in the mechanics file, sections 1-22.
Constraints: the tuned ecology stays measurably the same when no Ketch'em feature is on the map; the public Pages
build must still work (local-only Root features stay local; saves must work on Pages via IndexedDB); no em dashes,
no emojis, no exclamation marks in UI copy; timestamps local with offset; YAGNI inside each chunk.
Acceptance: the gate (`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`) green; the balance harness
within tolerance after every sim change; each chunk rehearsed against a scratch `VISIT_ROOT` with the real `~/root`
untouched; a final end-to-end rehearsal of a two-player session with a real model as Root.

## 2. Defaults for the items the owner left open (overturnable by him, say so when reporting)
- Widen the sim species key with light and height buckets so every elemental type can evolve: YES (names only; no
  balance effect; re-check that the speciation registry and Chronicle still read).
- Board generation runs live in a Worker behind a progress bar; pre-baked boards only if a 96x96 continent takes
  longer than 20 seconds on this machine (measure and record).
- Stone naming: Amber / Geode / Obsidian; the book is the Almanac; generic word "stone"; the box is the Cabinet.
- Ability strength multiplier on price: flat 1.4 per ability (mechanics 5.7).

## 3. Architecture
Keep the mode in its own folder so the game stays readable and the sim stays the sim.

| piece | path | nature |
|---|---|---|
| mode registry | `visit/modes.mjs` | add `ketchem`: label, blurb, brief, tools (mechanics: Root's verbs + save) |
| brief | `visit/briefs/ketchem.md` | Root's rules of the game, terse; the sense code gains the Ketch'em lines (level tags, rings as numbers, signposts, stores `S`, roads `=`) |
| relay | `visit/relay.mjs` | `/page/save` mirror to `~/root/ketchem/slots/`, `/page/slots` list; otherwise unchanged |
| sim changes | `src/sim.js` | `prefElev` (17), `road` layer hooks (13), species key widened (20.3), `maxLandCap` as a settable, an "ecology off" genesis flag, `seedFaunaGroup` reuse for the full-board seed. Each one small, each measured |
| pure rules | `src/ketchem/rules.js` | elementalType, levelOf, abilitiesOf (with the genome hash), priceOf, oddsOf, rarity; ALL pure, ALL gate-tested against the worked examples in the mechanics file |
| board | `src/ketchem/board.js` | settings, headless genesis driver, freeze, life seed, stores per quadrant, roads (A* with the cost table, bridges, meander noise, spurs), signposts, landmarks. Pure where possible; the Worker wraps it |
| fog | `src/ketchem/fog.js` | packed bits, reveal from sight squares, store/road reveal rules |
| encounter | `src/ketchem/encounter.js` | awareness machine, pulses, bait, throw resolution, attack, follower, stalkers. Pure core over sim arrays + mode state; tested with the hand-built 32x32 world like `visit.test.js` |
| market | `src/ketchem/market.js` | stores, stock and restock, buy / sell / cabinet / give, potions, pens (later) |
| growth | `src/ketchem/growth.js` | XP sources, growth level, genome moves, evolution (species key change) |
| save | `src/ketchem/save.js` | schema v1, IndexedDB, export/import, mirror, migrations list |
| controls | `src/ketchem/controls.js` | keyboard and mouse for Kevin, the stride budget, target cycling |
| render | `src/ketchem/render.js` | fog, roads, bridges, stores, signposts, tags, rings, pulses, animations table (9b), party row, HUD, store panel, Almanac panel |
| Root's side | `src/visit.js` | the `ketchem` branch of `arriveHere` / `pump` / `visitDraw`: Root's character is a second player in the same state; verbs map onto encounter/market/growth; looks gain the Ketch'em lines |
| tests | `src/ketchem/*.test.js` | one per pure module; the worked examples in the mechanics file are the fixtures |

State lives in one object, `K`, owned by the page (the browser owns the sim), serialised by `save.js`. Root reads and
writes it only through door verbs handled in `pump`.

## 4. Order of work and the gate after each
Build in this order; each step ends with the gate green, a rehearsal, a STATUS line and a commit. Do not start the
next step on a red gate.

| step | builds | acceptance |
|---|---|---|
| 1 | sim: `prefElev`, road hooks, species key widened, land cap settable, ecology-off genesis | `npm run measure` (harness) within 3 points of the C2 baseline on extinction and carnivore persistence with NO roads on the map; with the height weight at 0.25. If out, drop to 0.15 and re-measure; record both in the Ecosystem Tuning Log |
| 2 | rules.js | every worked example in mechanics 4, 5, 10 reproduced by a test; odds table pinned |
| 3 | board.js + fog.js + render of fog/roads/stores/signposts | a Continent, an Archipelago and a Highlands board each generate in under the budget; every store on the road; an island store reached by bridge in at least one of 20 seeds; no road over mountain; screenshots |
| 4 | controls.js + boats + Kevin's character; the Ketch'em launch card entry; mode plumbing for Root (arrive at a different store, look with the new lines) | Kevin walks, rides a boat, reads a signpost; Root arrives at its store and walks; fog clears for both; two-player rehearsal with a scripted door |
| 5 | save.js | save, reload the page, load: identical world (snapshot diff), fog, players; export/import round-trip; mirror file present under scratch VISIT_ROOT; a newer-version save refused |
| 6 | encounter.js: awareness, pulses, bait (all five), throw, attack, follower, stalkers; animations | scripted rehearsal: a grazer caught with Amber; a predator growls, pulses, and attacks after a failed Geode; stake recovered by a catch; a knock-down releases the party wild at the spot; corral bonus applied with both players adjacent |
| 7 | market.js: stores, stock, buy/sell/cabinet/give, potions, the Almanac with nicknames | sell prices match the worked examples; restock at 2,000 ticks; Slumber shortens by level; Homeward returns to the nearest discovered store |
| 8 | growth.js: XP, growth levels, genome moves, evolution | a fed creature crosses a bucket edge and the Almanac opens a linked entry; bred-later hook left as a function |
| 9 | pens (Breeder) | two parents, fee, offspring in the cabinet with mixed genome |
| 10 | polish: HUD, party row drawings, store panel, Almanac panel, sounds deferred | an owner playtest |

## 5. Rehearsal protocol (unchanged from the modes handoff)
Stop the keepalive's relay (kill the process on 7796), start one with `VISIT_ROOT=<scratch>` and `VISIT_MODEL=haiku`,
drive the page from the scratchpad with Taipan's Playwright and the door over stdio for scripted runs, press Begin
through the launch card for a real-model run, then kill the scratch relay and confirm the keepalive restored the real
one (its log names `C:\Users\KevinReilly\root\visits`). Never run a rehearsal against the real record.

## 6. Session hygiene for a long campaign
- Each step above is a natural `/wrap` point: update STATUS, append to this handoff's "Progress" section below,
  commit. Clear the window between steps; the docs resume you.
- Delegate mechanical slices to `builder` with a spec that names the mechanics section and the test fixture; run
  `critic` on encounter.js, save.js and every sim change before integrating.
- Route the hardest calls up: the A* cost tuning if roads look wrong, the harness verdict if it is borderline.
- Pushing main deploys to Pages. Push only at a step boundary with the gate green, and only when the Pages build
  still behaves for a visitor (the launch card and Root stay local; Ketch'em single-player on Pages is allowed to
  exist but is not a goal of this campaign).

## 7. Not in this campaign
Sounds (one click, one burst, one growl later), items beyond the potion table, a second human player, Root on the
public site, trading between saves.

## Progress
(append one line per step: date, step, gate verdict, commit)
- 2026-10-24 · step 1 (sim: prefElev + hRng stream, road layer + three hooks, species key and name widened to light and height, CFG knobs, harness --elevw) · gate GREEN (96/96, lint 0 errors, build) · harness: elevw 0 byte-identical to C2; 0.25 / 0.15 / 0.05 all out of tolerance (Tuning Log) · **shipped faunaElevWeight 0, a changed default for the owner** · section 2 default 1 (widen the key) taken as YES; maxLandCap / ecoActive already existed as settables · commit: see git log
  Critic (Sonnet): no blocker; noted for step 3: `seedLifeAt` and Root's `plant` verb can still put flora on a road tile (only the three ecology hooks honour it), and flora already standing on a tile that becomes road is not removed; the board builder must clear and guard those.
- 2026-10-24 · step 2 (`src/ketchem/rules.js` + `rules.test.js`: elementalType, rarity, levelOf, genomeHash + abilitiesOf, priceOf, oddsOf, cardOf; no sim import) · gate GREEN (133/133 full suite + rules 38/38 after critic fixes, lint 0 errors, build) · mechanics corrected: price row 6 is 10,274; the second-ability hash runs over the SPECIES buckets (sim speciesKey), not the individual's exact genome, so 5.2's "same for every member of a species" holds; growl -10 added to the sec. 8 table · handoff default 4 (flat 1.4 per ability) taken · commit: see git log
  Critic (Sonnet): growl missing from oddsOf (fixed), hash contradicted 5.2 (fixed as above), fallbacks for missing maxAge / maxEnergy now mirror visit.js creatureCode, table lookups guarded with Object.hasOwn. For later steps: `oddsOf` answers for a fled creature too; the encounter machine must refuse the throw.
- 2026-10-24 · step 3 (`src/ketchem/board.js` + `fog.js` + `render.js` + `board.worker.js`, two `drawWorld` hooks, `?ketchem=` boot path and `window.__wb.ketchem` in main.js, `scripts/ketchem-boards.mjs`; sim: `landCoverage` cached per genesis loop and `computeAridity` / `computeWaterDist` on index queues, byte-identical by fingerprint and by the harness; `seedLifeAt` and Root's `plant` refuse road tiles; flora cleared off roads and around stores at build) · gate GREEN (typecheck, lint 0 errors, full suite incl. 16 board tests, build) · harness = C2 baseline exactly · budget: continent mean 13.2 s / worst 19.3 s (10 seeds), archipelago at 45-60% land mean 11.4 s / worst 23.5 s under load (20 seeds, **9 island-store boards** by the sea-only metric), highlands mean 14.7 s (10 seeds; standalone 95% land 17-19 s): live generation, no pre-baked boards · **changed default for the owner: Archipelago land 45-60%, not 60-75%** (mechanics 15.1 note) · screenshots in `docs/04 Handoffs/img/2026-10-24-ketchem-step3/` · commit: see git log
  Spec readings recorded in the mechanics file (14.3-14.6, 15.1, 15.2, 16). Caught by the tests before shipping: a per-branch signpost search leaked diagonally into the next branch (8-connected roads), and a store revealed by the road rule counted as a road sighting for the next store, cascading reveals across the map. Open for step 4: the Hand is still on under fog; the fog is shared but nothing moves yet; store names are `<Biome> <Post>` with Post rotating by store index; signposts at a doorstep with only spurs beyond read empty (tooltip says "no stores this way").
- 2026-10-25 · step 6 (`src/ketchem/encounter.js` + `encounter.test.js`: awareness machine, baits (all five), throws with the wobble rule, the predator's pulses and attack, knock-down and release, followers, stalkers, corrals, the Almanac's seen / caught / nickname; `drawEncounters` (tags, rings, skull, baits, follower, throw / pulse / dust / attack effects, HUD line); Kevin's Tab / click / Space / 1-3 / B / F / N / E-pick; Root's pick / bait / throw / name / follow / recall with the 48-tick result delay; sim `held` flag; saves carry encounters and baits) · gate: see below · rehearsal (scratch relay, live page, scripted door): Kevin targeted and caught a grazer with Amber (party 1, Amber 9), named it "Pip, Hopper", let it follow; a hungry carnivore beside him growled with 2 pulses; a pinned-miss Geode brought the attack and "Pip" was taken; E picked a plant and B P D set it as bait; Root arrived, read `H 1E young fed L5 Ember 35%`, threw an Amber (result 5.1 s later), caught it, named it "Tam"; no page errors · readings in the mechanics note before section 12 · commit: see git log
  Critic (Sonnet), 7 blockers + 15 risks and nits; the blockers and the cheap risks taken: a creature walking to bait around a lake was held forever -> it gives up when no step brings it closer; the awareness machine ran on bait walkers (alert while feeding, odds wrong) -> a creature bound to a bait is calm until the bait is done; Root's knock-down teleport was overwritten by its next action and tick-driven attacks told nobody -> the body follows a `moved` flag and `K.news` carries the attack line to the next result (Kevin's bubble); released and bolting creatures could land on water or a bridge and be deleted by the sim -> a creature's `walkable` excludes water and bridges, and a release lands on the nearest ground; the follower corral lifted Obsidian below 100 and Amber on L10 above 0 -> only odds strictly between 0 and 100; Root's party, stones and wallet died with every departure -> `K.root` stays, marked `away`; a failed throw ignored the 50-tick cooldown -> honoured; a failed throw on a stake now gets the stake eaten (sec. 7); payload returns respect the party cap; the first pulse now fires the tick after the growl so N pulses span 10N ticks; wary creatures behave as alert; stalkers stop at stores; the growl reads the target player's abilities; party abilities computed once per tick; effects and baits hidden under fog; Space / F / N / B ignore key auto-repeat; a target that moved off yields to the nearest adjacent creature; the tooltip no longer counts sightings; `naming`, `hardyAt`, `nextId` saved and a saved growl loads as alert. Left as is and noted in the mechanics file: the corral's bolt block, the animation ordering (caught vanishes at the throw, bolt before burst), the sim's id counter after a load, a creature-level `fled` shared by both players, the wobble's second draw, drawEncounters' per-frame cost (within 4 tiles only).
- 2026-10-25 · step 5 (`src/ketchem/save.js` + `save.test.js`: schema v1 with cfg, board and vents; migrations; version refusal; base64; IndexedDB slots; `menu.js` for F9; `saveGame` / `loadGame` / `adoptBoard` / autosave / `beforeunload` in main.js; `mirrorSave` in visit.js; relay `/page/save` and `/page/slots`; sim `applySnapshot` replays initWorld's draw order so a loaded world is identical) · gate GREEN (typecheck, lint 0 errors / 30 warnings, 168/168 in 91 s, build) · rehearsal (scratch relay, headless Chromium): F5 named and saved a 1 MB record, the F9 menu on a fresh page listed and loaded it, and the grid, elevation, rivers, roads, fog, stores, players, flora, fauna and ticks were identical to the record (temperature and aridity differ on a few tiles until the next 20-tick climate refresh); an exported record re-imports to the same bytes; a v99 record is refused with its message; the mirror file sat in the scratch record's `ketchem/slots` with the same meta; no page errors · commit: see git log
  Critic (Sonnet), 1 blocker + 9 risks + 3 nits, all but three taken: the autosave clock advanced only after a successful write, so a slow or failed write rebuilt and retried a 1 MB save every loop tick -> the clock and a busy flag are set before the write; the menu put the seed and ticks into innerHTML unescaped (stored XSS through an imported file) -> escaped, wallets shown; F5 with a slider focused reloaded the page without saving -> F5 / F9 blur the field and act; a damaged file could replace the world halfway through a load -> every byte field is decoded and length-checked before the sim is touched; slot names the relay refused stayed "not mirrored" -> one sanitiser on the page and on import; `ringDone`, uplift cooldowns, hill decay and biome stability were missing from the record (the first tick after a load re-ran uplift) -> carried; the IndexedDB transaction had no abort handler and leaked on a synchronous throw -> handled; deleting the slot you play kept autosaving it back -> cleared; a loaded game without a Root record left Root at (-1,-1) -> back to its doorstep; the §18 note understated the residual climate difference -> reworded. Left as is: the sim's loader reseeds only the terrain stream (pre-existing; only the instant of a load is reproducible), case-insensitive mirror file names on Windows, and the launch-card load / wallets list (F9 menu does it; polish step).
- 2026-10-25 · step 4 (`src/ketchem/controls.js` + `controls.test.js`: stride table as a budget, held keys on the loop, Shift stride, boats, E to read, Root's leg / route walk, look lines; `drawPlayers`; `perceive(st, K)`; the `ketchem` branch of `arriveHere` / `pump`; the launch card's board row and build-then-summon; the `ketchem` mode + brief; `ketchemKey` / `kevinHeld` / `kevinCamera` in main.js; Hand rail hidden on a board; junctions by orthogonal neighbour groups) · gate GREEN (see STATUS for the count) · rehearsal: scripted two-player run on the scratch relay (Kevin walks / boats / reads, Root arrives at its store, walks, leaves with an "(as Ketch'em)" note; fog grows for both; no page errors; the keepalive restored the real relay afterwards, log 13:17 Pacific names `C:\Users\KevinReilly\root\visits`) · readings in mechanics 12 and 22.4 notes · commit: see git log
  Open for step 5+: Root's and Kevin's positions, the fog and `K.root` must ride in the save; Root's visit state is keyed by world (seed + size) as before, so a board re-rolled to seed + 1 is a different key; the `(boat)` marker on a leg; Kevin's E on a store says "opens in a later step".
  Critic (Sonnet), 2 blockers + 13 risks + 2 nits, all but one taken: the launch card's board row never hid (an author `display:flex` beat the `hidden` attribute) -> a `[hidden]` rule; R during a visit reset the world under Root and every look threw -> R is the game's on a board, and a board that vanishes turns Root back into a visitor on ground with a line saying so; the arrival's world key is re-read once the board lands; a tap moved two tiles (keydown plus the loop) -> the loop repeats only from the second tick and `e.repeat` is ignored; Ctrl / Alt / Meta chords, Tab, Enter and F-keys pass through; `K.root` and the camera clear on leave; an abandoned build tells its caller; the body class clears when a build starts; a road over a lake is a bridge, not a block; steep ground always stops a route; the bubble flips below the dot near the top edge; a stale stored board setting falls back to continent; the game no longer slows the sim to the visit speed (both players in real time). Left as is: zooming in while standing still does not recentre (the next step does). The critic also rebuilt 11 boards and found every road tile walkable and every store reachable on foot from Kevin's start.
  Critic (Sonnet), step 3: 1 blocker + 5 risks + 3 nits, all taken: the island-store acceptance was being counted with mountains as barriers (a ridge-split landmass with a 1-tile water hop read as an island; 0 of 20 real islands) -> `landmassMap` now divides by sea alone, and the archipelago land target moved to 45-60% because the sim's coastal spread merges every store-sized island by 60-65% land (curve in mechanics 15.1); a failed link always re-picked the pair's second store -> now the store on the smaller landmass; a Hand mark made during the build could undo the board away -> `godCancelMark(null)` on arrival; a scenario warm-up could seed life into the board -> cleared in `startKetchem`; the hero boot's speed 60 carried over -> 18; a spur cut at 25 tiles could end on a bridge -> trimmed to land; the chronicle named all four stores -> only the two starts; heuristic nudged under the diagonal step cost; the fog cache no longer crosses the Worker. The critic also re-proved the sim speedups byte-identical on non-square grids. Untested path left: a re-pick that moves a store (the survey reports `repicks`; none occurred in 60 boards at the old land range).
