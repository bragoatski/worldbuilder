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
same number every time it is computed. Built 2026-10-24 (`rules.js` `genomeHash`), with one correction: hashing the
individual's exact prefs and hue would have made siblings of one species disagree on the second ability, against the
promise two sentences up. The hash therefore runs over the SPECIES fields, the sim's own `speciesKey` buckets (type,
hue in 20 degree steps, the four prefs in 2.5 steps): FNV-1a 32-bit over `type|hueB|aB|pB|sB|eB`, roll = hash mod 100.
Every member of a species rolls the same number; individuals differ only through size, vivid and tolerance (the pool)
and level; an evolution (bucket change, 20.3) re-rolls. A creature without `prefElev` reads E as 5. A creature with one entry in its pool never gets a second ability even at
level 10; the 10% x L chance decides only whether a qualified second is switched on.

| L | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| P(second ability, if the pool has two or more) | 10% | 20% | 30% | 40% | 50% | 60% | 70% | 80% | 90% | 100% |

Consequences worth knowing:
- A Plain, small, dull, low-tolerance creature has pool = [trophic at I]: one ability, never two.
- A typed creature with tp 2 always has at least two in its pool (elemental III, trophic III).
- Trophic abilities at II or III exist only on tp 2 creatures; the fallback trophic ability is always I.
- Two creatures of one species differ in abilities only through size, vivid and tolerance (which the sim mutates),
  and through level (which moves with N and age). The Almanac records the species' usual set and marks variants.

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
  and a creature in sight shows its abilities only once caught or once the species is in the Almanac with that
  variant: `H 2N1E L4 Dune (Waterless III)`. An unknown creature shows only its type and level.
- Almanac entry: the species' usual pool and the variants seen (with the gene that caused the variant: big, vivid,
  tolerant).
- Store SELL card: abilities with strength, and the x1.4 per ability shown in the price breakdown.

### 5.7 Price
Each ability multiplies the price by 1.4 regardless of strength (two abilities: x1.96). Strength shows in the level
instead (tp is already in L). Decision point: a per-strength multiplier (1.3 / 1.4 / 1.5) is one line if you want
III to pay more.

Elder (gen >= 8) is a price tag (x1.5), not an ability.

## 6. Awareness: how a creature notices you

Every living creature carries a mode-side awareness record: `{state, until, encounter: {player, fails, since}}`.
States in order of alarm:

| state | enters when | odds | behaviour each tick | leaves after |
|---|---|---|---|---|
| calm | default; feeding on bait | +15 if also fed (en >= 0.5) | the sim's own movement | alert, wary |
| alert | a player within 3 tiles (carnivore, apex) or 2 tiles (all others) | -10 | 30% chance to step 1 tile directly away; keeps feeding otherwise | 50 ticks with no player within 3 |
| growl | a HUNGRY carnivore or apex is alert and a player is adjacent | -10 | shows a skull; attacks at the end of the player's NEXT action if still adjacent (sec. 11) | the player steps away, or it attacks |
| wary | a failed throw | -30 | bolts: 1 tile per tick directly away for 4 ticks, over passable ground; then alert behaviour | 200 ticks (100 with Stalk II) |
| fled | third failed throw in one encounter | cannot be targeted | moves 10-14 tiles away out of sight over 6 ticks (not a teleport: it runs, and Kevin can watch it go) | the visit (resets on save/load) |

An encounter is one creature and one player within 6 tiles, continuous. Leaving 6 tiles for 100 ticks resets fails
to 0. Two players count as two encounters on the same creature, with separate fail counts.

Growl is the warning turn: Root, who acts in turns, always gets one result that says `C 1E growls` before an
attack lands, and can step away. Kevin sees the skull for the same beat.

Ability hooks: Stalk I skips alert (and therefore growl: a creature must be alert to growl). Dread I turns attacks
off; II turns the alert step-away off; III turns wary off. Lure pulls calm creatures toward the player.

## 7. Baiting methods

Bait is anything placed on the ground that a creature wants more than it fears you. Five methods, two of them
co-op. One active bait per player; a second placement replaces the first.

| method | tool | what is placed | who comes | from how far | walks | feeds for | odds while feeding | cost |
|---|---|---|---|---|---|---|---|---|
| plant bait | `bait plant` | one plant from the pack, on your tile or an adjacent one | grazer, omnivore | 4 tiles | 1 tile / tick | 20 ticks | +20, calm, no bolt | the plant |
| scatter | `bait scatter` | three plants in a line of three tiles | grazers only; up to three creatures, one per tile | 6 tiles | 1 tile / tick | 20 ticks each | +20 each | three plants |
| meat bait | `bait meat <name>` | a party creature, set down adjacent | carnivore, apex, scavenger, omnivore | 5 tiles | 1 tile / tick | 30 ticks | +25, calm, no bolt | the creature is eaten at the END of the 30 ticks (or when feeding is interrupted by a catch) |
| stake | `bait stake <name>` | a party creature, tethered adjacent | carnivore, apex | 5 tiles | 1 tile / tick | 30 ticks | +25 | if you CATCH the hunter within the 30 ticks, the staked creature is untouched and returns to the party; if you fail or wait too long, it is eaten |
| corral | no tool: both players adjacent to one creature on opposite sides | nothing | any | | | while both stay | +10 for both players; the creature's bolt is blocked on the flanked axis | nothing |

Rot: any unclaimed bait vanishes after 60 ticks. A bait a creature is walking toward keeps its bait slot; once it
feeds, the clock is the feeding window.

Who takes what: scavengers refuse plants; grazers refuse meat; omnivores take either; a fed creature (en >= 0.8)
ignores bait altogether (it is not hungry, and the look says `fed` so the player can tell).

Stake is the gamble the mode is built around: a live party member on a rope and a Geode in hand. Scatter is
how you pull a herd to you instead of chasing it. Corral is the reason to play with a partner.

## 8. Catch odds

Base by stone and level, then modifiers, clamped 1-99; master is always 100.

| stone | price | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 | L9 | L10 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Amber | 5 | 85 | 65 | 45 | 30 | 20 | 12 | 6 | 3 | 1 | 0 |
| Geode | 25 | 95 | 95 | 95 | 80 | 65 | 50 | 40 | 30 | 20 | 10 |
| Obsidian | 150 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 |

| modifier | value | condition |
|---|---|---|
| calm | +15 | aw calm and en >= 0.5 |
| plant bait | +20 | feeding on plant bait |
| meat bait | +25 | feeding on meat bait |
| alert | -10 | aw alert |
| growl | -10 | aw growl (an alert with a skull, sec. 6; Dread III zeroes it like alert) |
| wary | -30 | aw wary |
| Lure III | +10 | in party |
| corral | +10 | the other player adjacent on the opposite side |
| Dread III | wary and alert count 0 | in party |
| Amber on L10 | stays 0 | no modifier lifts it |

Expected stones per catch (basic, no modifiers): L1 1.2, L2 1.5, L3 2.2, L4 3.3, L5 5, L6 8.3. The fled rule caps
any encounter at 3 throws, so above L5 a Amber is a gamble, which is the point of the strong tier.

## 9. Catching an animal, start to finish

The whole encounter as it plays, with what each player sees and the tick clock. The sim runs at the visit speed
(6 ticks a second at most); a "tick" here is one sim step.

| phase | what happens | Kevin sees | Root reads |
|---|---|---|---|
| 1. sight | a creature enters the sight square; the Almanac marks it seen | the creature with a small level tag `L4` above it; a type badge colour on the tag (Dune sand, Frost white, Ember orange, ...) | `H 2N1E L4 Dune fed` |
| 2. approach | the player steps toward it; at 3 or 2 tiles it goes alert (unless Stalk) | a `!` pops over the creature for 10 ticks; it may step away | `H 1N1E L4 Dune alert` |
| 3. read | within 2 tiles (Nose: further) the odds appear | a ring around the creature: green 60+, amber 25-59, red < 25; a skull replaces the ring on a growling predator | `H 1N1E L4 Dune alert 55%` |
| 4. bait (optional) | a bait is placed; the creature walks to it and feeds | a leaf (plant) or a bone (meat) icon on the tile; the creature's path dotted; a chewing bob while it feeds; the ring turns a shade greener | `bait set 1E`, then on the next look `H 1E L4 Dune feeding 75%` |
| 5. throw | `throw strong` at the adjacent target; the stone is spent; the roll happens now, before any animation | the stone arcs from the player to the creature (sec. 9b); the creature is pulled in; the stone wobbles | the result line arrives after the animation's length in ticks so both players learn it at the same beat: `caught! name it` or `broke free (wary)` |
| 6a. caught | creature leaves `fauna`; joins the party (or the box); naming prompt; Almanac caught++ | the stone clicks shut with a flash; a card slides into the party row; a naming field focuses | `caught H L4 Dune. name: ` then `name <name>` (and `name species <nick>` if new) |
| 6b. broke free | aw = wary; bolt 3-4 tiles; fails++ (3 = fled) | the stone bursts; the creature runs with dust puffs; `~` marks over it while wary | `broke free; H bolts 3N, wary` |
| 6c. attack | a hungry predator that was growling, or that you failed on, attacks | lunge, red flash on the party card taken, the card cracks and empties; or the player fades and reappears at the store with a coin-loss line | `C attacks: "Tam" is taken` or `C attacks: you wake at the North Store, 120 coins lost` |
| 7. record | Almanac and save updated | the Almanac badge pulses once | `new in your Almanac: ...` on first catch of a species |

Preconditions for a throw: target within 1 tile (8 neighbours), in sight, both on land (no throws from a boat or
at a swimming creature), a stone of that tier in the pack. Names: individual <= 24 characters, species nickname <= 16,
letters, digits, spaces and apostrophes.

The roll is decided at the throw, not at the end of the animation; the animation is a reveal. The wobble count is
derived from the roll so it tells the truth: a catch always ends on the third wobble; a near miss (roll within 15
of the odds) breaks out on the third wobble; a clear miss breaks out on the first or second. Nothing in the
animation is random on its own.

## 9b. Animation of the key actions

The renderer is a 2D canvas, one draw per sim step, `PIX` pixels per tile. Animations are a list of timed effects
the mode draws on top of `draw()`; each has a start tick and a length; the sim never waits for them, and Root's
results are delayed to match them (sec. 9) so the two players are in step. All durations in ticks (6 a second).

| action | length | frames |
|---|---|---|
| level tag | always | small rounded tag above the creature, `L4`, in the type's colour; fades to 40% when out of the odds range |
| alert | 10 | `!` rises 1 tile over the creature and fades |
| growl | until resolved | a skull replaces the ring; the creature's shape shakes 1px side to side every tick |
| ring | while in range | a ring at 0.9 tile radius, 2px, green / amber / red by odds; width pulses slowly when calm |
| bait drop | 6 | the icon drops from the player's hand (0.5 tile up) to the tile with a small bounce |
| bait walk | 1 per tile | a dotted line from creature to bait, erased as it walks |
| feeding | 20 or 30 | the creature bobs 1px up and down every 3 ticks; the ring turns a shade greener |
| throw | 8 | the stone (a two-tone circle, 0.5 tile) travels a parabola from the player's centre to the creature's, apex 1.5 tiles up, with a 3-frame spin |
| pull-in | 4 | the creature's shape shrinks into the stone with a white streak; the stone drops to the tile |
| wobble | 3 x 10 | the stone rocks 15 degrees left, right, centre, pausing 4 ticks between wobbles; 1, 2 or 3 wobbles per the roll |
| click | 6 | the stone flashes white, two sparkles, a small ring expands and fades; the party card slides in from the right over 6 ticks |
| burst | 6 | the stone splits into two halves that fly apart and fade; the creature reappears at full size |
| bolt | 4 | the creature moves 1 tile per tick with a dust puff (3 grey dots) behind each step |
| wary | 200 | a `~` drifts above the creature every 20 ticks |
| flee | 6 | the creature runs 10-14 tiles at 2 tiles per tick, trailing dust, and the tag reads `fled` |
| corral | while held | a thin line joins the two players through the creature; the ring gains a second, thinner ring |
| attack | 12 | the predator lunges 0.5 tile toward the player and back; a red flash fills the party card for 6 ticks; the card cracks (two diagonal lines) and empties; or, with no grazer, the player's dot fades over 6 ticks and reappears at the store with `-120` floating up |
| Hardy absorb | 8 | the lunge lands on a brief white shield arc over the player |
| store enter | 6 | the panel slides up from the bottom; the store roof lights |
| sell | 8 | the card lifts, shrinks into the counter; a coin count ticks up in the wallet |
| boat | per step | a small brown hull under the player's dot, bobbing 1px every 6 ticks |
| fog clear | 4 per tile | cloud tiles fade to terrain as the sight square moves |

Root's text keeps the same beats: a throw's result is delivered after throw + pull-in + wobbles + click or burst
(8 + 4 + 30 + 6 = 48 ticks, 8 seconds at full visit speed), so when Kevin sees the stone click, Root reads `caught`.
Sound is deferred: a single short click, burst and growl sample would be enough when we add it. Built 2026-10-26: the
three, synthesised in the browser (no files), each at its moment in the animation (the click or burst when the wobbles
end, a growl with each warning pulse), only for what is in Kevin's sight square; O or the HUD chip mutes.

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
| old apex Ember L10, two abilities, gen 9 (N 2) | 150 | 1.6 | 4.0 | 4.0 | 1.3 | 1.96 | 0.7 | 1.5 | 10,274 |

(Row 6 read 10,267 in the proposal; the product is 10,273.5, corrected 2026-10-24 when `rules.js` reproduced the table.
All six rows are fixtures in `src/ketchem/rules.test.js`, end to end: level and abilities derived from the genome.)

Plants: common 1-3 coins (by health: < 0.5 is 1, < 0.8 is 2, else 3); rare 15-40: a plant with gen >= 10 or a
preference within 1 of an extreme. Forager multiplies. Pack holds 10 plants (Pack adds).

## 11. Danger: the attack, the warning, and the defences

### 11.1 Who attacks
A wild carnivore or apex that is hungry (en < 0.5), alert, and adjacent to a player. Fed predators never attack.
Scavengers and omnivores never attack.

### 11.2 The warning (owner ruling 2026-10-24)
Before it strikes, the predator signals: a sound plus a small red ripple, an expanding circle from the creature that
fades over 10 ticks. It pulses 1 to 5 times, 10 ticks apart, then attacks if the player is still within reach.
Fewer pulses the higher the level, so an apex gives almost no notice:

| predator level | pulses | warning window |
|---|---|---|
| 5 | 4-5 | 40-50 ticks |
| 6 | 3-4 | 30-40 |
| 7 | 2-3 | 20-30 |
| 8-9 | 1-2 | 10-20 |
| 10 | 1 | 10 |

Root reads `C 1E growls (3)`, the number counting down on each later result. Kevin hears the sound and sees the
ripple; the level tag turns red.

### 11.3 Ending the warning: what the player can do
| defence | how | works against |
|---|---|---|
| leave | step out of the creature's reach (more than 3 tiles away) before the pulses end | every non-stalker; a stalker pursues (11.4) |
| catch it | a successful throw ends the threat and the predator is yours | all; a failed throw triggers the attack at once |
| feed it | meat bait or a stake adjacent: it turns to the bait and feeds (30 ticks, calm) | all; the bait rules apply (stake can be recovered by a catch) |
| take the road | predators avoid roads and will not step onto one to pursue; a stalker will, but your stride is 4 to its 1 | stalkers can be outrun on road |
| a store | a player standing on a store tile cannot be attacked | all |
| Guard | hungry carnivores (I), apex too (II), they move away from you (III) | by strength |
| Dread | nothing attacks | all |
| Hardy | one attack absorbed per cooldown | one strike |
| a higher follower | a follower (11.5) of higher level than the predator makes it back down: the pulses stop and it goes alert instead | predators below the follower's level |
| items (later) | smoke, repel, a decoy | to be designed with the item pass |

### 11.4 Stalkers
Most predators do not pursue: leave their reach and the warning ends. A small share are stalkers: `hash(genome)
mod 100 < 10` and level >= 7. A stalker follows at its own move speed (one tile every 16 ticks) for up to 60 ticks
after you leave, pulsing as it comes; it stops at roads unless it is already on one, at the sea, and at a store. The
Almanac marks the species variant `stalker` once seen, so the second time you know.

### 11.5 The follower (owner ask: like Pikachu in Pokemon Yellow)
`follow <name>` lets one party creature out of its stone to walk beside you; `recall` puts it back. One follower at a
time, per player.

| rule | value |
|---|---|
| position | trails one tile behind the player, stepping when the player steps; on a boat it rides |
| ability | the follower's abilities count one strength higher (max III) while it follows |
| corral | a follower adjacent to a target on the side opposite the player gives +5 (a solo corral; a real partner gives +10) |
| intimidate | a predator of lower level than the follower will not attack; its pulses stop |
| exposure | the follower is the FIRST thing an attack takes, before the weakest party grazer; a follower of higher level than the attacker is not taken (it backs the attacker down instead) |
| hunger | none; it is yours and the sim does not run it |
| view | drawn as itself (shape, colour, size) with a small amber collar; Root reads `"Tam" follows` in the party line |

### 11.6 The attack itself (owner ruling 2026-10-24: lose half the money and everything else)
| case | what happens |
|---|---|
| a follower is out and lower level than the attacker | the follower is taken: the predator eats it (+40 energy), the party card cracks and empties |
| else, the party has a grazer | the lowest-level grazer is taken, as above |
| else | the player is knocked down: wakes at the nearest store with half the wallet (floor), and loses everything else carried: all stones, all plants, and every party creature. The creatures are not destroyed: they are RELEASED into the wild at the spot of the attack, as themselves, wary; the plants drop there and rot in 60 ticks; the stones are gone. A player who hurries back can recatch their own animals, which are now wild again (and count toward N once more) |
| Hardy in party | the first strike per cooldown is absorbed: nothing taken, the predator goes alert |

Attack cooldown 50 ticks per creature. The box at the stores is never touched by an attack.

Built 2026-10-25 (step 6, `src/ketchem/encounter.js`, readings of sections 6-9 and 11, overturnable):
- The sim leaves a creature alone while the encounter moves it (`held`: walking to bait, feeding, bolting, fleeing,
  growling); with nothing held the ecology loop is unchanged. The board's own random stream decides alert steps,
  pulse counts and rolls; the sim's streams are untouched.
- A roll is `1 + floor(rng x 100)` against the odds; the wobble count follows the rule in sec. 9. Root's result is
  held back 48 ticks (or 10 s if the world is paused) so it lands with the animation Kevin watches.
- The growl needs the predator alert, hungry, adjacent, not guarded, not on cooldown, the player off a store tile;
  it then holds still and pulses every 10 ticks (counts by level as in 11.2). When the pulses run out it attacks if
  adjacent, else steps toward the player once per pulse; a player more than 3 tiles away ends it unless the
  predator is a stalker (hash and level rule), which pursues one tile per 16 ticks for 60 ticks, never onto a road
  from off it. A follower of higher level, Dread, Guard (by strength), a store tile or a full belly ends it too.
- An attack: Hardy absorbs one per 500 ticks; else a lower-level follower, else the lowest-level grazer, else the
  knock-down: half the wallet, every stone, plant and party creature lost; the creatures go wild and wary at the
  spot, the plants drop as plants (they do not rot: the sim grows or grazes them), and the player wakes on the
  nearest store's doorstep. Attack cooldown 50 ticks per creature.
- Bait: one per player (a new bait replaces the old; a set-down or staked creature comes back); it binds the nearest
  hungry taker in range that is free, which walks one tile a tick and feeds on arrival; a fed creature (energy
  >= 80 %) ignores bait; a bait with no feeder rots after 60 ticks; a failed throw on a feeding creature frees the
  bait with a fresh clock. Meat and stake feed the hunter 40 energy at the end; a stake is recovered if its hunter
  is caught while feeding.
- Caught: the creature leaves the world into the party (3) or the cabinet, keeps its sim record plus `caughtAt`,
  `by` and `name`; the Almanac keyed by species key counts seen (on every look) and caught and keeps the nickname.
- Kevin's keys: Tab cycles targets within 2 tiles, a click picks one, Space throws (the nearest adjacent creature
  if nothing is targeted), 1 / 2 / 3 pick the stone, B then P / S / M / T then a direction (E = here) baits, F
  lets the first party creature out or recalls the follower, N names the last catch (a prompt: "name, species
  nickname"), E picks the plant underfoot before reading the tile. A one-line HUD shows wallet, stones, pack and
  party.
- A failed throw on a creature eating a set-down or staked party member: that member is eaten at once (sec. 7); on
  a plant bait the bait is freed. A caught hunter gives its stake or meat back. A creature that cannot reach its bait
  gives up and is free again. A creature released by a knock-down lands on the nearest ground it can stand on.
  The attack cooldown (50 ticks) also covers the failed-throw attack. Root keeps its party, stones and wallet between
  visits (`K.root.away` while it is out of the world); a knock-down moves Root's body to the doorstep on its next
  action, and a growl that attacks between Root's actions reports itself on the next result (Kevin sees a bubble).
- Not yet: potions, the party row, sounds, items; the corral's bolt block; a caught creature vanishes at the throw
  and a failed one bolts before the burst plays (the animation is a reveal in Kevin's eyes only); the ability hooks
  for Stalk, Lure, Dread, Guard, Hardy, Pack and Nose are in place; Farsight, Climber, Firewalk, Waterless, Wader,
  Rivergait, Forager and Scrounge wait for the movement and market passes. The sim's own id counter is rebuilt from
  wild creatures on a load, so a party creature's id could be reissued to a newborn (saves keep records by object).

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

Built 2026-10-25 (`src/ketchem/controls.js`): the table is a budget for both players. A tile costs 1/stride of the
budget by its own ground (road 1/4, open land 1/2, sea or steep 1); Kevin's budget refills every 6 ticks (22.1), and
each of Root's legs gets one budget, so a leg from a road doorstep onto desert is 2 tiles, not 4. Shift + direction
walks as many tiles as the ground you stand on allows (road 4) within the budget. Steep ground still stops a leg
after one tile. A held key moves on every tick of the page loop (not on the OS key repeat), paced by the budget.
Abilities (Waterless, Furcoat, Wader, Rivergait, Climber, Firewalk) are not yet applied: the creature side arrives
with the party in step 6.

## 13. Roads and the ecology

| rule | where in the sim | value |
|---|---|---|
| no plant roots on a road tile | `floraStep` spawn and spread targets | refuse the tile |
| a plant may hop a road | `floraStep` spread | if the target is road, try the tile one further in the same direction, 50% |
| non-grazers avoid roads | `scoreTileForFauna` | -0.5 on a road tile (grazer 0) |
| animals may stand on roads | pathing | road is passable land |
| the road flag | new `Uint8Array road` beside `grid` | 1 = road; saved with the game |

## 14. Road generation, in detail

### 14.1 Store placement (owner ruling 2026-10-24: one per quadrant, random)
| step | rule |
|---|---|
| quadrants | the map split in four by its centre lines |
| candidates per quadrant | 200 random tiles in that quadrant that are land, not mountain / glacier / volcanic / lake / river, with at least 6 of 8 neighbours walkable, and at least 6 tiles from the quadrant's edges (so two stores cannot sit back to back across a centre line) |
| pick | one candidate per quadrant, uniformly at random |
| islands | a store may land on an island; the road reaches it by bridge (14.3). If no land-or-bridge route exists at all (14.3 fails after bridges), re-pick that quadrant's store; after 3 failures, re-roll the board |
| store tile | the tile itself becomes a store: 1 tile, walkable, safe; the 8 neighbours are cleared of plants once |
| name | from the biome under it: `<Biome> <Post>` where Post rotates Post / Depot / Trading / Outfitters, so e.g. Savanna Post, Tundra Depot. The Almanac lists a store with its coordinates once discovered |

### 14.2 The spine
| step | rule |
|---|---|
| edges | all 6 store pairs, weighted by straight-line distance |
| tree | Kruskal with a shuffled tie-break: a random spanning tree biased to short links (3 links) |
| extra links | 35%: one more pair (a loop); 15%: two more (two loops or a loop and a chord) |
| variant pairing | 20%: ignore the shortest-link bias entirely and take a random spanning tree, so sometimes two far stores join directly |

### 14.3 Routing one link
A* from store to store over land. Cost per tile entered:

| terrain | cost | note |
|---|---|---|
| grassland, savanna, steppe, desert, tundra, arctic | 1.0 | open |
| forest, jungle, wetland, mesa | 1.6 | roads prefer to skirt them |
| hills | 1.8 | roads may climb hills (owner: hills are ok) |
| river | 4.0 | the road crosses as a bridge tile (drawn as planks); rivers do not stop a road, they cost |
| mountain, glacier, volcanic | impassable | never over mountains (owner ruling) |
| coast, ocean, lake | 6.0 per tile, as a BRIDGE, only in a straight run of at most 12 water tiles between two land tiles; a bridge run cannot turn | the island store's road; a long causeway is expensive so A* takes land when land exists |
| existing road | 0.3 | links share roads where it is cheap, which makes junctions |
| diagonal step | x1.41 | |
| meander | + m x noise(x, y) | m per link uniform 0-3; noise is value noise, period 8 tiles, range 0-1; m 0 is a straight road, m 3 wanders |
| doubling penalty | +2 | a tile with a road tile beside it that is not the one being extended, so a road does not run parallel to itself one tile over |

Result: a 1-tile, 8-connected path over land, hills and bridges. Every store is on the network by construction. If A*
fails even with bridges (an island farther than 12 tiles from any land the network can reach), re-pick that store
(14.1) and retry; after 3 failures, re-roll the board.

Built 2026-10-24 (`src/ketchem/board.js`, `routeLink`), with these readings of the table, overturnable:
- The doubling penalty applies only to a tile that is not itself road. Charging it on road tiles would have priced
  sharing an existing road at 2.3 per tile and killed junctions.
- A bridge run may take any of the 8 directions (diagonal x1.41 like any step); it is one edge from land to land.
- A failed link re-picks the far store and lays the whole network again from a clean road layer (so no dangling
  roads from the failed attempt); 3 re-picks, then the board re-rolls with seed + 1 (at most twice).
- Heuristic 0.3 x straight-line distance (the cheapest tile), so the search is exact.

### 14.4 Spurs
| step | rule |
|---|---|
| count | uniform 0-10 |
| start | a random road tile at least 6 tiles from any store |
| target | one of: nearest lake shore, nearest peak foot (tile adjacent to mountain), nearest coast, a random land tile 10-25 tiles away; weights 3 / 2 / 2 / 3 |
| route | same A*, m uniform 1-3 (spurs wander more), length cap 25 |
| end | a dead end; 30% of spurs end at a small landmark tile (a cairn, a dead tree, a pool) that the Almanac names |

Built 2026-10-24: the landmark kind follows the end tile (beside water: pool; forest / jungle / wetland / mesa: dead
tree; else cairn) and its name is `<Biome> <kind>`, e.g. Steppe cairn. A spur starts on a land road tile (never a
bridge); its path is capped at 25 tiles after the start tile; "nearest" targets are by straight-line distance.

### 14.5 Signposts
Every junction (a road tile with 3+ road neighbours) and every store doorstep gets a signpost: standing on it reads
the stores reachable along each branch with the road distance, e.g. `N: Tundra Depot 41 - E: Savanna Post 17`.
Kevin hovers it; Root's look lists `signpost: ...` when it is in sight. This is how you find the next store without
a map.

Built 2026-10-24: a branch is a road neighbour of the signpost tile; each branch is searched along the road (not back
through the signpost) and names the nearest store it reaches. A store is listed once, by the branch that reaches it
soonest; the store you stand beside is not a destination; a branch that reaches no store (a spur) is omitted, so a
doorstep with only spurs beyond it reads empty. The doorstep is the store's first road neighbour (N, NE, E, ... order).

### 14.6 Rendering
| element | draw |
|---|---|
| road | concrete grey #8a8f94, the full tile, 1px darker edge; above terrain, below plants and life |
| bridge | over a river: the road colour with 3 plank lines in #6b5a45; over water: the same planks on 2px posts, drawn above the sea |
| junction | no special mark; the signpost is a 2px post with a tiny board |
| store | a 1-tile building: dark roof #3a3f47, a lit door #f3d9a4, the name as a label on hover; Root sees `S` in the ground row |
| landmark | its own tiny glyph |
| undiscovered | hidden under fog until a road tile is inside sight; then the road is revealed tile by tile as sight moves, and a store is revealed when a road leading to it is revealed within 12 tiles, so the road hints at where to go |

## 15. Board generation, in detail

The sim normally grows land over thousands of ticks and caps it at `maxLandCap` 0.55. Ketch'em needs a full board
first and no further growth, so the mode runs a headless genesis and then freezes land.

### 15.1 Settings
| setting | land target | genesis knobs | peaks | rivers | boats matter |
|---|---|---|---|---|---|
| Continent (default) | 60 + 35 x sqrt(r) %, r uniform (median ~85%) | one volcanic origin at the centre, coastal spread high (clumped) | normal | normal | little |
| Archipelago | 45-60% uniform (was 60-75%, changed 2026-10-24, see the note below) | 4-7 origins spread out, coastal spread low | normal | fewer | yes |
| Highlands | 70-95% uniform | one origin, elevation intensity x1.4 | many (Climber matters) | many springs | little |
| Custom (dev) | any | the sim's own controls | | | |

Built 2026-10-24 (`SETTINGS` in `src/ketchem/board.js`), overturnable:
- Continent: `coastalSpreadBase` 0.010, `volcanoChancePerTile` 0.00002, one origin planted at the map centre before
  the first tick (the sim's own first-volcano boost is skipped, so almost all land spreads from that one origin).
- Archipelago: **45-60% land** (overturnable), `coastalSpreadBase` 0.002, `volcanoChancePerTile` 0.00012, erosion
  0.0005, elevation intensity 0.8, 4-7 origins planted at random with at least W/4 between them, river threshold 10
  (fewer rivers). Why not 60-75%: traced along genesis on 8 seeds, sea-divided landmasses of 60+ tiles went from
  3-6 at 50% land to 1-3 at 55%, 1-2 at 60% and one at 65%+ (the largest holding 98-100% of the land). Slower
  coastal spread and 6-12 origins did not change this: the sim's coastal spread closes every strait as land fills.
  At 60-75% an archipelago is one continent with inlets, no store can be on an island, and boats would not matter.
  The critic caught the first survey counting a ridge-divided store as an island; the metric now divides land by
  sea alone (`landmassMap`).
- Highlands: 70-95% land, elevation intensity 1.4, `volcanoChancePerTile` 0.0002, 6 volcano centres with the
  volcanic preset's birth rate, 2-6 springs on the highest open ground found by sampling (`addSpring`).
- Board size 96 (128 is a parameter, unmeasured).

### 15.2 The build
| step | what | time budget |
|---|---|---|
| 1 | seed the RNG, set world size (96 default; 128 as an option), set `maxLandCap` = target | |
| 2 | run `step()` with ecology off until land >= target (volcanic genesis + coastal spread); progress bar reads land % | the long part: measured before shipping; a 96x96 continent to 85% is thousands of ticks, so this runs in a Worker |
| 3 | freeze: `maxLandCap` = current land; erosion continues as normal | |
| 4 | `generateRivers()`; add 2-6 springs on high ground for Highlands | |
| 5 | seed life as the sim does for a full world: flora clusters, then grazer groups, then predators, apex and omnivores per the sim's rescue rules | |
| 6 | run 300 ticks with ecology on so life settles; then assign `prefElev` to every creature from its tile | |
| 7 | place stores, build roads and spurs, place signposts and landmarks (sec. 14) | |
| 8 | fog on everywhere; Kevin and Root placed on the doorsteps of two different stores (15.3); those two stores and doorsteps revealed | |
| 9 | the first autosave, slot named by the player (default: the seed) | |

Root is called in from the launch card after the board exists; its first look is the store doorstep.

Built 2026-10-24 (`buildBoard` in `src/ketchem/board.js`; the Worker is `board.worker.js`; the page restores the
result with `restoreState` and keeps the board as `K`):
- Time: a headless genesis tick cost ~10 ms before this step because `landCoverage()` rescanned the grid on every
  genesis try (~1,300 scans a tick) and `computeAridity` used an O(n) queue; both fixed byte-identically (fingerprint
  of grid + elevation unchanged over 2,500 ticks on three seeds), a tick now costs ~1.2 ms. Measured on this machine,
  ecology off: continent 85% ~10 s, 95% 13-18 s; archipelago 75% ~11 s; highlands 95% 17-19 s. All under the 20 s
  budget, so boards are generated live behind a progress bar; no pre-baked boards.
- Freeze: `maxLandCap` = land coverage minus a hair, so neither new volcanoes nor coastal spread add land; erosion,
  volcano births and reclassification go on.
- Life seed per land tile count L: flora L/40, grazers L/100, carnivores L/300 (at least 2), scavengers L/600,
  omnivores L/400, apex L/1200 (each at least 1, and only if its CFG toggle is on); then 300 ticks with ecology on,
  then every creature's `prefElev` is set to its tile's height. Flora standing on a road tile, a store tile or one of
  the store's 8 neighbours is removed once the roads are laid; `seedLifeAt` and Root's `plant` refuse road tiles.
- Progress is reported every 25 ticks (land %, then settle ticks, then "roads").

### 15.3 Start (owner ruling 2026-10-24: different stores; the others must be discovered)
Kevin starts on the doorstep of one store, Root on the doorstep of another, chosen so they are not in adjacent
quadrants when the spine allows (diagonal quadrants first, else any two). Each player's own start store and its
doorstep are revealed to that player; since fog is shared, both players see both starts on the map from the first
tick, which tells each where the other is. The remaining two stores are hidden until a road leading to one is
revealed within 12 tiles, or the store itself enters a sight square. Signposts at the start doorsteps name the
stores down each road, so the first decision is which way to walk.

## 16. Sight and fog

| who | sight square | fog cleared |
|---|---|---|
| Kevin's character | 9x9 (Farsight 11 / 13 / 15) | permanently for the save, for both players |
| Root | 9x9 (same) | same |
| store | revealed when inside sight, or when a road tile leading to it is revealed within 12 tiles | |
| road | revealed tile by tile inside sight | |
| undiscovered | drawn as cloud; creatures and plants invisible; the Hand is off |

Built 2026-10-24 (`src/ketchem/fog.js`): one shared bit per tile, packed (`Uint8Array`, W x H / 8 bytes). A reveal
is a square clipped to the map; after every reveal the store rule runs: a store whose tile is revealed, or that has a
revealed road tile within 12 road steps (BFS along the road from the store, cached per board), is marked revealed and
its own tile is cleared so the building shows while its surroundings stay cloud. The two start stores and the 9x9
around each start doorstep are revealed at build time. Hovering a fogged tile reads "Unexplored" and nothing else.
The Hand is still on in step 3 (it goes off with the controls in step 4). |

## 17. Height axis in the sim

| change | value |
|---|---|
| `prefElev` at birth | clamp(elev(birth tile) + (rng x 3 - 1.5), 0, 10) |
| inheritance | like the other prefs: parent +/- randn x faunaMutationMag (0.6) |
| fit | fit x (0.75 + 0.25 x exp(-dE^2 / (2 x 5^2 x 2))) |
| worst case | a creature 10 elevation units from its preference keeps 75% + 25% x e^-1 = 84% of its fit |
| acceptance | 1000-tick harness protocol: extinction rate and carnivore persistence within 3 points of the C2 baseline, else weight drops to 0.15 |
| knobs (built 2026-10-24) | `CFG.faunaElevWeight` (shipped 0, see result), `CFG.faunaElevTolerance` 5; harness `--elevw=N` |
| result (2026-10-24) | fit feeds exactly one thing in the sim, the per-tick energy drain, so the term is a survival tax on every creature off its birth height. 0.25: extinction 33%, carnivores 0/6. 0.15: 17%, 3/6. 0.05 at 12 seeds: 17%, 9/12, phase lag flipped to -83t (C2 0%, 8/12, +60t). No weight met the acceptance; shipped at 0: the gene exists, drifts, sets the type and the species key, and does not touch survival. Owner may overturn; the alternative is a movement-scoring term as its own harness task (Ecosystem Tuning Log) |
| RNG stream (built 2026-10-24) | its own seeded stream `hRng`, so at weight 0 the ecology is byte-identical to C2 and the harness measures the fit term alone |
| legacy saves | a creature without `prefElev` is given its tile's elevation on load (fit term 1) |

## 18. Save file, in detail

### 18.1 Where
| where | holds | why |
|---|---|---|
| IndexedDB in the browser (`ketchem` store, one record per slot) | the whole game | works on the public Pages build too; no server; survives reloads |
| the relay, `~/root/ketchem/slots/<slot>.json` | a mirror of every local save, written through `/page/save` | Root's record of the game, readable from the file tree; a backup outside the browser |
| export / import | the same JSON as a download / file picker | moving a game between browsers; sharing a board |

Write order on save: build the JSON in memory, write IndexedDB, then POST the mirror. A failed mirror never fails
the save (the panel shows a faint "not mirrored"). Relay side writes `<slot>.json.tmp` then renames.

### 18.2 Slots
| rule | value |
|---|---|
| count | unlimited; the launch card lists them newest first with name, seed, setting, ticks played, both wallets, last saved (local time with offset) |
| name | typed by the player at the first save; default the seed |
| autosave | on entering a store, every 2,000 ticks, and when Root leaves or the page is closed (`beforeunload`, best effort) |
| manual | F5 (Kevin) or `save` (Root) writes the current slot; `save as` makes a new one |
| load | from the launch card (Root is not in the world during a load; if present it is told "the world dissolves" and gets the loaded one, as today) |
| delete | from the launch card, with a confirm |

### 18.3 Schema (version 1)
```
{
  version: 1,
  meta:    { slot, seed, setting, size: [W, H], created, lastSaved, ticksPlayed, worldKey },
  sim:     buildSnapshot()           // grid, elev, aridity, temp, flora, fauna, remnants, rivers, springs, sea,
                                     // god climate; PLUS per creature: prefElev, growthXP, growthLevel, awareness
  road:    Uint8Array as base64      // 0 none, 1 road, 2 bridge, 3 store, 4 signpost, 5 landmark
  fog:     Uint8Array as base64      // 1 bit per tile, packed
  stores:  [{ x, y, name, stock: { amber, geode, obsidian, potions: {...} }, restockAt, held: [creature] }]
  cabinet: [creature]                // shared storage (the owner's "box"); creatures are full sim records
  players: [{ id: "kevin" | "root", name, x, y, boat, wallet,
              stones: { amber, geode, obsidian }, pack: [plant | potion], party: [creature], follower: id | null,
              effects: [{ potion, until }], knockedDown: { at, until } | null }]
  almanac: { species: { [key]: { scientific, nickname, namedBy, seen, caught, bestLevel, abilities: [...],
                                 variants: [...], evolvedFrom, firstSeen: { tick, x, y } } },
             places: { stores: [...], landmarks: [...] } }
  baits:   [{ x, y, kind, by, until, creatureId }]
  encounters: { [creatureId]: { player, fails, since } }
  pulses:  { [creatureId]: { left, next } }
}
```
A creature record is the sim's own object (so a released creature re-enters the world as itself) plus the mode's
fields: `growthXP`, `growthLevel`, `caughtAt`, `name`, `by`.

### 18.4 Rules
| rule | why |
|---|---|
| the species key is recomputed on load, never trusted from the file | evolution can change it; the sim is the truth |
| N (population rarity) is never saved | it is recounted on every look |
| fled creatures are reset to calm on load | the owner reads a save as a fresh start on that moment |
| a save made on a newer version than the page refuses to load, with a message | no silent corruption |
| migrations are a list of functions by version | the usual |
| size budget | a 96x96 world with 400 fauna and 4,000 flora is ~600 KB of JSON; IndexedDB and the relay take that without trouble; 128x128 is ~1 MB |

Built 2026-10-25 (`src/ketchem/save.js`, `menu.js`; relay `/page/save`, `/page/slots`): schema v1 as above with the
fields that exist at step 5 (stock, cabinet, almanac, baits, encounters, pulses are written empty and read back);
plus `cfg` (every CFG key that differs from the default, so the setting's knobs and the frozen land cap survive, which
the sim's own JSON format does not carry), `board` (target, land, ticks, links, spurs), and `vents` (active volcanoes), `rings` / `peaks` / `centers` (the volcano cones, which decide the biome of every
ring tile) and `coast` (the shore timers) and `genesis` (the terrain passes' bookkeeping: ring-done, uplift cooldowns, hill
decay, biome stability): the sim's JSON format forgets all of them, so a world loaded without them reclassifies its
cones and shores and re-runs uplift on its first tick. A damaged file is decoded and checked before the live world
is touched. Slot names are what the relay accepts as a file name (word characters, spaces, dashes, starting with a
word character); the page sanitises typed and imported names the same way. `road` is the plain road layer (0 / 1);
the 2-5 codes of the schema table are not used, since stores, signposts and landmarks are their own lists. The slot
store is IndexedDB `ketchem` / `slots` keyed by the slot name; F5 saves (the first time asks for a name, default the
seed), F9 opens the menu (load, delete, export, import; F9 works on a plain page too), autosave every 2,000 ticks
once a slot exists and on `beforeunload`. The mirror is best effort; the bubble says "not mirrored" when the relay
is absent (the public site). A loaded game puts Root where the save left it, with "the world dissolves" on its next
action. Found on the way: the sim's JSON load reseeded the sun field at a different point of the seeded stream, so
every loaded world (Ketch'em or the old Load button) got a different sun field and some biomes flipped; the load now
replays initWorld's draw order and the grid is identical after a load. Remaining differences after a load: the
climate base is recomputed at load while the live world refreshes it every 20 ticks (a few tiles of temperature and
aridity differ, mostly by hundredths, a few tenths on a tile at a biome edge, until the next refresh; the critic saw
one tile change biome on 1 of 16 loads), `yearlyVariation` restarts at 1, and the ecology streams are reseeded by the
sim's loader as they always were (only the instant of the load is reproducible). Built 2026-10-27 from the rest of 18.2:
Root's `save` (the current slot; refused with guidance while the game has no name) and `save as <name>` (a new saved
game, continued in); a named game saves when Root leaves a Ketch'em visit; deleting a slot in the F9 menu deletes its
mirror. A new name is refused when this browser's saves or the relay's mirror already hold it, ignoring case (the
mirror's files on Windows do), so naming never overwrites a game; Kevin's first save asks again the same way. A failed
`save as` leaves the old name. Windows' reserved file names (con, nul, ...) get " game" added. Load and delete stay in
the F9 menu rather than the launch card (a reading: the launch card is Root's, the saves are Kevin's).

## 19. Relationships, in one view

```
sim genes  A P S E tol sz viv gen hue      sim state  en ag N(species living)
   |       |                               |
   v       v                               v
 typ, c, tp (sec.3) ----------------> L (sec.4) <---- size(sz), rarity(N), age(ag)
   |                                     |
   v                                     v
 primary ability (sec.5)      P(second) = 10% x L        odds(stone, L) + modifiers(aw, bait, party) (sec.6-8)
   |                                     |                                  |
   v                                     v                                  v
 party effects (movement, sight, danger, odds)                     throw -> catch / bolt / flee / attack
                                                                            |
 price = base(T) x levelF(L) x rarityF(N) x sizeF(sz) x abilityF x conditionF(en, ag) x elderF(gen)  (sec.10)
                                                                            |
                                                                            v
                                      wallet -> stones -> harder catches -> rarer stock -> Obsidian -> apex
```

## 20. Growth and evolution (owner ruling 2026-10-24: in)

The sim already has the raw material: a creature's preferences and size are its genome, the species is a bucket of
that genome, and children inherit it. So growth can be REAL, not a number on a card: training a creature moves its
genes, and moving its genes far enough changes which species it is. That is evolution with the sim's own rules, and
it feeds straight into breeding (trained genes are inherited).

### 20.1 Experience
| source | XP | why |
|---|---|---|
| in the party, per 100 ticks | 1 | time together |
| following, per 100 ticks | 2 | the follower learns faster |
| present (party or follower) at a catch | the caught creature's level | assisting |
| fed a plant (grazer, omnivore) | 1 common, 5 rare | plants gain a second use beyond selling |
| fed meat (carnivore, apex, scavenger, omnivore) | 3 per level of the creature fed to it | the expensive diet |
| 500 ticks carried through its own type's biome (Frost in arctic, Dune in desert) | 10 | the exposure analogue of an evolution stone |

### 20.2 Growth level
Growth level G from 0 upward; XP to reach G is 10 x G^2 (10, 40, 90, 160, 250 ...). Each growth level applies to
the creature's real genome:

| effect per growth level | value | cap |
|---|---|---|
| its type axis preference moves toward the ideal | 0.5 | the extreme (0 or 10) |
| a Plain creature picks the axis it already leans most on; after two growth levels it is typed | | |
| size | +0.04 | 2.2 |
| tolerance | +0.1 | 6.0 |

Consequences that fall out for free: type points rise (so L rises and elemental strength rises), Pack and Hardy can
be gained by growth, abilities can appear (a creature grown to tp 2 gains its trophic ability; the second-ability
roll is re-run against the new level), and price rises through levelF, sizeF and abilityF. Nothing is granted by a
table; it all comes from the genome moving.

### 20.3 Evolution
The sim's species key buckets dryness and warmth in steps of 2.5. When growth pushes a preference across a bucket
edge, the species KEY changes: the creature is now a different species by the sim's own definition. That is the
evolution:
- the Almanac opens a new entry, linked `evolved from <old species>`; the first evolver names the new species;
- the creature keeps its individual name and its nickname lineage; its scientific name changes (the sim generates
  it from the new bucket);
- N for the new species is probably 1 in this world (rare: price x4 and level +3 until others exist), which is the
  reward for growing it;
- bred offspring of the evolved creature are born in the new bucket.
Visual: a long white flash, the shape re-drawn in its new colour band, the new name typed out above it.
Decided 2026-10-24 (handoff default, open to the owner): light and height ARE in the species key, so every type can
evolve. Buckets are four steps of 2.5 on each of the four axes; a preference of exactly 10 (a clamped mutation)
joins the top bucket rather than opening a fifth. The binomial's suffix now encodes light x height so one key is
still one name; names of existing species changed with it (nothing persisted them).

Built 2026-10-25 (step 8, `src/ketchem/growth.js`, readings, overturnable):
- XP as the 20.1 table: time 1 per 100 ticks in the party (2 following; the counter rides on the creature), a catch
  pays every other party creature the caught creature's level (the follower is in the party), `feed` pays 1 / 5
  for a common / rare plant (the plant-price rarity rule) to grazers and omnivores and 3 per level for a party
  creature fed to a meat eater (it is gone), exposure pays 10 per 500 ticks carried through the type's home biomes
  (Dune: desert, mesa, steppe; Marsh: wetland, jungle; Ember: volcanic, desert; Frost: arctic, glacier, tundra; Sun:
  savanna, desert, steppe; Shade: forest, jungle; Peak: mountain, hills; Vale: wetland, grassland).
- A growth level is applied the moment the XP is there (several in one go if the XP allows): the type's axis moves
  0.5 toward its ideal (a Plain creature leans on its strongest axis; a dead-centre one takes dryness), size + 0.04
  to 2.2, tolerance + 0.1 to 6.0. Note against 20.2's table: a type needs a preference 2 from centre, so a Plain
  creature at dead centre is typed after FOUR growth levels (160 XP), not two; one already leaning 1 away needs two.
  Level, abilities and price follow from the genome through rules.js, nothing is granted by a table.
- Evolution: when the species key changes, the new Almanac entry gets `evolvedFrom` (the old nickname, else the
  old scientific name), the old entry gets the variant `evolved`, the owner is asked to name the species (`N` for
  Kevin, `name` for Root; the individual keeps its name), and a white flash with the new name plays at the owner.
  Every look and card recomputes the species from the genome, so the sim's own naming follows.
- Kevin: T feeds (a prompt: a creature, or "eater, meal"); the HUD says "N to name the new species" until the
  species is named or the creature is gone; a pending species name rides in the save. Root: `feed`. The sim's
  cached binomial on a record is dropped when its genome moves, so the evolved species gets its own name.
  Breeding (step 9) hooks in through `breedHook`.

Built 2026-10-25 (step 9, the pen, in `growth.js`; the spec gave only "two parents, fee, offspring in the cabinet
with mixed genome", so these are readings, overturnable): the PEN tab of the store panel (Root: `breed a b` on a
store tile) takes two of the player's creatures of one trophic kind, from the party or the cabinet; the fee is
20 + 5 x (level a + level b) coins; the young one is born into the cabinet at age 0 with full energy, each
preference the parents' midpoint plus a small drift (the board's stream, about the sim's mutation size), size and
tolerance the means, the colour from one parent, vivid half the time if either parent is, generation one past the
elder parent, the lineage of the first parent; it asks for a name; the Almanac marks its species `bred`; each
parent rests 2,000 ticks. On any axis where both parents sit in one species bucket the child's preference is
clamped into that bucket, so two parents of one species breed true; where they differ the midpoint plus drift decides.
A newborn breeds once it has grown a level (otherwise a newborn and any third creature would be a coin loop: a
bred L5 grazer sells for far more than its 70-coin fee; the economics of breeding are the owner's call). A pending
catch name keeps its turn: the newborn queues for the naming prompt. The panel pairs creatures by id, so two unnamed
ones of a kind can be bred.

Breeding extras (owner-approved proposal 2026-10-27; the numbers are first readings, overturnable after the playtest):
- An egg: a bred young one lies in the cabinet as an egg for 600 ticks (about two minutes at the default speed). An
  egg cannot be named, sold, boxed or taken, bred, fed, given, followed, used as bait, shaped by a shard or sent to
  another save; the panel shows "egg, hatches in N ticks" with no buttons. It hatches into its breeder's naming
  question (whoever holds the seat by then: the owner is found by id) with a message; it is born at the hatch, so the
  newborn rule (it breeds once it has grown a level) counts from there.
- The pen fee by store: the two start stores charge the full fee (20 + 5 per parent level); a found store charges
  three quarters, rounded (a reason to travel).
- A young one that has not grown a level sells at half (the price breakdown says "x0.5 young"), which closes the coin
  loop the earlier note flagged (a bred L5 grazer sold for far more than its fee). This also applies to young ones
  already in a save.

### 20.4 Alternatives considered
| idea | verdict |
|---|---|
| card-only levels (a number that raises odds and price, genome untouched) | simplest; cheap; but nothing in the world changes and breeding ignores it. Fallback if 20.2 measures badly |
| trophic evolution (grazer becomes omnivore) | no: it changes the food web and the tuned balance |
| battles for XP | no: there is no combat in this world and inventing one is a different game |
| evolution stones as items | folded into exposure (20.1) and the item pass |
| forms by biome (a Frost coat in arctic) | cosmetic variant, cheap, could ride on exposure; parked |

## 21. Potions (owner ruling 2026-10-24: in the market, for speed, sight, sleep, and others)

Sold at stores under BUY, beside the stones. A potion is one use. Durations in ticks; "self" potions act on
the player who drinks, "thrown" potions act on a creature within 2 tiles, "area" potions act around the player.
Root uses `drink <potion>` or `throw <potion> <target>`; Kevin clicks the potion then the target.

| potion | kind | effect | duration | price | level resistance | notes |
|---|---|---|---|---|---|---|
| Fleetfoot | self | stride +1 on every terrain (road 5, land 3, mountain still stops) | 300 | 12 | | the cheap one; what you buy first |
| Hawkeye | self | sight +2 (9x9 to 11x11), fog clears to match; stacks with Farsight to a cap of 15 | 300 | 15 | | |
| Slumber | thrown | the creature sleeps: calm, cannot bolt or attack, odds +30; each throw at it has a 25% chance to wake it | 40 - 3 x L (min 10) | 30 | sleeps shorter the higher its level | a sleeping predator's pulses stop |
| Hush | area | every creature within 4 tiles drops to calm (alert and wary cleared); fled creatures are not affected | instant | 20 | | the reset after a bad throw |
| Musk | area | creatures of ONE trophic type (chosen on use) within 8 tiles walk toward you for 100 ticks | 100 | 25 | predators of level >= 8 ignore it | the hunter's lure; carnivore musk is how you find them, and the danger comes with it |
| Smoke | area | predators within 5 tiles move away; no attacks on you for 200 ticks; stalkers lose you | 200 | 35 | | the defence item |
| Decoy | thrown (on ground) | a scent on a tile that stalkers and alert predators chase instead of you, 60 ticks | 60 | 20 | | |
| Homeward | self | after a 6-tick cast you reappear at the nearest discovered store (interrupted by an attack) | instant | 40 | | the escape; also the fast way back to sell |
| Tonic | on a party creature | +10 XP (sec. 20) | instant | 30 | | rare plants are the cheaper route; Tonic is the fast one |
| Survey | self | clears fog in a 25x25 square around you | instant | 50 | | the map item; one store stocks it |
| Spice | on bait | doubles a bait's draw range and feeding window | per bait | 8 | | |
| Mirror | self | the next attack is reflected: the predator goes wary and loses 30 energy | until used, max 500 | 60 | | rare; one store stocks it |

Stock: each store carries the first six always; the rest are spread so that each store has two of the last six,
restocked every 2,000 ticks (3 of each). Potions sit in the pack (10 slots shared with plants; Pack ability adds).
Potions do not stack in effect: drinking a second Fleetfoot refreshes the timer. A potion in effect shows as a
small icon beside the player's dot with a shrinking arc for time left; Root reads `fleetfoot 180` in its party line.

Economy check: a first hour's 100-150 coins buys one Slumber and a few Fleetfoot, not a Survey; Smoke and Homeward
are what a player with a valuable party saves for before hunting predators.

Built 2026-10-25 (step 7, `src/ketchem/market.js`, `panel.js`; readings, overturnable):
- Stones are never out of stock (price is the gate); potions are counted: the first six in every store, two of the
  last six per store by store index (Survey in one store, Mirror in another), 3 each, restocked 2,000 ticks after the
  last restock. A sold creature goes to the store's `held` list. Plant prices: common 1 / 2 / 3 by health (< 0.5,
  < 0.8, else), rare 15 / 25 / 40 (gen >= 10 or a preference within 1 of an extreme); Forager doubles.
- The cabinet is shared between the stores and the players (one list, `K.cabinet`); `box` works on a store tile.
- `give` while adjacent: coins, stones, a potion, a plant (the first in the pack) or a party creature.
- Potions: Fleetfoot (stride + 1 on every ground but steep, both players), Hawkeye (sight square 11x11 while
  moving and at the drink), Slumber (`asleep` until tick + max(10, 40 - 3L): calm, held, odds + 30, no bolt, a growl ends; each
  miss has a 25 % chance to wake it; a miss on a sleeper reads "sleeps on"), Hush (alert / wary / growl within 4
  tiles go calm), Musk (one type within 8 tiles steps toward the drinker every 10 ticks for 100; predators L8+
  ignore it), Smoke (predators within 5 tiles step one tile away and growls end; no growl and no attack on the drinker for
  200 ticks: an attack "turns back in the smoke"), Decoy (a scent on the tile you face, the way you last walked,
  or at a bearing for Root; growling predators within 8 tiles step toward it instead of the player while it lasts), Homeward (a 6-tick cast, then the nearest discovered store's doorstep; any
  attack cancels the cast), Tonic (+10 `growthXP` on a party creature, for step 8), Survey (25x25 reveal), Spice (the
  player's active baits draw from double range and feed twice as long), Mirror (the next attack is reflected: the
  predator goes wary and loses 30 energy). Effects show in the HUD line as `fleetfoot 180`.
- Kevin: E on a store tile opens the panel (BUY / SELL / BOX), C opens it on BOX, entering autosaves when the game
  has a name; P then 1-9 drinks the Nth potion (thrown ones at the current target, Musk asks the type, Tonic goes to
  the first party creature), I reads the pack, M opens the Almanac, G asks what to give. Root: `shop`, `buy`,
  `sell`, `box`, `give`, `drink`, `almanac`, `pack`.
- Not yet: the party row and store cards (step 10), Slumber thrown by click (P then the current target does it),
  pens (step 9), Scrounge's carrion coins and "old sells at full price", Hawkeye's effect on the look's size.

## 22. Co-op controls on the keyboard (Kevin's character)

Root plays the same verbs through the door. Kevin plays on the page.

### 22.1 Movement
| key | action |
|---|---|
| W A S D or arrows | move one tile; diagonals by two keys together (W+D) |
| hold | repeats; the stride table (sec. 12) is a budget: at most 2 tiles per 6-tick window on land, 4 on road, 1 on steep ground, so holding a key on a road is visibly faster than on grass |
| Shift + direction | a full stride in one press (2 on land, 4 on road), the keyboard twin of Root's path walk |
| into water | the boat appears; same keys |

### 22.2 Acting
| key | action |
|---|---|
| Tab | cycle the target among creatures within 2 tiles (nearest first); the ring brightens on the target |
| click a creature | target it (within 2 tiles) |
| Space | throw the selected stone at the target (must be adjacent) |
| 1 / 2 / 3 | select Amber / Geode / Obsidian; the HUD shows the count |
| B | bait menu: plant, scatter, meat, stake; then a direction key for the tile |
| E | interact: pick the plant on your tile; open the store when on its tile; read a signpost |
| F | follower: let the selected party creature out, or recall it |
| P | potions: a row appears; 1-9 drinks or arms one; a thrown potion then wants a target (Tab or click) |
| I | pack (plants, potions, stones) |
| M | the Almanac |
| C | party and cabinet (at a store); drag between them |
| Enter | chat to Root; Shift+click still points |
| Esc | close any panel |
| F5 / F9 | save / load menu |

### 22.2a The Controls panel (built 2026-10-28, owner ask: "I need to be able to see the controls and possibly click them")
- On a board, a Controls panel docked on the left shows every key in 22.2 as a button with its key chip: the move pad
  (hold to walk), Throw, Target, Use, Name, Follow, the three stones (the one in hand lit, with counts), Bait, Potion,
  and Pack, Almanac, Give, Feed, Cabinet, Camera, Sound, Save, Load. A click or tap is the key: it goes through the same
  code. While a bait or potion choice is open the panel shows only what applies (the kinds, Here and Cancel; the
  potions as buttons), so a button never means something else than it says; while a question is open it dims. It
  collapses to a tab and remembers that per browser; it starts collapsed below 1100 px wide (the store panel and the
  question bar would cover it). It drives Kevin only; a guest plays on the arrows and right-hand keys, a pad or their
  own screen.
- The start card offers "Play Ketch'em" under Start Simulation: Continent, Archipelago, Highlands with their lines,
  each starting the board the `?ketchem=` address starts.

### 22.3 Camera and HUD
| element | rule |
|---|---|
| camera | follows Kevin's character; `V` toggles following Root; the mouse wheel zooms as today; the undiscovered map is cloud |
| HUD (top) | wallet, stones 1/2/3 with counts, pack count, active potion icons with arcs |
| party row (bottom left) | three cards: drawing, name, level, type badge, ability icons, follower collar on the one out |
| Root's panel (bottom right) | as today: chat, status, tokens; plus Root's party row under its status |
| target | the ring and the level tag; odds number appears under the tag within 2 tiles |

### 22.4 Two players, one world
| rule | value |
|---|---|
| turns | none; both act in real time; Root's actions resolve as its door calls arrive |
| collision | the two characters may stand on one tile |
| giving | `give` while adjacent: coins, a stone, a plant or potion, or a party creature; Kevin: G then a choice |
| corral | automatic when both are adjacent to one creature on opposite sides |
| speech | Root hears Kevin's typed lines as today; Root's says float at its dot and go to the panel |
| who can act on whom | nothing; a player cannot be targeted by the other |

Built 2026-10-25 (step 4, movement only): WASD / arrows (two keys for a diagonal), Shift for a stride, E reads the
signpost, store or landmark under Kevin (the store answers "opens in a later step"), V swaps the camera between Kevin
and Root (the camera follows only when zoomed in; at zoom 1 the whole board is on screen). On a board the Hand's
hotkeys (1-6, [, ], E), Space, R, F and T are the game's (R is swallowed: it would reset the world under both players); Esc and Enter
stay the page's; browser chords (Ctrl+R, Ctrl+F) stay the browser's; Ctrl+Z, the Hand's undo, is off on a board like the Hand. The Hand rail is hidden.
Kevin's last message shows as a bubble at his character for 4 s. Root's character is the visit's amber dot, with a
boat hull under either player at sea. Root arrives on the second start's doorstep and its first look names its store,
the signpost and Kevin's start store with a bearing. Root is called through the launch card: the Ketch'em card shows a
board setting and seed; Begin builds the board first when the page has none, then summons. Tab, Space, B, F, P, I, M,
C, G, Enter, F5, F9, the HUD and the party row are later steps. (Built since: see steps 6-10 and the finishing pass;
O toggles sound.)

Built 2026-10-25 (step 10, `src/ketchem/hud.js`, `panel.js`; readings of 22.3 and 5.6, overturnable):
- The HUD is a DOM bar at the top left of the map: wallet, the three stones as `1 Amber 8` chips with the one in hand
  lit, `pack 3/10` (hover: the plants and potions, and the keys), and one amber arc per active potion that empties as
  its duration runs out (hover: ticks left), then the naming hint (`N to name your catch`). It redraws only when a
  value changes; the arcs alone move every tick.
- The party row is up to three cards at the bottom left: the creature drawn exactly as the map draws it (the same
  shape routine, `render.js drawCreatureShape`, at card size), name, level, a type badge in the type's colour,
  `herbivore · G1 12/40`, and one pip per ability (`Rivergait III`); hovering a pip shows its rule from 5.5 in one
  line. The follower's card has an amber border and a collar dot. The store panel sits above the row.
- Store cards (SELL, BOX, PEN) carry the same drawing; the SELL card adds the price breakdown under the line: the
  base and every factor that is not 1, the abilities always (`2 abilities x1.96`), so the x1.4 of 5.7 is visible.
- The Almanac (M) is a panel, not text: one row per species met with its drawing (kept from the first creature seen,
  so a species keeps a face after that creature is gone), nickname in bold, binomial, type, who named it, what it
  evolved from and its variants (`bred`, `evolved`), then `seen · caught · best L`; under it the stores found and the
  landmarks seen, each with a bearing from Kevin. Root's `almanac` stays the text form.
- Root's panel shows Root's party as the same cards under its status while it is on the board; the row empties
  when Root leaves. Every look Root takes begins with a `party:` line once it carries creatures (5.6).
- Not built: ability icons (the pip is the name and the strength), `C` drag between party and cabinet (the buttons
  do it), the "odds number under the tag" was already on the canvas, sounds (deferred by the handoff). A species
  seen in a saved game from before this step has no drawing until a creature of it is seen again (the card draws
  blank, nothing breaks).

Adversarial run 2026-10-25 (three critics on the seams, a scripted hostile playthrough and a key fuzz on the live
page; the rulings below are readings, overturnable):
- Naming: catches queue behind a pending prompt like bred young ones do (N names them in catch order); a creature
  that leaves the player's hands (sold, given, eaten, taken by an attack, fed away) drops out of the prompts and the
  queue moves up, every tick; boxing keeps the prompt (still owned), and a knock-down keeps it for cabinet creatures;
  an unnamed creature given away is the receiver's to name; a species nickname already set is never overwritten by a
  later catch (`name Tam Zorp` says it is already "Hopper"); the store's and the pack's words are not names
  (`plants`, `plant 1`, `coins`, the stones, the types, the potions).
- The store panel acts by creature id, never by name: two creatures may share a name or have none. Taking out of the
  cabinet by type searches the cabinet first.
- A sleeper keeps its hold when its bait is cleared or a throw misses it; Slumber will not bring back a creature that
  has fled (the three-throw cap holds); Decoy lands only on an adjacent target, else the way you last walked;
  Homeward on a store is refused and kept; Tonic applies its growth level at once; F with no name lets the first
  party creature out; `give` refuses amounts under 1; a bait kind must be one of the four (a prototype key crashed
  the loop).
- The Almanac counts what Kevin sees: a creature entering his sight square is seen once (it was Root's looks and
  catches only). When one player's miss gets the other's staked creature eaten, or their catch of the hunter returns
  it, the owner gets the news.
- Saves: the sim's creature-id counter is reserved past every creature carried out of the fauna list (party, cabinet,
  a store's cupboard, a bait's payload), or the next wild birth after a load reused a carried id and the wrong
  creature got named or followed; the record is a snapshot (`structuredClone`), not live references; a Homeward
  cast, a Musk, a Decoy, Root's pending news, the follower's tile and the facing are carried; a damaged record leaves
  the tab's settings as they were; the relay's mirror accepts records up to 8 MB (a 96x96 board passes 2 MB after a
  minute of flora growth; 18.4's "about 600 KB" was wrong).
- The page shell: on a board, browser chords (Ctrl+R, Ctrl+F) are the browser's (they reset the world under both
  players before); a focused preset select or speed slider hands the keys back to the game; scenario Start and Load
  JSON take the board down first (they regenerated the world under it); the god deck (Meteor, Drought, Bloom, Rivers,
  the spawn buttons) is hidden under a board like the Hand.
- Known and left: a load while Root is on the board marks Root away until its next action (its dot waits); a
  knock-down or Homeward moves Root's record at once and its dot on its next action; Reset while Root is in strands
  Root until a new board (the launch card is closed while Root is here); the Almanac shows no "usual pool" and no
  big / vivid / tolerant variants (never recorded); a pack can sit over its cap after the Pack creature leaves (no
  further picking); names are not unique; `window.prompt` (N, G, T, Musk) freezes the loop and Root's door while open
  (an inline input is the polish for it); a load during Root's 48-tick throw delay lets that one result read the old
  board. (All closed by the finishing pass below, except that names became unique rather than staying free.)

Finishing pass 2026-10-26 (owner ask: "finish the rest of the steps"; readings, overturnable). The ten steps were built;
this closes what step 10 and the adversarial run left open. Out of scope by the handoff's sec. 7 and not built: a second
human player, Root on the public site, trading between saves, items beyond the potion table. The playtest stays the
owner's.
- Questions are an inline bar above the party row (N, G, T, Musk's type, a new game's name), never a browser prompt:
  the world and Root keep moving while Kevin types. Enter answers, Esc declines; a question about a creature that left
  his hands before he answered says so rather than naming the next one.
- Names are one to a creature across both players, the cabinet and a bait (the verbs, give and the cabinet find
  creatures by name); a duplicate is refused with the reason. Catches are named in the order caught.
- Every ability pip has an icon (16 small glyphs: dunes, reeds, flame, snowflake, eye, moon, mountain, waves, leaf,
  bone, nose, shield, skull, bag, spark, heart) beside its name and strength; hover gives the rule.
- The cabinet tab (C) is two zones, party and cabinet: drag a creature across, or use the buttons. Any refusal (a full
  party, too few coins, a rest) shows in the panel itself.
- The Almanac learns each species' usual abilities (its elemental and trophic ones; a Plain line's trophic one) and
  the variants seen with the gene behind each (big, vivid, tolerant), beside bred and evolved. A creature counts as
  seen once for the whole game, whoever sees it; an evolved species and a bred newborn's species count their first
  member as seen and caught.
- The pack shows red when over its cap (a Pack creature left the party); nothing more fits until it is lighter.
- Root and the board: a knock-down or Homeward moves Root's body and dot at once; a load while Root plays puts Root
  where the save left it at once; Reset (or a new world) while Root plays builds a new board of the same setting with
  Root on its doorstep, also when pressed again mid-build; a throw whose result lands after the board was replaced
  says so instead of reading the old board.

## 23. Items (the item pass; build order step 7)

Built 2026-10-26 on the owner's ask "build the next step". The design left items "to be designed with the item pass"
(11.3) and folded evolution stones into it (20.4); smoke, repel and decoy were already potions (21). Two kinds, both
readings, all overturnable: the kinds, the numbers and whether gear survives a knock-down are the owner's call.

**Shards** (one use, carried in the pack like a potion, on the P menu, lost on a knock-down):

| shard | step | price | rarity of the type (3b) |
|---|---|---|---|
| Sun | sunlight +1 | 30 | common |
| Dune, Marsh, Shade, Vale | aridity +1, aridity -1, sunlight -1, height -1 | 45 | uncommon |
| Frost, Peak | temperature -1, height +1 | 70 | rare |
| Ember | temperature +1 | 100 | very rare |

- A shard on a party creature moves its genome one step (1.0, two growth levels' worth) on that type's axis toward the
  type's pole. Crossing a species line is an evolution exactly as in 20.3: a new, linked Almanac entry and the species
  to name. Enough shards turn a creature's elemental type (a Vale grazer fed Ember shards becomes an Ember grazer);
  the trophic type never changes, so the food web is untouched. At the end of its axis a shard is spent with a note.
- A creature a shard has shaped earns no scarcity bonus (3b): its species counts as established at least, for its
  level and its price. A new species made in the hand has no wild members, so without this rule one 45-coin shard
  turned a 67-coin carnivore into a 638-coin "last of its kind". Evolution earned by growth keeps the bonus: it costs
  hours, not coins. The shaped mark stays with the creature, and a young one bred from a shaped parent carries it
  too, so breeding two shaped creatures is not a way round it.
- Each store stocks two of the eight (store index, like the spread potions; all eight between the four stores), three
  of each, restocked with the potions. Root: `buy <Type> Shard`, then `drink <Type> Shard <creature name>`. Kevin: P,
  the shard's number, then the creature's name in the question bar (Tonic asks the same way now).

**Gear** (bought once at any store, worn for good, never consumed, not giveable or sellable):

| gear | price | effect |
|---|---|---|
| Satchel | 120 | +5 pack slots (stacks with Pack) |
| Trail Boots | 180 | stride +1 on open ground and river banks (land 3); not on a road, at sea or on steep ground. With Fleetfoot, open ground walks at road speed |
| Lucky Charm | 300 | catch odds +5 with Amber and Geode; Obsidian stays sure and Amber on L10 stays 0 |

- Worn gear survives a knock-down: 11.6's ruling takes "everything else carried", and gear is read as worn, not
  carried. If the owner reads it the other way, it is one line.
- Economy: the first hour's 100-150 coins buys a Satchel at most; Boots and the Charm are what a player who sells a
  carnivore or breeds saves for. They are the long-game coin sink the market lacked after the potions.
- Shown: the BUY tab lists gear with "worn" once bought; the HUD's pack tooltip and I list what is worn; Root's
  `shop` has a gear line and `pack` says what Root wears. Saves carry it.
- Gear extras (owner-approved proposal 2026-10-27, numbers overturnable): three slots, pack, feet and charm, one item
  each; buying into a filled slot swaps, selling the old item back first (its refund counts toward the price). Wear:
  Trail Boots 2,000 steps and Waders 2,000 steps (a step counts only where the bonus applies, not on a road or a
  winded step), Lucky Charm 40 throws (only throws it helps: not Obsidian, not Amber at L10), Quiet Bell 3,000 ticks
  worn on the board (not while away); the Satchel and the Pannier never wear. Worn-out gear comes off with a message.
  The HUD, I and Root's pack say what is left. Selling back at any store pays half the price, scaled by what is left.

| gear | slot | price | effect | wears |
|---|---|---|---|---|
| Satchel | pack | 120 | +5 pack slots | never |
| Pannier | pack | 260 | +8 pack slots | never |
| Trail Boots | feet | 180 | stride +1 on open ground and river banks | 2,000 steps |
| Waders | feet | 160 | stride +1 on river and wetland tiles | 2,000 steps |
| Lucky Charm | charm | 300 | odds +5 with Amber and Geode | 40 throws |
| Quiet Bell | charm | 240 | creatures notice the wearer one tile later (alert range -1, never below 1) | 3,000 ticks |

- Not built: a spyglass (sight would need to be one rule across the page and Root's look first).

## 24. Trading between saves

Built 2026-10-26 (owner ask "start on the next step" after the item pass; the build order was complete, and of the
three items the campaign handoff left out, this is the one with no hosting or running cost; the second human player
and Root on the public site stay the owner's call). Readings, overturnable.
- At a store, the cabinet tab's Send button sends a cabinet creature to the cabinet of another saved game: the
  question bar lists the other saves and takes the name. Only cabinet creatures travel (party creatures go to the
  cabinet first), so a store is where a trade happens.
- It refuses before anything changes: this game must have a name (F5 first), the creature must already have its
  name, the other save must be readable and of this version, and the creature must still be in the cabinet when the
  answer comes (moving it to the party while the question is open cancels the send).
- No copy survives in two places: the two saves are written back to back, this game without the creature first. If
  the other save cannot be written, the creature comes back and this game is saved again. A page closed in the
  instant between the two writes loses the creature rather than copying it.
- Names stay one to a creature in the other game: a name already used there gets a number ("Rex 2").
- The creature keeps its genome, name, growth and abilities. In the other game it takes an id that game never used,
  arrives rested (no breeding cooldown), is marked "sent from <game>", and its species takes the other world's
  binomial. An exported file of the old game is the player's own backup and can still be imported: that is not
  guarded.
- Root has no send: the saves are Kevin's.

## 25. A guest in the second seat

Built 2026-10-26 (owner ask "build the next step", repeated after the remaining steps were named as needing the owner's
decision). Of the handoff's "second human player", this is the form that needs no server: a second person at the same
keyboard. Networked play (a second device or a friend elsewhere) needs hosting and stays the owner's call, as does
Root on the public site (model calls paid for strangers). Readings, overturnable.
- The game was built for two players, so the guest takes the second seat, the character Root plays when it is called
  in, rather than becoming a third. The seat holds one occupant: a guest cannot sit while Root plays, and Call Root
  says the seat is taken while a guest holds it. A game loaded with a guest seated while Root plays seats Root.
- Belongings stay apart: Root's party, stones, coins and gear wait while a guest plays, and the guest's wait while
  they are away. Each has their own player id, so a bait, a growl, a payload or a message stays with its own player
  across a swap (a creature Root staked comes back to Root even if a guest sat down meanwhile). Saves carry both.
- Joining: the "+ guest" chip in Kevin's bar asks a name; "<name> leaves" gets up. The guest starts on the second
  start's doorstep with ten Amber, like Kevin. A guest still at the keyboard sits down in a new board or a loaded game.
- Keys (right hand; Kevin keeps WASD and his letters, and the arrows become the guest's while they play):

| key | guest's action |
|---|---|
| arrows | move (held arrows repeat within the stride budget) |
| . | next creature within 2 tiles |
| / | throw the stone in hand |
| [ ] | previous / next stone |
| ' | name the catch (or the new species) |
| ; | pick the plant underfoot, read a signpost, or open the store on a store tile |
| , | let the first party creature follow, or recall it |
| L then a digit | drink a potion or use a shard (Tonic and shards ask which creature) |
| K | what the guest carries |
| J, a digit, then an arrow or ; | bait (added 2026-10-27): 1 plant, 2 scatter, 3 meat, 4 stake; an arrow picks the tile beside them, ; the tile underfoot (a plant only). Meat and stake set down the first party creature, as Kevin's B does |
| H | give to Kevin (added 2026-10-27): the question Kevin's G asks, "coins N, Amber N, a potion name, plant, or a party creature name"; adjacent only |
| U | feed a party creature (added 2026-10-27): the question Kevin's T asks |
| Y | the Almanac (added 2026-10-27), with bearings from the guest; Y again closes it, and Kevin's moves leave it open |

A pending J or L waits about ten seconds (60 ticks) for the guest's next key; Kevin's keys pass through it meanwhile,
except the digits: while J waits for a kind (or L for a potion), a 1, 2 or 3 is the guest's, so Kevin's stone key in that
moment picks the guest's bait instead (known and left: the spec gives the guest digits; a board change clears both).
J cancels a pending L and L a pending J.

- The guest has their own bar (top right, in green) and party row (bottom right); their character is a green dot with
  a green sight square. Their questions use the same bar as Kevin's; a second question waits for the first.
- Guest parity (2026-10-27): bait, give, feed and the Almanac, which the first build left to Kevin, are the guest's
  too (J, H, U, Y above), through the same functions Kevin's keys use. A bait carries the guest's own id, so a creature
  the guest staked comes back to the guest even after they got up and someone else sat down.
- Not built for the guest: sending to another save (the saves are Kevin's).

### 25.1 A gamepad for the guest

Built 2026-10-27 (owner ask "build the next part"). A standard gamepad plays the guest seat at the shared screen, so
two people play on one machine without sharing a keyboard. Readings, overturnable (the button layout above all).
- Every button is a guest key (the table in sec. 25), handed to the same code the keys use: the pad has no actions of
  its own.

| button | guest's action |
|---|---|
| d-pad, left stick | move (held repeats) |
| A | throw |
| B | next creature within 2 tiles |
| X | name the catch, or a new species: the question offers a free name ("Herbivore 1", "New herbivore 1") that A accepts, since a pad cannot type |
| Y | pick, read a signpost, or open the store; "here" when placing a bait |
| LB / RB | previous / next stone |
| LT | potion (then A B X Y for four at a time; RB turns to the next four) |
| RT | bait (then A plant, B scatter, X meat, Y stake, then the d-pad, or Y for here) |
| Back | give to Kevin |
| Start | the Almanac; with nobody in the seat, asks who joins (A takes "Guest") |
| L3 / R3 | follow or recall / feed |

- While the guest's own question is open in the bar, A answers it with what the bar holds and B declines. The pad
  never answers one of Kevin's questions (each question records whose it is).
- On a pad, A B X Y are the choice keys, so the digit clash at the shared keyboard (sec. 25) does not arise.
- A guest on another screen plays on their own screen; this pad does nothing for them. A pad that disconnects lets go of
  any held direction.
- A guest on another screen can use a pad on their own device (sec. 26): the same buttons, and A / B answer the
  question on their screen. This machine's pad never drives them, and theirs never drives a guest here.
- Not built: Kevin on a pad; vibration.

## 26. The guest link: the guest seat from another screen

Built 2026-10-27 (owner ask "continue next step"). A guest plays the second seat (sec. 25) from another screen: a
second window on this machine, or, once the owner opens the link to them, a phone or laptop on the owner's private
network. Nothing is hosted and nothing is paid for: Kevin's page is the game, and `visit/guest-link.mjs` is a mailbox
between the two pages. Readings, overturnable.
- Kevin's bar shows "+ guest on another screen" while the link is running: the dev server starts it beside Root's relay
  (or `npm run guest-link` on its own). It asks the guest's
  name, seats them, and shows the address and a six-digit join code. The guest opens the address, types the code,
  and sees a live picture of the 33 x 33 tiles around them (the same drawing, fog and all, about five a second),
  their coins, stones, pack and party, and their last message.
- The guest plays with their own keyboard (the same keys as sec. 25, J H U Y included) or with buttons on a phone: a
  d-pad and Target, Throw, Stone, Name, Use, Follow, Potion, Pack, then Bait plant, Scatter, Bait meat, Stake (each
  then waits for a d-pad arrow, or Use for here), Give, Feed and Almanac. Questions (a name, which creature a potion
  is for, what to give) appear on the guest's screen. Anywhere, the command line takes `give coins 5` and `feed Moss`
  or `feed Wolf, Moss`; on a store tile the guest sees what it sells and types `buy Geode 2`, `sell Moss`,
  `sell plant 2`, `box Moss`, `take Moss` or `breed Moss, Fern`. The Almanac (Y or the button) appears as text under
  the picture, with bearings from the guest, until Y again; nothing opens on Kevin's screen. A gamepad on the guest's
  device plays too, with the buttons of sec. 25.1 (added 2026-10-27): the page loads the game's own pad mapping from
  the link and sends button numbers through the same key input; A and B answer the question on the guest's screen. While a guest plays from another screen, the arrows on Kevin's
  keyboard are Kevin's again.
- When the guest leaves (the chip), the link closes and their page asks for a code again. A load or a new board keeps
  the same guest on the other screen; if Root holds the seat in the loaded game, the link closes.
- Safety, by design: the link has two ports. The guest port (7797) serves the guest's page behind the join code; twenty
  wrong codes in a minute lock an address out for a minute, and every refusal reads the same. The host port (7798)
  is bound to this machine only, refuses other Host headers, other pages' requests and anything that is not JSON, and
  needs the session key from opening, so a second tab cannot take the link over. Exposing the guest port can never
  expose the host side.
- Opening it to other devices is the owner's call and needs nothing installed: with Tailscale already running, start
  the dev server from PowerShell with `$env:GUEST_HOST = (tailscale ip -4); npm run dev` (the link it starts binds the
  guest port to this machine's Tailscale address; a link already running must be stopped first). Only devices on the owner's tailnet can reach that address; the host port stays on this machine.
  Kevin's message then shows that address. Without it, the link answers this machine only.
- The guest's screen (added 2026-10-27): the three sounds play there for what is in the guest's sight (the same
  synthesis, served by the link; a switch on their bar), and on a store tile the store is a panel of rows with Buy,
  Sell, Sell all, Box and Take buttons (the command line stays for breeding and anything else). An unnamed creature
  has no button until it is named. The shared screen's own sounds are for Kevin and a guest playing at it.
- The Almanac on the guest's screen shows each species' drawing (as the host's panel draws it) above its text
  (added 2026-10-27).
- Not built: several guests at once. Bait, give, feed and the Almanac were added
  2026-10-27; the link's input kinds are unchanged (keys, answers, commands).
