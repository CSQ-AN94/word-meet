const PREFIX = 'word-meet-v1-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function cleanName(value) {
  if (typeof value !== 'string') throw new Error('给自己起一个昵称吧');
  const name = value.trim();
  if (!name || [...name].length > 12 || /[\u0000-\u001f\u007f]/u.test(name)) throw new Error('昵称请写 1–12 个字');
  return name;
}

export class RoomConnection {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.peer = null;
    this.connection = null;
    this.disposed = false;
    this.connected = false;
    this.handshakes = new Set();
    this.timers = new Set();
    this.reconnectAttempts = 0;
  }

  later(callback, delay) {
    const timer = setTimeout(() => { this.timers.delete(timer); if (!this.disposed) callback(); }, delay);
    this.timers.add(timer);
    return timer;
  }

  cancel(timer) {
    clearTimeout(timer);
    this.timers.delete(timer);
  }

  host(name, code) {
    this.role = 'host';
    this.name = cleanName(name);
    this.code = code || Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => ALPHABET[byte % 32]).join('');
    this.openPeer(PREFIX + this.code);
  }

  join(name, code) {
    this.role = 'guest';
    this.name = cleanName(name);
    this.code = code;
    this.openPeer();
  }

  openPeer(id) {
    if (!globalThis.Peer || !globalThis.RTCPeerConnection || !crypto.subtle) {
      this.fail('当前浏览器不支持联机，请用新版 Safari、Chrome 或 Edge 打开 HTTPS 链接。');
      return;
    }
    const peer = new globalThis.Peer(id, { secure: true, debug: 0 });
    this.peer = peer;
    let opened = false;
    const timeout = this.later(() => this.fail('连接服务暂时没有回应，请检查网络后重试。'), 25000);
    peer.on('open', () => {
      if (this.disposed || peer !== this.peer) return;
      this.cancel(timeout);
      this.reconnectAttempts = 0;
      if (opened) {
        this.onEvent({ type: 'signaling-restored' });
        return;
      }
      opened = true;
      if (this.role === 'host') {
        this.onEvent({ type: 'waiting', code: this.code });
      } else {
        const connection = peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json', label: 'word-meet-v1' });
        this.attach(connection, false);
      }
    });
    peer.on('connection', (connection) => {
      if (this.disposed || peer !== this.peer) return connection.close();
      if (this.role !== 'host') return connection.close();
      this.attach(connection, true);
    });
    peer.on('disconnected', () => {
      if (this.disposed || peer !== this.peer) return;
      if (!this.connected) this.onEvent({ type: 'signaling', message: '连接服务暂时断开，正在恢复…' });
      this.reconnectSignaling(peer);
    });
    peer.on('error', (error) => {
      if (this.disposed || peer !== this.peer) return;
      if (error.type === 'unavailable-id' && this.role === 'host' && !this.connected) {
        this.cancel(timeout);
        peer.destroy();
        if ((this.collisions = (this.collisions || 0) + 1) < 4) this.host(this.name);
        else this.fail('房间创建失败，请稍后重试。');
        return;
      }
      if (this.connected && ['network', 'socket-error', 'server-error'].includes(error.type)) return;
      const messages = {
        'peer-unavailable': '找不到这个房间。请检查房间码，并确认房主还开着页面。',
        'browser-incompatible': '这个浏览器暂不支持联机，请换一个新版浏览器。',
        'network': '暂时连接不到联机服务，请检查网络后重试。',
        'webrtc': '两人的网络没能连通。可以换一个网络，再重新加入。',
        'socket-error': '联机服务连接失败，请稍后重试。',
      };
      this.fail(messages[error.type] || '连接暂时出了点问题，请重新试一次。');
    });
  }

  reconnectSignaling(peer) {
    if (this.reconnectAttempts >= 4) {
      if (!this.connected) this.fail('连接服务恢复失败，请重新创建或加入房间。');
      return;
    }
    this.later(() => {
      if (peer !== this.peer || peer.destroyed || !peer.disconnected) return;
      this.reconnectAttempts++;
      peer.reconnect();
      this.reconnectSignaling(peer);
    }, 1800 * (this.reconnectAttempts + 1));
  }

  attach(connection, incoming) {
    this.handshakes.add(connection);
    let accepted = false;
    let rejected = false;
    const deadline = this.later(() => {
      connection.close();
      if (!incoming && !this.connected) this.fail('两人的网络没能连通。请让房主保持页面打开，也可以换个网络再试。');
    }, 25000);

    const reject = (message) => {
      rejected = true;
      this.cancel(deadline);
      if (connection.open) connection.send({ type: 'reject', message });
      this.later(() => connection.close(), 300);
    };

    connection.on('open', () => {
      if (this.disposed) return connection.close();
      if (!incoming) connection.send({ type: 'hello', v: 1, name: this.name });
    });
    connection.on('data', (message) => {
      if (this.disposed || rejected) return;
      if (!message || typeof message !== 'object' || Array.isArray(message) || JSON.stringify(message).length > 4096) {
        if (!accepted) reject('收到的房间信息无效，请重新加入。');
        else this.fail('对方发送了无效信息，请重新连接。');
        return;
      }
      if (!accepted) {
        if (!incoming && message.type === 'reject') {
          this.fail(typeof message.message === 'string' ? message.message.slice(0, 150) : '暂时不能加入这个房间。');
          return;
        }
        try {
          if (incoming) {
            if (message.type !== 'hello' || message.v !== 1) return reject('游戏版本不一致，请刷新后重新加入。');
            const otherName = cleanName(message.name);
            if (this.connection?.open) return reject('房间已经有两个人啦，请让朋友创建一个新房间。');
            this.sessionId = crypto.randomUUID();
            connection.send({ type: 'welcome', v: 1, sessionId: this.sessionId, name: this.name });
            this.accept(connection, otherName, 0);
          } else {
            if (message.type !== 'welcome' || message.v !== 1 || typeof message.sessionId !== 'string' ||
                !/^[a-zA-Z0-9-]{1,80}$/.test(message.sessionId)) return this.fail('房间信息无效，请重新加入。');
            this.sessionId = message.sessionId;
            this.accept(connection, cleanName(message.name), 1);
          }
          accepted = true;
          this.cancel(deadline);
        } catch (error) {
          if (incoming) reject(error.message);
          else this.fail(error.message);
        }
        return;
      }
      if (connection !== this.connection) return;
      this.lastSeen = Date.now();
      if (message.type === 'ping') return connection.send({ type: 'pong' });
      if (message.type === 'pong') return;
      this.onEvent({ type: 'message', message });
    });
    connection.on('close', () => {
      this.cancel(deadline);
      this.handshakes.delete(connection);
      if (this.disposed || rejected) return;
      if (connection === this.connection) {
        this.connection = null;
        this.connected = false;
        clearInterval(this.heartbeat);
        this.onEvent({ type: 'disconnected', message: this.role === 'host'
          ? '朋友的连接已断开。让 TA 用原链接重新加入，就能开始新的一局。'
          : '和房主的连接断开了。重新连接会开始新的一局。' });
      } else if (!incoming && !accepted && !this.failed) this.fail('没能加入房间，请检查房间码和网络后重试。');
    });
    connection.on('error', () => {
      if (connection === this.connection) connection.close();
      else if (!incoming && !this.disposed) this.fail('连接没有建立成功，请换个网络再试。');
    });
  }

  accept(connection, otherName, seat) {
    this.connection = connection;
    this.connected = true;
    this.lastSeen = Date.now();
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (!this.connection?.open) return;
      if (document.visibilityState === 'visible' && Date.now() - this.lastSeen > 60000) {
        this.connection.close();
        return;
      }
      this.connection.send({ type: 'ping' });
    }, 8000);
    this.onEvent({ type: 'connected', code: this.code, seat, otherName, sessionId: this.sessionId });
  }

  ping() {
    this.lastSeen = Date.now();
    if (this.connection?.open) this.connection.send({ type: 'ping' });
  }

  send(message) {
    if (!this.connection?.open || !this.connected) throw new Error('连接已断开，请先重新连接');
    this.connection.send(message);
  }

  fail(message) {
    if (this.disposed || this.failed) return;
    this.failed = true;
    this.onEvent({ type: 'error', message });
    this.dispose();
  }

  dispose() {
    this.disposed = true;
    this.connected = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    clearInterval(this.heartbeat);
    for (const connection of this.handshakes) connection.close();
    this.handshakes.clear();
    this.connection?.close();
    this.peer?.destroy();
  }
}
