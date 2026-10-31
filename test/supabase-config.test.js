import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomConnection } from '../src/room.js';

async function rejectedSettings(t, settings) {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return Response.json({ message: 'Unexpected network request' }, { status: 401 });
  });
  const event = await new Promise((resolve) => {
    const room = new RoomConnection((value) => { if (value.type === 'error') resolve(value); }, settings);
    t.after(() => room.dispose());
    room.host('甲');
  });
  return { event, requests };
}

test('missing Supabase configuration produces a clear error without sending a request', async (t) => {
  const result = await rejectedSettings(t, { endpoint: '', apiKey: '' });
  assert.match(result.event.message, /尚未开通|尚未配置/);
  assert.equal(result.requests, 0);
});

test('secret and service_role keys are rejected before they can leave the browser', async (t) => {
  const role = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
  for (const apiKey of ['sb_secret_not_for_the_browser', 'header.' + role + '.signature']) {
    const result = await rejectedSettings(t, { endpoint: 'https://project.supabase.co', apiKey });
    assert.match(result.event.message, /公开|publishable/);
    assert.equal(result.requests, 0);
    t.mock.restoreAll();
  }
});

test('non-local HTTP project URLs are rejected before sending the public key', async (t) => {
  const result = await rejectedSettings(t, { endpoint: 'http://project.supabase.co', apiKey: 'sb_publishable_test' });
  assert.match(result.event.message, /HTTPS/);
  assert.equal(result.requests, 0);
});

test('legacy anon keys use apikey while the room token stays in the RPC body', async (t) => {
  const apiKey = 'header.' + Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url') + '.signature';
  let sent;
  t.mock.method(globalThis, 'fetch', async (url, options) => { sent = { url, ...options }; return Response.json({ ok: true }); });
  const room = new RoomConnection(() => {}, { endpoint: 'https://project.supabase.co', apiKey });
  room.code = 'ABCDEFGH';
  room.token = 'a'.repeat(64);
  await room.request('poll', { after: 7 });
  assert.equal(sent.url, 'https://project.supabase.co/rest/v1/rpc/word_meet');
  assert.equal(sent.headers.apikey, apiKey);
  assert.equal(sent.headers.Authorization, undefined);
  assert.equal(sent.credentials, 'omit');
  assert.deepEqual(JSON.parse(sent.body), { p_request: { action: 'poll', code: room.code, token: room.token, after: 7 } });
});

test('an uninitialized Supabase project reports setup rather than leaking a PostgREST error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 'PGRST202', message: 'Could not find public.word_meet in the schema cache' }, { status: 404 }));
  const event = await new Promise((resolve) => {
    const room = new RoomConnection((value) => { if (value.type === 'error') resolve(value); }, { endpoint: 'https://project.supabase.co', apiKey: 'sb_publishable_test' });
    room.host('甲');
  });
  assert.match(event.message, /尚未初始化/);
});
