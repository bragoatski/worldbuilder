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
Sound is deferred: a single short click, burst and growl sample would be enough when we add it.

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
