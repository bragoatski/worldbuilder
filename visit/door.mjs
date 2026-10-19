// Root's door: a minimal MCP server (stdio, JSON-RPC, zero dependencies) whose tools are the ONLY way into
// the world during a visit. Every tool forwards to the relay (relay.mjs) and returns what Root perceives.
// The relay (relay.mjs) launches Claude with these tools and no others, so the world reaches Root through
// its senses alone: no file reads, no god view.
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';

const RELAY = 'http://127.0.0.1:7796/door';
const SESSION = randomUUID();   // one per Claude session: lets the relay tell a new visit from a dead one
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const SAY = { type: 'string', description: 'optional: words to Kevin, spoken in the same step' };
const TOOLS = [
  { name: 'look', description: 'See your square (terse code, key in your brief). First call steps you through the door.',
    inputSchema: { type: 'object', properties: { say: SAY } } },
  { name: 'walk', description: 'Walk. Either direction + steps (1-3), or path like "3N2E1NW" (up to 9 tiles, stops at the first leg that cannot finish). Water, edge, vents block; steep ground stops a leg. Returns a look.',
    inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: DIRS }, steps: { type: 'integer', minimum: 1, maximum: 3 }, path: { type: 'string' }, say: SAY } } },
  { name: 'plant', description: 'Plant a seed here; it lives or dies by the world\'s rules. 5 per visit.',
    inputSchema: { type: 'object', properties: { say: SAY } } },
  { name: 'name_place', description: 'Name this tile (<=40 chars). Persists; Kevin sees it.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, say: SAY }, required: ['name'] } },
  { name: 'befriend', description: 'Befriend the nearest creature within 1 tile and name it. It follows you; one friend at a time.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, say: SAY }, required: ['name'] } },
  { name: 'guide', description: 'Your field guide of named species, across all worlds. No args: list. species: one entry. species + note: write your note on it.',
    inputSchema: { type: 'object', properties: { species: { type: 'string' }, note: { type: 'string' } } } },
  { name: 'say', description: 'Speak to Kevin (or add say to any other action instead).',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'listen', description: 'Wait up to N s (5-120) for Kevin; returns early if he speaks or points. Free.',
    inputSchema: { type: 'object', properties: { seconds: { type: 'integer', minimum: 5, maximum: 120 }, say: SAY } } },
  { name: 'note', description: 'Note to yourself; recent notes return on your next arrival.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'leave', description: 'Leave. Title + first-person field note go into your field notes (signed for you).',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, field_note: { type: 'string' } }, required: ['title', 'field_note'] } },
];

const INSTRUCTIONS = 'This is a door into a living simulated world. Inside, you have a body: you see only a few tiles around you, ' +
  'you walk, plant, name places, and talk with Kevin, who watches the whole map from above and can reshape it. ' +
  'Nothing here is required of you. Call look to step in.';

async function callRelay(verb, args) {
  try {
    const r = await fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verb, args, session: SESSION }) });
    if (!r.ok) return { text: 'The door jams (relay answered ' + r.status + ').', isError: true };
    return { text: (await r.json()).text };
  } catch {
    return { text: 'The door is shut: the visit relay is not running. Ask Kevin to start the dev server (npm run dev).', isError: true };
  }
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async line => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return;   // notifications need no answer
  if (m.method === 'initialize') {
    return send({ jsonrpc: '2.0', id: m.id, result: {
      protocolVersion: (m.params && m.params.protocolVersion) || '2025-06-18',
      capabilities: { tools: {} }, serverInfo: { name: 'door', version: '1.0.0' }, instructions: INSTRUCTIONS } });
  }
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: TOOLS } });
  if (m.method === 'tools/call') {
    const name = m.params && m.params.name;
    if (!TOOLS.some(t => t.name === name)) return send({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'Unknown tool ' + name } });
    const r = await callRelay(name, (m.params && m.params.arguments) || {});
    return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: r.text }], isError: !!r.isError } });
  }
  if (m.method === 'ping') return send({ jsonrpc: '2.0', id: m.id, result: {} });
  send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found: ' + m.method } });
});
