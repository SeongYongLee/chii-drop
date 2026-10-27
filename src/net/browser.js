import { loadOnlineConfig, onlineTokenKey } from './config.js';
import { showOnlineControls } from '../app/controls-guide.js';
import { attachKeyboard, createKeyboard, readInput, KEYMAPS, clearPressed } from '../input/keyboard.js';
import { loadKeyBindings } from '../input/key-settings.js';
import { setupScreen } from '../app/screen.js';
import { loadSettings } from '../app/storage.js';
import { createEffects, tickCharacters, observeMatchEffects, animateMatchEffects } from '../view/effects.js';
import { drawBanner, drawGame } from '../view/renderer.js';
import { chooseBattleScenery, applyPageBackdrop } from '../view/battle-backgrounds.js';
import { drawFieldResults } from '../view/field-results.js';
import { playSfx, prepareSfx, unlockSfx, setSfxOptions } from '../audio/sfx.js';
import { mixLevels } from '../audio/mix-levels.js';
import { playBoardSounds } from '../audio/board-sounds.js';
import { configureCharacterVoices, playCharacterEvents, playCharacterVoice } from '../audio/character-voice.js';
import { configureMusic, syncMusicVisibility } from '../audio/music.js';
import { RULES_VERSION } from '../engine/rules.js';
import { RollbackMatch, PROTOCOL, stateHash } from './rollback.js';
import { SpectatorMatch } from './spectator.js';
import { ROOM_CAPACITY, roomHeadcount } from './room-capacity.js';
import { createInputBatcher, validInputBatch } from './input-batch.js';
import { roomSocketURL } from './socket-route.js';
import { roomInviteCode, roomInviteURL } from './room-invite.js';
import { createLobbyPresentation } from './lobby-presentation.js';
import { attachTouchControls } from './touch.js';
import { attachMobileViewport } from './mobile-viewport.js';
import { attachTouchLayout } from './touch-layout.js';
import { attachStageLayout } from './stage-layout.js';

export async function createOnlineSession({ root, shell, skin, sfx, onExit }) {
const $ = id => root.getElementById(id);
const onlineConfig = await loadOnlineConfig();
let opened = false;
let ws, profile, room, side, queued = false, connected = false, game, matchId, participants = [];
let battleScenery;
let spectating = false, matchFinished = false, passwordAction = 'join';
let effects = createEffects(2), active = false, rtt = 0, verifiedWinner = null, error = null;
let inputWaitingSince = null;
const inputBatcher = createInputBatcher();
let routedRoom = null, automaticHeartbeat = false, heartbeatSent = 0;
const ctx = setupScreen($('screen'));
const keyboard = createKeyboard();
try { keyboard.bindings = loadKeyBindings(window.localStorage); } catch { /* 저장 차단 시 기본 키를 사용한다. */ }
const touch = attachTouchControls($('touch-controls'));
const mobileViewport = attachMobileViewport(window, { shell, root });
const stageLayout = attachStageLayout($('board-area'), $('game-stage'));
const touchLayout = attachTouchLayout({ view: window, surface: shell, dialog: $('touch-options-dialog'), container: $('touch-controls'), preview: $('touch-preview'), onEdit: () => { touch.clear(); keyboard.held.clear(); } });
$('touch-options').onclick = $('battle-options').onclick = () => { $('battle-menu').open = false; touchLayout.open(); syncBattleControls(); };
$('battle-menu').addEventListener('toggle', syncBattleControls);
$('touch-options-dialog').addEventListener('close', syncBattleControls);
window.addEventListener('resize', clearControls);
// 폼을 편집하는 동안 게임용 키보드 처리기를 통과하지 않는다.
window.addEventListener('keydown', (event) => {
  const target = event.composedPath()[0];
  if (opened && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'SUMMARY'].includes(target.tagName) && !target.closest('#touch-controls') && !target.closest('.controls-guide')) event.stopImmediatePropagation();
}, true);
keyboard.enabled = false;
attachKeyboard(keyboard, window);

await configureCharacterVoices(sfx, skin, loadSettings().voice !== false);
function setOnlineMusic(scene) {
  const settings = loadSettings();
  const mix = mixLevels(settings);
  setSfxOptions(sfx, { enabled: settings.sfx, volume: mix.master,
    effectsVolume: mix.effects, voiceVolume: mix.voice });
  configureMusic(sfx, skin, { enabled: settings.music !== false, volume: mix.master * mix.music, scene, chooseNew: scene === 'intense' });
}
setOnlineMusic('menu');
await prepareSfx(sfx);
window.addEventListener('pointerdown', () => unlockSfx(sfx));
window.addEventListener('keydown', () => unlockSfx(sfx));
document.addEventListener('visibilitychange', () => syncMusicVisibility(sfx));

let resultFrame = 0;
let abandonConnection;
let epoch = 0, reconnectTimer, reconnectAttempt = 0, departing = false, pauseUntil = 0, paused = false;
const TOKEN_KEY = onlineTokenKey(onlineConfig);
let playerToken;
try { playerToken = localStorage.getItem(TOKEN_KEY); } catch {}
function clearControls() { keyboard.held.clear(); keyboard.rotationInputs?.clear(); clearPressed(keyboard); touch.clear(); }
function scheduleReconnect() {
  if (!opened || departing || reconnectTimer || error) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, Math.min(500 * 2 ** reconnectAttempt++, 5000));
}
function requestResync() {
  if (!active) return;
  active = false; paused = true; pauseUntil = performance.now() + 30000; clearControls(); buttons();
  status('서버 상태로 경기를 다시 맞추고 있습니다.'); send({ type: 'resync', matchId });
}
let soundPlayers = null;
let voiceResultPlayed = false;
let lastPacket = performance.now(), last = performance.now(), accumulator = 0, lastVerified = 0;
const hashes = new Map(), checks = new Map();
let roomList = [], rankings = [], roomFilter = 'all', submitting = false, passwordCode = null, guiding = false;
let pendingInvite = null;
function clearInvite() {
  pendingInvite = null;
  const url = new URL(location.href);
  if (url.searchParams.has('room')) {
    url.searchParams.delete('room'); history.replaceState(null, '', url);
  }
}
function joinEntry(entry, action = 'join') {
  if (submitting || !connected || room || queued) return;
  if (entry.locked) {
    passwordCode = entry.code; passwordAction = action; $('password-room-name').textContent = `${entry.name}${action === 'watch' ? ' · 관전' : ''}`;
    $('join-error').textContent = ''; $('password-value').value = '';
    $('password-dialog').showModal();
    $('close-password').focus({ preventScroll: true });
  } else { pendingRequest(); send({ type: action, code: entry.code }); }
}
function acceptInvite() {
  if (!pendingInvite || !connected || submitting) return;
  const code = pendingInvite, entry = roomList.find(value => value.code === code);
  clearInvite();
  if (room) return;
  if (!entry) { status('초대받은 방을 찾을 수 없습니다. 방이 닫혔는지 확인해 주세요.'); return; }
  if (entry.phase !== 'waiting' || entry.players.length >= entry.capacity || roomHeadcount(entry) >= (entry.memberCapacity ?? ROOM_CAPACITY)) {
    status('초대받은 방은 경기 중이거나 인원이 가득 찼습니다.'); return;
  }
  joinEntry(entry);
}
const playableCharacters = (skin.characterRoster ?? skin.characters).filter(character => character.selectable !== false && character.selectionVisible !== false);
const lobbyPresentation = createLobbyPresentation(skin, playableCharacters, root, shell);
for (const character of playableCharacters) {
  const button = document.createElement('button'); button.type = 'button'; button.dataset.charId = character.id;
  button.setAttribute('aria-pressed', 'false');
  const portrait = document.createElement('canvas'); portrait.width = 192; portrait.height = 192; portrait.setAttribute('aria-hidden', 'true');
  button.append(portrait, text('span', character.name));
  button.onclick = () => { if (!button.disabled) { send({ type: 'character', charId: character.id, selectionId: room?.selectionId }); playCharacterVoice(sfx, character.id, 'select'); } };
  $('character-options').append(button);
}
function updateCharacterButtons() {
  const me = room?.players.find(player => player.id === profile?.id);
  for (const button of $('character-options').children) {
    button.disabled = spectating || !connected || !room || room.phase !== 'selecting' || !!me?.confirmed || guiding;
    button.setAttribute('aria-pressed', String(button.dataset.charId === me?.charId));
  }
  $('online-guide').disabled = guiding || active;
}
const panelRoutes = { play: 'play', 'new-room': 'create', leaderboard: 'rankings' };
function selectPanel({ scroll = false } = {}) {
  const panel = panelRoutes[location.hash.slice(1)] ?? 'play';
  for (const name of ['play', 'create', 'rankings']) {
    $(`panel-${name}`).hidden = name !== panel;
    if (name === panel) $(`tab-${name}`).setAttribute('aria-current', 'page');
    else $(`tab-${name}`).removeAttribute('aria-current');
  }
  if (scroll) {
    root.querySelector('.profile-edit').open = false;
    $(`panel-${panel}`).scrollTop = 0;
  }
}
window.addEventListener('hashchange', () => selectPanel({ scroll: true }));
selectPanel();
if (location.hash === '#controls') touchLayout.open();
function showPlay() { history.replaceState(null, '', '#play'); selectPanel(); }
function pendingRequest() { submitting = true; buttons(); }
function showEmpty(target, title, description, { create = false } = {}) {
  const empty = text('div', '', 'empty');
  const symbol = text('span', '◌', 'empty-symbol'); symbol.setAttribute('aria-hidden', 'true');
  empty.append(symbol, text('strong', title), text('p', description));
  if (create) { const link = text('a', '첫 번째 방 만들기', 'button secondary'); link.href = '#new-room'; empty.append(link); }
  target.append(empty);
}
function renderStanding() {
  const entry = rankings.find((p) => p.id === profile?.id);
  $('my-standing').textContent = entry ? `나의 순위 ${entry.rank}위 · 레이트 ${entry.rating} · 랭크전 ${entry.games}회` : '첫 랭크전을 마치고 순위에 도전해 보세요.';
}
function status(text) { $('status').textContent = text; }
function send(message) { if (ws?.readyState === 1) ws.send(JSON.stringify(message)); }
function fail(reason) { error = reason; active = false; touch.setEnabled(false); status(reason); ws?.close(); }
function text(tag, value, className) { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; }
function syncBattleControls() {
  const blocked = $('touch-options-dialog').open || (!!game && $('battle-menu').open);
  keyboard.enabled = opened && !blocked && !spectating;
  touch.setEnabled(active && !blocked && !spectating);
  if (blocked) clearControls();
}
function buttons() {
  const free = connected && !room && !queued && !submitting;
  shell.dataset.connected = String(connected);
  shell.dataset.playing = String(!!game);
  root.host.dataset.playing = String(!!game);
  shell.dataset.inRoom = String(!!room);
  shell.dataset.matchActive = String(active);
  shell.dataset.spectating = String(spectating);
  const searching = connected && queued && !room;
  shell.dataset.queued = String(searching);
  $('queue-banner').hidden = !searching;
  syncBattleControls();
  for (const id of ['create', 'join', 'matchmake', 'rename']) $(id).disabled = !free;
  $('refresh').disabled = !connected;
  $('password-join').disabled = !free;
  for (const id of ['create', 'join', 'password-join']) $(id).setAttribute('aria-busy', String(submitting));
  $('queue-mode').disabled = !free;
  $('cancel-match').hidden = !queued;
  $('queue-status').hidden = !queued;
  $('lobby-view').hidden = !!room;
  const choosing = room?.phase === 'selecting';
  shell.dataset.selecting = String(choosing);
  $('room-view').hidden = !room || choosing;
  $('character-select-view').hidden = !choosing;
  const me = room?.players.find(p => p.id === profile?.id);
  $('confirm-character').hidden = spectating; $('cancel-character').hidden = spectating;
  $('confirm-character').disabled = !connected || !choosing || !!me?.confirmed || guiding;
  $('confirm-character').textContent = me?.confirmed ? '상대 결정 기다리는 중…' : '이 캐릭터로 결정';
  $('ready').disabled = spectating || !connected || !room || room.players.length !== 2 || room.phase !== 'waiting' || guiding;
  $('ready').hidden = spectating; root.querySelector('.selection-choices').hidden = spectating;
  $('take-seat').hidden = !spectating;
  $('take-seat').disabled = !connected || !room || room.phase !== 'waiting' || room.players.length >= room.capacity || submitting;
  for (const id of ['watch-instead', 'battle-watch-instead']) {
    $(id).hidden = spectating;
    $(id).disabled = !connected || !room || submitting;
  }
  $('field-zoom').hidden = spectating; $('battle-options').hidden = spectating;
  $('spectator-badge').hidden = !spectating; $('stop-watch').hidden = !spectating;
  $('leave').textContent = spectating ? '관전 종료' : '방 나가기';
  const canReturn = !spectating && !!game && matchFinished;
  $('return-room').hidden = !canReturn; $('battle-return-room').hidden = !canReturn;
  updateCharacterButtons();
}
function renderProfile(value) {
  profile = value; $('my-name').textContent = value.name;
  $('my-rating').textContent = value.rating.toLocaleString('ko-KR');
  $('my-record').textContent = `레이트 · ${value.games}전 ${value.wins}승`;
  renderStanding();
  if (root.activeElement !== $('nickname')) $('nickname').value = value.name;
}
function renderRankings(entries) {
  rankings = entries; renderStanding();
  const target = $('rankings'); target.replaceChildren();
  if (!entries.length) { showEmpty(target, '아직 랭크전 기록이 없어요', '첫 번째 대전의 주인공이 되어 보세요.'); return; }
  const table = document.createElement('table'), head = document.createElement('thead'), body = document.createElement('tbody');
  const row = document.createElement('tr');
  for (const title of ['순위', '플레이어', '레이트']) { const th = text('th', title); th.scope = 'col'; row.append(th); }
  head.append(row);
  for (const entry of entries) {
    const tr = document.createElement('tr'); if (entry.id === profile?.id) tr.className = 'me';
    tr.append(text('td', String(entry.rank)), text('td', entry.name), text('td', String(entry.rating))); body.append(tr);
  }
  table.append(head, body); target.append(table);
}
function renderRooms(rooms = roomList) {
  roomList = rooms;
  const search = $('room-search').value.trim().toLocaleLowerCase();
  const filtered = rooms.filter((entry) => (roomFilter === 'all' || entry.rated === (roomFilter === 'rated')) && entry.name.toLocaleLowerCase().includes(search));
  $('room-count').textContent = String(rooms.filter((r) => r.phase === 'waiting' && r.players.length < r.capacity && roomHeadcount(r) < (r.memberCapacity ?? ROOM_CAPACITY)).length);
  const target = $('rooms'); target.replaceChildren();
  if (!filtered.length) showEmpty(target, rooms.length ? '조건에 맞는 방이 없어요' : '아직 열려 있는 방이 없어요', rooms.length ? '다른 검색어나 방 종류로 찾아보세요.' : '방을 만들고 새로운 상대를 만나 보세요.', { create: !rooms.length });
  for (const entry of filtered) {
    const row = text('article', '', `room-row ${entry.rated ? 'rated' : 'casual'}`);
    const emblem = text('div', entry.rated ? '◇' : '◈', 'room-emblem'); emblem.setAttribute('aria-hidden', 'true');
    const info = text('div', '', 'room-description'), badges = text('div', '', 'room-badges');
    badges.append(text('span', entry.rated ? '랭크전' : '친선전', `tag ${entry.rated ? 'rated' : ''}`));
    if (entry.locked) badges.append(text('span', '비밀번호', 'tag'));
    const avg = entry.players.length ? Math.round(entry.players.reduce((sum, p) => sum + p.rating, 0) / entry.players.length) : 1500;
    const hasSpace = roomHeadcount(entry) < (entry.memberCapacity ?? ROOM_CAPACITY);
    info.append(badges, text('strong', entry.name), text('small', `입장 ${roomHeadcount(entry)}/${entry.memberCapacity ?? ROOM_CAPACITY}명 · 대전 ${entry.players.length}/${entry.capacity}명 · 평균 레이트 ${avg} · ${entry.phase === 'playing' ? '경기 중' : '대기 중'}`));
    const available = entry.phase === 'waiting' && entry.players.length < entry.capacity && hasSpace;
    const button = text('button', !hasSpace ? '입장 마감' : entry.phase === 'playing' ? '경기 중' : !available ? '대전 만석' : '참가하기', 'secondary');
    button.setAttribute('aria-label', `${entry.name} ${entry.locked ? '비밀번호로 ' : ''}참가`);
    button.disabled = !connected || !!room || queued || submitting || !available;
    button.onclick = () => joinEntry(entry);
    const watch = text('button', `관전 ${entry.spectators ?? 0}명`, 'secondary');
    watch.setAttribute('aria-label', `${entry.name} 관전`);
    watch.disabled = !connected || !!room || queued || submitting || !hasSpace;
    watch.onclick = () => joinEntry(entry, 'watch');
    const actions = text('div', '', 'room-entry-actions'); actions.append(button, watch);
    row.append(emblem, info, actions); target.append(row);
  }
}
function renderRoom(value) {
  room = value;
  $('room-title').textContent = value.name;
  $('room-info').textContent = `${value.rated ? '랭크전 · 경기 중 이탈 시 패배 및 레이트 반영' : '친선전 · 레이트 유지'}${value.locked ? ' · 비밀번호 있음' : ''} · 입장 ${roomHeadcount(value)}/${value.memberCapacity ?? ROOM_CAPACITY}명 · 관전 ${value.spectators ?? 0}명${spectating ? ' · 관전 중' : ''}`;
  $('room-code').textContent = value.code;
  $('spectator-count').textContent = String(value.spectators ?? 0);
  $('player-count').textContent = String(value.players.length);
  $('spectator-hint').textContent = value.spectators ? `${value.spectators}명이 함께하고 있어요` : '친구가 들어오면 여기에 표시돼요';
  $('game-audience-count').textContent = String(value.spectators ?? 0);
  $('game-audience').hidden = !(value.spectators > 0);
  const viewers = $('spectator-list'); viewers.replaceChildren();
  for (const spectator of value.spectatorList ?? []) {
    const item = text('li', '', 'spectator-name'); item.title = spectator.name;
    item.classList.toggle('is-self', spectator.id === profile?.id);
    item.classList.toggle('is-offline', !spectator.connected);
    const avatar = text('span', spectator.name.slice(0, 1), 'spectator-avatar'); avatar.setAttribute('aria-hidden', 'true');
    const details = text('span', '', 'spectator-details');
    details.append(text('strong', spectator.name), text('small', spectator.connected ? '관전 중' : '재접속 중'));
    item.append(avatar, details);
    if (spectator.id === profile?.id) item.append(text('span', '나', 'spectator-self'));
    viewers.append(item);
  }
  if (!viewers.children.length) viewers.append(text('li', '아직 관전자가 없어요.', 'spectator-empty'));
  if (pendingInvite) clearInvite();
  $('character-title').textContent = spectating ? '플레이어가 캐릭터를 고르고 있어요' : '캐릭터를 선택해 주세요';
  const previews = $('selection-players'); previews.replaceChildren();
  if (value.phase === 'selecting') for (const p of value.players) {
    const card = text('article', '', 'selection-player'); card.classList.toggle('is-confirmed', !!p.confirmed); card.classList.toggle('is-self', p.id === profile?.id);
    const portrait = document.createElement('canvas'); portrait.width = 192; portrait.height = 192; portrait.dataset.charId = p.charId; portrait.dataset.side = String(p.side); portrait.setAttribute('aria-hidden', 'true');
    card.append(text('span', `${p.side + 1}P${p.id === profile?.id ? ' · 나' : ''} · ${p.name}`, 'eyebrow'), portrait, text('h3', playableCharacters.find(c => c.id === p.charId)?.name ?? ''), text('p', p.confirmed ? '결정 완료' : '선택 중')); previews.append(card);
  }
  const seats = $('seats'); seats.replaceChildren();
  for (let i = 0; i < value.capacity; i++) {
    const p = value.players.find((entry) => entry.side === i), mine = p?.id === profile?.id;
    const seat = text('div', '', `seat${mine ? ' mine' : ''}`);
    seat.classList.toggle('is-ready', !!p?.ready);
    const portrait = document.createElement('canvas'); portrait.width = 192; portrait.height = 192;
    portrait.setAttribute('aria-hidden', 'true'); portrait.dataset.charId = p?.charId ?? ''; portrait.dataset.side = String(i);
    const details = text('div', '', 'participant-details');
    details.append(text('span', `${i + 1}P${mine ? ' · 나' : ''}`, 'eyebrow'), text('h3', p?.name ?? '참가자 대기 중'),
      text('p', p ? `레이트 ${p.rating} · ${p.ready ? '준비 완료' : '준비 대기'}` : '대전 참가를 기다려요'));
    seat.append(portrait, details);
    seats.append(seat);
  }
  const me = value.players.find((p) => p.id === profile?.id);
  $('ready').textContent = me?.ready ? '준비 취소' : '준비하기';
  $('room-help').textContent = spectating
    ? value.phase === 'waiting' && value.players.length < value.capacity
      ? '빈자리가 있어요. 대전 참가를 누르면 직접 플레이할 수 있습니다.'
      : '관전 중 · 빈자리가 생기면 대전에 참가할 수 있습니다.'
    : value.phase === 'playing' ? '대전 중입니다. 각자의 자리에서 플레이하세요.' : value.players.length < 2 ? '상대가 참가하기를 기다리고 있습니다.' : '두 사람 모두 준비하면 캐릭터를 선택해요.';
  buttons();
}
function verify() {
  for (const [frame, check] of checks) {
    if (!hashes.has(frame)) continue;
    if (hashes.get(frame) !== check.hash) { requestResync(); return; }
    if (check.type === 'result') {
      if (verifiedWinner === null) { resultFrame = 0; setOnlineMusic('result'); }
      verifiedWinner = check.winner;
      $('game-stage').classList.remove('focus-field');
      $('field-zoom').setAttribute('aria-pressed', 'false'); $('field-zoom').textContent = '내 필드 크게'; stageLayout.update();
    }
    lastVerified = Math.max(lastVerified, frame); checks.delete(frame);
  }
  for (const frame of hashes.keys()) if (frame < lastVerified) hashes.delete(frame);
}
function confirmed(states) {
  for (const state of states) {
    state.players.forEach((player, i) => playCharacterEvents(sfx,
      (participants[i]?.charId ?? skin.characters[i % skin.characters.length].id), player.events, i));
    if (state.phase === 'over' && !voiceResultPlayed && state.winner >= 0) {
      voiceResultPlayed = true;
      state.players.forEach((p, i) => playCharacterVoice(sfx, (participants[i]?.charId ?? skin.characters[i % skin.characters.length].id),
        i === state.winner ? 'win' : 'lose', { channel: i }));
    }
    observeMatchEffects(effects, state);
    state.players.forEach((player, i) => playBoardSounds(sfx, soundPlayers?.[i], player, i, effects[i].warningChange, []));
    soundPlayers = state.players;
    for (const [i, p] of state.players.entries()) for (const event of p.events) {
      if (event.type === 'lock') continue;
      if (['move', 'rotate'].includes(event.type) && i !== side) continue;
      playSfx(sfx, event.type, { ...event, channel: i });
    }
    if (state.frame % 60 === 0 || state.phase === 'over') hashes.set(state.frame, stateHash(state));
  }
  verify();
}
function resetGame() {
  setOnlineMusic('menu');
  soundPlayers = null;
  voiceResultPlayed = false;
  resultFrame = 0; matchFinished = false;
  active = false; paused = false; pauseUntil = 0; game = null; matchId = null; verifiedWinner = null; error = null;
  $('game-view').hidden = true; $('return-room').hidden = true; $('settlement').textContent = ''; keyboard.held.clear(); touch.clear(); touch.setEnabled(false);
  shell.dataset.playing = 'false'; $('game-stage').classList.remove('focus-field');
  $('field-zoom').setAttribute('aria-pressed', 'false'); $('field-zoom').textContent = '내 필드 크게'; stageLayout.update();
}
function connect() {
  if (!opened) return;
  const endpoint = roomSocketURL(onlineConfig.socketURL ?? new URL('/socket', location.href).href.replace(/^http/, 'ws'), routedRoom);
  automaticHeartbeat = false;
  const socket = new WebSocket(endpoint); ws = socket; lastPacket = performance.now();
  ws.onopen = () => {
    if (!opened || socket !== ws) return;
    send({ type: 'hello', token: playerToken ?? undefined, protocol: PROTOCOL, rulesVersion: RULES_VERSION });
  };
  const lostConnection = () => {
    if (!opened || socket !== ws) return;
    ws = null; socket.close();
    if (game && !pauseUntil) pauseUntil = performance.now() + 30000;
    paused = !!game; clearControls();
    active = false; connected = false; queued = false; submitting = false; buttons(); renderRooms(); $('connection').textContent = '재접속 중'; $('reconnect-help').hidden = false;
    if (!error) status('연결이 끊겼습니다. 자동으로 재접속하고 있습니다.');
    scheduleReconnect();
  };
  abandonConnection = lostConnection;
  socket.onclose = lostConnection;
  socket.onerror = () => { if (socket === ws) status('서버에 연결하지 못했습니다. 자동으로 다시 시도합니다.'); };
  ws.onmessage = ({ data }) => {
    if (!opened || socket !== ws) return;
    try {
      lastPacket = performance.now(); const msg = JSON.parse(data);
      if (msg.type === 'route') {
        roomSocketURL(endpoint, msg.code); // 새 연결을 만들기 전에 코드 형식을 검사한다.
        routedRoom = msg.code;
        connect(); socket.close(); return;
      }
      if (msg.type === 'heartbeatAck') { rtt = Math.round(performance.now() - heartbeatSent); return; }
      if (msg.type === 'incompatible') { fail(msg.reason); return; }
      if (msg.type === 'pong') { rtt = Math.round(performance.now() - msg.time); return; }
      if (msg.type === 'welcome') {
        automaticHeartbeat = msg.heartbeat === 'auto';
        if (msg.token) { playerToken = msg.token; try { localStorage.setItem(TOKEN_KEY, msg.token); } catch {} }
        reconnectAttempt = 0; $('reconnect-help').hidden = true;
        if (room || game) { room = null; resetGame(); }
        connected = true; renderProfile(msg.profile); status('방에 참가하거나 자동 매칭으로 상대를 찾아보세요.'); buttons();
      }
      if (msg.type === 'profile') renderProfile(msg.profile);
      if (msg.type === 'rankings') renderRankings(msg.rankings);
      if (msg.type === 'lobby') { $('connection').textContent = `접속 ${msg.online}명`; renderRooms(msg.rooms); acceptInvite(); }
      if (msg.type === 'joined') {
        mobileViewport.dismissKeyboard();
        submitting = false; queued = false; side = msg.side; spectating = msg.role === 'spectator'; $('password-dialog').close(); $('code-dialog').close(); root.querySelector('.profile-edit').open = false; resetGame(); showPlay(); status(spectating ? '관전으로 입장했습니다. 경기를 기다려 주세요.' : '방에 참가했습니다. 상대와 함께 준비해 주세요.');
      }
      if (msg.type === 'room') renderRoom(msg.room);
      if (msg.type === 'queued') { queued = msg.active; buttons(); renderRooms(); status(queued ? '상대를 찾고 있습니다. 매칭은 언제든 취소할 수 있습니다.' : '매칭 대기를 취소했습니다.'); send({ type: 'list' }); }
      if (msg.type === 'matched') status('상대를 찾았습니다! 양쪽 모두 준비하면 캐릭터를 선택합니다.');
      if (msg.type === 'start' || msg.type === 'snapshot' || msg.type === 'spectatorSnapshot') {
        inputBatcher.reset();
        setOnlineMusic('intense');
        mobileViewport.dismissKeyboard();
        matchId = msg.matchId; participants = msg.players;
        game = spectating ? new SpectatorMatch(msg.state, msg.hash) : new RollbackMatch(msg.seed ?? 1, side);
        if (!spectating) game.setLatency(rtt);
        inputWaitingSince = null;
        matchFinished = !!msg.finished;
        epoch = msg.epoch ?? 0;
        if (msg.type === 'snapshot') game.restore(msg.state, msg.hash);
        battleScenery = chooseBattleScenery(skin, undefined, () => (game.state.seed >>> 0) / 0x100000000);
        paused = spectating ? !!msg.paused : msg.type === 'snapshot';
        pauseUntil = paused ? performance.now() + msg.remaining : 0;
        effects = createEffects(2);
        soundPlayers = game.confirmedState.players;
        voiceResultPlayed = false;
        hashes.clear(); checks.clear(); lastVerified = 0; verifiedWinner = null; error = null; active = !paused; accumulator = 0; clearControls();
        room.phase = 'playing'; buttons(); $('game-stage').dataset.side = String(side);
        $('game-identity').textContent = spectating ? '관전 중 · 양쪽 필드 보기' : `나는 ${side + 1}P · ${side === 0 ? '왼쪽' : '오른쪽'} 필드`;
        $('game-stage').classList.remove('focus-field');
        $('battle-menu').open = false;
        $('field-zoom').setAttribute('aria-pressed', String($('game-stage').classList.contains('focus-field')));
        $('field-zoom').textContent = $('game-stage').classList.contains('focus-field') ? '전체 필드 보기' : '내 필드 크게'; $('game-view').hidden = false; $('settlement').textContent = ''; stageLayout.update(); $('screen').focus({ preventScroll: true });
        $('room-help').textContent = `대전 중 · 나는 ${side + 1}P (${side === 0 ? '왼쪽' : '오른쪽'})`;
        status(paused ? '양쪽 상태 확인 중…' : spectating ? '관전 중 · 확정된 경기를 재생합니다.' : `대전 중 · 나는 ${side + 1}P`);
        if (spectating) {
          hashes.set(game.state.frame, stateHash(game.state));
          if (game.state.phase === 'over') verifiedWinner = game.state.winner;
        }
        if (paused && !spectating) {
          lastVerified = game.state.frame; hashes.set(game.state.frame, stateHash(game.state));
          send({ type: 'synced', matchId, epoch, hash: stateHash(game.state) });
        }
      }
      if (msg.type === 'spectatorFrames' && spectating && active && msg.matchId === matchId && msg.epoch === epoch) {
        try { game.receiveBatch(msg.frame, msg.inputs); } catch { requestResync(); }
      }
      if (msg.type === 'paused' && msg.matchId === matchId) {
        active = false; paused = true; pauseUntil = performance.now() + msg.remaining;
        clearControls(); buttons(); status('연결 회복을 기다리고 있습니다. 최대 30초 동안 경기를 보관합니다.');
      }
      if (msg.type === 'resumed' && msg.matchId === matchId && msg.epoch === epoch) {
        active = true; paused = false; pauseUntil = 0; accumulator = 0; clearControls(); buttons();
        status('재접속 완료 · 서버 상태를 맞추고 경기를 이어갑니다.');
      }
      if (msg.type === 'input' && (msg.epoch ?? 0) === epoch && active && msg.matchId === matchId) confirmed(game.receive(msg.side, msg.frame, msg.input));
      if (msg.type === 'inputBatch' && msg.epoch === epoch && active && msg.matchId === matchId) {
        if (!validInputBatch(msg)) throw new Error('invalid input batch');
        confirmed(game.receiveBatch(msg.side, msg.frame, msg.inputs));
      }
      if ((msg.type === 'checksum' || msg.type === 'result') && (msg.epoch ?? 0) === epoch && msg.matchId === matchId) { checks.set(msg.frame, msg); verify(); }
      if (msg.type === 'settlement') {
        const entry = msg.result.standings.find((p) => p.id === profile.id);
        if (!entry) {
          $('settlement').textContent = `관전 경기 종료${msg.result.reason === 'forfeit' ? ' · 참가자 이탈' : ''} · 내 레이트는 유지됩니다.`;
          return;
        }
        const sign = entry.delta > 0 ? '+' : '';
        $('settlement').textContent = msg.result.rated ? `레이트 ${entry.rating} → ${entry.after} (${sign}${entry.delta})${msg.result.reason === 'forfeit' ? (entry.place === 1 ? ' · 상대 이탈 승리' : ' · 이탈 패배') : ''}` : '친선전 결과 · 레이트가 유지됩니다.';
        if (!game && room) status(`${$('settlement').textContent} · 같은 방에서 새 상대를 기다려 주세요.`);
      }
      if (msg.type === 'finished' && msg.matchId === matchId) {
        matchFinished = true;
        if (spectating) { buttons(); status('경기가 끝났습니다. 플레이어가 대기실로 돌아가면 함께 이동합니다.'); return; }
        active = false; buttons(); $('game-stage').classList.remove('focus-field');
        $('field-zoom').setAttribute('aria-pressed', 'false'); $('field-zoom').textContent = '내 필드 크게'; stageLayout.update();
        $('room-help').textContent = '경기가 끝났어요. 다시 준비해 볼까요?'; $('return-room').hidden = false; status('경기가 끝났습니다. 대기실로 돌아가 다시 대전할 수 있습니다.');
      }
      if (msg.type === 'reset') {
        const settlement = $('settlement').textContent;
        if (msg.side !== undefined) side = msg.side;
        resetGame(); clearControls(); inputBatcher.reset();
        status(msg.reason ? `${msg.reason}${settlement ? ' ' + settlement : ''}` : spectating ? '관전 중 · 같은 방에서 다음 경기를 기다립니다.' : '대기실로 돌아왔습니다. 다시 준비해 주세요.');
      }
      if (msg.type === 'ended') {
        const settlement = $('settlement').textContent;
        room = null; queued = false; spectating = false; resetGame(); buttons(); status(`${msg.reason}${settlement ? ' ' + settlement : ''}`);
      }
      if (msg.type === 'error') {
        submitting = false; buttons(); renderRooms(); status(msg.reason);
        if (msg.retryable && !connected) abandonConnection();
        if (!connected) { $('connection').textContent = '접속 확인 필요'; $('reconnect-help').hidden = false; }
        $('create-error').textContent = location.hash === '#new-room' ? msg.reason : '';
        if ($('code-dialog').open) $('code-error').textContent = msg.reason;
        if ($('password-dialog').open) { $('join-error').textContent = msg.reason; $('password-value').focus({ preventScroll: true }); }
      }
    } catch { fail('통신 데이터가 올바르지 않습니다. 새로 접속해 주세요.'); }
  };
  buttons();
}
$('name-form').onsubmit = (event) => { event.preventDefault(); send({ type: 'rename', name: $('nickname').value }); };
async function copyRoomInvite(link) {
  if (!room) return;
  const value = link ? roomInviteURL(location.href, room.code) : room.code;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(value);
    status(link ? '초대 링크를 복사했습니다. 친구에게 붙여넣어 보내 주세요.' : '방 코드를 복사했습니다.');
  } catch {
    $('share-value').value = value; $('share-dialog').showModal(); $('share-value').select();
  }
}
$('copy-room-code').onclick = () => { void copyRoomInvite(false); };
$('copy-room-link').onclick = () => { void copyRoomInvite(true); };
$('close-share').onclick = () => $('share-dialog').close();
$('create-form').onsubmit = (event) => {
  event.preventDefault(); $('create-error').textContent = ''; pendingRequest(); send({ type: 'create', name: $('room-name').value, password: $('room-password').value, rated: $('room-rated').value === 'rated', mode: 'duel' }); $('room-password').value = '';
};
$('join-form').onsubmit = (event) => { event.preventDefault(); pendingRequest(); send({ type: 'join', code: $('code').value.trim(), password: $('join-password').value }); $('join-password').value = ''; };
$('room-search').addEventListener('input', () => renderRooms());
for (const button of root.querySelectorAll('[data-room-filter]')) button.onclick = () => {
  roomFilter = button.dataset.roomFilter;
  for (const item of root.querySelectorAll('[data-room-filter]')) item.setAttribute('aria-pressed', String(item === button));
  renderRooms();
};
$('room-rated').onchange = () => { $('rated-help').textContent = $('room-rated').value === 'rated' ? '승패와 상대 레이트에 따라 변해요. 경기 중 나가면 패배로 처리돼요.' : '승패와 관계없이 레이트가 그대로 유지돼요.'; };
$('password-form').onsubmit = (event) => {
  event.preventDefault(); $('join-error').textContent = ''; pendingRequest();
  send({ type: passwordAction, code: passwordCode, password: $('password-value').value });
};
$('close-password').onclick = () => $('password-dialog').close();
$('password-dialog').addEventListener('close', () => { $('password-value').value = ''; });
$('open-code').onclick = () => { $('code-error').textContent = ''; $('code-dialog').showModal(); $('close-code').focus({ preventScroll: true }); };
$('close-code').onclick = () => $('code-dialog').close();
$('code-dialog').addEventListener('close', () => { $('join-password').value = ''; });
$('field-zoom').onclick = () => {
  const focused = $('game-stage').classList.toggle('focus-field');
  $('field-zoom').setAttribute('aria-pressed', String(focused)); $('field-zoom').textContent = focused ? '전체 필드 보기' : '내 필드 크게'; stageLayout.update();
};
$('reconnect').onclick = () => { if (connected) return; clearTimeout(reconnectTimer); reconnectTimer = null; ws?.close(); connect(); };
$('refresh').onclick = () => send({ type: 'list' });
$('matchmake').onclick = () => send({ type: 'queue', rated: $('queue-mode').value === 'rated' });
$('cancel-match').onclick = $('queue-banner-cancel').onclick = () => send({ type: 'cancelQueue' });
async function explainControls(force = false) {
  if (guiding) return;
  guiding = true; buttons(); keyboard.held.clear(); touch.clear();
  try { await showOnlineControls({ keyboard, touch: window.matchMedia('(pointer: coarse)').matches, force }); }
  finally { guiding = false; buttons(); }
}
$('online-guide').onclick = () => { void explainControls(true); };
$('ready').onclick = async () => {
  if (!room || guiding || spectating) return;
  if (room.players.find(player => player.id === profile.id)?.ready) { send({ type: 'ready', ready: false }); return; }
  if (connected && room.phase === 'waiting') send({ type: 'ready', ready: true });
};
$('confirm-character').onclick = async () => {
  if (!connected || spectating || room?.phase !== 'selecting' || guiding) return;
  const selectionId = room.selectionId;
  await explainControls();
  if (connected && room?.selectionId === selectionId) send({ type: 'confirmCharacter', selectionId });
};
$('cancel-character').onclick = () => send({ type: 'cancelSelection', selectionId: room?.selectionId });
$('leave').onclick = () => {
  if (!spectating && game && room.rated && !window.confirm('지금 나가면 이탈 패배로 레이트가 반영됩니다. 방을 나갈까요?')) return;
  send({ type: 'leave' });
};
$('return-room').onclick = $('battle-return-room').onclick = () => {
  if (spectating || !game || !matchFinished) return;
  $('battle-menu').open = false; send({ type: 'returnRoom' });
};
$('stop-watch').onclick = () => send({ type: 'leave' });
$('take-seat').onclick = () => {
  if (!spectating || !connected || !room || room.phase !== 'waiting' || room.players.length >= room.capacity || submitting) return;
  pendingRequest(); send({ type: 'takeSeat' });
};
$('watch-instead').onclick = $('battle-watch-instead').onclick = () => {
  if (spectating || !connected || !room || submitting) return;
  if (game && verifiedWinner === null && !window.confirm(room.rated
    ? '관전으로 전환하면 현재 경기는 기권 패배로 처리되고 레이트가 반영됩니다. 전환할까요?'
    : '관전으로 전환하면 현재 경기는 기권 패배로 처리됩니다. 전환할까요?')) return;
  pendingRequest(); send({ type: 'watchInstead' });
};
window.addEventListener('pagehide', () => { departing = true; clearTimeout(reconnectTimer); reconnectTimer = null; ws?.close(); });
window.addEventListener('pageshow', event => { if (event.persisted) { departing = false; connect(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) { keyboard.held.clear(); touch.clear(); } });
setInterval(() => {
  if (opened && ws?.readyState === 1) {
    heartbeatSent = performance.now();
    send(automaticHeartbeat ? { type: 'heartbeat' } : { type: 'ping', time: heartbeatSent });
  }
  if (ws && [0, 1].includes(ws.readyState) && performance.now() - lastPacket > 10000) abandonConnection();
}, 1000);
function tick(now) {
  if (!opened) { last = now; requestAnimationFrame(tick); return; }
  lobbyPresentation.tick(now, { playing: !!game, inRoom: !!room, charId: room?.players.find(p => p.id === profile?.id)?.charId });
  if (!spectating && room?.phase === 'selecting' && !$('character-select-view').hidden && !active) for (const button of $('character-options').children) {
    const portrait = button.querySelector('canvas'), preview = portrait.getContext('2d');
    preview.clearRect(0, 0, 192, 192);
    skin.drawCharacter(preview, button.dataset.charId, 'idle', 8, 8, 176, { frame: Math.floor(now * .06), instance: `online-choice-${button.dataset.charId}`, presentation: 'selection' });
  }
  accumulator = Math.min(accumulator + now - last, 1000 / 60 * 5); last = now;
  if (game && !spectating) game.setLatency(rtt);
  while (accumulator >= 1000 / 60) {
    if (verifiedWinner !== null) resultFrame += 1;
    if (game && !paused) {
      tickCharacters(effects);
      animateMatchEffects(effects, game.confirmedState);
      effects.forEach((effect, channel) => {
        for (const event of effect.arrivalSounds) playSfx(sfx, event.type, { ...event, channel });
      });
    }
    if (active && game.canAdvance) {
      if (spectating) {
        const packet = game.advance(); if (packet) confirmed(packet.confirmed);
      } else {
      const packet = game.advance(document.hidden ? 0 : (readInput(keyboard, KEYMAPS.solo) | touch.read()));
      if (packet) {
        const batch = inputBatcher.push(packet.frame, packet.input);
        if (batch) send({ ...batch, matchId, epoch });
        confirmed(packet.confirmed);
      }
      }
    }
    clearPressed(keyboard); accumulator -= 1000 / 60;
  }
  if (game && !spectating && active && !game.canAdvance) {
    // 멈춘 상태에서는 다음 프레임이 생기지 않으므로 남은 묶음을 즉시 보낸다.
    const batch = inputBatcher.flush();
    if (batch) send({ ...batch, matchId, epoch });
    inputWaitingSince ??= now;
  } else inputWaitingSince = null;
  if (game) {
    applyPageBackdrop(ctx, skin, battleScenery ? `game:${battleScenery}` : 'game');
    drawGame(ctx, { skin, scenery: battleScenery, match: game.state, effects, characters: participants.map((p, i) => ({ id: (participants[i]?.charId ?? skin.characters[i % skin.characters.length].id), name: p.name })), showGhost: true, result: verifiedWinner !== null });
    if (error) drawBanner(ctx, '연결 종료', error);
    else if (paused) drawBanner(ctx, '재접속 대기', `경기 일시 정지 · 남은 유예 ${Math.max(0, Math.ceil((pauseUntil - now) / 1000))}초`);
    else if (verifiedWinner !== null) drawFieldResults(ctx, {
      skin, match: { ...game.state, winner: verifiedWinner }, age: resultFrame,
      characters: participants.map((participant, index) => ({
        id: participant.charId ?? skin.characters[index % skin.characters.length].id, name: participant.name,
      })),
    });
    else if (!spectating && active && inputWaitingSince !== null && now - inputWaitingSince >= 250) drawBanner(ctx, '상대 입력 대기', '연결이 회복되면 이어집니다');
    if (spectating && matchFinished && !game.canAdvance && active) { active = false; buttons(); }
    $('metrics').textContent = `확정 ${game.confirmedState.frame} · 검증 ${lastVerified} · 서버 왕복 ${rtt}ms · 예측 ${game.state.frame - game.confirmedState.frame}프레임 · 보정 ${game.rollbacks}회`;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
for (const back of root.querySelectorAll('[data-online-exit]')) back.onclick = event => {
  event.preventDefault();
  if (!spectating && game && room?.rated && !window.confirm('메인 메뉴로 나가면 이탈 패배가 반영됩니다. 나갈까요?')) return;
  send({ type: 'leave' });
  opened = false; departing = true; keyboard.enabled = false;
  clearTimeout(reconnectTimer); reconnectTimer = null; ws?.close(); ws = null;
  for (const dialog of root.querySelectorAll('dialog[open]')) dialog.close();
  room = null; queued = false; spectating = false; connected = false; routedRoom = null; resetGame(); clearControls(); buttons();
  onExit();
};
return { open() {
  opened = true; departing = false; keyboard.enabled = true;
  pendingInvite = roomInviteCode(location.href);
  reconnectAttempt = 0; error = null; last = performance.now();
  selectPanel(); stageLayout.update(); setOnlineMusic('menu'); connect();
} };
}
