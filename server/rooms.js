import { readFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createMatch, stepMatch } from '../src/engine/match.js';
import { RULES_VERSION } from '../src/engine/rules.js';
import { MAX_AHEAD, PROTOCOL, stateHash, validInput } from '../src/net/rollback.js';
import { createProfileStore } from './profiles.js';
import { validInputBatch } from '../src/net/input-batch.js';
import { ROOM_CAPACITY, PLAYER_CAPACITY, SPECTATOR_CAPACITY, roomHeadcount } from '../src/net/room-capacity.js';
import { STATE_INTERVAL, importantState, statePacket } from '../src/net/state-stream.js';

export const REMATCH_START_DELAY = 350;
export const CHAT_HISTORY_LIMIT = 100;
export const CHAT_TEXT_LIMIT = 160;

function passwordHash(salt, password) { return createHash('sha256').update(salt).update(password).digest(); }
function passwordValue(value) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > 32) throw new Error('비밀번호는 32자까지 입력할 수 있습니다.');
  return value;
}
function defaultCharacters() {
  try { return JSON.parse(readFileSync(new URL('../skins/chiikawa/pages-runtime/manifest.json', import.meta.url), 'utf8')).characters
    .filter(character => character.selectable !== false && character.selectionVisible !== false).map(character => character.id); }
  catch { return ['actor-0', 'actor-1']; }
}
export function createRooms({ profiles = createProfileStore(), now = Date.now, characters = defaultCharacters(), reconnectGrace = 30000, allowStatePrototype = false, allowBatchExperiments = false, onFrame } = {}) {
  if (!characters.length) throw new Error('No playable characters');
  const availableCharacters = new Set(characters);
  const rooms = new Map(), peers = new Set(), queue = new Map();
  const send = (peer, message) => { if (!peer.disconnected) peer.send(message); };
  const broadcast = (room, message) => [...room.peers, ...room.spectators].forEach((p) => send(p, message));
  const error = (peer, reason) => send(peer, { type: 'error', reason });
  function chatHistory(room, peer) { send(peer, { type: 'chatHistory', code: room.code, messages: room.chat ?? [] }); }
  function roomView(room, includeSpectators = false) {
    return { code: room.code, name: room.name, rated: room.rated, locked: !!room.password,
      mode: 'duel', capacity: PLAYER_CAPACITY, memberCapacity: ROOM_CAPACITY,
      spectators: room.spectators.length, spectatorCapacity: SPECTATOR_CAPACITY, phase: room.state ? 'playing' : room.selectionId ? 'selecting' : 'waiting', selectionId: room.selectionId ?? null,
      ...(includeSpectators ? { spectatorList: room.spectators.map(p => ({ id: p.profileId, name: profiles.get(p.profileId).name, connected: !p.disconnected })) } : {}),
      finished: !!room.finished,
      players: room.peers.map((p) => ({ ...profiles.get(p.profileId), side: p.side, charId: p.charId,
        ...(p.inputBatchLimit > 3 ? { inputBatchLimit: p.inputBatchLimit } : {}),
        connected: !p.disconnected, ready: room.ready.has(p.side), confirmed: room.confirmed?.has(p.side) ?? false, rematch: room.rematch?.has(p.side) ?? false })) };
  }
  function updateRoom(room) { broadcast(room, { type: 'room', room: roomView(room, true) }); }
  function updateLobby() {
    const list = [...rooms.values()].map(room => roomView(room));
    for (const p of peers) send(p, { type: 'lobby', rooms: list, online: peers.size });
  }
  function updateRankings() {
    for (const p of peers) {
      send(p, { type: 'profile', profile: profiles.get(p.profileId) });
      send(p, { type: 'rankings', rankings: profiles.rankings() });
    }
  }
  function settle(room, winner, reason) {
    if (room.settlement) return room.settlement;
    const standings = room.peers.map((p, i) => ({ id: p.profileId, place: winner === -1 || winner === i ? 1 : 2 }));
    room.settlement = profiles.record({ id: room.matchId, standings, rated: room.rated, reason });
    broadcast(room, { type: 'settlement', matchId: room.matchId, result: room.settlement });
    updateRankings();
    return room.settlement;
  }
  function clearMatch(room) {
    room.state = null; room.matchId = null; room.ready.clear(); room.settlement = null;
    room.selectionId = null; room.confirmed = new Set();
    room.rematch = new Set(); room.rematchAt = null;
    room.spectatorInputs = [];
    for (const key of ['started', 'epoch', 'paused', 'deadline', 'syncing', 'acks', 'next', 'inputs', 'finished', 'resultSent', 'resultFrame']) delete room[key];
  }
  function beginMatch(room) {
    const seed = randomBytes(4).readUInt32LE();
    room.state = createMatch({ seed }); room.started = now(); room.matchId = randomUUID();
    room.epoch = 0; room.paused = false; room.deadline = null; room.syncing = false;
    room.next = [0, 0]; room.inputs = [new Map(), new Map()];
    room.spectatorInputs = []; room.rematch = new Set(); room.rematchAt = null;
    for (const p of room.peers) { p.state15Base = room.state; send(p, { type: 'start', seed, matchId: room.matchId, players: roomView(room).players }); }
    for (const p of room.spectators) spectatorSnapshot(room, p);
    updateRoom(room); updateLobby();
  }
  function removeRoomPeers(room, removed, reason, retained = null) {
    const remaining = room.peers.filter(p => !removed.includes(p) && !p.disconnected);
    for (const p of room.peers) if (!remaining.includes(p) && p !== retained) {
      p.room = null;
      send(p, { type: 'ended', reason: '방을 나왔습니다. 로비에서 다시 참가하세요.' });
    }
    room.peers = remaining;
    for (const p of removed) if (room.chatTimes) delete room.chatTimes[p.profileId];
    if (!remaining.length && !room.spectators.some(p => !p.disconnected)) {
      for (const p of room.spectators) { p.room = null; send(p, { type: 'ended', reason: '대전 참가자가 모두 나가 방을 종료했습니다.' }); }
      room.spectators = []; rooms.delete(room.code); updateLobby(); return;
    }
    clearMatch(room);
    remaining.forEach((p, side) => {
      p.side = side;
      send(p, { type: 'reset', side, reason });
    });
    for (const p of room.spectators) send(p, { type: 'reset', reason: '대전 참가자가 나갔습니다. 같은 방에서 다음 경기를 기다립니다.' });
    updateRoom(room); updateLobby();
  }
  function exitRoom(peer) {
    const room = peer.room;
    queue.delete(peer);
    if (!room) return;
    if (peer.spectator) {
      room.spectators = room.spectators.filter(p => p !== peer); peer.room = null;
      if (room.chatTimes) delete room.chatTimes[peer.profileId];
      if (!room.peers.length && !room.spectators.length) rooms.delete(room.code);
      send(peer, { type: 'ended', reason: '관전을 종료했습니다.' }); updateRoom(room); updateLobby(); return;
    }
    const forfeited = room.state && !room.settlement;
    if (forfeited) settle(room, 1 - peer.side, 'forfeit');
    removeRoomPeers(room, [peer], forfeited
      ? '상대가 이탈하여 기권승 처리했습니다. 같은 방에서 새 상대를 기다려 주세요.'
      : '상대가 방을 나갔습니다. 같은 방에서 새 상대를 기다려 주세요.');
  }
  function leave(peer) {
    exitRoom(peer); queue.delete(peer); peers.delete(peer); updateLobby();
  }
  function pause(room) {
    room.paused = true;
    room.deadline ??= now() + reconnectGrace;
    broadcast(room, { type: 'paused', matchId: room.matchId, remaining: Math.max(0, room.deadline - now()) });
  }
  function disconnect(peer) {
    if (!peers.has(peer)) return;
    peers.delete(peer); queue.delete(peer);
    const room = peer.room;
    if (room && peer.spectator) {
      peer.disconnected = true; peer.deadline = now() + reconnectGrace; updateRoom(room); updateLobby(); return;
    }
    if (!room) { updateLobby(); return; }
    if (!room.state) {
      peer.disconnected = true; peer.deadline = now() + reconnectGrace;
      if (room.selectionId) {
        clearMatch(room);
        broadcast(room, { type: 'reset', reason: '플레이어가 재접속 중입니다. 복귀하면 다시 준비해 주세요.' });
      } else room.ready.delete(peer.side);
      updateRoom(room); updateLobby(); return;
    }
    if (room.finished) {
      peer.disconnected = true; peer.deadline = now() + reconnectGrace;
      room.rematch?.delete(peer.side); room.rematchAt = null;
      updateRoom(room); updateLobby(); return;
    }
    peer.disconnected = true;
    pause(room); updateLobby();
  }
  function sweep() {
    for (const room of rooms.values()) for (const p of [...room.spectators]) if (p.disconnected && now() >= p.deadline) exitRoom(p);
    for (const room of rooms.values()) if (!room.state || room.finished) {
      const missing = room.peers.filter(p => p.disconnected && now() >= p.deadline);
      if (missing.length) { removeRoomPeers(room, missing, '상대의 재접속 유예가 끝났습니다. 대기실에서 새 상대를 기다려 주세요.'); continue; }
      if (room.rematchAt != null && now() >= room.rematchAt && room.rematch?.size === 2
        && room.peers.length === 2 && room.peers.every(p => !p.disconnected)) {
        clearMatch(room); beginMatch(room);
      }
    }
    for (const room of rooms.values()) if (room.paused && now() >= room.deadline) {
      const missing = room.peers.filter(p => p.disconnected || (room.syncing && !room.acks?.has(p.side)));
      if (!room.settlement) settle(room, missing.length === 1 ? 1 - missing[0].side : -1, 'forfeit');
      removeRoomPeers(room, missing, '재접속 유예가 끝나 경기를 종료했습니다. 같은 방에서 새 상대를 기다려 주세요.');
    }
  }
  function synchronize(room) {
    pause(room);
    room.epoch++; room.syncing = true; room.acks = new Set();
    room.next = [room.state.frame, room.state.frame]; room.inputs = [new Map(), new Map()];
    room.spectatorInputs = [];
    const snapshot = { type: 'snapshot', matchId: room.matchId, epoch: room.epoch,
      remaining: Math.max(0, room.deadline - now()), state: room.state, hash: stateHash(room.state), players: roomView(room).players };
    for (const p of room.peers) { p.state15Base = room.state; send(p, snapshot); }
    for (const p of room.spectators) spectatorSnapshot(room, p);
  }
  function spectatorSnapshot(room, peer) {
    if (!room.state) return;
    send(peer, { type: 'spectatorSnapshot', matchId: room.matchId, epoch: room.epoch,
      state: room.state, hash: stateHash(room.state), players: roomView(room).players,
      paused: !!room.paused, remaining: Math.max(0, (room.deadline ?? now()) - now()), finished: !!room.finished, settlement: room.settlement });
  }
  function makeRoom({ name = '함께 대전해요', rated = false, password = '' } = {}) {
    if (rooms.size >= 100) throw new Error('서버의 방이 가득 찼습니다.');
    if (typeof rated !== 'boolean' || typeof name !== 'string' || name.trim().length < 1 || name.length > 30 || /[\p{C}<>]/u.test(name)) throw new Error('방 설정이 올바르지 않습니다.');
    const pass = passwordValue(password), salt = randomBytes(16).toString('hex');
    let code;
    do { code = randomBytes(4).toString('hex').toUpperCase(); } while (rooms.has(code));
    const room = { code, name: name.trim(), rated, salt, password: pass ? passwordHash(salt, pass) : null,
      peers: [], spectators: [], spectatorInputs: [], ready: new Set(), rematch: new Set(), rematchAt: null, state: null,
      chat: [], chatSequence: 0, chatTimes: {} };
    rooms.set(code, room); return room;
  }
  function seat(room, peer) {
    queue.delete(peer); peer.spectator = false; peer.side = room.peers.length;
    if (!availableCharacters.has(peer.charId)) peer.charId = characters[peer.side % characters.length];
    peer.room = room; room.peers.push(peer);
    send(peer, { type: 'joined', code: room.code, side: peer.side });
    chatHistory(room, peer);
    updateRoom(room); updateLobby();
  }
  function watch(room, peer) {
    if (!room.spectators.length) room.spectatorInputs = [];
    queue.delete(peer); peer.spectator = true; peer.side = null; peer.room = room; room.spectators.push(peer);
    send(peer, { type: 'joined', code: room.code, role: 'spectator', side: null });
    chatHistory(room, peer);
    updateRoom(room); spectatorSnapshot(room, peer); updateLobby();
  }
  function matchmake() {
    const waiting = [...queue.entries()];
    for (const [a, entryA] of waiting) {
      if (!queue.has(a)) continue;
      const ratingA = profiles.get(a.profileId).rating;
      const candidates = waiting.filter(([b, entryB]) => b !== a && queue.has(b) && entryA.rated === entryB.rated)
        .map(([b, entryB]) => ({ peer: b, gap: Math.abs(ratingA - profiles.get(b.profileId).rating), waited: now() - Math.min(entryA.at, entryB.at) }))
        .filter((c) => !entryA.rated || c.gap <= Math.min(800, 100 + c.waited / 100))
        .sort((a, b) => a.gap - b.gap);
      const b = candidates[0]?.peer;
      if (!b) continue;
      if (rooms.size >= 100) return;
      const room = makeRoom({ name: '자동 매칭', rated: entryA.rated });
      seat(room, a); seat(room, b);
      broadcast(room, { type: 'matched' });
    }
  }
  function handle(peer, msg, relay = true) {
    if (!msg || typeof msg !== 'object') throw new Error('invalid message');
    if (msg.type === 'ping') { send(peer, { type: 'pong', time: msg.time }); return; }
    if (msg.type === 'hello') {
      if (peer.profileId || msg.protocol !== PROTOCOL || msg.rulesVersion !== RULES_VERSION) throw new Error('version mismatch');
      try {
        sweep();
        const identity = profiles.authenticate(msg.token);
        if ([...peers].some((p) => p.profileId === identity.profile.id)) { send(peer, { type: 'error', retryable: true, reason: '이미 연결된 세션을 확인하고 있습니다. 잠시 후 다시 접속합니다.' }); return; }
        peer.profileId = identity.profile.id; peers.add(peer);
        peer.transport = allowStatePrototype && msg.transport === 'state15' ? 'state15' : 'inputs';
        peer.inputBatchLimit = allowBatchExperiments && [4, 6].includes(msg.inputBatchLimit) ? msg.inputBatchLimit : 3;
        if (availableCharacters.has(identity.profile.charId)) peer.charId = identity.profile.charId;
        send(peer, { type: 'welcome', ...identity, transport: peer.transport, inputBatchLimit: peer.inputBatchLimit });
        send(peer, { type: 'rankings', rankings: profiles.rankings() });
        const reserved = [...rooms.values()].flatMap(r => [...r.peers, ...r.spectators]).find(p => p.disconnected && p.profileId === peer.profileId);
        if (reserved) {
          const room = reserved.room;
          peer.room = room; peer.side = reserved.side; peer.charId = reserved.charId; peer.spectator = !!reserved.spectator;
          if (peer.spectator) room.spectators[room.spectators.indexOf(reserved)] = peer;
          else room.peers[peer.side] = peer;
          reserved.room = null;
          send(peer, { type: 'joined', code: room.code, side: peer.side, role: peer.spectator ? 'spectator' : 'player' }); updateRoom(room);
          chatHistory(room, peer);
          if (room.state) {
            if (peer.spectator) spectatorSnapshot(room, peer);
            else if (room.finished) { peer.state15Base = room.state; send(peer, { type: 'snapshot', matchId: room.matchId, epoch: room.epoch,
              state: room.state, hash: stateHash(room.state), players: roomView(room).players, finished: true, settlement: room.settlement }); }
            else synchronize(room);
          }
        }
        updateLobby();
      } catch (e) { error(peer, e.message); }
      return;
    }
    if (!peers.has(peer)) throw new Error('authentication required');
    if (msg.type === 'rename') {
      if (peer.room || queue.has(peer)) { error(peer, '로비에서 닉네임을 변경하세요.'); return; }
      try {
        if (msg.charId !== undefined && !availableCharacters.has(msg.charId)) throw new Error('선택할 수 없는 캐릭터입니다.');
        const profile = profiles.rename(peer.profileId, msg.name, msg.charId);
        if (profile.charId) peer.charId = profile.charId;
        send(peer, { type: 'profile', profile }); updateRankings();
      } catch (e) { error(peer, e.message); }
      return;
    }
    if (msg.type === 'list') { updateLobby(); send(peer, { type: 'rankings', rankings: profiles.rankings() }); return; }
    if (msg.type === 'leave') { const wasQueued = queue.has(peer); exitRoom(peer); if (wasQueued) send(peer, { type: 'queued', active: false }); return; }
    if (msg.type === 'cancelQueue') { queue.delete(peer); send(peer, { type: 'queued', active: false }); return; }
    if (msg.type === 'queue') {
      if (peer.room || queue.has(peer) || typeof msg.rated !== 'boolean') { error(peer, '현재 자동 매칭을 시작할 수 없습니다.'); return; }
      queue.set(peer, { at: now(), rated: msg.rated }); send(peer, { type: 'queued', active: true, rated: msg.rated }); matchmake(); return;
    }
    if (msg.type === 'create' || msg.type === 'join' || msg.type === 'watch') {
      if (peer.room || queue.has(peer)) { error(peer, '먼저 현재 방이나 매칭 대기에서 나와 주세요.'); return; }
      if (msg.mode !== undefined && msg.mode !== 'duel') { error(peer, '현재 1대1만 지원합니다.'); return; }
      try {
        if (msg.type === 'create') seat(makeRoom(msg), peer);
        else {
          const room = typeof msg.code === 'string' && rooms.get(msg.code.toUpperCase());
          if (!room) { error(peer, '입장 가능한 방을 찾을 수 없습니다.'); return; }
          if (roomHeadcount(room) >= ROOM_CAPACITY) { error(peer, '방 입장 인원이 가득 찼습니다. (최대 6명)'); return; }
          if (msg.type !== 'watch' && (room.peers.length >= PLAYER_CAPACITY || room.state || room.selectionId)) { error(peer, '입장 가능한 방을 찾을 수 없습니다.'); return; }
          const attempt = passwordValue(msg.password);
          if (room.password && !timingSafeEqual(room.password, passwordHash(room.salt, attempt))) { error(peer, '비밀번호가 일치하지 않습니다.'); return; }
          if (msg.type === 'watch') watch(room, peer); else { peer.spectator = false; seat(room, peer); }
        }
      } catch (e) { error(peer, e.message); }
      return;
    }
    const room = peer.room;
    if (!room) throw new Error('not in room');
    if (msg.type === 'chat') {
      const reject = reason => send(peer, { type: 'chatError', reason });
      if (room.state && !room.finished && !peer.spectator) { reject('경기 중에는 읽기만 가능해요.'); return; }
      if (typeof msg.text !== 'string') { reject('메시지를 입력해 주세요.'); return; }
      const value = msg.text.trim().normalize('NFC');
      if (!value || value.length > CHAT_TEXT_LIMIT || /[\p{Cc}\p{Cf}]/u.test(value)) { reject(`메시지는 줄바꿈 없이 ${CHAT_TEXT_LIMIT}자까지 입력해 주세요.`); return; }
      room.chatTimes ??= {};
      const recent = (room.chatTimes[peer.profileId] ?? []).filter(at => now() - at < 5000);
      if (recent.length >= 3) { reject('잠시 기다린 뒤 보내 주세요. (5초에 3개)'); return; }
      recent.push(now()); room.chatTimes[peer.profileId] = recent;
      const message = { id: (room.chatSequence ?? 0) + 1, playerId: peer.profileId, name: profiles.get(peer.profileId).name, text: value, at: now() };
      room.chatSequence = message.id; room.chat = [...(room.chat ?? []), message].slice(-CHAT_HISTORY_LIMIT);
      broadcast(room, { type: 'chat', code: room.code, message }); return;
    }
    if (msg.type === 'returnRoom' && !peer.spectator) {
      if (msg.matchId !== room.matchId) return;
      if (!room.finished) { error(peer, '경기가 끝난 뒤 대기실로 돌아갈 수 있습니다.'); return; }
      clearMatch(room);
      broadcast(room, { type: 'reset', reason: '플레이어가 대기실로 이동했습니다. 다시 준비해 주세요.' }); updateRoom(room); updateLobby(); return;
    }
    if (msg.type === 'rematch' && !peer.spectator) {
      if (msg.matchId !== room.matchId) return;
      if (!room.finished || room.peers.length !== 2 || room.peers.some(p => p.disconnected)) { error(peer, '두 플레이어가 연결된 경기 종료 화면에서 선택해 주세요.'); return; }
      if (typeof msg.ready !== 'boolean') throw new Error('invalid rematch choice');
      room.rematch ??= new Set();
      if (msg.ready) room.rematch.add(peer.side); else room.rematch.delete(peer.side);
      room.rematchAt = room.rematch.size === 2 ? room.rematchAt ?? now() + REMATCH_START_DELAY : null;
      updateRoom(room); return;
    }
    if (peer.spectator) {
      if (msg.type === 'takeSeat') {
        if (room.state || room.selectionId || room.peers.length >= 2) { error(peer, '경기가 끝나고 빈자리가 생기면 참가할 수 있습니다.'); return; }
        room.spectators = room.spectators.filter(p => p !== peer);
        delete peer.deadline; room.ready.clear();
        seat(room, peer);
      } else if (msg.type === 'resync' && msg.matchId === room.matchId) spectatorSnapshot(room, peer);
      else error(peer, '관전 중에는 경기 조작이나 준비 상태를 변경할 수 없습니다.');
      return;
    }
    if (room.paused && now() >= room.deadline) { sweep(); return; }
    if (msg.type === 'watchInstead') {
      const forfeited = room.state && !room.settlement;
      if (forfeited) settle(room, 1 - peer.side, 'forfeit');
      peer.spectator = true; peer.side = null; room.spectators.push(peer);
      send(peer, { type: 'joined', code: room.code, role: 'spectator', side: null });
      removeRoomPeers(room, [peer], forfeited
        ? '상대가 관전으로 전환하여 기권승 처리했습니다. 같은 방에서 새 상대를 기다려 주세요.'
        : '상대가 관전으로 전환했습니다. 같은 방에서 새 상대를 기다려 주세요.', peer);
      return;
    }
    if (msg.type === 'character') {
      if (room.state || !room.selectionId || msg.selectionId !== room.selectionId || room.confirmed.has(peer.side)) { error(peer, '캐릭터 선택 화면에서 선택해 주세요.'); return; }
      if (!availableCharacters.has(msg.charId)) { error(peer, '선택할 수 없는 캐릭터입니다.'); return; }
      peer.charId = msg.charId; updateRoom(room); return;
    }
    if (msg.type === 'ready') {
      if (room.state || room.selectionId || room.peers.length !== 2 || room.peers.some(p => p.disconnected)) { error(peer, '상대가 참가한 후 준비할 수 있습니다.'); return; }
      if (msg.ready === false) room.ready.delete(peer.side); else room.ready.add(peer.side);
      updateRoom(room);
      if (room.ready.size === 2) {
        room.selectionId = randomUUID(); room.confirmed = new Set();
        updateRoom(room); updateLobby();
      }
      return;
    }
    if (msg.type === 'cancelSelection') {
      if (!room.state && room.selectionId && msg.selectionId === room.selectionId) {
        clearMatch(room); broadcast(room, { type: 'reset', reason: '캐릭터 선택을 취소했습니다. 다시 준비해 주세요.' }); updateRoom(room); updateLobby();
      }
      return;
    }
    if (msg.type === 'confirmCharacter') {
      if (room.state || !room.selectionId || msg.selectionId !== room.selectionId || room.peers.length !== 2) { error(peer, '진행 중인 캐릭터 선택을 확인해 주세요.'); return; }
      room.confirmed.add(peer.side); updateRoom(room);
      if (room.confirmed.size === 2) {
        beginMatch(room);
      }
      return;
    }
    if (msg.type === 'resync' && msg.matchId === room.matchId) {
      if (!room.finished && !room.paused) synchronize(room);
      return;
    }
    if (msg.type === 'synced') {
      if (!room.syncing || msg.matchId !== room.matchId || msg.epoch !== room.epoch || peer.disconnected) return;
      if (msg.hash !== stateHash(room.state)) throw new Error('invalid snapshot acknowledgement');
      room.acks.add(peer.side);
      if (room.acks.size === 2 && room.peers.every(p => !p.disconnected)) {
        room.syncing = false; room.paused = false; room.deadline = null;
        room.started = now() - room.state.frame / .06;
        broadcast(room, { type: 'resumed', matchId: room.matchId, epoch: room.epoch });
        if (room.resultSent) broadcast(room, { type: 'result', matchId: room.matchId, epoch: room.epoch, frame: room.state.frame, winner: room.state.winner, hash: stateHash(room.state) });
      }
      return;
    }
    if (msg.type === 'inputBatch') {
      if (!room.state || msg.matchId !== room.matchId || room.finished || room.paused || (msg.epoch ?? 0) !== room.epoch) return;
      // 전체를 검사한 뒤 중계한다. 잘못된 마지막 입력 때문에 앞부분만 확정되지 않게 한다.
      if (!validInputBatch(msg, peer.inputBatchLimit ?? 3) || msg.frame !== room.next[peer.side]
        || msg.frame + msg.inputs.length - 1 > room.state.frame + MAX_AHEAD
        || msg.frame + msg.inputs.length - 1 > (now() - room.started) * .06 + MAX_AHEAD) throw new Error('invalid input batch');
      if (room.peers[1 - peer.side].transport !== 'state15') send(room.peers[1 - peer.side], { type: 'inputBatch', matchId: room.matchId, epoch: room.epoch, side: peer.side, frame: msg.frame, inputs: msg.inputs });
      for (let i = 0; i < msg.inputs.length && !room.finished; i++) handle(peer, {
        type: 'input', matchId: room.matchId, epoch: room.epoch, frame: msg.frame + i, input: msg.inputs[i],
      }, false);
      return;
    }
    if (msg.type === 'input' && msg.matchId !== room.matchId) return;
    if (msg.type !== 'input' || !room.state) throw new Error('unexpected message');
    // 이전 경기에서 전송 중이던 프레임은 새 경기와 섞지 않는다.
    if (msg.matchId !== room.matchId || room.finished || room.paused || (msg.epoch ?? 0) !== room.epoch) return;
    const { frame, input } = msg;
    if (!Number.isInteger(frame) || frame !== room.next[peer.side] || !validInput(input)
      || frame > room.state.frame + MAX_AHEAD || frame > (now() - room.started) * 0.06 + MAX_AHEAD) throw new Error('invalid frame');
    room.next[peer.side]++; room.inputs[peer.side].set(frame, input);
    if (relay && room.peers[1 - peer.side].transport !== 'state15') send(room.peers[1 - peer.side], { type: 'input', matchId: room.matchId, epoch: room.epoch, side: peer.side, frame, input });
    while (room.inputs.every((map) => map.has(room.state.frame))) {
      const f = room.state.frame;
      const pair = room.inputs.map((map) => map.get(f));
      const before = room.state;
      room.state = stepMatch(room.state, pair);
      onFrame?.(room.state, room);
      const receivers = room.peers.filter(p => p.transport === 'state15');
      if (receivers.length) {
        const critical = importantState(before, room.state);
        if (critical || room.state.frame % STATE_INTERVAL === 0) for (const p of receivers) {
          send(p, { ...statePacket(p.state15Base ?? before, room.state, critical), matchId: room.matchId, epoch: room.epoch });
          p.state15Base = room.state;
        }
      }
      if (room.spectators.length) {
        room.spectatorInputs.push(pair);
        if (room.spectatorInputs.length >= 6 || room.state.phase === 'over') {
          const inputs = room.spectatorInputs; room.spectatorInputs = [];
          for (const p of room.spectators) send(p, { type: 'spectatorFrames', matchId: room.matchId, epoch: room.epoch, frame: room.state.frame - inputs.length, inputs });
        }
      }
      room.inputs.forEach((map) => map.delete(f));
      if (room.state.frame % 60 === 0) broadcast(room, { type: 'checksum', matchId: room.matchId, epoch: room.epoch, frame: room.state.frame, hash: stateHash(room.state) });
      if (room.state.phase === 'over' && !room.resultSent) {
        settle(room, room.state.winner, 'played');
        room.resultSent = true; room.resultFrame = room.state.frame;
        broadcast(room, { type: 'result', matchId: room.matchId, epoch: room.epoch, frame: room.state.frame, winner: room.state.winner, hash: stateHash(room.state) });
      }
      if (room.resultSent && room.state.frame >= room.resultFrame + 180) {
        room.finished = true; updateRoom(room); broadcast(room, { type: 'finished', matchId: room.matchId }); break;
      }
    }
  }
  // 연결 객체·토큰을 저장하지 않고 경기와 예약 좌석을 복원한다.
  function snapshot() {
    return [...rooms.values()].map(room => ({ ...room,
      password: room.password?.toString('hex') ?? null,
      peers: room.peers.map(p => ({ profileId: p.profileId, side: p.side, charId: p.charId, inputBatchLimit: p.inputBatchLimit ?? 3, disconnected: !!p.disconnected, deadline: p.deadline })),
      spectators: room.spectators.map(p => ({ profileId: p.profileId, side: null, spectator: true, disconnected: !!p.disconnected, deadline: p.deadline })),
      ready: [...room.ready], confirmed: [...(room.confirmed ?? [])], rematch: [...(room.rematch ?? [])], acks: room.acks ? [...room.acks] : undefined,
      inputs: room.inputs?.map(map => [...map]),
    }));
  }
  function restore(saved, makePeer) {
    rooms.clear(); peers.clear(); queue.clear();
    for (const value of saved) {
      const room = { ...value, password: value.password ? Buffer.from(value.password, 'hex') : null,
        ready: new Set(value.ready), confirmed: new Set(value.confirmed ?? []), rematch: new Set(value.rematch ?? []), acks: value.acks ? new Set(value.acks) : undefined,
        inputs: value.inputs?.map(entries => new Map(entries)) };
      room.peers = value.peers.map(meta => {
        const peer = Object.assign(makePeer(meta), meta, { room,
          inputBatchLimit: allowBatchExperiments && [4, 6].includes(meta.inputBatchLimit) ? meta.inputBatchLimit : 3 });
        if (!peer.disconnected) peers.add(peer);
        return peer;
      });
      room.spectators = (value.spectators ?? []).map(meta => {
        const peer = Object.assign(makePeer(meta), meta, { room });
        if (!peer.disconnected) peers.add(peer);
        return peer;
      });
      room.spectatorInputs ??= [];
      rooms.set(room.code, room);
    }
  }
  return { handle, leave, disconnect, sweep, synchronize, rooms, peers, queue, matchmake, profiles, snapshot, restore };
}
