// Root's modes: each is its own game. A mode is a brief (what Root is told), a tool set (what Root can do) and a
// way of seeing (what a look returns). The door (door.mjs) serves exactly one mode's tools; the relay (relay.mjs)
// composes its brief and refuses any verb outside it; the page (src/visit.js) perceives and acts accordingly.
//   visitor  a body with nine tiles of sight: walk, plant, name, befriend. The control.
//   shaper   the same body and sight, plus the Hand's powers anchored to where Root stands. It lives inside its changes.
//   sky      no body: a coarse view of the whole world, a zoom, and the Hand anywhere. Root as god.
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const SAY = { type: 'string', description: 'optional: words to Kevin, spoken in the same step' };
const AT = { type: 'string', description: 'optional: a bearing in sight like "2N1E" (default: where you stand)' };
const XY = { x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 } };
const POWERS = ['raise', 'sink', 'rain', 'parch', 'warm', 'chill'];

function tool(name, description, properties = {}, required = []) {
  const t = { name, description, inputSchema: { type: 'object', properties: { ...properties, say: SAY } } };
  if (required.length) t.inputSchema.required = required;
  return t;
}

// Shared by every mode.
const COMMON = [
  tool('guide', 'Your field guide of named species, across all worlds. No args: list. species: one entry. species + note: write your note on it.',
    { species: { type: 'string' }, note: { type: 'string' } }),
  { name: 'say', description: 'Speak to Kevin (or add say to any other action instead).',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  tool('listen', 'Wait up to N s (5-120) for Kevin; returns early if he speaks or points. Free.',
    { seconds: { type: 'integer', minimum: 5, maximum: 120 } }),
  { name: 'note', description: 'Note to yourself; recent notes return on your next arrival.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'leave', description: 'Leave. Title + first-person field note go into your field notes (signed for you).',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, field_note: { type: 'string' } }, required: ['title', 'field_note'] } },
];

// A body in the world.
const BODY = [
  tool('look', 'See your square (terse code, key in your brief). First call steps you through the door.'),
  tool('walk', 'Walk. Either direction + steps (1-3), or path like "3N2E1NW" (up to 9 tiles, stops at the first leg that cannot finish). Water, edge, vents block; steep ground stops a leg. Returns a look.',
    { direction: { type: 'string', enum: DIRS }, steps: { type: 'integer', minimum: 1, maximum: 3 }, path: { type: 'string' } }),
  tool('plant', 'Plant a seed here; it lives or dies by the world\'s rules. 5 per visit.'),
  tool('name_place', 'Name this tile (<=40 chars). Persists; Kevin sees it.', { name: { type: 'string' } }, ['name']),
  tool('befriend', 'Befriend the nearest creature within 1 tile and name it. It follows you; one friend at a time.', { name: { type: 'string' } }, ['name']),
];

// The Hand, anchored to the body: every power lands where Root stands, or at a bearing it can see.
const HAND_HERE = [
  tool('shape', 'Shape the ground in a soft disc: raise or sink land, rain or parch, warm or chill. radius 1-3 tiles. Returns a look.',
    { power: { type: 'string', enum: POWERS }, radius: { type: 'integer', minimum: 1, maximum: 3 }, at: AT }, ['power']),
  tool('ember', 'Fire. On high ground a volcano opens; anywhere lower a meteor craters a 4-tile blast and kills what it lands on. Returns a look.', { at: AT }),
  tool('spring', 'Open a headwater; the water finds its own way to the sea. Returns a look.', { at: AT }),
  tool('seed', 'Seed life for the ground: bare ground gets plants, green ground gets grazers, grazed ground gets a predator. Returns a look.', { at: AT }),
];

// The Hand from above: every power takes a tile.
const HAND_SKY = [
  tool('survey', 'See the whole world, coarse (terse code, key in your brief). First call opens the sky.'),
  tool('zoom', 'See a 9x9 square around any tile, as a body on the ground would.', XY, ['x', 'y']),
  tool('shape', 'Shape the ground in a soft disc at a tile: raise or sink land, rain or parch, warm or chill. radius 1-8 tiles.',
    { ...XY, power: { type: 'string', enum: POWERS }, radius: { type: 'integer', minimum: 1, maximum: 8 } }, ['x', 'y', 'power']),
  tool('ember', 'Fire at a tile. High ground: a volcano opens. Lower: a meteor craters a 4-tile blast and kills what it lands on.', XY, ['x', 'y']),
  tool('spring', 'Open a headwater at a tile; the water finds its own way to the sea.', XY, ['x', 'y']),
  tool('seed', 'Seed life at a tile: bare ground gets plants, green ground gets grazers, grazed ground gets a predator.', XY, ['x', 'y']),
  tool('weather', 'A world-wide event: drought withers plants (driest ground hardest) or bloom seeds a flush of growth.',
    { event: { type: 'string', enum: ['drought', 'bloom'] } }, ['event']),
  tool('sea', 'Move the sea one step: raise drowns the low country, lower uncovers the shelf.',
    { direction: { type: 'string', enum: ['raise', 'lower'] } }, ['direction']),
  tool('name_place', 'Name a tile (<=40 chars). Persists; Kevin sees it.', { ...XY, name: { type: 'string' } }, ['x', 'y', 'name']),
];

// Ketch'em: the second player on a fogged board. Its walk uses the stride table (road 4, open 2, sea 1).
const KETCHEM_BODY = [
  tool('look', 'See your square (terse code, key in your brief). First call steps you through the door onto your store\'s doorstep.'),
  tool('walk', 'Walk. Either direction + steps (1-4), or path like "4E2N" (up to 9 tiles, stops at the first leg that cannot finish). Stride per leg: road 4, open land 2, sea 1 by boat, steep ground 1 then stop; lakes, volcanic rock and vents block. Returns a look.',
    { direction: { type: 'string', enum: DIRS }, steps: { type: 'integer', minimum: 1, maximum: 4 }, path: { type: 'string' } }),
  tool('pick', 'Pick the plant on your tile into your pack (10 plants).'),
  tool('bait', 'Set bait on a tile beside you: plant (one plant from the pack; grazers and omnivores come), scatter (three plants in a line; grazers), meat (a party creature set down; it is eaten at the end), stake (a party creature tethered; recovered if you catch its hunter). One bait at a time.',
    { kind: { type: 'string', enum: ['plant', 'scatter', 'meat', 'stake'] }, direction: { type: 'string', enum: DIRS }, name: { type: 'string', description: 'the party creature for meat or stake' } }, ['kind']),
  tool('throw', 'Throw a stone at an adjacent creature (a bearing in sight like "1E", or its type letter; default the nearest adjacent). The roll is decided now; the result arrives after the animation. Odds in your look.',
    { stone: { type: 'string', enum: ['Amber', 'Geode', 'Obsidian'] }, at: { type: 'string' } }),
  tool('name', 'Name your latest catch (<= 24 chars); species: a nickname for its species if it has none (<= 16).', { name: { type: 'string' }, species: { type: 'string' } }, ['name']),
  tool('follow', 'Let a party creature out of its stone to walk beside you (one at a time). No name: the first.', { name: { type: 'string' } }),
  tool('recall', 'Put your follower back in its stone.'),
  tool('shop', 'On a store tile: what it sells, what you can sell and for how much, the cabinet.'),
  tool('buy', 'Buy at the store you stand on: a stone (Amber, Geode, Obsidian), a potion, a <Type> Shard, or gear (Satchel, Trail Boots, Lucky Charm: bought once, worn for good), qty default 1.', { item: { type: 'string' }, qty: { type: 'integer', minimum: 1, maximum: 20 } }, ['item']),
  tool('sell', 'Sell at the store you stand on: a creature by name (party or cabinet), or "plants" for every plant in the pack.', { name: { type: 'string' } }, ['name']),
  tool('box', 'At a store: put a party creature into the cabinet (shared storage), or take one out with take: true.', { name: { type: 'string' }, take: { type: 'boolean' } }, ['name']),
  tool('give', 'Give to Kevin while adjacent: what = coins / Amber / Geode / Obsidian / a potion / plant / a party creature name; amount for coins and stones.', { what: { type: 'string' }, amount: { type: 'integer', minimum: 1 } }, ['what']),
  tool('drink', 'Use a potion from the pack. Slumber: target a creature (bearing in sight, default the nearest within 2). Tonic or a <Type> Shard: a party creature name. Musk: target = a type (herbivore, carnivore, omnivore, scavenger, apex). Decoy: a bearing beside you.', { potion: { type: 'string' }, target: { type: 'string' } }, ['potion']),
  tool('almanac', 'The Almanac: species seen and caught with nicknames, stores found, landmarks.'),
  tool('pack', 'What you carry: plants, potions, shards, stones, coins, the party, and the gear you wear.'),
  tool('breed', 'At a store: breed two of your creatures of one kind (party or cabinet) for a fee (20 + 5 x their levels); the young one is born into the cabinet with a mixed genome, and each parent rests 2,000 ticks.', { a: { type: 'string' }, b: { type: 'string' } }, ['a', 'b']),
  tool('save', 'Save this game into its slot (Kevin\'s F5 does the same). as: save it as a new game under that name instead (letters, digits, spaces, dashes); refused if another saved game has the name.',
    { as: { type: 'string' } }),
  tool('feed', 'Feed a party creature: what = "plant" (the first plant in the pack; grazers and omnivores) or another party creature\'s name (meat eaters; it is eaten). Feeding is XP; XP moves the genome; a genome that crosses a species bucket is a new species.', { name: { type: 'string' }, what: { type: 'string' } }, ['name']),
];

export const MODES = {
  visitor: {
    label: 'Visitor', blurb: 'A body with nine tiles of sight. Walk, plant, name places, befriend a creature.',
    brief: 'visitor.md', tools: [...BODY, ...COMMON],
    instructions: 'This is a door into a living simulated world. Inside, you have a body: you see only a few tiles around you, ' +
      'you walk, plant, name places, and talk with Kevin, who watches the whole map from above and can reshape it. ' +
      'Nothing here is required of you. Call look to step in.',
  },
  shaper: {
    label: 'Shaper', blurb: 'The same body and sight, plus the Hand: shape land and climate, fire, springs, life. You live inside your changes.',
    brief: 'shaper.md', tools: [...BODY, ...HAND_HERE, ...COMMON],
    instructions: 'This is a door into a living simulated world. Inside, you have a body and the Hand: you see only a few tiles ' +
      'around you, and you can reshape the ground where you stand. Kevin watches the whole map from above. ' +
      'Nothing here is required of you. Call look to step in.',
  },
  sky: {
    label: 'Sky', blurb: 'No body. The whole world in one coarse view, a zoom, and the Hand anywhere. Root as god.',
    brief: 'sky.md', tools: [...HAND_SKY, ...COMMON],
    instructions: 'This is a door to the sky above a living simulated world. You have no body: you see the whole world ' +
      'coarsely, zoom where you like, and reshape any of it. Kevin watches beside you. ' +
      'Nothing here is required of you. Call survey to open the sky.',
  },
  ketchem: {
    label: 'Ketch\'em', blurb: 'Co-op on a fogged board: four stores, roads, creatures to catch. Root plays beside you from its own store.',
    brief: 'ketchem.md', tools: [...KETCHEM_BODY, ...COMMON], board: true,
    instructions: 'This is a door into a Ketch\'em board: a fogged map inside a living simulated world, with four stores joined by ' +
      'roads. You have a body with a few tiles of sight and start at one store; Kevin plays beside you from another. ' +
      'Nothing here is required of you. Call look to step in.',
  },
};

export const MODE_IDS = Object.keys(MODES);
export const DEFAULT_MODE = 'visitor';

export function modeOf(id) { return Object.hasOwn(MODES, id) ? id : DEFAULT_MODE; }   // own keys only: 'constructor' is not a mode
export function toolsFor(id) { return MODES[modeOf(id)].tools; }
export function verbsFor(id) { return toolsFor(id).map(t => t.name); }
