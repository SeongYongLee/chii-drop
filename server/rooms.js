import { readFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createMatch, stepMatch } from '../src/engine/match.js';
import { RULES_VERSION } from '../src/engine/rules.js';
import { MAX_AHEAD, PROTOCOL, stateHash, validInput } from '../src/net/rollback.js';
import { createProfileStore } from './profiles.js';
import { validInputBatch } from '../src/net/input-batch.js';

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
export function createRooms({ profiles = createProfileStore(), now = Date.now, characters = defaultCharacters(), reconnectGrace = 30000 } = {}) {
  if (!characters.length) throw new Error('No playable characters');
  const availableCharacters = new Set(characters);
  const rooms = new Map(), peers = new Set(), queue = new Map();
  const send = (peer, message) => { if (!peer.disconnected) peer.send(message); };
  const broadcast = (room, message) => room.peers.forEach((p) => send(p, message));
  const error = (peer, reason) => send(peer, { type: 'error', reason });
  function roomView(room) {
    return { code: room.code, name: room.name, rated: room.rated, locked: !!room.password,
      mode: 'duel', capacity: 2, phase: room.state ? 'playing' : 'waiting',
      players: room.peers.map((p) => ({ ...profiles.get(p.profileId), side: p.side, charId: p.charId, ready: room.ready.has(p.side) })) };
  }
  function updateRoom(room) { broadcast(room, { type: 'room', room: roomView(room) }); }
  function updateLobby() {
    const list = [...rooms.values()].map(roomView);
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
  function exitRoom(peer) {
    const room = peer.room;
    queue.delete(peer);
    if (!room) return;
    if (room.state && !room.settlement) settle(room, 1 - peer.side, 'forfeit');
    rooms.delete(room.code);
    room.peers.forEach((p) => {
      p.room = null;
      send(p, { type: 'ended', reason: p !== peer && room.state && !room.finished ? '상대가 이탈하여 경기를 종료했습니다.' : '방을 나왔습니다. 로비에서 다시 참가하세요.' });
    });
    updateLobby();
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
    if (!room?.state || room.finished) { exitRoom(peer); updateLobby(); return; }
    peer.disconnected = true;
    pause(room); updateLobby();
  }
  function sweep() {
    for (const room of rooms.values()) if (room.paused && now() >= room.deadline) {
      const missing = room.peers.filter(p => p.disconnected || (room.syncing && !room.acks?.has(p.side)));
      if (!room.settlement) settle(room, missing.length === 1 ? 1 - missing[0].side : -1, 'forfeit');
      rooms.delete(room.code);
      for (const p of room.peers) { p.room = null; send(p, { type: 'ended', reason: '30초 재접속 유예가 끝나 경기를 종료했습니다.' }); }
      updateLobby();
    }
  }
  function synchronize(room) {
    pause(room);
    room.epoch++; room.syncing = true; room.acks = new Set();
    room.next = [room.state.frame, room.state.frame]; room.inputs = [new Map(), new Map()];
    broadcast(room, { type: 'snapshot', matchId: room.matchId, epoch: room.epoch,
      remaining: Math.max(0, room.deadline - now()), state: room.state, hash: stateHash(room.state), players: roomView(room).players });
  }
  function makeRoom({ name = '함께 대전해요', rated = false, password = '' } = {}) {
    if (rooms.size >= 100) throw new Error('서버의 방이 가득 찼습니다.');
    if (typeof rated !== 'boolean' || typeof name !== 'string' || name.trim().length < 1 || name.length > 30 || /[\p{C}<>]/u.test(name)) throw new Error('방 설정이 올바르지 않습니다.');
    const pass = passwordValue(password), salt = randomBytes(16).toString('hex');
    let code;
    do { code = randomBytes(4).toString('hex').toUpperCase(); } while (rooms.has(code));
    const room = { code, name: name.trim(), rated, salt, password: pass ? passwordHash(salt, pass) : null,
      peers: [], ready: new Set(), state: null };
    rooms.set(code, room); return room;
  }
  function seat(room, peer) {
    queue.delete(peer); peer.side = room.peers.length;
    if (!availableCharacters.has(peer.charId)) peer.charId = characters[peer.side % characters.length];
    peer.room = room; room.peers.push(peer);
    send(peer, { type: 'joined', code: room.code, side: peer.side });
    updateRoom(room); updateLobby();
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
        send(peer, { type: 'welcome', ...identity });
        send(peer, { type: 'rankings', rankings: profiles.rankings() });
        const reserved = [...rooms.values()].flatMap(r => r.peers).find(p => p.disconnected && p.profileId === peer.profileId);
        if (reserved) {
          const room = reserved.room;
          peer.room = room; peer.side = reserved.side; peer.charId = reserved.charId;
          room.peers[peer.side] = peer; reserved.room = null;
          send(peer, { type: 'joined', code: room.code, side: peer.side }); updateRoom(room);
          if (room.state) synchronize(room);
        }
        updateLobby();
      } catch (e) { error(peer, e.message); }
      return;
    }
    if (!peers.has(peer)) throw new Error('authentication required');
    if (msg.type === 'rename') {
      if (peer.room || queue.has(peer)) { error(peer, '로비에서 닉네임을 변경하세요.'); return; }
      try { send(peer, { type: 'profile', profile: profiles.rename(peer.profileId, msg.name) }); updateRankings(); } catch (e) { error(peer, e.message); }
      return;
    }
    if (msg.type === 'list') { updateLobby(); send(peer, { type: 'rankings', rankings: profiles.rankings() }); return; }
    if (msg.type === 'leave') { const wasQueued = queue.has(peer); exitRoom(peer); if (wasQueued) send(peer, { type: 'queued', active: false }); return; }
    if (msg.type === 'cancelQueue') { queue.delete(peer); send(peer, { type: 'queued', active: false }); return; }
    if (msg.type === 'queue') {
      if (peer.room || queue.has(peer) || typeof msg.rated !== 'boolean') { error(peer, '현재 자동 매칭을 시작할 수 없습니다.'); return; }
      queue.set(peer, { at: now(), rated: msg.rated }); send(peer, { type: 'queued', active: true, rated: msg.rated }); matchmake(); return;
    }
    if (msg.type === 'create' || msg.type === 'join') {
      if (peer.room || queue.has(peer)) { error(peer, '먼저 현재 방이나 매칭 대기에서 나와 주세요.'); return; }
      if (msg.mode !== undefined && msg.mode !== 'duel') { error(peer, '현재 1대1만 지원합니다.'); return; }
      try {
        if (msg.type === 'create') seat(makeRoom(msg), peer);
        else {
          const room = typeof msg.code === 'string' && rooms.get(msg.code.toUpperCase());
          if (!room || room.peers.length !== 1 || room.state) { error(peer, '입장 가능한 방을 찾을 수 없습니다.'); return; }
          const attempt = passwordValue(msg.password);
          if (room.password && !timingSafeEqual(room.password, passwordHash(room.salt, attempt))) { error(peer, '비밀번호가 일치하지 않습니다.'); return; }
          seat(room, peer);
        }
      } catch (e) { error(peer, e.message); }
      return;
    }
    const room = peer.room;
    if (!room) throw new Error('not in room');
    if (room.paused && now() >= room.deadline) { sweep(); return; }
    if (msg.type === 'character') {
      if (room.state || room.ready.has(peer.side)) { error(peer, '준비를 취소한 뒤 캐릭터를 선택해 주세요.'); return; }
      if (!availableCharacters.has(msg.charId)) { error(peer, '선택할 수 없는 캐릭터입니다.'); return; }
      peer.charId = msg.charId; updateRoom(room); return;
    }
    if (msg.type === 'ready') {
      if (room.state || room.peers.length !== 2) { error(peer, '상대가 참가한 후 준비할 수 있습니다.'); return; }
      if (msg.ready === false) room.ready.delete(peer.side); else room.ready.add(peer.side);
      updateRoom(room);
      if (room.ready.size === 2) {
        const seed = randomBytes(4).readUInt32LE();
        room.state = createMatch({ seed }); room.started = now(); room.matchId = randomUUID();
        room.epoch = 0; room.paused = false; room.deadline = null; room.syncing = false;
        room.next = [0, 0]; room.inputs = [new Map(), new Map()];
        broadcast(room, { type: 'start', seed, matchId: room.matchId, players: roomView(room).players }); updateLobby();
      }
      return;
    }
    if (msg.type === 'returnRoom') {
      if (!room.finished) { error(peer, '경기가 끝난 뒤 대기실로 돌아갈 수 있습니다.'); return; }
      room.state = null; room.matchId = null; room.ready.clear(); room.settlement = null; room.finished = false; room.resultSent = false;
      broadcast(room, { type: 'reset' }); updateRoom(room); updateLobby(); return;
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
      if (!validInputBatch(msg) || msg.frame !== room.next[peer.side]
        || msg.frame + msg.inputs.length - 1 > room.state.frame + MAX_AHEAD
        || msg.frame + msg.inputs.length - 1 > (now() - room.started) * .06 + MAX_AHEAD) throw new Error('invalid input batch');
      send(room.peers[1 - peer.side], { type: 'inputBatch', matchId: room.matchId, epoch: room.epoch, side: peer.side, frame: msg.frame, inputs: msg.inputs });
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
    if (relay) send(room.peers[1 - peer.side], { type: 'input', matchId: room.matchId, epoch: room.epoch, side: peer.side, frame, input });
    while (room.inputs.every((map) => map.has(room.state.frame))) {
      const f = room.state.frame;
      room.state = stepMatch(room.state, room.inputs.map((map) => map.get(f)));
      room.inputs.forEach((map) => map.delete(f));
      if (room.state.frame % 60 === 0) broadcast(room, { type: 'checksum', matchId: room.matchId, epoch: room.epoch, frame: room.state.frame, hash: stateHash(room.state) });
      if (room.state.phase === 'over' && !room.resultSent) {
        settle(room, room.state.winner, 'played');
        room.resultSent = true; room.resultFrame = room.state.frame;
        broadcast(room, { type: 'result', matchId: room.matchId, epoch: room.epoch, frame: room.state.frame, winner: room.state.winner, hash: stateHash(room.state) });
      }
      if (room.resultSent && room.state.frame >= room.resultFrame + 180) {
        room.finished = true; broadcast(room, { type: 'finished', matchId: room.matchId }); break;
      }
    }
  }
  // 연결 객체·토큰을 저장하지 않고 경기와 예약 좌석을 복원한다.
  function snapshot() {
    return [...rooms.values()].map(room => ({ ...room,
      password: room.password?.toString('hex') ?? null,
      peers: room.peers.map(p => ({ profileId: p.profileId, side: p.side, charId: p.charId, disconnected: !!p.disconnected })),
      ready: [...room.ready], acks: room.acks ? [...room.acks] : undefined,
      inputs: room.inputs?.map(map => [...map]),
    }));
  }
  function restore(saved, makePeer) {
    rooms.clear(); peers.clear(); queue.clear();
    for (const value of saved) {
      const room = { ...value, password: value.password ? Buffer.from(value.password, 'hex') : null,
        ready: new Set(value.ready), acks: value.acks ? new Set(value.acks) : undefined,
        inputs: value.inputs?.map(entries => new Map(entries)) };
      room.peers = value.peers.map(meta => {
        const peer = Object.assign(makePeer(meta), meta, { room });
        if (!peer.disconnected) peers.add(peer);
        return peer;
      });
      rooms.set(room.code, room);
    }
  }
  return { handle, leave, disconnect, sweep, synchronize, rooms, peers, queue, matchmake, profiles, snapshot, restore };
}
