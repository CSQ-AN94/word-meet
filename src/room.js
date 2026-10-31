import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js?v=4338c59b50a7';

export function cleanName(value) {
  if (typeof value !== 'string') throw new Error('请输入昵称');
  const name = value.trim();
  if (!name || [...name].length > 12 || /[\u0000-\u001f\u007f]/u.test(name)) throw new Error('昵称请写 1–12 个字');
  return name;
}

class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

function checkConfig(endpoint, apiKey) {
  if (!endpoint || !apiKey) throw new ApiError('房间服务尚未开通，请稍后再试', 400);
  let url;
  try { url = new URL(endpoint); } catch { throw new ApiError('房间服务地址配置无效，请稍后再试', 400); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new ApiError('房间服务地址需要使用 HTTPS', 400);
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new ApiError('房间服务地址配置无效，请稍后再试', 400);
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(apiKey);
  if (!publicKey && apiKey.split('.').length === 3) {
    try { publicKey = JSON.parse(atob(apiKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon'; }
    catch { /* Invalid legacy anon key. */ }
  }
  if (!publicKey) throw new ApiError('请使用公开的 publishable key，不能使用管理员密钥', 400);
}

export class RoomConnection {
  constructor(onEvent, { endpoint = SUPABASE_URL, apiKey = SUPABASE_PUBLISHABLE_KEY } = {}) {
    this.onEvent = onEvent;
    this.endpoint = endpoint.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.disposed = false;
    this.connected = false;
    this.requests = new Set();
    this.outbox = [];
    this.after = 0;
    this.failures = 0;
    this.networkUnavailable = false;
    this.peerOffline = false;
  }

  host(name) {
    this.role = 'host';
    this.name = cleanName(name);
    void this.start('create');
  }

  join(name, code, resumeToken) {
    this.role = 'guest';
    this.name = cleanName(name);
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) throw new Error('房间码无效');
    this.code = code;
    this.resumeToken = resumeToken;
    void this.start('join');
  }

  async start(action) {
    try {
      const data = await this.request(action, { name: this.name, ...(this.resumeToken ? { resumeToken: this.resumeToken } : {}) });
      if (this.disposed) return;
      if (typeof data.token !== 'string' || !/^[a-f0-9]{64}$/.test(data.token)) throw new Error('房间服务器返回了无效信息');
      this.token = data.token;
      this.code = data.code;
      this.applySnapshot(data);
      this.schedule(0);
    } catch (error) {
      if (!this.disposed) this.fail(error instanceof ApiError ? error.message : '暂时无法连接房间服务器，请稍后重试');
    }
  }

  async request(action, body = {}) {
    checkConfig(this.endpoint, this.apiKey);
    const controller = new AbortController();
    this.requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(this.endpoint + '/rest/v1/rpc/word_meet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: this.apiKey },
        body: JSON.stringify({ p_request: { action, code: this.code, token: this.token, ...body } }),
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
      });
      let data;
      try { data = await response.json(); }
      catch { throw new ApiError('房间服务器返回了无法识别的响应，请稍后重试', response.status >= 500 ? response.status : 503); }
      if (!response.ok) {
        const message = /^PT\d{3}$/.test(data.code) ? data.message
          : data.code === 'PGRST202' || response.status === 404 ? '房间服务尚未初始化，请稍后再试'
          : [401, 403].includes(response.status) ? '房间服务配置需要更新，请稍后再试'
          : '房间服务暂时不可用，请稍后重试';
        throw new ApiError(message, response.status, data.details || data.code);
      }
      return data;
    } finally {
      clearTimeout(timeout);
      this.requests.delete(controller);
    }
  }

  applySnapshot(data) {
    if (this.disposed) return;
    if (!data || !/^[A-HJ-NP-Z2-9]{8}$/.test(data.code) || ![0, 1].includes(data.seat) || !Array.isArray(data.names)) throw new Error('房间信息无效');
    this.code = data.code;
    const recovered = this.networkUnavailable;
    this.networkUnavailable = false;
    this.failures = 0;
    if (data.sessionId && data.sessionId !== this.sessionId) {
      this.sessionId = data.sessionId;
      this.connected = true;
      this.after = 0;
      this.outbox = this.outbox.filter((packet) => packet.message.sessionId === this.sessionId);
      this.onEvent({ type: 'connected', code: this.code, seat: data.seat, otherName: data.names[1 - data.seat], sessionId: this.sessionId });
    } else if (!data.sessionId && this.sessionId) {
      this.sessionId = null;
      this.connected = false;
      this.after = 0;
      this.outbox = [];
      this.onEvent({ type: 'disconnected', message: '对方已离开房间。可以通过原房间码重新加入，开始新的一局。' });
    } else if (!data.sessionId && !this.waitingAnnounced) {
      this.waitingAnnounced = true;
      this.onEvent({ type: 'waiting', code: this.code });
    }
    if (this.connected) {
      if (!data.peerOnline && !this.peerOffline) {
        this.peerOffline = true;
        this.onEvent({ type: 'peer-offline', message: '对方暂时离线，正在等待恢复。请双方保持游戏页面打开。' });
      } else if (data.peerOnline && (this.peerOffline || recovered)) {
        this.peerOffline = false;
        this.onEvent({ type: 'online', connected: true });
      }
    } else if (recovered) this.onEvent({ type: 'online', connected: false });
    for (const entry of data.messages || []) this.onEvent({ type: 'message', message: entry.message });
    this.after = Math.max(this.after, Number(data.after) || 0);
    void this.flush();
  }

  schedule(delay = 750) {
    if (this.disposed) return;
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.poll(), delay);
  }

  async poll() {
    if (this.disposed || this.polling || !this.token) return;
    this.polling = true;
    let delay = typeof document !== 'undefined' && document.visibilityState === 'hidden' ? 2000 : 750;
    try {
      const data = await this.request('poll', { after: this.after });
      this.applySnapshot(data);
      if (data.messages?.length === 200) delay = 0;
    } catch (error) {
      if (!this.disposed) {
        if (error instanceof ApiError && [400, 401, 403, 404].includes(error.status)) return this.fail(error.message);
        this.markUnavailable();
        delay = Math.min(6000, 750 * 2 ** Math.min(this.failures, 3));
      }
    } finally {
      this.polling = false;
      this.schedule(delay);
    }
  }

  markUnavailable() {
    this.failures++;
    if (this.networkUnavailable || this.disposed) return;
    this.networkUnavailable = true;
    this.onEvent({ type: 'retrying', message: '与房间服务器的连接暂时中断，正在自动恢复。已提交的词语会保留。' });
  }

  send(message) {
    if (this.disposed || !this.token || !this.sessionId) throw new Error('当前未连接房间，请重新加入');
    this.outbox.push({ id: crypto.randomUUID(), message });
    void this.flush();
  }

  async flush() {
    if (this.flushing || this.disposed || !this.token) return;
    this.flushing = true;
    try {
      while (this.outbox.length && !this.disposed) {
        const packet = this.outbox[0];
        if (packet.message.sessionId !== this.sessionId) { this.outbox.shift(); continue; }
        try {
          await this.request('messages', packet);
          if (this.outbox[0] === packet) this.outbox.shift();
        } catch (error) {
          if (this.disposed) return;
          if (error instanceof ApiError && error.code === 'SESSION_CHANGED') {
            this.outbox = this.outbox.filter((entry) => entry.message.sessionId !== packet.message.sessionId);
            this.schedule(0);
          } else if (error instanceof ApiError && [400, 401, 403, 404, 409].includes(error.status)) this.fail(error.message);
          else this.markUnavailable();
          return;
        }
      }
    } finally { this.flushing = false; }
  }

  ping() { this.schedule(0); }

  fail(message) {
    if (this.disposed) return;
    this.onEvent({ type: 'error', message });
    this.dispose();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.connected = false;
    clearTimeout(this.pollTimer);
    for (const controller of this.requests) controller.abort();
    this.requests.clear();
    this.outbox = [];
    if (this.token && this.code) {
      void fetch(this.endpoint + '/rest/v1/rpc/word_meet', {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: this.apiKey },
        body: JSON.stringify({ p_request: { action: 'leave', code: this.code, token: this.token } }), credentials: 'omit', keepalive: true,
      }).catch(() => {});
    }
  }
}
