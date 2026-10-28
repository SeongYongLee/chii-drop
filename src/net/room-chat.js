import { ONLINE_PORTRAIT_QUERY } from './stage-layout.js';

// 방 수명과 함께 유지한다. 경기 초기화·재대전은 채팅 기록을 지우지 않는다.
export function attachRoomChat(root, shell, { send, onFocusChange = () => {}, view = window }) {
  const $ = id => root.getElementById(id);
  let code = null, ownId, messages = [], connected = false, readingOnly = false, wasPlaying = false, pending = null;
  let expanded = true, spectating = false, finished = false;
  const portrait = view.matchMedia(ONLINE_PORTRAIT_QUERY);
  const locked = () => readingOnly && portrait.matches;
  function controls() {
    $('room-chat').hidden = !code;
    const open = expanded && !locked();
    shell.dataset.chatExpanded = String(open);
    shell.dataset.chatLocked = String(locked());
    $('chat-toggle').disabled = locked();
    $('chat-toggle').hidden = locked();
    $('chat-toggle').setAttribute('aria-expanded', String(open));
    $('chat-toggle').textContent = open ? '접기' : `펼치기${messages.length ? ` · ${messages.length}` : ''}`;
    $('chat-form').hidden = readingOnly || !open;
    $('chat-input').disabled = !connected || readingOnly;
    $('chat-send').disabled = !connected || readingOnly || pending !== null || !$('chat-input').value.trim();
    $('chat-status').textContent = !connected ? '재접속 중… 기록은 유지됩니다.' : pending !== null ? '전송 중…' : '';
  }
  portrait.addEventListener('change', controls);
  // 가로 중앙 여백은 레터박스를 뺀 실제 경기판을 기준으로 맞춘다.
  function place() {
    const stage = $('game-stage').getBoundingClientRect(), frame = shell.getBoundingClientRect();
    shell.style.setProperty('--chat-stage-center', `${stage.left - frame.left + stage.width / 2}px`);
    shell.style.setProperty('--chat-stage-top', `${stage.top - frame.top + stage.height * .43}px`);
    shell.style.setProperty('--chat-stage-width', `${stage.width * .235}px`);
    shell.style.setProperty('--chat-stage-height', `${stage.height * .35}px`);
    shell.style.setProperty('--chat-collapsed-top', `${stage.top - frame.top + stage.height * 308 / 448}px`);
    shell.style.setProperty('--chat-strip-height', `${Math.max(20, Math.min(40, stage.height * 40 / 448))}px`);
  }
  const observer = new view.ResizeObserver(place);
  observer.observe($('game-stage')); observer.observe(shell);

  function preview() {
    const latest = messages.at(-1);
    $('chat-preview').textContent = latest?.text ?? '아직 메시지가 없어요';
    $('chat-preview').setAttribute('aria-label', latest ? `${latest.name}: ${latest.text}` : '아직 메시지가 없어요');
    $('chat-preview').title = latest ? `${latest.name}: ${latest.text}` : '';
  }
  function appendMessage(message) {
    const line = root.ownerDocument.createElement('li'), name = root.ownerDocument.createElement('strong'), body = root.ownerDocument.createElement('span');
    name.textContent = message.name; body.textContent = message.text;
    line.classList.toggle('is-self', message.playerId === ownId);
    line.append(name, body); $('chat-log').append(line);
  }
  function render() {
    const log = $('chat-log');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 32;
    const previousTop = log.scrollTop;
    log.replaceChildren();
    for (const message of messages) appendMessage(message);
    $('chat-empty').hidden = messages.length > 0;
    log.scrollTop = atBottom || !expanded ? log.scrollHeight : previousTop;
    preview(); controls();
  }
  $('chat-toggle').onclick = () => { if (locked()) return; expanded = !expanded; controls(); $('chat-log').scrollTop = $('chat-log').scrollHeight; };
  $('chat-input').addEventListener('input', controls);
  $('chat-input').addEventListener('focus', onFocusChange);
  $('chat-input').addEventListener('blur', onFocusChange);
  $('chat-form').onsubmit = event => {
    event.preventDefault();
    if (!code || !connected || readingOnly || pending !== null) return;
    const text = $('chat-input').value.trim(); if (!text) return;
    pending = text; send({ type: 'chat', text }); controls();
  };
  return {
    enter(nextCode, { collapsed = false } = {}) {
      if (nextCode === code) return;
      code = nextCode; messages = []; pending = null; expanded = !collapsed; wasPlaying = false;
      $('chat-input').value = ''; render();
    },
    update(state) {
      ownId = state.playerId; connected = state.connected;
      if (state.playing && (!wasPlaying || state.spectating !== spectating || (finished && !state.finished))) expanded = state.spectating;
      if (state.finished && !finished) expanded = true;
      spectating = state.spectating; finished = state.finished;
      if (!state.playing && wasPlaying) expanded = true;
      wasPlaying = state.playing;
      readingOnly = state.playing && !state.finished && !state.spectating;
      if (!connected) pending = null;
      controls();
    },
    history(packet) {
      if (packet.code !== code) return;
      messages = packet.messages.slice(-100); render();
    },
    receive(packet) {
      if (packet.code !== code || messages.some(m => m.id === packet.message.id)) return;
      messages = [...messages, packet.message].slice(-100);
      if (packet.message.playerId === ownId && packet.message.text === pending) {
        if ($('chat-input').value.trim() === pending) $('chat-input').value = '';
        pending = null;
      }
      const log = $('chat-log'), atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 32;
      appendMessage(packet.message);
      while (log.children.length > 100) log.firstElementChild.remove();
      $('chat-empty').hidden = true; preview(); controls();
      if (atBottom || !expanded) log.scrollTop = log.scrollHeight;
    },
    error(reason) { pending = null; controls(); $('chat-status').textContent = reason; },
    clear() { code = null; messages = []; pending = null; $('chat-input').value = ''; render(); },
  };
}
