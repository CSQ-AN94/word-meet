import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { postgresDatabase } from './support/postgres.js';

let db;
before(async () => { db = await postgresDatabase(); });
beforeEach(async () => {
  const exists = await db.pg.query("SELECT to_regclass('word_meet_private.rooms') AS name");
  if (exists.rows[0].name) await db.pg.exec('TRUNCATE word_meet_private.rooms CASCADE');
});
after(async () => db?.close());

async function create(name = '甲') {
  const reply = await db.call({ action: 'create', name });
  assert.equal(reply.status, 200, reply.body.message);
  return reply.body;
}
async function pair() {
  const host = await create();
  const reply = await db.call({ action: 'join', code: host.code, name: '乙' });
  assert.equal(reply.status, 200, reply.body.message);
  return { host, guest: reply.body };
}
const send = (player, message, id = crypto.randomUUID()) => db.call({ action: 'messages', code: player.code, token: player.token, id, message });

test('create returns a private seat token and an eight-character room code', async () => {
  const host = await create();
  assert.match(host.code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.match(host.token, /^[a-f0-9]{64}$/);
  assert.equal(host.seat, 0);
  assert.deepEqual(host.names, ['甲', null]);
  assert.equal(host.sessionId, null);
  const stored = await db.pg.query('SELECT host_token_hash FROM word_meet_private.rooms');
  assert.notEqual(stored.rows[0].host_token_hash, host.token);
});

test('simultaneous guest joins cannot allocate more than one guest seat', async () => {
  const host = await create();
  const replies = await Promise.all(['乙', '丙'].map((name) => db.call({ action: 'join', code: host.code, name })));
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
  assert.equal(replies.find((r) => r.status === 409).body.details, 'ROOM_FULL');
});

test('anonymous callers cannot read private tables or poll without the correct seat token', async () => {
  const { host } = await pair();
  assert.equal((await db.call({ action: 'poll', code: host.code })).status, 401);
  assert.equal((await db.call({ action: 'poll', code: host.code, token: '0'.repeat(64) })).status, 401);
  await assert.rejects(db.pg.transaction(async (tx) => {
    await tx.exec('SET LOCAL ROLE anon');
    await tx.query('SELECT * FROM word_meet_private.rooms');
  }), (error) => error.code === '42501');
  await assert.rejects(db.pg.transaction(async (tx) => {
    await tx.exec('SET LOCAL ROLE authenticated');
    await tx.query('SELECT * FROM word_meet_private.messages');
  }), (error) => error.code === '42501');
});

test('message delivery is ordered, deduplicated and restricted to the current session', async () => {
  const { host, guest } = await pair();
  const message = { v: 1, sessionId: guest.sessionId, match: 1, round: 1, type: 'commit', hash: 'a'.repeat(64) };
  assert.equal((await send(host, message, 'one')).status, 200);
  assert.equal((await send(host, message, 'one')).status, 200);
  assert.equal((await send(host, { ...message, hash: 'b'.repeat(64) }, 'one')).status, 409);
  const polled = await db.call({ action: 'poll', code: guest.code, token: guest.token, after: 0 });
  assert.equal(polled.status, 200, polled.body.message);
  assert.equal(polled.body.messages.length, 1);
  assert.deepEqual(polled.body.messages[0].message, message);
  const empty = await db.call({ action: 'poll', code: guest.code, token: guest.token, after: polled.body.after });
  assert.deepEqual(empty.body.messages, []);
  assert.equal((await send(host, { ...message, sessionId: crypto.randomUUID() })).body.details, 'SESSION_CHANGED');
});

test('authenticated rejoin replaces the guest and a late old leave cannot remove the new seat', async () => {
  const { host, guest } = await pair();
  const next = await db.call({ action: 'join', code: host.code, name: '乙', resumeToken: guest.token });
  assert.equal(next.status, 200, next.body.message);
  assert.notEqual(next.body.sessionId, guest.sessionId);
  assert.equal((await db.call({ action: 'leave', code: host.code, token: guest.token })).status, 401);
  const poll = await db.call({ action: 'poll', code: host.code, token: next.body.token });
  assert.equal(poll.status, 200, poll.body.message);
  assert.equal(poll.body.sessionId, next.body.sessionId);
});

test('inactive guest leases expire and host leave closes the room', async () => {
  const { host, guest } = await pair();
  await db.pg.query('UPDATE word_meet_private.rooms SET guest_seen = 0 WHERE code = $1', [host.code]);
  const next = await db.call({ action: 'join', code: host.code, name: '丙' });
  assert.equal(next.status, 200, next.body.message);
  assert.notEqual(next.body.sessionId, guest.sessionId);
  assert.equal((await db.call({ action: 'leave', code: host.code, token: host.token })).status, 200);
  assert.equal((await db.call({ action: 'poll', code: host.code, token: next.body.token })).status, 404);
});

test('expired rooms cannot be polled and are cleaned by the next room creation', async () => {
  const host = await create();
  await db.pg.query('UPDATE word_meet_private.rooms SET expires_at = 0 WHERE code = $1', [host.code]);
  assert.equal((await db.call({ action: 'poll', code: host.code, token: host.token })).status, 404);
  await create('丙');
  assert.equal((await db.pg.query('SELECT count(*)::int AS count FROM word_meet_private.rooms')).rows[0].count, 1);
});

test('names, Unicode words, message types and numeric boundaries are validated', async () => {
  assert.equal((await db.call({ action: 'create', name: '\u3000\t' })).status, 400);
  assert.equal((await db.call({ action: 'create', name: '甲\n乙' })).status, 400);
  assert.equal((await db.call({ action: 'create', name: '甲'.repeat(13) })).status, 400);
  const { host, guest } = await pair();
  const base = { v: 1, sessionId: guest.sessionId, match: 1, round: 1 };
  assert.equal((await send(host, { ...base, type: 'reveal', word: ' e\u0301 ', salt: 'c'.repeat(32) })).status, 200);
  const poll = await db.call({ action: 'poll', code: guest.code, token: guest.token });
  assert.equal(poll.body.messages[0].message.word, 'é');
  for (const message of [
    { ...base, type: 'reveal', word: '字'.repeat(21), salt: 'c'.repeat(32) },
    { ...base, type: 'commit', hash: 'oops' },
    { ...base, type: 'ready', round: 1.5 },
    { ...base, type: 'ready', match: null },
    { ...base, type: 'ready', match: 9007199254740992 },
    { ...base, type: 'unknown' },
  ]) assert.equal((await send(host, message)).status, 400);
  assert.equal((await db.call({ action: 'poll', code: host.code, token: host.token, after: -1 })).status, 400);
  assert.equal((await db.call({ action: 'poll', code: host.code, token: host.token, after: 'bad' })).status, 400);
  assert.equal((await db.call({ action: 'create', name: 'a'.repeat(5000) })).status, 413);
});

test('setup can be applied twice without deleting an existing room', async () => {
  const host = await create();
  await db.pg.exec(await readFile(new URL('../supabase/setup.sql', import.meta.url), 'utf8'));
  assert.equal((await db.call({ action: 'poll', code: host.code, token: host.token })).status, 200);
});
