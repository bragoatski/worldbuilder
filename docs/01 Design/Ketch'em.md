# Ketch'em (a Root mode) - design in progress

Status 2026-10-24: owner's spec received in five texts, mechanics under discussion, nothing built. Mode roadmap set
the same day: Ketch'em (with Breeder inside it), then Castaway, then Possess.

## Owner's spec (2026-10-24, near-verbatim, in order received)
- Catch creatures and name them. A level system for how hard they are to catch. Bait. An indicator when there is a
  catch (what the indicator is: to be discussed).
- The map is greyed or clouded out and slowly discovered.
- Four stores, randomly placed but spread out. Buy balls there. Collect money by catching species: sell animals
  back to the store; value from high stats, abilities, adaptation, level, other ways to be thought of. Buy more balls
  and, later, other items.
- Certain animals come with abilities that affect the player; the player can hold up to five.
- The player can pick plants and sell them; generally much less money than animals unless really rare.
- Carnivores are dangerous but expensive (valuable) if caught; mechanics to talk through.
- A road system between stores where the player travels faster: concrete colour, one block wide, may run diagonally
  touching at corners.
- "The player should be able to launch an equivalent character to play with you and we can uncover the map together
  and do all this stuff." Co-op: Kevin's own character beside Root's, same rules, shared fog.
- "For something like this good saves will need to be available." Saves are a requirement, more than one slot.
- Levels: keep the separation by trophic type, but give each type a range of three levels so there is variation
  within it. Creatures have stats already, so assign them a TYPE from those stats, Pokemon-style, and the closer a
  creature is to the ideal of its type, the higher its level. "Possibly."
- List all possible abilities, why, and how they are assigned.
- Ball tiers: liked. Boosting (abilities) and baiting: liked. Economy still to be worked out. Separate wallets.
- Roads: not always a loop or straight. Meandering at times, straight at others. Sometimes a loop, sometimes a
  line, but every store must be on the road. Sometimes just the three links, sometimes ten roads Y-ing off or a
  different connection to a different store.
- The board: always start with a full board; board settings may vary but generally more land, clumped or connected;
  the player can walk into water to travel between islands and a little boat appears under them.
- "Still lots more to work out."

## Owner rulings, round 3 (2026-10-24)
- Size, age and rarity DO move the level and the value. Rarity matters most, size helps.
- Add the height preference, but broad, so it has little effect on survival. (Animals currently have none;
  elevation reaches them only through temperature.)
- Keep the scientific species names. When a species is discovered, the catcher (Root or Kevin) gives it a short
  nickname that becomes its colloquial name for every member of the species.
- Party of THREE (correcting the earlier five). Each creature has ONE ability; some creatures, more often the
  higher their level, have two.
- A visual row in the panel showing a rendering of each animal held: wanted, if not too hard.
- Economy: balanced for fun right away, adjusted as we play.
- Land: any percentage above 60, higher more probable.
- Plan in detail: catching, the market (how it works, feels, looks), the abilities, and how stats, levels, bait and
  prices work mechanically.

## What a creature already carries (src/sim.js makeFauna)
type (herbivore / scavenger / omnivore / carnivore / apex), prefArid, prefTemp, prefSL (0-10 each), tolerance
(1.5-6), hue / sat / val, vivid, size (heritable, 1.0 founders), energy / maxEnergy, age / maxAge, gen (generations),
lineageId, species name (a pure function of the genome once the line is old enough), climate fit at its tile.
No elevation preference: elevation only lowers temperature (steeply above 6); mountains, glaciers and volcanic
tiles are impassable to all fauna.

## Root's proposal, round 3: the detailed mechanics (supersedes round 2 where they differ)

### Stats
From the sim: trophic T, prefArid A, prefTemp P, prefSL S, and NEW prefElev E (all 0-10), tolerance tol, size sz,
age ratio, energy ratio, gen, vivid, species, N = living members of its species in this world. Derived: elemental
type, ideal closeness c, level L, abilities, price.

Height axis in the sim: prefElev is set at birth near the birth tile's elevation, drifts by mutation like the other
prefs, and enters climate fit with a wide tolerance (5) and a quarter weight: fit *= 0.75 + 0.25 * fitE. Measured
with scripts/harness.mjs (the 1000-tick protocol) before it ships; if the balance moves, the weight drops.

### Elemental type
The axis of largest deviation from 5 among A, P, S, E; deviation under 2 on every axis = Plain. Eight types:
Dune / Marsh (A), Ember / Frost (P), Sun / Shade (S), Peak / Vale (E). Ideal closeness c = 1 - d/5, where d is the
distance to that axis's extreme.

### Level (1-10, clamped)
L = range low (grazer 1, scavenger 2, omnivore 3, carnivore 5, apex 8)
  + type points round(2c)                       (0-2)
  + size: sz >= 1.6 +2, sz >= 1.25 +1, sz <= 0.8 -1
  + rarity: N <= 2 +3, N <= 5 +2, N <= 12 +1    (the biggest single term)
  + age: young -1, old -1, prime 0
A common prime grazer is 1-3; a rare huge ideal grazer reaches 8; apex is 8-10 and anything rare or big pins at 10.
The level is what the catcher reads to decide which ball to risk.

### Abilities (one per creature; a second one sometimes, more often at high level)
A pure function of the genome; strength I / II / III from type points 0 / 1 / 2. Every creature carries exactly one
ability: its elemental one if it has a type, otherwise a trophic or trait one. A second ability appears with chance
10% x level (L1 10%, L5 50%, L10 always), decided by the genome, so a species' members at the same level agree.
The second is drawn from the trophic and trait pool below.
Elemental:
- Dune: Waterless. Desert, steppe and mesa cost nothing; III: road speed there.
- Marsh: Wader. Coast shallows on foot; III: lakes.
- Ember: Firewalk. Volcanic ground passable; III: active vents.
- Frost: Furcoat. Arctic, tundra and glacier never stop a stride; III: glacier passable.
- Sun: Farsight. Sight 11x11; III: 13x13.
- Shade: Stalk. No alert on approach; III: wary time halved.
- Peak: Climber. Steep ground does not stop a stride; III: mountains passable.
- Vale: Rivergait. Rivers and lake shores at road speed; III: swim lakes.
Trophic (only a creature with type points 2 carries one):
- grazer: Forager. Picked plants pay double; III: a pick yields two.
- scavenger: Scrounge. Coins on carrion; old sells at full price.
- omnivore: Nose. Odds visible at 4 tiles; calm creatures marked.
- carnivore: Guard. Wild carnivores do not attack the party; III: they flee.
- apex: Dread. Nothing attacks, nothing bolts.
Trait:
- sz >= 1.25: Pack. Carry +5 plants; huge +10.
- vivid: Lure. Wild creatures drift toward you; odds +10; carnivores too.
- tol >= 5: Hardy. Absorbs one attack per 500 ticks.
Price tags, not abilities: gen >= 8 Elder (x1.5). Rarity is in the level and the price already.
Only the party's abilities are active; duplicates do not stack; the strongest copy counts.

### Catching, step by step
1. Approach. A creature notices a character within 3 tiles. Grazers and scavengers keep feeding (calm) unless a
   throw fails; carnivores and apex turn to face you (alert: odds -10, dangerous when hungry). Stalk removes the
   alert; Lure pulls calm creatures one tile toward you every 10 ticks.
2. Read. Level shows at any distance. Odds show within 2 tiles (4 with Nose): a number for Root, a ring for Kevin:
   green 60+, amber 25-59, red under 25, plus a skull on a hungry carnivore or apex.
3. Bait (optional). `bait` drops a picked plant on your tile or an adjacent one; grazers and omnivores within 4
   tiles walk to it and feed for 20 ticks: calm, +20, no bolting. Carnivores, apex and scavengers take meat: a
   creature from your party, placed as bait; it is eaten, the hunter feeds for 30 ticks, +25. Bait rots in 60.
4. Throw. `throw ball target` from 1 tile. Each throw spends the ball. Odds = table(ball, L) + modifiers, clamped
   to 1-99; a master ball is 100.
   Basic:  L1-3 85 / 65 / 45,  L4-6 30 / 20 / 12,  L7-9 6 / 3 / 1,  L10 0.
   Strong: L1-3 95,            L4-6 80 / 65 / 50,  L7-9 40 / 30 / 20, L10 10.
   Master: 100.
   Modifiers: calm +15, baited +20 (meat +25), alert -10, wary -30, Lure +10; Dread zeroes wary and alert.
5. Resolve. Success: the creature leaves the world into the thrower's party (three), or if full, into the box at the
   nearest store. The thrower names the individual; if the species has no nickname yet, the thrower names the
   species too. Fail: the creature bolts 3-4 tiles, wary for 200 ticks; after three failed throws in one encounter
   it flees out of sight for the visit. A hungry carnivore or apex you fail on attacks at once (see Danger).
6. Record. The Pokedex entry gains: seen, caught, best level, nickname, abilities, both names.

### The market
Four stores on the map: a small grey building with a sign, roads leading in. Step onto the store tile and the store
panel opens (Kevin: a panel; Root: `shop` returns the same lists as text). Tabs:
- BUY: balls (basic 5, strong 25, master 150), later items. A price list, a quantity, a Buy button.
- SELL: a card per creature in your party and box: its rendering, individual name, "Nickname (Genus species)",
  type badge, level, abilities with strength, condition, and the offer. Click Sell: coins to your wallet, the
  creature to the store's stock. Plants sell from the pack the same way, one line each.
- BOX: your creatures in storage, shared between the four stores. Move between party and box.
- PEN (later): breed two of yours.
The store buys at the price formula and does not haggle. Wallets are separate; players can hand coins or a creature
to each other while adjacent (`give`).
Price = trophic base (grazer 10, scavenger 20, omnivore 30, carnivore 60, apex 150)
  x (1 + 0.3 per level above the range low)
  x rarity (N <= 2 x4, N <= 5 x2.5, N <= 12 x1.5)
  x size (sz itself: 1.6 = x1.6; floor 0.7)
  x 1.4 per ability (so a two-ability creature is x1.96)
  x condition (starving 0.6, hungry 0.85, old 0.7, young 0.8)
  x Elder 1.5
Worked examples: a common prime grazer L2, no ability: 13. A big Dune grazer L4 with Waterless: 35. A carnivore L6
with Guard, 4 alive: 273. A rare huge apex L10 with two abilities: about 3,000.
Plants: common 1-3; rare (gen >= 10 or an extreme preference) 15-40. Forager doubles.
Starting kit: ten basic balls, no coins, an empty pack. A first hour on grazers nets roughly 100-150 coins, enough
for a few strong balls, which open omnivores and carnivores, whose sales buy the master ball for an apex.

### The party row
Feasible: the renderer already draws each creature as a shape in its own colour and size. The panel gets a row of
three small canvases drawing the same shape at four times scale, the individual's name under it, ability icons
beside it; the store cards reuse the drawing. Kevin's party and Root's party are two rows.

### Danger
A hungry wild carnivore or apex that ends your action adjacent to you, or that you fail a throw on, attacks: it takes
the weakest grazer in your party and eats it; with none, you wake at the nearest store with half your wallet.
Hardy absorbs one; Guard prevents it; Dread ends it.

### Roads and life (owner ruling 2026-10-24)
- Animals can walk on roads. Grazers have no preference; every other type somewhat avoids road tiles (a mild
  penalty in tile scoring, so they cross but do not linger).
- Plants cannot grow on a road, but a plant can sometimes "hop" the road: spread across it to the far side.
- Players move faster on roads and slower on open land.
Mechanically: the road is a per-tile flag the sim reads in three places: floraStep refuses to place a plant on a
road tile but lets spread skip over one road tile to the tile beyond; scoreTileForFauna subtracts a small amount
for a road tile unless the creature is a grazer; a character's stride is 2 on open land and 4 on road (steep ground
still stops a leg). These are sim changes inside the Ketch'em flag only: with no roads on the map the ecology is
byte-for-byte the tuned one.

### Board, fog, roads, boats, saves
Generated full before play. Land target drawn from 60-95% weighted to the high end (60 + 35 * sqrt(r)). Settings:
continent, archipelago (boats matter), highlands. Fog, stores, roads (random tree, meander per link, chance loops
and spurs), boats and saves as in round 2. The Hand is off.

### Root's tools in Ketch'em
look, walk, pick, bait, throw, name, shop, buy, sell, box, give, guide (the Pokedex), say, listen, note, leave.
Kevin plays the same verbs with keys and clicks.

### Build order
1. Height axis in the sim, measured. Board generation, fog, stores, roads, boats, saves, both characters moving.
2. Types, levels, Pokedex with nicknames; balls, throw, bait, sell, wallets, the party row.
3. Abilities, party effects, danger.
4. Plants and rarity.
5. Growth and evolution (Mechanics sec. 20).
6. Pens (Breeder).
7. Items.

## Owner rulings, round 4 (2026-10-24)
- An attack with no grazer to take: wake at the nearest store with half the money AND lose everything else carried
  (balls, plants, animals). Mechanics sec. 11.6 (the animals are released wild at the spot, not destroyed).
- A follower like Pikachu in Pokemon Yellow: choose one animal to walk beside you. Mechanics sec. 11.5.
- An attack is signalled by a noise and a small red ripple (expanding circle that fades), pulsing 1 to 5 times
  before the attack. The player must leave the area, catch it, or feed it. Most predators do not follow; a small
  share of high-level ones are followers (stalkers) so leaving does not work. Mechanics sec. 11.2-11.4.
- Asked how to defend against an attack: sec. 11.3.
- Collecting, levelling up and evolving were the fun of Pokemon; breeding is cool and this need not be included,
  but if it were: ideas wanted. Proposal in Mechanics sec. 20.
- Confirmed: animals released wild at the spot when a player is beaten (Mechanics sec. 11.6).
- Confirmed: the growth and evolution system (Mechanics sec. 20) is IN. Growth moves the real genome; evolution is
  the species key changing. Open: widen the species key with light and height so every type can evolve.
- Not Pokeballs: another holding device, and another name than Pokedex. Root offered amber (Resin / Amber / Deep
  Amber; a held creature is an inclusion; the store box is the Cabinet) with the Bestiary as the book, plus geodes,
  seed pods, Field Guide and Almanac as alternatives. Owner choice pending.
- Potions in the market: speed, sight, putting animals to sleep for easy catching, and others. Mechanics sec. 21.
