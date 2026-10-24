// Root's door: a minimal MCP server (stdio, JSON-RPC, zero dependencies) whose tools are the ONLY way into
// the world during a visit. Every tool forwards to the relay (relay.mjs) and returns what Root perceives.
// The relay launches Claude with these tools and no others, so the world reaches Root through its senses
// alone: no file reads, no god view unless the mode is Sky. The mode (visit/modes.mjs) comes from the relay in
// VISIT_MODE, and this door serves exactly that mode's tools.
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { MODES, modeOf } from './modes.mjs';

const RELAY = 'http://127.0.0.1:7796/door';
const SESSION = randomUUID();   // one per Claude session: lets the relay tell a new visit from a dead one
const MODE = modeOf(process.env.VISIT_MODE);
const TOOLS = MODES[MODE].tools;

async function callRelay(verb, args) {
  try {
    const r = await fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verb, args, session: SESSION, mode: MODE }) });
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
      capabilities: { tools: {} }, serverInfo: { name: 'door', version: '2.0.0' }, instructions: MODES[MODE].instructions } });
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
