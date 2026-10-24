# Ketch'em Mechanics - the technical spec

Companion to `Ketch'em.md` (the design conversation). This file is the numbers: every variable, every table, every
relationship. Constants marked **sim** already exist in `src/sim.js`; everything else is new and lives in the mode.
Status 2026-10-24: proposal for owner review. Each number here is a dial; the table is the thing to keep.

## 1. Variables

| symbol | name | source | range | read by |
|---|---|---|---|---|
| T | trophic type | sim `fauna.type` | grazer, scavenger, omnivore, carnivore, apex | level, price, bait, danger, roads |
| A | dryness preference | sim `prefArid` | 0-10 | type, species name |
| P | warmth preference | sim `prefTemp` | 0-10 | type, species name |
| S | light preference | sim `prefSL` | 0-10 | type |
| E | height preference | NEW sim `prefElev` | 0-10 | type, fit (weak) |
| tol | climate tolerance | sim `tolerance` | 1.5-6.0 | Hardy trait, fit |
| sz | size gene | sim `size` | ~0.5-2.2, founders 1.0 | level, price, Pack |
| ag | age ratio | sim `age / maxAge` | 0-1 | level (young/old), price |
| en | energy ratio | sim `energy / maxEnergy` | 0-1 | condition, calm, danger |
| gen | generation | sim `gen` | 0+ | species name gate (sim `SPECIES_MIN_GEN`), Elder |
| viv | vivid | sim `vivid` | bool | Lure |
| N | living members of its species in this world | computed each look | 0+ | rarity |
| hue, sat, val | colour | sim | | species name (genus), rendering |
| typ | elemental type | derived (sec. 3) | 9 values | ability, level |
| c | ideal closeness | derived (sec. 3) | 0-1 | type points |
| tp | type points | round(2c) | 0, 1, 2 | level, ability strength, trophic ability gate |
| L | level | derived (sec. 4) | 1-10 | odds, price, second ability |
| aw | awareness | mode state per creature | calm, alert, wary, fled | odds, bolting |
| st | store, box, wallet, pack, party | mode state per player | | market |

Age and energy words follow the sim's existing look code: young ag < 0.2, old ag > 0.8, prime otherwise;
starving en < 0.25, hungry en < 0.5, fed otherwise.

## 2. Trophic types

| T | sim move cooldown | sim maxEnergy | level range | base price | eats | takes bait | road behaviour | dangerous |
|---|---|---|---|---|---|---|---|---|
| grazer (herbivore) | 20 | 100 | 1-3 | 10 | plants | plant | no preference | no |
| scavenger | 15 | 110 | 2-4 | 20 | carrion | meat | avoids (-0.5 score) | no |
| omnivore | 17 | 110 | 3-5 | 30 | plants, grazers | plant or meat | avoids | no |
| carnivore | 16 | 120 | 5-7 | 60 | grazers | meat | avoids | when hungry |
| apex | 16 | 180 | 8-10 | 150 | carnivores, scavengers | meat | avoids | when hungry |

"Level range" is the band before modifiers; modifiers can push above it (sec. 4). Road avoidance is a subtraction in
`scoreTileForFauna` for a road tile; grazers get 0.

## 3. Elemental types

Deviation on each axis: dA = A - 5, dP = P - 5, dS = S - 5, dE = E - 5. The type is the axis with the largest |d|,
if that |d| >= 2; otherwise Plain. Ties break in the order A, P, S, E.

| typ | axis | sign | ideal pref | d to ideal | ability | theme |
|---|---|---|---|---|---|---|
| Dune | A | + | 10 | 10 - A | Waterless | desert walker |
| Marsh | A | - | 0 | A | Wader | wetland walker |
| Ember | P | + | 10 | 10 - P | Firewalk | heat |
| Frost | P | - | 0 | P | Furcoat | cold |
| Sun | S | + | 10 | 10 - S | Farsight | open light |
| Shade | S | - | 0 | S | Stalk | dim cover |
| Peak | E | + | 10 | 10 - E | Climber | high ground |
| Vale | E | - | 0 | E | Rivergait | low ground, water |
| Plain | none | | | | none (trophic or trait instead) | generalist |

Closeness c = 1 - d / 5, clamped 0-1 (d ranges 0-3 for a typed creature, since |d| >= 2 means pref >= 7 or <= 3).
Type points tp = round(2c): pref within 1.25 of the extreme gives 2, within 3.75 gives 1, else 0. Plain has tp 0.

| pref on its axis (high side) | d | c | tp | strength |
|---|---|---|---|---|
| 10.0-8.75 | 0-1.25 | 1-0.75 | 2 | III |
| 8.74-6.25 | 1.26-3.75 | 0.74-0.25 | 1 | II |
| 7.0-6.25 only reach here with a weaker other axis | | | | |
| typed but 6.25 > pref >= 7 cannot occur: typed means pref >= 7 | | | | |

(Mirror for the low side: 0-1.25 gives 2, 1.26-3.0 gives 1.)

## 3b. Rarity, in detail

Two different things are both called rarity. They are separate terms with separate tables.

**Population rarity (N).** How many of this exact species are alive in this world right now. The sim already
defines a species as a bucket of the genome: `speciesKey = type | hue bucket (20 degree steps) | dryness bucket
(2.5 steps) | warmth bucket (2.5 steps)` (`src/sim.js:1296`). N is the count of living creatures with the same key,
computed at the moment of the look or the throw. It changes as the world runs: a species can be rare today because
a drought thinned it, and common next season.

| N (alive, this species, this world) | reading | level bonus | price multiplier |
|---|---|---|---|
| 1-2 | last of its kind | +3 | x4.0 |
| 3-5 | endangered | +2 | x2.5 |
| 6-12 | scarce | +1 | x1.5 |
| 13-30 | established | 0 | x1.0 |
| 31+ | abundant | 0 | x0.8 |

Example: a grazer species with 40 alive is abundant: a level 1-3 animal worth 8-10 coins. Its sibling species with 4
alive is endangered: the same animal is two levels higher and worth two and a half times more. Catching one of the
4 makes the remaining 3 rarer still (N drops to 3, then to 2 and "last of its kind"), so hunting a species out
raises its price as you go, and a player who sells the last two has ended that line in this world. Releasing one
back lowers it again.

Before a lineage is old enough for a scientific name (gen < 3, the sim's `SPECIES_MIN_GEN`), N is still computed
from the key, so a young line is counted the same way; it just has no name yet.

**Type rarity (habitat).** How much of the world could ever hold this elemental type. Winter and mountain animals
are rare because little ground is frozen or high; plain animals are common because any ground suits them. This is a
fixed class per type (legible, the same on every board) and a price effect, not a level effect.

| typ | class | price multiplier | why |
|---|---|---|---|
| Plain | common | x1.0 | lives anywhere |
| Sun | common | x1.0 | most land is lit |
| Dune | uncommon | x1.5 | deserts are a minority of land |
| Marsh | uncommon | x1.5 | wetlands and shores |
| Shade | uncommon | x1.5 | deep forest and jungle |
| Vale | uncommon | x1.5 | river valleys and lowland |
| Frost | rare | x2.5 | arctic, tundra, glacier edges |
| Peak | rare | x2.5 | high ground, which also blocks most fauna |
| Ember | very rare | x4.0 | volcanic ground, which is briefly habitable and deadly |

Alternative, if you would rather the board decide: type rarity computed per world as the share of land tiles whose
climate is within 2 of the type's ideal (fewer suitable tiles, rarer), bucketed into the same four classes. A frozen
board would then make Frost common. My recommendation is the fixed table: a player learns it once.

**How the two combine.** Level uses population rarity only (it is about this animal, today). Price uses both:
`rarityF = populationF x typeF`. A last-of-its-kind Ember apex multiplies x4 x x4 = x16 on top of base, level, size
and abilities, which is the jackpot of the game. A common abundant Plain grazer multiplies x0.8.

## 4. Level

L = clamp(1, 10, low(T) + tp + size(sz) + rarity(N) + age(ag))

| term | input | value |
|---|---|---|
| low(T) | grazer / scavenger / omnivore / carnivore / apex | 1 / 2 / 3 / 5 / 8 |
| tp | sec. 3 | 0 / 1 / 2 |
| size | sz >= 1.6 | +2 |
| | 1.25 <= sz < 1.6 | +1 |
| | 0.8 < sz < 1.25 | 0 |
| | sz <= 0.8 | -1 |
| rarity | N <= 2 | +3 |
| | 3 <= N <= 5 | +2 |
| | 6 <= N <= 12 | +1 |
| | N > 12 | 0 |
| age | young or old | -1 |
| | prime | 0 |

Worked examples:

| creature | low | tp | size | rarity | age | L |
|---|---|---|---|---|---|---|
| common prime grazer, Plain, sz 1.0, N 40 | 1 | 0 | 0 | 0 | 0 | 1 |
| prime Dune grazer (A 9.5), sz 1.3, N 20 | 1 | 2 | +1 | 0 | 0 | 4 |
| young Frost scavenger (P 2), sz 1.0, N 8 | 2 | 1 | 0 | +1 | -1 | 3 |
| prime omnivore Plain, sz 1.7, N 3 | 3 | 0 | +2 | +2 | 0 | 7 |
| prime Shade carnivore (S 1), sz 1.0, N 15 | 5 | 2 | 0 | 0 | 0 | 7 |
| old apex Ember (P 8), sz 1.3, N 2 | 8 | 1 | +1 | +3 | -1 | 10 (12 clamped) |

## 5. Abilities

### 5.1 What an ability is
A standing effect on the PLAYER whose party holds the creature. Abilities never change the creature itself in the
wild: a Furcoat grazer survives winter no better than its siblings. That keeps the tuned ecology untouched and makes
the party a tool belt. (Decision point: if you want abilities to also help the animal in the wild, that is a sim
balance change and gets measured like the height axis.)

Sixteen abilities in three families: eight elemental (one per type), five trophic (one per trophic type), three
trait (from genes the sim already breeds).

### 5.2 How many, and which: the assignment algorithm
Run once per creature, from its genome alone, so the result is stable for its whole life and the same for every
member of a species at the same level. Nothing random at catch time.

```
1. typed  = elemental type != Plain                       (sec. 3)
2. tp     = type points 0 / 1 / 2                          (sec. 3)
3. pool   = []                                             abilities this creature qualifies for, in priority order:
     if typed:           pool += elemental ability of its type         (strength from tp)
     if tp == 2:         pool += trophic ability of T                  (strength III)
     if sz >= 1.25:      pool += Pack                                   (strength from sz)
     if vivid:           pool += Lure                                   (strength from tp, Plain = I)
     if tol >= 5:        pool += Hardy                                  (strength from tol)
     if pool is empty:   pool += trophic ability of T                  (strength I)   <- every creature gets one
4. primary = pool[0]
5. second  = pool[1] if pool has one AND hash(genome) mod 100 < 10 x L   (L = level, sec. 4)
```
The hash is over the stable genome fields (type, prefs rounded to 0.1, tolerance, size, vivid, hue), so it is the
same number every time it is computed. A creature with one entry in its pool never gets a second ability even at
level 10; the 10% x L chance decides only whether a qualified second is switched on.

| L | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| P(second ability, if the pool has two or more) | 10% | 20% | 30% | 40% | 50% | 60% | 70% | 80% | 90% | 100% |

Consequences worth knowing:
- A Plain, small, dull, low-tolerance creature has pool = [trophic at I]: one ability, never two.
- A typed creature with tp 2 always has at least two in its pool (elemental III, trophic III).
- Trophic abilities at II or III exist only on tp 2 creatures; the fallback trophic ability is always I.
- Two creatures of one species differ in abilities only through size, vivid and tolerance (which the sim mutates),
  and through level (which moves with N and age). The Pokedex records the species' usual set and marks variants.

### 5.3 Strength
| source | I | II | III |
|---|---|---|---|
| elemental (by tp) | tp 0 (cannot occur: typed means tp >= 1 on a 2-deviation... see note) | tp 1 | tp 2 |
| trophic | fallback | never | tp 2 |
| Pack (by sz) | 1.25-1.59 | 1.6-1.99 | 2.0+ |
| Lure (by tp of its type) | Plain or tp 0 | tp 1 | tp 2 |
| Hardy (by tol) | 5.0-5.4 | 5.5-5.9 | 6.0 |

Note on elemental I: a typed creature has |d| >= 2 on its axis, which gives c >= 0.4 and tp >= 1, so elemental
abilities are II or III only. The table keeps I for completeness; it is reachable only if the type threshold is ever
lowered to 1.

### 5.4 Stacking and activation
- Only creatures in the party (three) are active. The box and the store do nothing.
- Same ability from two party members: the strongest counts, nothing adds.
- Different abilities all apply at once (Furcoat + Climber + Farsight is a mountain explorer's party).
- Both players have their own party; abilities are per player. Root's Nose does not show Kevin the odds.
- Swapping party and box at a store changes the active set immediately. No cooldown.

### 5.5 The sixteen, in full
Each entry: what it does in play, the exact rule per strength, and which system reads it.

**Movement family** (read by the stride table, sec. 12; "costs 1" means the tile counts as road for stride purposes
so a step covers 4 of them instead of 2; "never stops a leg" removes the steep stop; "walkable" removes a block).

| ability | type | I | II | III |
|---|---|---|---|---|
| Waterless | Dune | desert, steppe, mesa cost 1 | + mesa never stops a leg | + desert, steppe, mesa at road stride (4) |
| Wader | Marsh | wetland costs 1 | + coast shallows walkable on foot, no boat | + lakes walkable |
| Firewalk | Ember | volcanic biome walkable | + any tile with temperature > 8 costs 1 | + active vents walkable |
| Furcoat | Frost | arctic and tundra cost 1 | + glacier never stops a leg | + glacier at road stride |
| Climber | Peak | hills cost 1, mountain never stops a leg | + mountain walkable | + mountain at normal stride (2) |
| Rivergait | Vale | river tiles cost 1 | + river tiles at road stride | + lakes walkable |

**Sense family** (read by the look / fog / odds display).

| ability | type | I | II | III |
|---|---|---|---|---|
| Farsight | Sun | sight 11x11 (fog clears the same) | 13x13 | 15x15 |
| Nose | omnivore | odds shown at 3 tiles (base 2) | 4 tiles | 5 tiles, and calm creatures carry a mark in the look and a dot on the map |

**Awareness family** (read by the awareness machine, sec. 6).

| ability | type | I | II | III |
|---|---|---|---|---|
| Stalk | Shade | no alert when you come within 3 (creatures stay calm) | + wary lasts 100 ticks, not 200 | + a failed throw does not bolt the creature (it still goes wary) |
| Lure | trait (vivid) | calm creatures within 3 tiles drift toward you 1 tile per 10 ticks | within 5 tiles | + odds +10 on every throw |
| Dread | apex | nothing attacks you (danger off) | + nothing bolts (alert never steps away) | + nothing goes wary (failed throws are free of penalty) |

**Danger family** (read by sec. 11).

| ability | type | I | II | III |
|---|---|---|---|---|
| Guard | carnivore | hungry carnivores do not attack | + apex do not attack | + carnivores and apex within 3 tiles move away from you (you can still throw at them before they go) |
| Hardy | trait (tol >= 5) | one attack per 500 ticks is absorbed: nothing taken, nothing lost | per 300 | per 150 |

**Economy family** (read by pick, sell, carrion).

| ability | type | I | II | III |
|---|---|---|---|---|
| Forager | grazer | picked plants sell x1.5 | x2 | x2 and every pick yields two plants (pack space allowing) |
| Scrounge | scavenger | walking onto a carrion tile pays 1-3 coins (once per carrion) | 2-6 | + old creatures sell at condition 1.0 instead of 0.7 |
| Pack | trait (sz >= 1.25) | +5 pack slots (base 10) | +10 | +15 |

### 5.6 How the player sees them
- Panel: each party card shows up to two ability icons with a I / II / III pip. Hover: the rule in one line.
- Root's look: a party line at the top of every look, `party: "Tam" H L3 Furcoat II; "Ash" C L6 Guard III Hardy I`,
  and a creature in sight shows its abilities only once caught or once the species is in the Pokedex with that
  variant: `H 2N1E L4 Dune (Waterless III)`. An unknown creature shows only its type and level.
- Pokedex entry: the species' usual pool and the variants seen (with the gene that caused the variant: big, vivid,
  tolerant).
- Store SELL card: abilities with strength, and the x1.4 per ability shown in the price breakdown.

### 5.7 Price
Each ability multiplies the price by 1.4 regardless of strength (two abilities: x1.96). Strength shows in the level
instead (tp is already in L). Decision point: a per-strength multiplier (1.3 / 1.4 / 1.5) is one line if you want
III to pay more.

Elder (gen >= 8) is a price tag (x1.5), not an ability.

## 6. Awareness

| state | enters when | odds | bolts on approach | leaves after |
|---|---|---|---|---|
| calm | default; feeding on bait | +15 (if fed, en >= 0.5) | no | alert or wary |
| alert | a character within 3 tiles (carnivore, apex only; all types at 2 tiles) | -10 | 30% per tick to step 1 tile away | 50 ticks with no character within 3 |
| wary | a failed throw | -30 | always steps away, 1 tile / tick for 4 ticks (the bolt) | 200 ticks (100 with Stalk II) |
| fled | third failed throw in one encounter | cannot be thrown at | teleports 10-14 tiles away out of sight | the visit |

An encounter is one creature and one player within 6 tiles, continuous; leaving 6 tiles for 100 ticks resets it.
Stalk I removes alert. Dread II removes bolting. Lure pulls calm creatures toward the player.

## 7. Bait

| bait | who takes it | from how far | approach | feeds for | odds while feeding | cost |
|---|---|---|---|---|---|---|
| plant (picked) | grazer, omnivore | 4 tiles | 1 tile / tick | 20 ticks | +20, calm, no bolt | one plant from the pack |
| meat (a party or box creature) | carnivore, apex, scavenger, omnivore | 5 tiles | 1 tile / tick | 30 ticks | +25, calm, no bolt | that creature, eaten |
| rots | | | | after 60 ticks unclaimed | | |

Bait is placed on the player's tile or an adjacent one. One active bait per player.

## 8. Catch odds

Base by ball and level, then modifiers, clamped 1-99; master is always 100.

| ball | price | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 | L9 | L10 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| basic | 5 | 85 | 65 | 45 | 30 | 20 | 12 | 6 | 3 | 1 | 0 |
| strong | 25 | 95 | 95 | 95 | 80 | 65 | 50 | 40 | 30 | 20 | 10 |
| master | 150 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |

| modifier | value | condition |
|---|---|---|
| calm | +15 | aw calm and en >= 0.5 |
| plant bait | +20 | feeding on plant bait |
| meat bait | +25 | feeding on meat bait |
| alert | -10 | aw alert |
| wary | -30 | aw wary |
| Lure III | +10 | in party |
| Dread III | wary and alert count 0 | in party |
| basic ball on L10 | stays 0 | no modifier lifts it |

Expected balls per catch (basic, no modifiers): L1 1.2, L2 1.5, L3 2.2, L4 3.3, L5 5, L6 8.3. The fled rule caps
any encounter at 3 throws, so above L5 a basic ball is a gamble, which is the point of the strong tier.

## 9. Throw resolution

| step | rule |
|---|---|
| preconditions | target within 1 tile (8-neighbour), in sight, not at sea, a ball of that tier in the pack |
| spend | the ball is consumed on the throw, win or lose |
| roll | uniform 0-99 < odds |
| success | creature removed from `fauna`; added to the thrower's party (max 3) else the box; thrower names it (<= 24 chars); if the species has no nickname, thrower names the species (<= 16 chars) |
| fail | aw = wary (or fled on the third fail of the encounter); bolt 3-4 tiles away from the thrower over passable tiles; a hungry carnivore or apex attacks (sec. 11) |
| Pokedex | seen++, caught++ on success, best L, nickname, abilities, scientific name, first world and tick |

## 10. Price

price = base(T) x levelF x rarityF x sizeF x abilityF x conditionF x elderF, rounded to a whole coin.

| factor | formula / table |
|---|---|
| base(T) | grazer 10, scavenger 20, omnivore 30, carnivore 60, apex 150 |
| levelF | 1 + 0.3 x (L - low(T)), minimum 1 |
| rarityF | populationF (N <= 2: 4.0; 3-5: 2.5; 6-12: 1.5; 13-30: 1.0; 31+: 0.8) x typeF (common 1.0, uncommon 1.5, rare 2.5, very rare 4.0; sec. 3b) |
| sizeF | max(0.7, sz) |
| abilityF | 1.4 per ability (1.4 or 1.96) |
| conditionF | starving 0.6; hungry 0.85; old 0.7; young 0.8; prime and fed 1.0 (multiply if two apply) |
| elderF | gen >= 8: 1.5 |

| creature (from sec. 4) | base | levelF | populationF | typeF | sizeF | abilityF | condF | elderF | price |
|---|---|---|---|---|---|---|---|---|---|
| common prime grazer L1 (Plain, N 40) | 10 | 1.0 | 0.8 | 1.0 | 1.0 | 1.4 | 1.0 | 1.0 | 11 |
| prime Dune grazer L4 (N 20) | 10 | 1.9 | 1.0 | 1.5 | 1.3 | 1.4 | 1.0 | 1.0 | 52 |
| young Frost scavenger L3 (N 8) | 20 | 1.3 | 1.5 | 2.5 | 1.0 | 1.4 | 0.8 | 1.0 | 109 |
| prime omnivore L7, two abilities (Plain, N 3) | 30 | 2.2 | 2.5 | 1.0 | 1.7 | 1.96 | 1.0 | 1.0 | 550 |
| prime Shade carnivore L7 (N 15) | 60 | 1.6 | 1.0 | 1.5 | 1.0 | 1.4 | 1.0 | 1.0 | 202 |
| old apex Ember L10, two abilities, gen 9 (N 2) | 150 | 1.6 | 4.0 | 4.0 | 1.3 | 1.96 | 0.7 | 1.5 | 10,267 |

Plants: common 1-3 coins (by health: < 0.5 is 1, < 0.8 is 2, else 3); rare 15-40: a plant with gen >= 10 or a
preference within 1 of an extreme. Forager multiplies. Pack holds 10 plants (Pack adds).

## 11. Danger

| trigger | attacker | effect | counters |
|---|---|---|---|
| a hungry (en < 0.5) carnivore or apex is adjacent when the player's action ends | that creature | takes the lowest-level grazer in the party (the creature eats it: +40 energy); with no grazer, the player wakes at the nearest store with floor(wallet / 2) | Guard I (carnivore), Guard II (apex), Hardy (absorbs), Dread I |
| a failed throw on a hungry carnivore or apex | same | same, at once | same |
| a creature feeding on meat bait | none | no attack while feeding | |

A player at a store tile cannot be attacked. Attack cooldown 50 ticks per creature.

## 12. Movement

Stride = tiles per step for a player. Steep ground stops a leg after the first tile as today.

| terrain | stride | notes |
|---|---|---|
| road | 4 | 8-connected; diagonals allowed |
| open land (grassland, forest, savanna, jungle, hills, wetland, steppe, mesa, tundra, arctic, desert) | 2 | Waterless / Furcoat / Wader / Rivergait reduce their biome's cost to 1 stride-equivalent (treated as road for cost) |
| mountain, glacier | 1 then stop | Climber / Furcoat per table |
| volcanic | blocked | Firewalk |
| active vent | blocked | Firewalk III |
| coast, ocean | boat, 1 | boat appears on leaving land; no throws at sea |
| lake, river | river 2; lake blocked | Rivergait, Wader III |

Root's walk tool takes the same path grammar; its stride per leg is the table above instead of a flat 3.

## 13. Roads and the ecology

| rule | where in the sim | value |
|---|---|---|
| no plant roots on a road tile | `floraStep` spawn and spread targets | refuse the tile |
| a plant may hop a road | `floraStep` spread | if the target is road, try the tile one further in the same direction, 50% |
| non-grazers avoid roads | `scoreTileForFauna` | -0.5 on a road tile (grazer 0) |
| animals may stand on roads | pathing | road is passable land |
| the road flag | new `Uint8Array road` beside `grid` | 1 = road; saved with the game |

## 14. Road generation

| parameter | value |
|---|---|
| stores | 4, on land, pairwise distance >= W/3, all on one landmass (else re-place) |
| spine | random spanning tree over the stores (random edge order, union-find) |
| link routing | A* over land; cost 1 per tile + meander noise m x noise(x, y) where m per link is uniform 0-3 (0 straight, 3 wandering) |
| extra links | with 35%: one more store pair (makes a loop); with 15%: two |
| spurs | count uniform 0-10; each starts at a random road tile and routes toward a random target: lake, peak, coast or a random land tile; length capped 25; dead end |
| width | 1 tile, 8-connected |
| render | concrete grey #8a8f94 overlay, drawn above terrain, below life |

## 15. Board generation

| setting | land target | genesis | notes |
|---|---|---|---|
| continent | 60 + 35 x sqrt(r) % | one seed, clumped | default |
| archipelago | 60-75% | several seeds | boats matter |
| highlands | 70-95% | continent plus raised peaks | Climber matters |

The board runs genesis forward until land >= target, then freezes land growth (erosion continues), seeds flora and
fauna as a full world, runs 300 ticks so life settles, then play begins. Species have no names yet at tick 300
(sim gate `SPECIES_MIN_GEN`), so early catches are nicknamed before they have a scientific name; the scientific name
attaches once the line is old enough.

## 16. Sight and fog

| who | sight square | fog cleared |
|---|---|---|
| Kevin's character | 9x9 (Farsight 11 / 13 / 15) | permanently for the save, for both players |
| Root | 9x9 (same) | same |
| store | revealed when inside sight, or when a road tile leading to it is revealed within 12 tiles | |
| road | revealed tile by tile inside sight | |
| undiscovered | drawn as cloud; creatures and plants invisible; the Hand is off | |

## 17. Height axis in the sim

| change | value |
|---|---|
| `prefElev` at birth | clamp(elev(birth tile) + (rng x 3 - 1.5), 0, 10) |
| inheritance | like the other prefs: parent +/- randn x faunaMutationMag (0.6) |
| fit | fit x (0.75 + 0.25 x exp(-dE^2 / (2 x 5^2 x 2))) |
| worst case | a creature 10 elevation units from its preference keeps 75% + 25% x e^-1 = 84% of its fit |
| acceptance | 1000-tick harness protocol: extinction rate and carnivore persistence within 3 points of the C2 baseline, else weight drops to 0.15 |

## 18. Save file

One JSON per slot: `~/root/ketchem/<slot>.json` (Root's record) with a copy the page can load.

| key | contents |
|---|---|
| sim | `buildSnapshot()` plus `prefElev` per creature and the `road` array |
| fog | bit per tile |
| stores | 4 x {x, y, stock: [creatures], box: [creatures]} (box shared, stored once) |
| players | 2 x {x, y, boat, wallet, balls {basic, strong, master}, pack [plants], party [creatures], name} |
| pokedex | per species key: scientific, nickname, seen, caught, bestL, abilities, firstWorld |
| awareness | per living creature id: state, until tick |
| bait | active baits |
| meta | slot name, created, lastSaved (local time with offset), seed, board setting, ticks played |

Autosave on entering a store and every 2,000 ticks; manual save from the panel; load from the launch card.

## 19. Relationships, in one view

```
sim genes  A P S E tol sz viv gen hue      sim state  en ag N(species living)
   |       |                               |
   v       v                               v
 typ, c, tp (sec.3) ----------------> L (sec.4) <---- size(sz), rarity(N), age(ag)
   |                                     |
   v                                     v
 primary ability (sec.5)      P(second) = 10% x L        odds(ball, L) + modifiers(aw, bait, party) (sec.6-8)
   |                                     |                                  |
   v                                     v                                  v
 party effects (movement, sight, danger, odds)                     throw -> catch / bolt / flee / attack
                                                                            |
 price = base(T) x levelF(L) x rarityF(N) x sizeF(sz) x abilityF x conditionF(en, ag) x elderF(gen)  (sec.10)
                                                                            |
                                                                            v
                                      wallet -> balls -> harder catches -> rarer stock -> master ball -> apex
```
