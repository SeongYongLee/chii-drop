import test from 'node:test';
import assert from 'node:assert/strict';
import { createRooms, REMATCH_START_DELAY } from '../server/rooms.js';
import { PROTOCOL, stateHash } from '../src/net/rollback.js';
import { RULES_VERSION } from '../src/engine/rules.js';
import { createMatch } from '../src/engine/match.js';
const last = (p, type) => p.messages.findLast(m => m.type === type);
function fixture() {
  let time = 100000;
  const lobby = createRooms({ now: () => time, characters: ['actor-a', 'actor-b', 'actor-c'] });
  const peer = token => {
    const p = { messages: [], send(m) { this.messages.push(structuredClone(m)); } };
    lobby.handle(p, { type: 'hello', protocol: PROTOCOL, rulesVersion: RULES_VERSION, token }); return p;
  };
  const a = peer(), b = peer(), observer = peer();
  lobby.handle(a, { type: 'create', name: '같은 방', rated: true, password: 'test' });
  const room = a.room;
  lobby.handle(b, { type: 'join', code: room.code, password: 'test' });
  lobby.handle(observer, { type: 'watch', code: room.code, password: 'test' });
  for (const p of [a, b]) lobby.handle(p, { type: 'ready' });
  lobby.handle(a, { type: 'character', charId: 'actor-c', selectionId: room.selectionId });
  for (const p of [a, b]) lobby.handle(p, { type: 'confirmCharacter', selectionId: room.selectionId });
  const finish = () => {
    time += 600000;
    for (let frame = 0; frame < 5000 && !room.finished; frame++) for (const p of room.peers) {
      lobby.handle(p, { type: 'input', matchId: room.matchId, epoch: room.epoch, frame, input: 4 });
    }
    assert.equal(room.finished, true);
  };
  const choose = (p, ready = true, matchId = room.matchId) => lobby.handle(p, { type: 'rematch', matchId, ready });
  return { lobby, room, a, b, observer, peer, finish, choose, advance(ms) { time += ms; lobby.sweep(); }, now: () => time };
}

test('both players consent before a new match starts with the same characters, room and spectators', () => {
  const f = fixture(); f.finish();
  const { lobby, room, a, b, observer } = f, previous = room.matchId;
  const characters = room.peers.map(p => p.charId), code = room.code, password = room.password.toString('hex');
  f.choose(a); f.choose(a);
  f.advance(1000); assert.equal(room.matchId, previous); assert.deepEqual([...room.rematch], [0]);
  f.choose(b); const deadline = room.rematchAt; f.choose(b); assert.equal(room.rematchAt, deadline);
  f.advance(REMATCH_START_DELAY - 1); assert.equal(room.matchId, previous);
  f.advance(1); assert.notEqual(room.matchId, previous);
  assert.equal(room.state.frame, 0); assert.deepEqual(room.next, [0, 0]); assert.equal(room.finished, undefined);
  assert.equal(room.rematch.size, 0); assert.equal(room.code, code); assert.equal(room.password.toString('hex'), password);
  assert.deepEqual(room.peers.map(p => p.charId), characters);
  assert.equal(last(observer, 'spectatorSnapshot').matchId, room.matchId);
  assert.equal(last(observer, 'spectatorSnapshot').state.frame, 0);
  assert.equal(stateHash(room.state), stateHash(createMatch({ seed: last(a, 'start').seed })));
  assert.equal(lobby.profiles.get(a.profileId).games, 1);
});

test('either player returning to the room cancels even mutually requested rematches for every spectator', () => {
  for (const returning of [0, 1]) {
    const f = fixture(); f.finish(); const old = f.room.matchId;
    f.choose(f.a); f.choose(f.b);
    f.lobby.handle([f.a, f.b][returning], { type: 'returnRoom', matchId: old });
    f.advance(1000);
    assert.equal(f.room.state, null); assert.equal(f.room.matchId, null); assert.equal(f.room.rematch.size, 0);
    for (const p of [f.a, f.b, f.observer]) { assert.ok(last(p, 'reset')); assert.equal(p.room, f.room); }
    assert.equal(f.lobby.profiles.get(f.a.profileId).games, 1);
  }
});

test('requests can be withdrawn and stale choices cannot reset or restart another match', () => {
  const f = fixture();
  f.choose(f.a); assert.match(last(f.a, 'error').reason, /종료/);
  f.finish(); const old = f.room.matchId;
  f.choose(f.a); f.choose(f.b); f.choose(f.a, false); f.advance(1000);
  assert.equal(f.room.matchId, old); assert.deepEqual([...f.room.rematch], [1]);
  f.choose(f.a); f.advance(REMATCH_START_DELAY);
  const current = f.room.matchId;
  f.lobby.handle(f.a, { type: 'returnRoom', matchId: old }); f.choose(f.b, true, old);
  assert.equal(f.room.matchId, current); assert.equal(f.room.state.frame, 0);
  f.finish();
  f.lobby.handle(f.a, { type: 'returnRoom', matchId: old });
  assert.equal(f.room.matchId, current); assert.equal(f.room.finished, true); assert.equal(f.room.rematch.size, 0);
});

test('spectators cannot choose a rematch or return the players to the lobby', () => {
  const f = fixture(); f.finish();
  f.choose(f.observer); assert.match(last(f.observer, 'error').reason, /관전/);
  f.lobby.handle(f.observer, { type: 'returnRoom', matchId: f.room.matchId });
  assert.match(last(f.observer, 'error').reason, /관전/); assert.equal(f.room.rematch.size, 0);
});

test('pending rematch consent and its deadline survive persistence without sharing mutable state', () => {
  const f = fixture(); f.finish(); f.choose(f.a); f.choose(f.b);
  const saved = JSON.parse(JSON.stringify(f.lobby.snapshot())), old = f.room.matchId;
  let time = f.now();
  const restored = createRooms({ profiles: f.lobby.profiles, now: () => time, characters: ['actor-a', 'actor-b', 'actor-c'] });
  restored.restore(saved, () => ({ send() {} }));
  const room = restored.rooms.get(f.room.code);
  assert.deepEqual([...room.rematch], [0, 1]);
  time += REMATCH_START_DELAY; restored.sweep();
  assert.notEqual(room.matchId, old); assert.equal(room.state.frame, 0);
  assert.equal(f.room.matchId, old); assert.equal(f.room.rematch.size, 2);
});

test('a disconnected result-screen player keeps a reserved seat but must consent again after reconnecting', () => {
  const f = fixture(); f.finish(); f.choose(f.a); f.choose(f.b);
  const token = last(f.b, 'welcome').token, old = f.room.matchId;
  f.lobby.disconnect(f.b); f.advance(1000);
  assert.equal(f.room.matchId, old); assert.deepEqual([...f.room.rematch], [0]); assert.equal(f.room.rematchAt, null);
  const back = f.peer(token), snapshot = last(back, 'snapshot');
  assert.equal(snapshot.finished, true); assert.equal(snapshot.matchId, old); assert.ok(snapshot.settlement);
  assert.notEqual(f.room.paused, true); assert.equal(back.room, f.room);
  f.choose(back); f.advance(REMATCH_START_DELAY);
  assert.notEqual(f.room.matchId, old); assert.equal(f.lobby.profiles.get(back.profileId).games, 1);
});

test('result-screen reconnect grace expiry returns everyone else to the waiting room without another rating settlement', () => {
  const f = fixture(); f.finish(); f.choose(f.a); f.lobby.disconnect(f.b);
  f.advance(30000);
  assert.equal(f.room.state, null); assert.deepEqual(f.room.peers, [f.a]);
  assert.equal(f.room.rematch.size, 0); assert.ok(last(f.observer, 'reset'));
  assert.equal(f.lobby.profiles.get(f.a.profileId).games, 1);
});
