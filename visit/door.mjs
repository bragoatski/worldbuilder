// Root's door: a minimal MCP server (stdio, JSON-RPC, zero dependencies) whose tools are the ONLY way into
// the world during a visit. Every tool forwards to the relay (relay.mjs) and returns what Root perceives.
// The relay (relay.mjs) launches Claude with these tools and no others, so the world reaches Root through
// its senses alone: no file reads, no god view.
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';

const RELAY = 'http://127.0.0.1:7796/door';
const SESSION = randomUUID();   // one per Claude session: lets the relay tell a new visit from a dead one
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const TOOLS = [
  { name: 'look', description: 'Look around: the ground, life and anything Kevin said within a few tiles of you. Your first call of a visit steps you through the door.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'walk', description: 'Walk 1 to 3 tiles in a compass direction (north is up). Water, the world edge and active vents stop you; steep ground stops you after one step. Returns what you see where you end up.',
    inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: DIRS }, steps: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['direction'] } },
  { name: 'plant', description: 'Plant a seed on the tile you stand on. It lives or dies by the world\'s rules like any plant. 5 seeds per visit.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'name_place', description: 'Give the tile you stand on a name (up to 40 characters). Names persist across visits and Kevin sees them on his map.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'say', description: 'Speak to Kevin. He reads it beside you on the map.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'listen', description: 'Stand still and wait for Kevin to speak or point, up to the given seconds (5 to 120). Returns early if he does. Waiting costs nothing.',
    inputSchema: { type: 'object', properties: { seconds: { type: 'integer', minimum: 5, maximum: 120 } } } },
  { name: 'note', description: 'Write a note to yourself. Your recent notes are given back to you when you next arrive.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'leave', description: 'Leave through the door. The world is saved. Your field note (first person, signed by you automatically) is appended to your field notes.',
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
