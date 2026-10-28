/* global fetch, URL */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';

// The guest link server (visit/guest-link.mjs, mechanics 26): a mailbox between Kevin's page (the host port, this
// machine only) and a guest's page (the guest port, behind a join code).
const { createGuestLink } = await import('./guest-link.mjs');
let link, guest, host;
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r('http://127.0.0.1:' + s.address().port)));
beforeAll(async () => { link = createGuestLink(); guest = await listen(link.server); host = await listen(link.hostServer); });
afterAll(() => Promise.all([new Promise(r => link.server.close(r)), new Promise(r => link.hostServer.close(r))]));
const jpost = (base, p, b, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(b) });
// A raw request, to set a Host header fetch will not let us choose.
const raw = (base, p, headers, body = '{}') => new Promise((resolve, reject) => {
  const u = new URL(base + p);
  const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, res => { res.resume(); resolve(res.statusCode); });
  req.on('error', reject); req.end(body);
});
let key;

describe('the guest link', () => {
  it('serves the guest page with no em dashes, and no game until the host opens one', async () => {
    const page = await (await fetch(guest + '/')).text();
    expect(page).toContain('the guest seat'); expect(page).not.toContain(String.fromCharCode(0x2014));
    const r = await fetch(guest + '/frame?code=123456'); expect(r.status).toBe(403); expect((await r.json()).error).toBe('no game here with that code');
  });
  it('serves the game\'s pad mapping to the guest page, which loads it', async () => {
    const r = await fetch(guest + '/pad.js'); expect(r.status).toBe(200); expect(r.headers.get('content-type')).toMatch(/javascript/);
    const js = await r.text(); expect(js).toContain('export function padKey'); expect(js).not.toMatch(/^import /m);
    expect(await (await fetch(guest + '/')).text()).toContain("from '/pad.js'");
  });
  it('serves the game\'s sounds to the guest page too', async () => {
    const js = await (await fetch(guest + '/synth.js')).text();
    expect(js).toContain('export function play'); expect(js).not.toMatch(/^import /m);
    expect(await (await fetch(guest + '/')).text()).toContain("from '/synth.js'");
  });
  it('the guest port has no host side', async () => {
    expect((await jpost(guest, '/host/open', { code: '123456' })).status).toBe(404);
  });
  it('the host opens with a six-digit code and gets a session key', async () => {
    expect((await jpost(host, '/host/open', { code: '1234' })).status).toBe(400);
    const r = await (await jpost(host, '/host/open', { code: '482913' })).json();
    expect(r.ok).toBe(true); expect(r.key).toMatch(/^[0-9a-f]{32}$/); key = r.key;
  });
  it('refuses a foreign page, a renamed host and a post that is not JSON', async () => {
    expect((await jpost(host, '/host/close', { key }, { Origin: 'https://evil.example' })).status).toBe(403);
    expect(await raw(host, '/host/close', { Host: 'evil.example:7798' }, JSON.stringify({ key }))).toBe(403);
    expect((await fetch(host + '/host/close', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ key }) })).status).toBe(415);
    expect((await jpost(host, '/host/frame', { key: 'wrong' })).status).toBe(403);
  });
  it('a second tab cannot take the link over while it is live', async () => {
    await jpost(host, '/host/frame', { key, state: {} });
    expect((await jpost(host, '/host/open', { code: '111111' })).status).toBe(409);
  });
  it('the right code gets the frame and the state; a wrong one gets the same refusal as no game', async () => {
    const jpeg = 'data:image/jpeg;base64,AAAA';
    await jpost(host, '/host/frame', { key, jpeg, state: { name: 'Sam', wallet: 3 } });
    const d = await (await fetch(guest + '/frame?code=482913')).json();
    expect(d.jpeg).toBe(jpeg); expect(d.state.name).toBe('Sam'); expect(d.fresh).toBe(true);
    expect((await (await fetch(guest + '/frame?code=111111')).json()).error).toBe('no game here with that code');
  });
  it('the guest\'s input reaches the host once, in order, only the known kinds', async () => {
    await jpost(guest, '/input?code=482913', { events: [{ t: 'down', key: 'ArrowUp' }, { t: 'up', key: 'ArrowUp' }, { t: 'answer', id: 1, text: 'Moss' }, { t: 'cmd', text: 'buy Geode 2' }, { t: 'evil', key: 'x' }, null] });
    const r = await (await jpost(host, '/host/frame', { key })).json();
    expect(r.inputs).toEqual([{ t: 'down', key: 'ArrowUp' }, { t: 'up', key: 'ArrowUp' }, { t: 'answer', id: 1, text: 'Moss' }, { t: 'cmd', id: 0, text: 'buy Geode 2' }]);
    expect(r.guestSeen).toBeGreaterThan(0);
    expect((await (await jpost(host, '/host/frame', { key })).json()).inputs).toEqual([]);
  });
  it('keeps only a JPEG data URL as the frame, and long text is cut', async () => {
    await jpost(host, '/host/frame', { key, jpeg: 'javascript:alert(1)' });
    expect((await (await fetch(guest + '/frame?code=482913')).json()).jpeg).toBe('data:image/jpeg;base64,AAAA');
    await jpost(guest, '/input?code=482913', { events: [{ t: 'cmd', text: 'x'.repeat(500) }] });
    expect((await (await jpost(host, '/host/frame', { key })).json()).inputs[0].text).toHaveLength(80);
  });
  it('closing ends the guest\'s access', async () => {
    await jpost(host, '/host/close', { key });
    expect((await fetch(guest + '/frame?code=482913')).status).toBe(403);
  });
  it('twenty wrong codes in a minute lock that address out for a minute', async () => {
    const fresh = createGuestLink(); const g = await listen(fresh.server);
    let last = 0; for (let k = 0; k < 21; k++) last = (await fetch(g + '/frame?code=' + String(100000 + k))).status;
    expect(last).toBe(429);
    await new Promise(r => fresh.server.close(r));
  });
});
