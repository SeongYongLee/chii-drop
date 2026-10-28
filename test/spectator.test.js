import test from 'node:test';
import assert from 'node:assert/strict';
import { createRooms } from '../server/rooms.js';
import { PROTOCOL, stateHash } from '../src/net/rollback.js';
import { RULES_VERSION } from '../src/engine/rules.js';
import { SpectatorMatch } from '../src/net/spectator.js';

const last = (p, type) => p.messages.findLast(m => m.type === type);
function fixture() {
  let now = 100000;
  const lobby = createRooms({ now: () => now });
  const peer = token => {
    const p = { messages: [], send(m) { this.messages.push(structuredClone(m)); } };
    lobby.handle(p, { type: 'hello', protocol: PROTOCOL, rulesVersion: RULES_VERSION, token }); return p;
  };
  const a = peer(), b = peer();
  lobby.handle(a, { type: 'create', password: 'secret', rated: true });
  const room = a.room;
  lobby.handle(b, { type: 'join', code: room.code, password: 'secret' });
  const watch = p => lobby.handle(p, { type: 'watch', code: room.code, password: 'secret' });
  const start = () => { room.peers.forEach(p => lobby.handle(p, { type: 'ready' })); room.peers.forEach(p => lobby.handle(p, { type: 'confirmCharacter', selectionId: room.selectionId })); };
  const frames = count => {
    for (let i = 0; i < count; i++) {
      now += 1000 / 60;
      const frame = room.state.frame;
      for (const p of room.peers) lobby.handle(p, { type: 'input', matchId: room.matchId, epoch: room.epoch, frame, input: (frame % 17 === 0 ? 8 : frame % 23 === 0 ? 2 : 0) });
    }
  };
  return { lobby, peer, a, b, room, watch, start, frames, advance(ms) { now += ms; lobby.sweep(); } };
}
function consume(p, game) {
  for (const packet of p.messages.filter(m => m.type === 'spectatorFrames')) {
    game.receiveBatch(packet.frame, packet.inputs);
    while (game.canAdvance) game.advance();
  }
  p.messages = p.messages.filter(m => m.type !== 'spectatorFrames');
}

test('관전은 비밀번호와 총 입장 6명 상한을 지키고 대전 좌석·레이트·준비에 영향을 주지 않는다', () => {
  const f = fixture(), p = f.peer();
  f.lobby.handle(p, { type: 'watch', code: f.room.code, password: 'wrong' }); assert.equal(p.room, undefined);
  f.watch(p); assert.equal(p.spectator, true); assert.equal(last(p, 'joined').side, null); assert.equal(f.room.peers.length, 2);
  for (const type of ['ready', 'character', 'returnRoom', 'confirmCharacter', 'cancelSelection', 'input', 'inputBatch', 'synced']) {
    f.lobby.handle(p, { type, ready: true, charId: 'actor-0' }); assert.match(last(p, 'error').reason, /관전/);
  }
  assert.equal(f.room.ready.size, 0);
  for (let i = 0; i < 3; i++) f.watch(f.peer());
  const extra = f.peer(); f.watch(extra); assert.equal(extra.room, undefined);
  assert.equal(f.room.spectators.length, 4);
  f.lobby.handle(p, { type: 'leave' }); assert.equal(f.room.peers.length, 2); assert.equal(f.room.settlement, undefined);
  f.lobby.handle(p, { type: 'create' }); assert.equal(p.spectator, false);
});

test('시작 전 관전과 경기 도중 관전 모두 확정 입력만 재생하고 서버 상태 해시가 일치한다', () => {
  const f = fixture(), early = f.peer(); f.watch(early); f.start();
  const initial = last(early, 'spectatorSnapshot'), game = new SpectatorMatch(initial.state, initial.hash);
  f.frames(17);
  const late = f.peer(); f.watch(late);
  const snapshot = last(late, 'spectatorSnapshot'), lateGame = new SpectatorMatch(snapshot.state, snapshot.hash);
  assert.equal(snapshot.state.frame, 17); assert.equal(f.room.paused, false); assert.equal(f.room.epoch, 0);
  f.frames(43); consume(early, game); consume(late, lateGame);
  assert.equal(stateHash(game.state), stateHash(f.room.state)); assert.equal(stateHash(lateGame.state), stateHash(f.room.state));
  assert.equal(game.canAdvance, false); assert.equal(game.advance(), null);
  assert.equal(early.messages.some(m => ['input', 'inputBatch'].includes(m.type)), false);
  assert.equal(early.messages.filter(m => m.type === 'checksum').length, 1);
});

test('관전자 재접속·개별 재동기화는 경기 epoch·유예·양쪽 입력 진행을 바꾸지 않는다', () => {
  const f = fixture(), p = f.peer(); f.watch(p); f.start(); f.frames(12);
  const token = last(p, 'welcome').token;
  f.lobby.disconnect(p); assert.equal(f.room.paused, false); f.frames(6);
  const next = f.peer(token); assert.equal(next.room, f.room); assert.equal(next.spectator, true);
  assert.equal(last(next, 'spectatorSnapshot').state.frame, 18); assert.equal(f.room.epoch, 0);
  f.lobby.handle(next, { type: 'resync', matchId: f.room.matchId });
  assert.equal(f.room.paused, false); assert.equal(f.room.epoch, 0);
  f.lobby.disconnect(f.a); assert.equal(f.room.paused, true);
  const player = f.peer(last(f.a, 'welcome').token);
  const snap = last(player, 'snapshot'), observerSnap = last(next, 'spectatorSnapshot');
  assert.equal(observerSnap.epoch, snap.epoch); assert.equal(observerSnap.paused, true);
  for (const q of f.room.peers) f.lobby.handle(q, { type: 'synced', matchId: f.room.matchId, epoch: snap.epoch, hash: snap.hash });
  assert.equal(f.room.paused, false); assert.equal(last(next, 'resumed').epoch, snap.epoch);
  f.lobby.disconnect(next); f.advance(30000); assert.equal(f.room.spectators.length, 0); assert.equal(f.room.paused, false);
});

test('관전 좌석은 저장·복원되고 기권 정산에 포함되지 않으며 관전자만 남아도 방을 유지한다', () => {
  const f = fixture(), p = f.peer(); f.watch(p); f.start(); f.frames(9);
  const saved = JSON.parse(JSON.stringify(f.lobby.snapshot()));
  const restored = createRooms({ profiles: f.lobby.profiles });
  restored.restore(saved, () => ({ send() {} }));
  const restoredRoom = restored.rooms.get(f.room.code);
  assert.equal(restoredRoom.spectators.length, 1); assert.equal(restoredRoom.spectators[0].spectator, true);
  assert.equal(stateHash(restoredRoom.state), stateHash(f.room.state));
  f.lobby.handle(f.a, { type: 'leave' });
  assert.equal(f.lobby.profiles.get(p.profileId).games, 0); assert.equal(f.lobby.profiles.get(p.profileId).rating, 1500);
  assert.equal(last(p, 'settlement').result.standings.length, 2); assert.ok(last(p, 'reset'));
  assert.equal(p.room, f.room); assert.equal(f.room.spectators.length, 1);
  f.lobby.handle(f.b, { type: 'leave' }); assert.equal(p.room, f.room); assert.equal(f.room.peers.length, 0);
  f.lobby.handle(p, { type: 'leave' }); assert.equal(p.room, null); assert.equal(f.lobby.rooms.size, 0); assert.ok(last(p, 'ended'));
});

test('관전자가 빈자리로 전환하면 같은 방에서 준비·캐릭터 선택·다음 경기와 플레이어 재접속을 이어간다', () => {
  const f = fixture(), first = f.peer(), second = f.peer(); f.watch(first); f.watch(second);
  const code = f.room.code;
  f.lobby.handle(first, { type: 'takeSeat' }); assert.match(last(first, 'error').reason, /빈자리/);
  f.start(); f.frames(12);
  f.lobby.handle(first, { type: 'takeSeat' }); assert.equal(first.spectator, true); assert.equal(f.room.state.frame, 12);
  const oldMatch = f.room.matchId;
  f.lobby.handle(f.a, { type: 'leave' });
  f.lobby.handle(first, { type: 'takeSeat' });
  assert.equal(first.room.code, code); assert.equal(first.spectator, false); assert.equal(first.side, 1);
  assert.equal(f.room.peers.length, 2); assert.deepEqual(f.room.spectators, [second]); assert.equal(f.room.ready.size, 0);
  assert.equal(last(first, 'joined').side, 1);
  f.lobby.handle(second, { type: 'takeSeat' }); assert.equal(second.spectator, true);
  f.room.peers.forEach(p => f.lobby.handle(p, { type: 'ready' }));
  f.lobby.handle(first, { type: 'character', charId: f.b.charId, selectionId: f.room.selectionId }); assert.equal(first.charId, f.b.charId);
  f.room.peers.forEach(p => f.lobby.handle(p, { type: 'confirmCharacter', selectionId: f.room.selectionId })); assert.notEqual(f.room.matchId, oldMatch); f.frames(60);
  assert.ok(last(first, 'checksum')); assert.ok(last(second, 'spectatorSnapshot'));
  assert.equal(f.lobby.profiles.get(first.profileId).games, 0);
  f.lobby.disconnect(first);
  const next = f.peer(last(first, 'welcome').token);
  assert.equal(next.spectator, false); assert.equal(next.side, 1); assert.equal(next.room.code, code);
  assert.ok(last(next, 'snapshot')); assert.equal(last(next, 'spectatorSnapshot'), undefined);
});

test('대전자가 없어도 관전자 두 명이 순서대로 자리를 차지하며 빈 방은 마지막 관전자 만료 때 정리한다', () => {
  const f = fixture(), first = f.peer(), second = f.peer(); f.watch(first); f.watch(second);
  f.lobby.handle(f.a, { type: 'leave' }); f.lobby.handle(f.b, { type: 'leave' });
  const code = f.room.code;
  f.lobby.handle(first, { type: 'takeSeat' }); f.lobby.handle(second, { type: 'takeSeat' });
  assert.deepEqual(f.room.peers.map(p => p.side), [0, 1]); assert.equal(f.room.spectators.length, 0); assert.equal(f.room.code, code);
  f.start(); assert.ok(f.room.state);
  const g = fixture(), watcher = g.peer(); g.watch(watcher);
  g.lobby.handle(g.a, { type: 'leave' }); g.lobby.handle(g.b, { type: 'leave' });
  g.lobby.disconnect(watcher); g.advance(29999); assert.equal(g.lobby.rooms.size, 1);
  g.advance(1); assert.equal(g.lobby.rooms.size, 0);
});

test('관전 재생기는 잘못된 입력·프레임 누락·과도한 누적을 거부하고 스냅샷으로 회복한다', () => {
  const f = fixture(); f.start();
  const game = new SpectatorMatch(f.room.state, stateHash(f.room.state));
  assert.throws(() => game.receiveBatch(1, [[0, 0]]));
  assert.throws(() => game.receiveBatch(0, [[32, 0]]));
  assert.throws(() => game.receiveBatch(0, [[0]]));
  for (let i = 0; i < 100; i++) game.receiveBatch(i * 6, Array.from({ length: 6 }, () => [0, 0]));
  assert.throws(() => game.receiveBatch(600, [[0, 0]]));
  game.restore(f.room.state, stateHash(f.room.state)); assert.equal(game.canAdvance, false);
  assert.throws(() => game.restore(f.room.state, 'bad'));
});

test('대기 중 플레이어는 준비 상태를 초기화하며 같은 방에서 관전으로 전환하고 다시 참가한다', () => {
  const f = fixture(); const code = f.room.code, character = f.a.charId;
  f.lobby.handle(f.a, { type: 'ready' });
  f.lobby.handle(f.a, { type: 'watchInstead' });
  assert.equal(f.a.spectator, true); assert.equal(f.a.side, null); assert.equal(f.a.room.code, code);
  assert.deepEqual(f.room.peers, [f.b]); assert.equal(f.b.side, 0); assert.deepEqual(f.room.spectators, [f.a]);
  assert.equal(f.room.ready.size, 0); assert.equal(f.a.messages.some(m => m.type === 'ended'), false);
  assert.equal(last(f.a, 'joined').role, 'spectator'); assert.equal(f.lobby.profiles.get(f.a.profileId).games, 0);
  f.lobby.handle(f.a, { type: 'takeSeat' });
  assert.equal(f.a.spectator, false); assert.equal(f.a.side, 1); assert.equal(f.a.charId, character);
  assert.equal(f.room.spectators.length, 0); f.start(); assert.ok(last(f.a, 'start'));
});

test('경기 중 관전 전환은 한 번만 기권 정산하고 새 관전자·다음 플레이어를 올바르게 분리한다', () => {
  const f = fixture(), next = f.peer(); f.watch(next); f.start(); f.frames(12);
  f.lobby.handle(f.a, { type: 'watchInstead' });
  assert.equal(f.lobby.profiles.get(f.a.profileId).rating, 1484);
  assert.equal(f.lobby.profiles.get(f.b.profileId).rating, 1516);
  assert.equal(f.lobby.profiles.get(next.profileId).games, 0);
  assert.equal(f.room.state, null); assert.equal(f.room.paused, undefined);
  assert.equal(f.a.room, f.room); assert.equal(f.a.spectator, true);
  f.lobby.handle(f.a, { type: 'watchInstead' }); assert.equal(f.lobby.profiles.get(f.a.profileId).games, 1);
  f.lobby.handle(next, { type: 'takeSeat' }); f.start();
  assert.ok(last(f.a, 'spectatorSnapshot')); assert.ok(last(next, 'start'));
  assert.equal(f.a.messages.filter(m => m.type === 'settlement').length, 1);
  const token = last(f.a, 'welcome').token; f.lobby.disconnect(f.a);
  const rejoined = f.peer(token); assert.equal(rejoined.spectator, true); assert.equal(rejoined.room, f.room);
  assert.equal(f.room.paused, false);
});

test('2P와 관전자 4명으로 가득 찬 방에서도 두 플레이어가 모두 관전으로 전환한다', () => {
  const f = fixture(); for (let i = 0; i < 4; i++) f.watch(f.peer()); f.start();
  f.lobby.handle(f.a, { type: 'watchInstead' });
  assert.equal(f.a.spectator, true); assert.equal(f.room.spectators.length, 5); assert.equal(f.room.peers.length, 1);
  assert.equal(f.lobby.profiles.get(f.a.profileId).games, 1);
  f.lobby.handle(f.b, { type: 'watchInstead' });
  assert.equal(f.b.spectator, true); assert.equal(f.room.spectators.length, 6); assert.equal(f.room.peers.length, 0);
  const outside = f.peer();
  for (const type of ['join', 'watch']) {
    f.lobby.handle(outside, { type, code: f.room.code, password: 'secret' });
    assert.equal(outside.room, undefined); assert.match(last(outside, 'error').reason, /최대 6명/);
  }
  f.lobby.handle(f.a, { type: 'takeSeat' }); f.lobby.handle(f.b, { type: 'takeSeat' });
  assert.equal(f.room.peers.length, 2); assert.equal(f.room.spectators.length, 4); f.start(); assert.ok(f.room.state);
});

test('1P와 관전자 5명일 때 외부 플레이어 입장은 막고 기존 관전자 승격·만석 재접속은 허용한다', () => {
  const f = fixture(); f.lobby.handle(f.b, { type: 'watchInstead' });
  for (let i = 0; i < 4; i++) f.watch(f.peer());
  const outside = f.peer(); f.lobby.handle(outside, { type: 'join', code: f.room.code, password: 'secret' });
  assert.equal(outside.room, undefined); assert.equal(f.room.peers.length, 1);
  const token = last(f.b, 'welcome').token; f.lobby.disconnect(f.b);
  f.watch(outside); assert.equal(outside.room, undefined);
  const back = f.peer(token); assert.equal(back.room, f.room); assert.equal(f.room.spectators.length, 5);
  f.lobby.handle(back, { type: 'takeSeat' }); assert.equal(f.room.peers.length, 2); assert.equal(f.room.spectators.length, 4);
  f.lobby.handle(f.room.spectators[0], { type: 'leave' });
  f.watch(outside); assert.equal(outside.room, f.room); assert.equal(f.room.peers.length + f.room.spectators.length, 6);
});

test('관전자 명단은 방 안에만 전달되고 재접속·대전 전환·퇴장을 반영한다', () => {
  const f = fixture(), p = f.peer(), q = f.peer(); f.watch(p); f.watch(q);
  const list = () => last(f.a, 'room').room.spectatorList;
  assert.deepEqual(list().map(v => v.id), [p.profileId, q.profileId]);
  assert.equal(list()[0].name, f.lobby.profiles.get(p.profileId).name); assert.equal(list()[0].connected, true);
  assert.deepEqual(Object.keys(list()[0]).sort(), ['connected', 'id', 'name']);
  const outside = f.peer(); f.lobby.handle(outside, { type: 'create' });
  assert.ok(last(outside, 'lobby').rooms.every(r => r.spectatorList === undefined));
  const token = last(p, 'welcome').token; f.lobby.disconnect(p); assert.equal(list()[0].connected, false);
  const back = f.peer(token); assert.equal(list()[0].connected, true);
  f.lobby.handle(f.b, { type: 'watchInstead' }); f.lobby.handle(back, { type: 'takeSeat' });
  assert.ok(!list().some(v => v.id === back.profileId));
  f.lobby.handle(q, { type: 'leave' }); assert.ok(!list().some(v => v.id === q.profileId));
});

test('경기 종료 후 플레이어의 대기실 복귀를 관전자도 따라가고 다음 경기를 관전한다', () => {
  const f = fixture(), p = f.peer(); f.watch(p); f.start();
  f.lobby.handle(p, { type: 'returnRoom' }); assert.match(last(p, 'error').reason, /관전/); assert.ok(f.room.state);
  f.room.started -= 600000;
  for (let frame = 0; frame < 5000 && !f.room.finished; frame++) for (const player of f.room.peers) {
    f.lobby.handle(player, { type: 'input', matchId: f.room.matchId, epoch: f.room.epoch, frame, input: 4 });
  }
  assert.equal(f.room.finished, true); assert.ok(last(p, 'finished'));
  const code = f.room.code, previous = f.room.matchId;
  f.lobby.handle(p, { type: 'returnRoom' }); assert.match(last(p, 'error').reason, /관전/); assert.equal(f.room.matchId, previous);
  f.lobby.handle(f.a, { type: 'returnRoom', matchId: previous });
  assert.equal(f.room.code, code); assert.equal(f.room.state, null); assert.equal(f.room.ready.size, 0);
  for (const member of [f.a, f.b, p]) { assert.ok(last(member, 'reset')); assert.equal(member.room, f.room); }
  assert.equal(p.spectator, true); assert.equal(last(p, 'room').room.spectatorList[0].id, p.profileId);
  assert.equal(f.lobby.profiles.get(p.profileId).games, 0);
  f.start(); assert.notEqual(f.room.matchId, previous); assert.equal(last(p, 'spectatorSnapshot').state.frame, 0);
});
