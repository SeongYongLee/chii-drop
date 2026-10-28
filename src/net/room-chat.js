// 방 수명과 함께 유지한다. 경기 초기화·재대전은 채팅 기록을 지우지 않는다.
export function attachRoomChat(root, shell, { send, onFocusChange = () => {} }) {
  const $ = id => root.getElementById(id);
  let code = null, ownId, messages = [], connected = false, readingOnly = false, wasPlaying = false, pending = null;
  let expanded = true;
  function controls() {
    $('room-chat').hidden = !code;
    shell.dataset.chatExpanded = String(expanded);
    $('chat-toggle').setAttribute('aria-expanded', String(expanded));
    $('chat-toggle').textContent = expanded ? '접기' : `펼치기${messages.length ? ` · ${messages.length}` : ''}`;
    $('chat-form').hidden = readingOnly || !expanded;
    $('chat-input').disabled = !connected || readingOnly;
    $('chat-send').disabled = !connected || readingOnly || pending !== null || !$('chat-input').value.trim();
    $('chat-status').textContent = !connected ? '재접속 중… 기록은 유지됩니다.' : readingOnly ? '경기 중에는 읽기만 가능해요.' : pending !== null ? '전송 중…' : '';
  }
  function appendMessage(message) {
    const line = document.createElement('li'), name = document.createElement('strong'), body = document.createElement('span');
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
    controls();
  }
  $('chat-toggle').onclick = () => { expanded = !expanded; controls(); $('chat-log').scrollTop = $('chat-log').scrollHeight; };
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
    enter(nextCode) {
      if (nextCode === code) return;
      code = nextCode; messages = []; pending = null; expanded = true; wasPlaying = false;
      $('chat-input').value = ''; render();
    },
    update(state) {
      ownId = state.playerId; connected = state.connected;
      if (state.playing && !wasPlaying) expanded = false;
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
      $('chat-empty').hidden = true; controls();
      if (atBottom || !expanded) log.scrollTop = log.scrollHeight;
    },
    error(reason) { pending = null; controls(); $('chat-status').textContent = reason; },
    clear() { code = null; messages = []; pending = null; $('chat-input').value = ''; render(); },
  };
}
