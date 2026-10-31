const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TTL = 2 * 60 * 60 * 1000;
const GUEST_LEASE = 90000;
const PUBLIC_ORIGINS = new Set([
  'https://csq-an94.github.io',
  'https://word-meet-csq-an94.chirpy-lemur-3231.chatgpt.site',
]);

class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED') { super(message); this.status = status; this.code = code; }
}

function nameOf(value) {
  if (typeof value !== 'string') throw new HttpError(400, '请输入昵称');
  const name = value.trim();
  if (!name || [...name].length > 12 || /[\u0000-\u001f\u007f]/u.test(name)) throw new HttpError(400, '昵称请写 1–12 个字');
  return name;
}

function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '请求内容为空');
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 4096) { await reader.cancel(); throw new HttpError(413, '请求内容过长'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(400, '请求格式无效'); }
}

function snapshot(room, seat, now, messages = [], after = 0) {
  const peerSeen = seat === 0 ? room.guest_seen : room.host_seen;
  return {
    code: room.code, seat, sessionId: room.session_id,
    names: [room.host_name, room.guest_name],
    peerOnline: Boolean(peerSeen && now - peerSeen < 45000),
    messages: messages.map((entry) => ({ id: entry.id, message: JSON.parse(entry.payload) })),
    after: messages.length ? messages.at(-1).id : after,
  };
}

function gameMessage(value, sessionId) {
  if (!value || value.v !== 1 || value.sessionId !== sessionId) throw new HttpError(409, '对局已更新，请重新加入', 'SESSION_CHANGED');
  if (!Number.isSafeInteger(value.match) || value.match < 1 || !Number.isSafeInteger(value.round) || value.round < 1) throw new HttpError(400, '对局轮次无效');
  const base = { v: 1, sessionId, match: value.match, round: value.round, type: value.type };
  if (value.type === 'commit' && typeof value.hash === 'string' && /^[a-f0-9]{64}$/.test(value.hash)) return { ...base, hash: value.hash };
  if (value.type === 'ready') return base;
  if (value.type === 'reveal' && typeof value.word === 'string' && typeof value.salt === 'string' && /^[a-f0-9]{32}$/.test(value.salt)) {
    const word = value.word.trim().normalize('NFC');
    if (word && [...word].length <= 20 && !/[\u0000-\u001f\u007f]/u.test(word)) return { ...base, word, salt: value.salt };
  }
  throw new HttpError(400, '对局消息格式无效');
}

async function authenticate(request, db, code, now, bodyToken) {
  const token = bodyToken ?? request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, '本次连接已失效，请重新加入', 'INVALID_TOKEN');
  const tokenHash = await hashToken(token);
  const room = await db.prepare('SELECT * FROM rooms WHERE code = ? AND expires_at > ?').bind(code, now).first();
  if (!room) throw new HttpError(404, '房间已关闭或已过期，请重新建房', 'ROOM_CLOSED');
  const seat = room.host_token_hash === tokenHash ? 0 : room.guest_token_hash === tokenHash ? 1 : -1;
  if (seat === -1) throw new HttpError(401, '本次连接已失效，请重新加入', 'INVALID_TOKEN');
  return { room, seat, tokenHash };
}

export async function handleRequest(request, db, { now: clock = Date.now } = {}) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  let allowed = !origin || origin === url.origin || PUBLIC_ORIGINS.has(origin);
  if (origin && !allowed) {
    try { const parsed = new URL(origin); allowed = parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname); } catch { /* Reject invalid origins. */ }
  }
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
    ...(allowed && origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
  };
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });
  try {
    if (!allowed) throw new HttpError(403, '请求来源不受支持');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method === 'GET' && url.pathname === '/api/health') return json({ ok: true, transport: 'https', protocol: 2 });
    if (!db) throw new HttpError(503, '房间服务尚未准备就绪，请稍后重试');
    const now = clock();
    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      const body = await readBody(request);
      const name = nameOf(body.name);
      const token = randomToken();
      const tokenHash = await hashToken(token);
      await db.prepare('DELETE FROM rooms WHERE expires_at <= ?').bind(now).run();
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), (value) => ALPHABET[value % 32]).join('');
        const result = await db.prepare('INSERT OR IGNORE INTO rooms (code, host_token_hash, host_name, created_at, expires_at, host_seen) VALUES (?, ?, ?, ?, ?, ?) RETURNING *')
          .bind(code, tokenHash, name, now, now + TTL, now).first();
        if (result) return json({ ...snapshot(result, 0, now), token }, 201);
      }
      throw new HttpError(503, '房间创建失败，请重试');
    }
    const route = /^\/api\/rooms\/([A-HJ-NP-Z2-9]{8})\/(join|poll|messages|leave)$/.exec(url.pathname);
    if (!route) throw new HttpError(404, '接口不存在');
    const [, code, action] = route;
    if (action === 'join' && request.method === 'POST') {
      const body = await readBody(request);
      const name = nameOf(body.name);
      const resumeHash = typeof body.resumeToken === 'string' && /^[a-f0-9]{64}$/.test(body.resumeToken) ? await hashToken(body.resumeToken) : null;
      const token = randomToken();
      const tokenHash = await hashToken(token);
      const sessionId = crypto.randomUUID();
      const room = await db.prepare('UPDATE rooms SET guest_token_hash = ?, guest_name = ?, guest_seen = ?, session_id = ?, expires_at = ? WHERE code = ? AND expires_at > ? AND (guest_token_hash IS NULL OR guest_seen < ? OR guest_token_hash = ?) RETURNING *')
        .bind(tokenHash, name, now, sessionId, now + TTL, code, now, now - GUEST_LEASE, resumeHash).first();
      if (room) {
        await db.prepare('DELETE FROM messages WHERE code = ? AND session_id <> ? AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND session_id = ?)').bind(code, sessionId, code, sessionId).run();
        return json({ ...snapshot(room, 1, now), token });
      }
      const exists = await db.prepare('SELECT code FROM rooms WHERE code = ? AND expires_at > ?').bind(code, now).first();
      if (!exists) throw new HttpError(404, '找不到房间，请检查房间码或让对方重新建房', 'ROOM_CLOSED');
      throw new HttpError(409, '房间已满，每个房间最多两人', 'ROOM_FULL');
    }
    const bodyToken = action === 'leave' && request.method === 'POST' && !request.headers.has('Authorization') ? (await readBody(request)).token : undefined;
    const { room, seat, tokenHash } = await authenticate(request, db, code, now, bodyToken);
    const tokenColumn = seat === 0 ? 'host_token_hash' : 'guest_token_hash';
    const seenColumn = seat === 0 ? 'host_seen' : 'guest_seen';
    if (action === 'poll' && request.method === 'GET') {
      const after = Number(url.searchParams.get('after') || 0);
      if (!Number.isSafeInteger(after) || after < 0) throw new HttpError(400, '消息游标无效');
      const result = await db.batch([
        db.prepare(`UPDATE rooms SET ${seenColumn} = ?, expires_at = ? WHERE code = ? AND ${tokenColumn} = ?`).bind(now, now + TTL, code, tokenHash),
        db.prepare('SELECT id, payload FROM messages WHERE code = ? AND session_id = ? AND sender <> ? AND id > ? ORDER BY id LIMIT 200').bind(code, room.session_id, seat, after),
      ]);
      return json(snapshot(room, seat, now, result[1].results, after));
    }
    if (action === 'messages' && request.method === 'POST') {
      const body = await readBody(request);
      if (typeof body.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(body.id)) throw new HttpError(400, '消息编号无效');
      if (!room.session_id) throw new HttpError(409, '另一位玩家尚未加入', 'SESSION_CHANGED');
      const message = gameMessage(body.message, room.session_id);
      const payload = JSON.stringify(message);
      const result = await db.prepare(`INSERT OR IGNORE INTO messages (code, session_id, sender, client_id, payload, created_at) SELECT ?, ?, ?, ?, ?, ? FROM rooms WHERE code = ? AND session_id = ? AND ${tokenColumn} = ? AND expires_at > ?`)
        .bind(code, room.session_id, seat, body.id, payload, now, code, room.session_id, tokenHash, now).run();
      if (!result.meta.changes) {
        const previous = await db.prepare('SELECT payload FROM messages WHERE code = ? AND session_id = ? AND sender = ? AND client_id = ?').bind(code, room.session_id, seat, body.id).first();
        if (!previous) throw new HttpError(409, '对局已更新，请重新加入', 'SESSION_CHANGED');
        if (previous.payload !== payload) throw new HttpError(409, '不能修改已发送的消息');
      }
      return json({ ok: true });
    }
    if (action === 'leave' && request.method === 'POST') {
      if (seat === 0) await db.prepare('DELETE FROM rooms WHERE code = ? AND host_token_hash = ?').bind(code, tokenHash).run();
      else await db.batch([
        db.prepare('UPDATE rooms SET guest_token_hash = NULL, guest_name = NULL, guest_seen = NULL, session_id = NULL WHERE code = ? AND guest_token_hash = ?').bind(code, tokenHash),
        db.prepare('DELETE FROM messages WHERE code = ? AND session_id = ?').bind(code, room.session_id),
      ]);
      return json({ ok: true });
    }
    throw new HttpError(405, '请求方法不受支持');
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status);
    console.error('Room API failure:', error.message);
    return json({ error: '房间服务暂时出错，请稍后重试', code: 'SERVER_ERROR' }, 500);
  }
}
