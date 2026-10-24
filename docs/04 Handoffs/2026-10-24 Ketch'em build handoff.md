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
