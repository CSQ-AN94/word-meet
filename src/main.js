import { GameSession, parseRoomCode } from './game.js';
import { RoomConnection, cleanName } from './room.js';

const $ = (id) => document.getElementById(id);
const state = { mode: 'create', busy: false, inRoom: false, connected: false, code: '', role: '', game: null, network: null, names: [], seat: 0, protocolError: false };
let inbox = Promise.resolve();
let renderedRound = '';
let renderedHistory = '';
let celebrated = '';
let toastTimer;

function showError(id, message) {
  $(id).textContent = message;
  $(id).hidden = !message;
}

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200);
}

function setBusy(busy) {
  state.busy = busy;
  $('entry-submit').disabled = busy;
  $('nickname').disabled = busy;
  $('room-code').disabled = busy;
  $('create-tab').disabled = busy;
  $('join-tab').disabled = busy;
  $('entry-submit-text').textContent = busy ? '正在连接…' : state.mode === 'create' ? '创建我们的房间' : '去和 TA 相遇';
}

function setMode(mode) {
  if (state.busy) return;
  state.mode = mode;
  for (const current of ['create', 'join']) {
    $(current + '-tab').setAttribute('aria-selected', String(mode === current));
    $(current + '-tab').tabIndex = mode === current ? 0 : -1;
  }
  $('entry-panel').setAttribute('aria-labelledby', mode + '-tab');
  $('room-code-field').hidden = mode !== 'join';
  $('room-code').required = mode === 'join';
  $('entry-description').textContent = mode === 'create' ? '建一个小房间，等一个懂你的人。' : '带着房间码，去赴一场灵感之约。';
  showError('entry-error', '');
  setBusy(false);
}

function inviteURL() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = new URLSearchParams({ room: state.code }).toString();
  return url.href;
}

function enterRoom(code) {
  state.code = code;
  state.inRoom = true;
  setBusy(false);
  $('home').hidden = true;
  $('room').hidden = false;
  $('display-code').textContent = code.slice(0, 4) + '-' + code.slice(4);
  $('invite-url').value = inviteURL();
  $('share-url').value = inviteURL();
  $('waiting-name').textContent = state.name;
  history.replaceState(null, '', inviteURL());
}

function connectionStatus(text, status) {
  $('connection-status').textContent = text;
  $('connection-status').dataset.state = status;
}

function showConnectionBanner(message) {
  $('connection-banner').hidden = !message;
  $('connection-message').textContent = message;
  $('reconnect-button').textContent = state.role === 'host' ? '重新建房' : '重新连接';
}

function startConnection(role, code) {
  state.network?.dispose();
  state.role = role;
  state.connected = false;
  state.protocolError = false;
  state.game = null;
  inbox = Promise.resolve();
  renderedRound = '';
  renderedHistory = '';
  celebrated = '';
  setBusy(true);
  showError('entry-error', '');
  showError('word-error', '');
  showConnectionBanner('');
  if (state.inRoom) {
    $('waiting').hidden = false;
    $('game').hidden = true;
    connectionStatus('正在连接', 'connecting');
  }
  const network = new RoomConnection((event) => {
    if (state.network !== network) return;
    if (event.type === 'waiting') {
      enterRoom(event.code);
      $('waiting').hidden = false;
      $('game').hidden = true;
      connectionStatus('等 TA 加入', 'online');
    } else if (event.type === 'connected') {
      enterRoom(event.code);
      state.connected = true;
      state.seat = event.seat;
      state.names = event.seat === 0 ? [state.name, event.otherName] : [event.otherName, state.name];
      $('waiting').hidden = true;
      $('game').hidden = false;
      showConnectionBanner('');
      connectionStatus('两人已连接', 'online');
      const game = new GameSession({
        sessionId: event.sessionId, seat: event.seat,
        send: (message) => network.send(message),
        onChange: () => { if (state.game === game) renderGame(); },
      });
      state.game = game;
      renderGame();
      $('word-input').focus({ preventScroll: true });
    } else if (event.type === 'message') {
      const game = state.game;
      inbox = inbox.then(async () => {
        if (state.network === network && state.game === game && !state.protocolError) await game?.receive(event.message);
      }).catch((error) => {
        state.protocolError = true;
        showError('word-error', error.message);
        showConnectionBanner('本局的信息校验出现问题，请重新连接后再玩。');
        renderGame();
      });
    } else if (event.type === 'disconnected') {
      state.connected = false;
      connectionStatus('连接已断开', 'error');
      showConnectionBanner(event.message);
      renderGame();
    } else if (event.type === 'signaling') {
      if (state.inRoom) connectionStatus('正在恢复连接', 'connecting');
    } else if (event.type === 'signaling-restored') {
      if (state.inRoom) connectionStatus(state.connected ? '两人已连接' : '等 TA 加入', 'online');
    } else if (event.type === 'error') {
      state.connected = false;
      setBusy(false);
      if (state.inRoom) {
        connectionStatus('连接未成功', 'error');
        showConnectionBanner(event.message);
        renderGame();
      } else showError('entry-error', event.message);
    }
  });
  state.network = network;
  try {
    if (role === 'host') network.host(state.name, code);
    else network.join(state.name, code);
  } catch (error) {
    network.dispose();
    setBusy(false);
    if (state.inRoom) showConnectionBanner(error.message);
    else showError('entry-error', error.message);
  }
}

function renderGame() {
  if (!state.game) return;
  const view = state.game.view;
  const own = state.seat;
  const other = 1 - own;
  const revealed = view.phase !== 'writing';
  const matched = view.phase === 'matched';
  const active = state.connected && !state.protocolError;
  const key = `${state.game.sessionId}-${view.match}-${view.round}`;
  if (key !== renderedRound) {
    $('word-input').value = '';
    showError('word-error', '');
    renderedRound = key;
    $('word-hint').textContent = '1–20 字 · 双方锁定后同时揭晓 · Enter 提交';
  }
  $('round-number').textContent = String(view.round).padStart(2, '0');
  $('round-description').textContent = matched ? '原来，你也想到了这里。' : revealed ? '这两个词，会把我们带向哪里？' : view.round === 1 ? '第一轮，想到什么就写什么。' : '从上轮的两个词，联想一个新的共同词语。';
  $('match-label').textContent = matched ? 'SAME WORD, SAME WAVELENGTH' : 'THINK · REVEAL · MEET';
  $('own-name').textContent = state.names[own];
  $('other-name').textContent = state.names[other];
  $('history-own-label').textContent = state.names[own] + '（你）';
  $('history-other-label').textContent = state.names[other];
  const previous = view.history.find((entry) => entry.round === view.round - 1);
  $('previous-words').hidden = !previous || revealed;
  if (previous) {
    $('previous-own').textContent = previous.words[own];
    $('previous-other').textContent = previous.words[other];
  }
  const ownWord = revealed ? view.words[own] : view.ownWord;
  const otherWord = revealed ? view.words[other] : '';
  for (const [prefix, word, index] of [['own', ownWord, own], ['other', otherWord, other]]) {
    $(prefix + '-word').textContent = word || (view.committed[index] ? '•••' : '?');
    $(prefix + '-word').classList.toggle('has-word', Boolean(word));
    $(prefix + '-word').classList.toggle('long-word', Boolean(word && [...word].length > 6));
    $(prefix + '-status').textContent = revealed ? (matched ? '同频了' : '已揭晓') : view.committed[index] ? '✓ 已锁定' : '正在想';
    $(prefix + '-status').dataset.locked = String(view.committed[index]);
  }
  $('own-word-note').textContent = revealed ? (matched ? '这次，和你想到了一起' : '带着这个词，继续出发') : view.committed[own] ? '你的答案已锁定，暂时替你保密' : '一个词，就是一次出发';
  $('other-word-note').textContent = revealed ? (matched ? '刚刚好，是同一个想法' : '试着走进 TA 的脑回路') : view.committed[other] ? 'TA 已锁定，等你一起揭晓' : '给 TA 一点点灵感的时间';
  $('player-cards').classList.toggle('revealed', revealed);
  $('player-cards').classList.toggle('matched', matched);
  $('between-cards').textContent = matched ? '=' : '&';
  $('word-form').hidden = revealed || view.committed[own];
  $('word-input').disabled = !active || view.submitting;
  $('word-submit').disabled = !active || view.submitting;
  $('submitted-message').hidden = revealed || !view.committed[own];
  $('round-result').hidden = !revealed;
  $('result-message').textContent = matched ? `第 ${view.round} 轮，我们相遇了。` : '再靠近一点，也许下一轮就会相遇。';
  $('next-button').disabled = !active || view.ready[own];
  $('next-button').textContent = view.ready[own] ? '等 TA 准备好…' : matched ? '再来一次相遇 ↗' : '继续联想 →';
  $('ready-note').textContent = view.ready[own] ? '你已准备好，等 TA 点击就继续。' : view.ready[other] ? 'TA 已准备好，就等你啦。' : matched ? '两个人都愿意，就再开启一局。' : '两个人都准备好，就开始下一轮。';
  const historyKey = `${state.game.sessionId}-${view.match}-${view.history.length}`;
  $('history-section').hidden = view.history.length === 0;
  if (historyKey !== renderedHistory) {
    $('history-list').replaceChildren(...view.history.map((entry) => {
      const li = document.createElement('li');
      li.className = 'history-row' + (entry.matched ? ' matched' : '');
      const number = document.createElement('span');
      number.textContent = String(entry.round).padStart(2, '0');
      li.append(number);
      for (const index of [own, other]) {
        const word = document.createElement('bdi');
        word.textContent = entry.words[index];
        li.append(word);
      }
      return li;
    }));
    $('history-count').textContent = `${String(view.history.length).padStart(2, '0')} ROUND${view.history.length === 1 ? '' : 'S'}`;
    renderedHistory = historyKey;
  }
  if (matched && celebrated !== key) {
    celebrated = key;
    celebrate();
  }
}

function celebrate() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  $('confetti').replaceChildren();
  const colors = ['#e8b295', '#9db88a', '#dfcd8c', '#d97558', '#b8c7a4'];
  for (let index = 0; index < 28; index++) {
    const piece = document.createElement('i');
    piece.style.setProperty('--x', `${5 + Math.random() * 90}%`);
    piece.style.setProperty('--delay', `${Math.random() * .7}s`);
    piece.style.setProperty('--rotation', `${Math.random() * 180}deg`);
    piece.style.setProperty('--color', colors[index % colors.length]);
    $('confetti').append(piece);
  }
  setTimeout(() => $('confetti').replaceChildren(), 3800);
}

function leaveRoom() {
  state.network?.dispose();
  state.network = null;
  state.game = null;
  state.inRoom = false;
  state.connected = false;
  $('room').hidden = true;
  $('home').hidden = false;
  $('confetti').replaceChildren();
  history.replaceState(null, '', location.pathname);
  showError('entry-error', '');
  showConnectionBanner('');
  setBusy(false);
  $('nickname').focus({ preventScroll: true });
}

async function copy(text, field) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    toast('复制好了，发给 TA 吧。');
    return true;
  } catch {
    if (field) {
      field.focus();
      field.select();
      field.setSelectionRange(0, text.length);
    }
    toast('请长按或按 ⌘C / Ctrl+C 复制链接。');
    return false;
  }
}

function openShare() {
  $('share-url').value = inviteURL();
  $('share-note').textContent = state.connected ? '房间已经坐满了两个人。链接仍可用，重新加入会开启新局。' : '复制链接发给朋友，对方打开后输入昵称就能加入。房间最多两人。';
  $('native-share').hidden = typeof navigator.share !== 'function';
  $('share-dialog').showModal();
}

$('create-tab').addEventListener('click', () => setMode('create'));
$('join-tab').addEventListener('click', () => setMode('join'));
for (const tab of ['create-tab', 'join-tab']) {
  $(tab).addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const mode = event.key === 'Home' ? 'create' : event.key === 'End' ? 'join' : state.mode === 'create' ? 'join' : 'create';
    setMode(mode);
    $(mode + '-tab').focus();
  });
}
$('entry-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (state.busy) return;
  try {
    state.name = cleanName($('nickname').value);
    const code = state.mode === 'join' ? parseRoomCode($('room-code').value) : undefined;
    try { localStorage.setItem('word-meet-nickname', state.name); } catch { /* Storage is optional. */ }
    startConnection(state.mode === 'create' ? 'host' : 'guest', code);
  } catch (error) { showError('entry-error', error.message); }
});
$('word-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.game || !state.connected || state.protocolError) return;
  showError('word-error', '');
  const game = state.game;
  try { await game.submit($('word-input').value); }
  catch (error) { if (state.game === game) showError('word-error', error.message); }
});
$('word-input').addEventListener('input', () => {
  const length = [...$('word-input').value.trim()].length;
  $('word-hint').textContent = length ? `${length} / 20 字 · 双方锁定后同时揭晓` : '1–20 字 · 双方锁定后同时揭晓 · Enter 提交';
  showError('word-error', '');
});
$('next-button').addEventListener('click', () => {
  if (!state.connected || state.protocolError) return;
  try { state.game?.readyNext(); }
  catch (error) { showError('word-error', error.message); }
});
$('reconnect-button').addEventListener('click', () => {
  if (state.busy) return;
  startConnection(state.role, state.role === 'guest' ? state.code : undefined);
});
$('leave-button').addEventListener('click', leaveRoom);
$('brand-link').addEventListener('click', (event) => {
  if (state.inRoom || state.busy) { event.preventDefault(); leaveRoom(); }
});
$('rules-button').addEventListener('click', () => $('rules-dialog').showModal());
for (const button of document.querySelectorAll('[data-close-dialog]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
}
$('invite-button').addEventListener('click', openShare);
$('copy-invite').addEventListener('click', () => copy(inviteURL(), $('invite-url')));
$('share-copy').addEventListener('click', () => copy(inviteURL(), $('share-url')));
$('invite-url').addEventListener('click', () => $('invite-url').select());
$('share-url').addEventListener('click', () => $('share-url').select());
$('copy-code').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.code);
    toast('房间码已复制：' + state.code.slice(0, 4) + '-' + state.code.slice(4));
  } catch { openShare(); }
});
$('native-share').addEventListener('click', async () => {
  try { await navigator.share({ title: '同词相遇 · 想到一起', text: '来和我玩一局同词相遇吧。', url: inviteURL() }); }
  catch (error) { if (error.name !== 'AbortError') toast('分享没有完成，可以复制链接发给 TA。'); }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') state.network?.ping(); });
window.addEventListener('pagehide', () => state.network?.dispose());
window.addEventListener('pageshow', (event) => { if (event.persisted) { leaveRoom(); toast('页面已恢复，重新加入就能开始。'); } });

try { $('nickname').value = localStorage.getItem('word-meet-nickname') || ''; } catch { /* Storage is optional. */ }
if (new URLSearchParams(location.hash.slice(1)).has('room')) {
  try {
    const code = parseRoomCode(location.href);
    $('room-code').value = code.slice(0, 4) + '-' + code.slice(4);
    setMode('join');
    $('entry-description').textContent = '朋友给你留了一个位置，填好昵称就出发。';
  } catch { setMode('join'); showError('entry-error', '邀请链接里的房间码不完整，请让朋友重新分享。'); }
}
