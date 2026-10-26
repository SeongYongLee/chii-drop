import test from 'node:test';
import assert from 'node:assert/strict';
import { createRooms } from '../server/rooms.js';
import { PROTOCOL, stateHash } from '../src/net/rollback.js';
import { RULES_VERSION } from '../src/engine/rules.js';
import { createMatch, stepMatch } from '../src/engine/match.js';

const last = (p, type) => p.messages.findLast(m => m.type === type);
function fixture() {
  let now = 100000;
  const lobby = createRooms({ now: () => now });
  const peer = () => {
    const p = { messages: [], send(m) { this.messages.push(structuredClone(m)); } };
    lobby.handle(p, { type: 'hello', protocol: PROTOCOL, rulesVersion: RULES_VERSION });
    return p;
  };
  const a = peer(), b = peer();
  lobby.handle(a, { type: 'create', name: '유지할 방', password: 'test-password', rated: true });
  const room = a.room;
  lobby.handle(b, { type: 'join', code: room.code, password: 'test-password' });
  const start = () => { room.peers.forEach(p => lobby.handle(p, { type: 'ready' })); room.peers.forEach(p => lobby.handle(p, { type: 'confirmCharacter', selectionId: room.selectionId })); };
  return { lobby, peer, a, b, room, start, advance(ms) { now += ms; lobby.sweep(); } };
}

test('어느 좌석이 나가도 코드·설정·남은 캐릭터를 유지하고 새 상대와 같은 방에서 대전한다', () => {
  for (const leavingSide of [0, 1]) {
    const f = fixture(), { lobby, room } = f;
    const oldCode = room.code, oldPassword = room.password.toString('hex');
    const leaving = room.peers[leavingSide], staying = room.peers[1 - leavingSide], character = staying.charId;
    lobby.handle(staying, { type: 'ready' });
    lobby.handle(leaving, { type: 'leave' });
    assert.equal(lobby.rooms.get(oldCode), room);
    assert.equal(leaving.room, null);
    assert.equal(staying.room, room); assert.equal(staying.side, 0); assert.equal(staying.charId, character);
    assert.deepEqual(room.peers, [staying]); assert.equal(room.ready.size, 0);
    assert.equal(room.name, '유지할 방'); assert.equal(room.rated, true); assert.equal(room.password.toString('hex'), oldPassword);
    assert.equal(last(staying, 'reset').side, 0);
    const c = f.peer();
    lobby.handle(c, { type: 'join', code: oldCode, password: 'wrong' });
    assert.equal(c.room, undefined);
    lobby.handle(c, { type: 'join', code: oldCode, password: 'test-password' });
    assert.equal(c.side, 1); assert.equal(c.room, room);
    f.start();
    const seed = last(staying, 'start').seed;
    let expected = createMatch({ seed });
    for (let frame = 0; frame < 60; frame++) {
      const inputs = [frame % 7 ? 0 : 2, frame % 9 ? 0 : 8];
      room.peers.forEach((p, side) => lobby.handle(p, { type: 'input', matchId: room.matchId, epoch: 0, frame, input: inputs[side] }));
      expected = stepMatch(expected, inputs);
    }
    assert.equal(stateHash(room.state), stateHash(expected));
    assert.equal(lobby.profiles.get(staying.profileId).games, 0);
  }
});

test('경기 중 기권은 한 번만 정산하고 새 경기에는 이전 입력·체크포인트·준비가 섞이지 않는다', () => {
  const f = fixture(), { lobby, a, b, room } = f; f.start();
  const oldMatch = room.matchId;
  lobby.handle(a, { type: 'leave' });
  lobby.handle(a, { type: 'leave' });
  assert.equal(lobby.profiles.get(a.profileId).rating, 1484);
  assert.equal(lobby.profiles.get(b.profileId).rating, 1516);
  assert.equal(lobby.profiles.get(b.profileId).games, 1);
  assert.equal(room.state, null); assert.equal(room.matchId, null); assert.equal(room.ready.size, 0);
  assert.equal(room.paused, undefined); assert.equal(room.inputs, undefined);
  assert.equal(b.messages.filter(m => m.type === 'settlement').length, 1);
  const c = f.peer(); lobby.handle(c, { type: 'join', code: room.code, password: 'test-password' }); f.start();
  assert.notEqual(room.matchId, oldMatch);
  lobby.handle(b, { type: 'inputBatch', matchId: oldMatch, epoch: 0, frame: 0, inputs: [31] });
  assert.equal(room.state.frame, 0); assert.deepEqual(room.next, [0, 0]);
  lobby.handle(b, { type: 'leave' }); lobby.handle(c, { type: 'leave' });
  assert.equal(lobby.rooms.size, 0);
});

test('대기실 연결 종료는 남은 방을 유지하고 마지막 사람이 나가면 방을 삭제한다', () => {
  const { lobby, a, b, room } = fixture();
  lobby.disconnect(a);
  assert.equal(b.room, room); assert.equal(room.state, null);
  lobby.disconnect(b);
  assert.equal(lobby.rooms.size, 0);
  assert.equal(lobby.profiles.get(a.profileId).games, 0);
});

test('유예 만료 뒤 남은 좌석은 대기실로 복귀하고 만료된 사용자는 로비로만 재접속한다', () => {
  const f = fixture(), { lobby, a, b, room } = f; f.start();
  const token = last(a, 'welcome').token;
  lobby.disconnect(a); f.advance(29999);
  assert.equal(room.paused, true); assert.equal(room.state.frame, 0);
  f.advance(1);
  assert.equal(b.room, room); assert.equal(b.side, 0); assert.equal(room.state, null);
  const next = { messages: [], send(m) { this.messages.push(m); } };
  lobby.handle(next, { type: 'hello', protocol: PROTOCOL, rulesVersion: RULES_VERSION, token });
  assert.equal(next.room, undefined);
  assert.equal(lobby.profiles.get(b.profileId).games, 1);
});
