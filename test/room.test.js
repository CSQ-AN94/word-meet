import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RoomConnection, cleanName } from '../src/room.js';

class Channel extends EventEmitter {
  open = true;
  sent = [];
  send(message) { this.sent.push(message); }
  close() { if (this.open) { this.open = false; this.emit('close'); } }
}

// Only the remote PeerJS service is replaced; room admission and lifecycle are real.
function environment(t) {
  const saved = Object.fromEntries(['Peer', 'RTCPeerConnection', 'document'].map((key) => [key, globalThis[key]]));
  const peers = [];
  const rooms = [];
  globalThis.RTCPeerConnection = class {};
  globalThis.document = { visibilityState: 'visible' };
  globalThis.Peer = class extends EventEmitter {
    destroyed = false;
    channels = [];
    constructor(id) { super(); this.id = id; peers.push(this); }
    connect() { const channel = new Channel(); this.channels.push(channel); return channel; }
    destroy() { this.destroyed = true; }
  };
  t.after(() => {
    rooms.forEach((room) => room.dispose());
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  return {
    peers,
    room() {
      const events = [];
      const room = new RoomConnection((event) => events.push(event));
      rooms.push(room);
      return { room, events };
    },
  };
}

function admit(peer, name = '朋友') {
  const channel = new Channel();
  peer.emit('connection', channel);
  channel.emit('open');
  channel.emit('data', { type: 'hello', v: 1, name });
  return channel;
}

test('nickname validation rejects blank, multiline and overlong names', () => {
  assert.equal(cleanName(' 小橘子 '), '小橘子');
  for (const invalid of ['', ' ', 'a\nb', '词'.repeat(13), {}]) assert.throws(() => cleanName(invalid));
});

test('a host admits only two players and forwards game messages from the admitted guest', (t) => {
  const env = environment(t);
  const { room, events } = env.room();
  room.host('小橘子', 'ABCD2345');
  const peer = env.peers[0];
  peer.emit('open');
  const guest = admit(peer);
  assert.equal(events.at(-1).type, 'connected');
  assert.equal(events.at(-1).seat, 0);
  assert.equal(events.at(-1).otherName, '朋友');
  const third = admit(peer, '第三人');
  assert.equal(third.sent[0].type, 'reject');
  assert.match(third.sent[0].message, /两个人/);
  assert.equal(events.filter((event) => event.type === 'connected').length, 1);
  guest.emit('data', { type: 'commit', hash: 'a'.repeat(64) });
  assert.equal(events.at(-1).type, 'message');
  assert.equal(events.at(-1).message.type, 'commit');
});

test('a disconnected guest can rejoin and gets a new session', (t) => {
  const env = environment(t);
  const { room, events } = env.room();
  room.host('小橘子', 'ABCD2345');
  const peer = env.peers[0];
  peer.emit('open');
  const first = admit(peer);
  const sessionId = events.at(-1).sessionId;
  first.close();
  assert.equal(events.at(-1).type, 'disconnected');
  admit(peer);
  assert.equal(events.at(-1).type, 'connected');
  assert.notEqual(events.at(-1).sessionId, sessionId);
});

test('recovering signaling does not hide an active host game', (t) => {
  const env = environment(t);
  const { room, events } = env.room();
  room.host('小橘子', 'ABCD2345');
  const peer = env.peers[0];
  peer.emit('open');
  admit(peer);
  peer.emit('open');
  assert.equal(room.connected, true);
  assert.equal(events.filter((event) => event.type === 'waiting').length, 1);
});

test('recovering guest signaling does not create a second game connection', (t) => {
  const env = environment(t);
  const { room, events } = env.room();
  room.join('朋友', 'ABCD2345');
  const peer = env.peers[0];
  peer.emit('open');
  const channel = peer.channels[0];
  channel.emit('open');
  channel.emit('data', { type: 'welcome', v: 1, sessionId: 'new-session', name: '小橘子' });
  assert.equal(events.at(-1).type, 'connected');
  peer.emit('open');
  assert.equal(peer.channels.length, 1);
  assert.equal(room.connected, true);
});

test('invalid handshakes cannot occupy a room', (t) => {
  const env = environment(t);
  const { room, events } = env.room();
  room.host('小橘子', 'ABCD2345');
  const peer = env.peers[0];
  peer.emit('open');
  const invalid = admit(peer, {});
  assert.equal(invalid.sent[0].type, 'reject');
  assert.equal(room.connected, false);
  admit(peer);
  assert.equal(events.at(-1).type, 'connected');
});
