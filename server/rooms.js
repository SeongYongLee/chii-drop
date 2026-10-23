import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createMatch, stepMatch } from '../src/engine/match.js';
import { RULES_VERSION } from '../src/engine/rules.js';
import { MAX_AHEAD, PROTOCOL, stateHash, validInput } from '../src/net/rollback.js';
import { createProfileStore } from './profiles.js';

function passwordHash(salt, password) { return createHash('sha256').update(salt).update(password).digest(); }
function passwordValue(value) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > 32) throw new Error('비밀번호는 32자까지 입력할 수 있습니다.');
  return value;
}
export function createRooms({ profiles = createProfileStore(), now = Date.now } = {}) {
  const rooms = new Map(), peers = new Set(), queue = new Map();
  const send = (peer, message) => peer.send(message);
  const broadcast = (room, message) => room.peers.forEach((p) => send(p, message));
  const error = (peer, reason) => send(peer, { type: 'error', reason });
  function roomView(room) {
    return { code: room.code, name: room.name, rated: room.rated, locked: !!room.password,
      mode: 'duel', capacity: 2, phase: room.state ? 'playing' : 'waiting',
      players: room.peers.map((p) => ({ ...profiles.get(p.profileId), side: p.side, ready: room.ready.has(p.side) })) };
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
    queue.delete(peer); peer.side = room.peers.length; peer.room = room; room.peers.push(peer);
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
  function handle(peer, msg) {
    if (!msg || typeof msg !== 'object') throw new Error('invalid message');
    if (msg.type === 'ping') { send(peer, { type: 'pong', time: msg.time }); return; }
    if (msg.type === 'hello') {
      if (peer.profileId || msg.protocol !== PROTOCOL || msg.rulesVersion !== RULES_VERSION) throw new Error('version mismatch');
      try {
        const identity = profiles.authenticate(msg.token);
        if ([...peers].some((p) => p.profileId === identity.profile.id)) { error(peer, '이미 다른 창에서 이 플레이어가 접속 중입니다.'); return; }
        peer.profileId = identity.profile.id; peers.add(peer);
        send(peer, { type: 'welcome', ...identity });
        send(peer, { type: 'rankings', rankings: profiles.rankings() }); updateLobby();
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
    if (msg.type === 'ready') {
      if (room.state || room.peers.length !== 2) { error(peer, '상대가 참가한 후 준비할 수 있습니다.'); return; }
      if (msg.ready === false) room.ready.delete(peer.side); else room.ready.add(peer.side);
      updateRoom(room);
      if (room.ready.size === 2) {
        const seed = randomBytes(4).readUInt32LE();
        room.state = createMatch({ seed }); room.started = now(); room.matchId = randomUUID();
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
    if (msg.type === 'input' && msg.matchId !== room.matchId) return;
    if (msg.type !== 'input' || !room.state) throw new Error('unexpected message');
    // 이전 경기에서 전송 중이던 프레임은 새 경기와 섞지 않는다.
    if (msg.matchId !== room.matchId || room.finished) return;
    const { frame, input } = msg;
    if (!Number.isInteger(frame) || frame !== room.next[peer.side] || !validInput(input)
      || frame > room.state.frame + MAX_AHEAD || frame > (now() - room.started) * 0.06 + MAX_AHEAD) throw new Error('invalid frame');
    room.next[peer.side]++; room.inputs[peer.side].set(frame, input);
    send(room.peers[1 - peer.side], { type: 'input', matchId: room.matchId, side: peer.side, frame, input });
    while (room.inputs.every((map) => map.has(room.state.frame))) {
      const f = room.state.frame;
      room.state = stepMatch(room.state, room.inputs.map((map) => map.get(f)));
      room.inputs.forEach((map) => map.delete(f));
      if (room.state.frame % 60 === 0) broadcast(room, { type: 'checksum', matchId: room.matchId, frame: room.state.frame, hash: stateHash(room.state) });
      if (room.state.phase === 'over' && !room.resultSent) {
        settle(room, room.state.winner, 'played');
        room.resultSent = true; room.resultFrame = room.state.frame;
        broadcast(room, { type: 'result', matchId: room.matchId, frame: room.state.frame, winner: room.state.winner, hash: stateHash(room.state) });
      }
      if (room.resultSent && room.state.frame >= room.resultFrame + 180) {
        room.finished = true; broadcast(room, { type: 'finished', matchId: room.matchId }); break;
      }
    }
  }
  return { handle, leave, rooms, queue, matchmake, profiles };
}
