import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../server/api.js';
import { testDatabase } from './support/d1.js';

function setup(t) {
  const db = testDatabase();
  t.after(() => db.close());
  let time = 1000000;
  async function request(path, { token, method = 'GET', body, origin } = {}) {
    const response = await handleRequest(new Request('https://game.example/api' + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(origin ? { Origin: origin } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), db, { now: () => time });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), headers: response.headers };
  }
  return { request, advance: (milliseconds) => { time += milliseconds; } };
}

async function roomPair(request) {
  const host = await request('/rooms', { method: 'POST', body: { name: '甲' } });
  assert.equal(host.status, 201);
  const guest = await request('/rooms/' + host.data.code + '/join', { method: 'POST', body: { name: '乙' } });
  assert.equal(guest.status, 200);
  return { host: host.data, guest: guest.data };
}

test('a room is created and a second device joins through ordinary HTTPS requests', async (t) => {
  const { request } = setup(t);
  const { host, guest } = await roomPair(request);
  assert.match(host.code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.notEqual(host.token, guest.token);
  const poll = await request('/rooms/' + host.code + '/poll?after=0', { token: host.token });
  assert.equal(poll.status, 200);
  assert.equal(poll.data.sessionId, guest.sessionId);
  assert.deepEqual(poll.data.names, ['甲', '乙']);
  assert.equal(poll.data.seat, 0);
  assert.equal(JSON.stringify(poll.data).includes(guest.token), false);
});

test('simultaneous join requests cannot admit two guests', async (t) => {
  const { request } = setup(t);
  const created = await request('/rooms', { method: 'POST', body: { name: '甲' } });
  const results = await Promise.all(['乙', '丙'].map((name) => request('/rooms/' + created.data.code + '/join', { method: 'POST', body: { name } })));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
});

test('messages are authenticated, ordered, and not delivered back to their sender', async (t) => {
  const { request } = setup(t);
  const { host, guest } = await roomPair(request);
  const body = { id: 'message-one', message: { v: 1, sessionId: guest.sessionId, match: 1, round: 1, type: 'commit', hash: 'a'.repeat(64) } };
  assert.equal((await request('/rooms/' + host.code + '/messages', { method: 'POST', body })).status, 401);
  const sent = await request('/rooms/' + host.code + '/messages', { method: 'POST', token: host.token, body });
  assert.equal(sent.status, 200);
  assert.equal((await request('/rooms/' + host.code + '/messages', { method: 'POST', token: host.token, body })).status, 200);
  const received = await request('/rooms/' + host.code + '/poll?after=0', { token: guest.token });
  assert.equal(received.data.messages.length, 1);
  assert.deepEqual(received.data.messages[0].message, body.message);
  const next = await request('/rooms/' + host.code + '/poll?after=' + received.data.after, { token: guest.token });
  assert.equal(next.data.messages.length, 0);
  const own = await request('/rooms/' + host.code + '/poll?after=0', { token: host.token });
  assert.equal(own.data.messages.length, 0);
});

test('guest departure permits a new guest and invalidates packets from the previous session', async (t) => {
  const { request } = setup(t);
  const { host, guest } = await roomPair(request);
  assert.equal((await request('/rooms/' + host.code + '/leave', { method: 'POST', token: guest.token })).status, 200);
  const replacement = await request('/rooms/' + host.code + '/join', { method: 'POST', body: { name: '丙' } });
  assert.equal(replacement.status, 200);
  assert.notEqual(replacement.data.sessionId, guest.sessionId);
  assert.equal((await request('/rooms/' + host.code + '/poll', { token: guest.token })).status, 401);
  const stale = { id: 'stale', message: { v: 1, sessionId: guest.sessionId, match: 1, round: 1, type: 'ready' } };
  assert.equal((await request('/rooms/' + host.code + '/messages', { token: host.token, method: 'POST', body: stale })).status, 409);
});

test('rooms expire and a stale guest lease can be replaced without overwriting an active guest', async (t) => {
  const { request, advance } = setup(t);
  const { host, guest } = await roomPair(request);
  advance(100000);
  const replacement = await request('/rooms/' + host.code + '/join', { method: 'POST', body: { name: '丙' } });
  assert.equal(replacement.status, 200);
  assert.equal((await request('/rooms/' + host.code + '/leave', { method: 'POST', token: guest.token })).status, 401);
  advance(3 * 60 * 60 * 1000);
  assert.equal((await request('/rooms/' + host.code + '/poll', { token: host.token })).status, 404);
});

test('hosting-origin and GitHub Pages requests work without cookies; other origins are rejected', async (t) => {
  const { request } = setup(t);
  const cors = await request('/rooms', { method: 'OPTIONS', origin: 'https://csq-an94.github.io' });
  assert.equal(cors.status, 204);
  assert.equal(cors.headers.get('Access-Control-Allow-Origin'), 'https://csq-an94.github.io');
  assert.match(cors.headers.get('Access-Control-Allow-Headers'), /authorization/i);
  const denied = await request('/rooms', { method: 'POST', origin: 'https://unrelated.example', body: { name: '甲' } });
  assert.equal(denied.status, 403);
});

test('a plain-text keepalive leave request releases the seat without a CORS preflight', async (t) => {
  const db = testDatabase();
  t.after(() => db.close());
  const hostResponse = await handleRequest(new Request('https://game.example/api/rooms', { method: 'POST', body: JSON.stringify({ name: '甲' }) }), db);
  const host = await hostResponse.json();
  const guestResponse = await handleRequest(new Request('https://game.example/api/rooms/' + host.code + '/join', { method: 'POST', body: JSON.stringify({ name: '乙' }) }), db);
  const guest = await guestResponse.json();
  const left = await handleRequest(new Request('https://game.example/api/rooms/' + host.code + '/leave', {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8', Origin: 'https://csq-an94.github.io' }, body: JSON.stringify({ token: guest.token }),
  }), db);
  assert.equal(left.status, 200);
  const rejoin = await handleRequest(new Request('https://game.example/api/rooms/' + host.code + '/join', { method: 'POST', body: JSON.stringify({ name: '丙' }) }), db);
  assert.equal(rejoin.status, 200);
});

test('an authenticated guest can rejoin before its old leave request arrives', async (t) => {
  const { request } = setup(t);
  const { host, guest } = await roomPair(request);
  const rejoined = await request('/rooms/' + host.code + '/join', { method: 'POST', body: { name: '乙', resumeToken: guest.token } });
  assert.equal(rejoined.status, 200);
  assert.notEqual(rejoined.data.token, guest.token);
  assert.notEqual(rejoined.data.sessionId, guest.sessionId);
  assert.equal((await request('/rooms/' + host.code + '/leave', { method: 'POST', token: guest.token })).status, 401);
  const current = await request('/rooms/' + host.code + '/poll', { token: rejoined.data.token });
  assert.equal(current.status, 200);
  assert.equal(current.data.sessionId, rejoined.data.sessionId);
});
