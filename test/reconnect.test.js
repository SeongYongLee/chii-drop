import test from 'node:test';
import assert from 'node:assert/strict';
import { createRooms } from '../server/rooms.js';
import { PROTOCOL, RollbackMatch, stateHash } from '../src/net/rollback.js';
import { RULES_VERSION } from '../src/engine/rules.js';
import { stepMatch } from '../src/engine/match.js';

const peer = () => ({ messages: [], send(m) { this.messages.push(structuredClone(m)); } });
const last = (p, type) => p.messages.findLast(m => m.type === type);
const hello = (l, p, token) => l.handle(p, { type: 'hello', protocol: PROTOCOL, rulesVersion: RULES_VERSION, token });
function fixture() {
  let time = 100000;
  const lobby = createRooms({ now: () => time });
  const a = peer(), b = peer(); hello(lobby, a); hello(lobby, b);
  const token = last(a, 'welcome').token, tokenB = last(b, 'welcome').token;
  lobby.handle(a, { type: 'create', rated: true }); lobby.handle(b, { type: 'join', code: a.room.code });
  lobby.handle(a, { type: 'ready' }); lobby.handle(b, { type: 'ready' });
  const room = a.room;
  const packet = (p, frame, epoch = room.epoch, input = 0) => lobby.handle(p, { type: 'input', matchId: room.matchId, epoch, frame, input });
  const ack = p => lobby.handle(p, { type: 'synced', matchId: room.matchId, epoch: room.epoch, hash: stateHash(room.state) });
  return { lobby, a, b, token, tokenB, room, packet, ack, advance(ms) { time += ms; lobby.sweep(); } };
}
test('disconnect freezes the match; token restores seat and both clients converge before resuming', () => {
  const f = fixture(), { lobby, a, b, room, packet, ack } = f;
  for (let n = 0; n < 60; n++) { packet(a, n); packet(b, n); }
  packet(a, 60, 0, 4); // 예측 중인 미확정 입력은 버린다.
  const hash = stateHash(room.state), charId = a.charId;
  lobby.disconnect(a); lobby.disconnect(a);
  assert.equal(room.paused, true); assert.equal(lobby.profiles.get(a.profileId).games, 0);
  packet(b, 60); assert.equal(stateHash(room.state), hash);
  f.advance(29000);
  const rejoined = peer(); hello(lobby, rejoined, f.token);
  assert.equal(rejoined.room, room); assert.equal(rejoined.side, 0); assert.equal(rejoined.charId, charId);
  const snapshots = [last(rejoined, 'snapshot'), last(b, 'snapshot')];
  assert.deepEqual(snapshots[0], snapshots[1]); assert.equal(snapshots[0].hash, hash);
  const clients = snapshots.map((snapshot, side) => {
    const c = new RollbackMatch(1, side); c.restore(snapshot.state, snapshot.hash); return c;
  });
  ack(rejoined); assert.equal(room.paused, true); packet(rejoined, 60); assert.equal(room.state.frame, 60);
  ack(b); assert.equal(room.paused, false);
  packet(rejoined, 60, 0, 31); assert.equal(room.next[0], 60); // stale epoch
  let expected = structuredClone(room.state);
  for (let n = 60; n < 120; n++) {
    const inputs = [n % 3 ? 0 : 2, n % 5 ? 0 : 4];
    packet(rejoined, n, room.epoch, inputs[0]); packet(b, n, room.epoch, inputs[1]);
    clients.forEach((c, side) => { c.advance(inputs[side]); c.receive(1 - side, n, inputs[1 - side]); });
    expected = stepMatch(expected, inputs);
  }
  assert.equal(stateHash(room.state), stateHash(expected));
  clients.forEach(c => assert.equal(stateHash(c.confirmedState), stateHash(expected)));
  f.advance(30000); assert.equal(lobby.rooms.size, 1); // old grace is cancelled
  assert.equal(lobby.profiles.get(a.profileId).games, 0);
});
test('grace expiry settles once and a late reconnect returns to the lobby', () => {
  const f = fixture(); f.lobby.disconnect(f.a); f.advance(30000); f.advance(30000);
  assert.equal(f.lobby.rooms.size, 0); assert.equal(f.b.room, null);
  assert.equal(f.lobby.profiles.get(f.a.profileId).rating, 1484);
  assert.equal(f.lobby.profiles.get(f.b.profileId).rating, 1516);
  assert.equal(f.b.messages.filter(m => m.type === 'settlement').length, 1);
  const late = peer(); hello(f.lobby, late, f.token); assert.equal(late.room, undefined);
});
test('both disconnected players recover; an incomplete acknowledgement cannot extend the grace', () => {
  const f = fixture(); f.lobby.disconnect(f.a); f.lobby.disconnect(f.b);
  const a = peer(), b = peer(); hello(f.lobby, a, f.token); assert.ok(last(a, 'snapshot')); assert.equal(f.room.paused, true);
  hello(f.lobby, b, f.tokenB); assert.ok(last(a, 'snapshot')); f.ack(a);
  f.advance(30000); assert.equal(f.lobby.rooms.size, 0);
  assert.equal(f.lobby.profiles.get(b.profileId).rating, 1484);
});
test('resync clears queued predictions, waits for both acknowledgements and ignores stale acknowledgements', () => {
  const f = fixture(); f.packet(f.a, 0, 0, 8);
  f.lobby.handle(f.b, { type: 'resync', matchId: f.room.matchId });
  assert.deepEqual(f.room.next, [0, 0]); assert.equal(f.room.inputs[0].size, 0);
  f.lobby.handle(f.a, { type: 'synced', matchId: f.room.matchId, epoch: 0, hash: stateHash(f.room.state) });
  assert.equal(f.room.acks.size, 0);
  assert.throws(() => f.lobby.handle(f.a, { type: 'synced', matchId: f.room.matchId, epoch: 1, hash: 'bad' }));
  f.ack(f.a); f.ack(f.b); assert.equal(f.room.paused, false);
  f.packet(f.a, 0, 1); f.packet(f.b, 0, 1); assert.equal(f.room.state.frame, 1);
});
test('explicit leave remains an immediate forfeit; both absent timeouts draw without double settlement', () => {
  let f = fixture(); f.lobby.handle(f.a, { type: 'leave' }); assert.equal(f.lobby.rooms.size, 0);
  assert.equal(f.lobby.profiles.get(f.a.profileId).rating, 1484);
  f = fixture(); f.lobby.disconnect(f.a); f.lobby.disconnect(f.b); f.advance(30000);
  assert.equal(f.lobby.profiles.get(f.a.profileId).rating, 1500); assert.equal(f.lobby.profiles.get(f.b.profileId).rating, 1500);
});
test('snapshot validation rejects corrupt data and restores nonzero input sequences', () => {
  const c = new RollbackMatch(1, 0); c.advance(4); c.receive(1, 0, 0);
  assert.throws(() => c.restore(c.confirmedState, 'bad'));
  c.restore(c.confirmedState, stateHash(c.confirmedState));
  assert.deepEqual(c.received, [1, 1]); assert.equal(c.advance(0).frame, 1);
});

test('two absent players both restore; disconnect during recovery keeps the original deadline', () => {
  const f = fixture(); f.lobby.disconnect(f.a); f.lobby.disconnect(f.b);
  const a = peer(), b = peer(); hello(f.lobby, a, f.token); hello(f.lobby, b, f.tokenB);
  f.ack(a); f.ack(b); assert.equal(f.room.paused, false);
  f.packet(a, 0); f.packet(b, 0); assert.equal(f.room.state.frame, 1);
  f.lobby.disconnect(a); const deadline = f.room.deadline; f.advance(20000);
  const next = peer(); hello(f.lobby, next, f.token); f.lobby.disconnect(next);
  assert.equal(f.room.deadline, deadline); f.advance(10000); assert.equal(f.lobby.rooms.size, 0);
});
