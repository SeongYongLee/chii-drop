import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, stepMatch } from '../src/engine/match.js';
import { StateStreamMatch, STATE_INTERVAL, importantState, statePacket } from '../src/net/state-stream.js';
import { stateHash, PROTOCOL } from '../src/net/rollback.js';
import { createRooms } from '../server/rooms.js';
import { RULES_VERSION } from '../src/engine/rules.js';

test('15Hz delta stream reconstructs every sent authoritative state, including immediate lock and attack events', () => {
  let state = createMatch({ seed: 123 }), base = state;
  const client = new StateStreamMatch(123, 0);
  let sent = 0, locks = 0;
  for (let f = 0; f < 1200; f++) {
    if (client.canAdvance) client.advance(4 | (f % 180 < 90 ? 1 : 2));
    const before = state;
    state = stepMatch(state, [4 | (f % 180 < 90 ? 1 : 2), 4 | (f % 200 < 100 ? 2 : 1)]);
    const critical = importantState(before, state);
    if (critical || state.frame % STATE_INTERVAL === 0) {
      const packet = JSON.parse(JSON.stringify(statePacket(base, state, critical)));
      client.receiveState(packet); base = state; sent++;
      assert.equal(stateHash(client.confirmedState), stateHash(state));
      if (state.players.some(p => p.events.some(e => e.type === 'lock'))) { locks++; assert.equal(packet.critical, true); }
    }
  }
  assert.ok(locks > 0); assert.ok(sent >= 300);
});
test('own input responds immediately; presentation interpolation cannot alter authority; invalid delta needs resync', () => {
  const a = new StateStreamMatch(7, 0);
  for (let i = 0; i < 40; i++) a.advance(1);
  assert.equal(a.state.frame, 40); assert.equal(a.confirmedState.frame, 0);
  let state = createMatch({ seed: 7 });
  for (let i = 0; i < 40; i++) state = stepMatch(state, [1, 2]);
  a.receiveState(statePacket(a.confirmedState, state, false));
  const hash = stateHash(a.confirmedState);
  a.advance(2); assert.equal(stateHash(a.confirmedState), hash);
  assert.throws(() => a.receiveState({ base: 0, frame: 41 }), /snapshot/);
  const next = stepMatch(state, [2, 1]), bad = statePacket(state, next, false); bad.hash = 'bad';
  assert.throws(() => a.receiveState(bad), /hash/);
});
test('prototype is opt-in on the local server and input relaying is suppressed only for opted-in recipients', () => {
  for (const allowed of [false, true]) {
    let time = 10000;
    const lobby = createRooms({ allowStatePrototype: allowed, now: () => time });
    const peer = (mode, token) => { const p = { messages: [], send(m) { this.messages.push(structuredClone(m)); } }; lobby.handle(p, { type: 'hello', protocol: PROTOCOL, rulesVersion: RULES_VERSION, transport: mode, token }); return p; };
    const a = peer('state15'), b = peer('inputs');
    assert.equal(a.transport, allowed ? 'state15' : 'inputs');
    lobby.handle(a, { type: 'create' }); lobby.handle(b, { type: 'join', code: a.room.code });
    for (const p of [a, b]) lobby.handle(p, { type: 'ready' });
    for (const p of [a, b]) lobby.handle(p, { type: 'confirmCharacter', selectionId: a.room.selectionId });
    const room = a.room;
    for (let f = 0; f < 8; f++) { time += 17; for (const p of [a, b]) lobby.handle(p, { type: 'input', matchId: room.matchId, epoch: 0, frame: f, input: 0 }); }
    assert.equal(a.messages.filter(m => m.type === 'state15').length, allowed ? 2 : 0);
    assert.equal(a.messages.filter(m => m.type === 'input').length, allowed ? 0 : 8);
    assert.equal(b.messages.filter(m => m.type === 'input').length, 8);
    if (allowed) {
      lobby.disconnect(a); assert.equal(room.paused, true);
      const returning = peer('state15', a.messages.find(m => m.type === 'welcome').token);
      const snapshot = returning.messages.findLast(m => m.type === 'snapshot');
      const client = new StateStreamMatch(1, 0); client.restore(snapshot.state, snapshot.hash);
      for (const p of [returning, b]) lobby.handle(p, { type: 'synced', matchId: room.matchId, epoch: room.epoch, hash: snapshot.hash });
      assert.equal(room.paused, false);
      for (let f = 8; f < 12; f++) { time += 17; for (const p of [returning, b]) lobby.handle(p, { type: 'input', matchId: room.matchId, epoch: room.epoch, frame: f, input: 0 }); }
      const packet = returning.messages.findLast(m => m.type === 'state15');
      assert.equal(packet.base, 8); client.receiveState(packet);
      assert.equal(stateHash(client.confirmedState), stateHash(room.state));
    }
  }
});
test('remote interpolation leaves integer collision and landing coordinates intact', () => {
  const client = new StateStreamMatch(3, 0);
  const before = createMatch({ seed: 3 }); before.frame = 40;
  before.players[1].phase = 'control'; before.players[1].piece.x = 1;
  client.restore(before, stateHash(before));
  const after = structuredClone(before); after.frame = 44; after.players[1].piece.x = 4;
  client.receiveState(statePacket(before, after, false));
  client.advance(0); client.advance(0);
  assert.equal(client.state.players[1].piece.x, 4);
  assert.equal(client.state.players[1].displayPiece.x, 2.5);
  assert.equal(stateHash(client.confirmedState), stateHash(after));
});
