import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputBatcher } from '../src/net/input-batch.js';
import { PROTOCOL, RollbackMatch, stateHash } from '../src/net/rollback.js';
import { RULES_VERSION } from '../src/engine/rules.js';
import { createMatch, stepMatch } from '../src/engine/match.js';
import { createRooms } from '../server/rooms.js';

const hello = { type: 'hello', protocol: PROTOCOL, rulesVersion: RULES_VERSION };
const input = (frame, side) => (frame % 41 < 15 ? (side ? 1 : 2) : 0) | (frame % 53 === 0 ? 8 : 0);
function setup(options = {}) {
  const lobby = createRooms(options);
  const peers = [0, 1].map(() => ({ messages: [], send(m) { this.messages.push(structuredClone(m)); } }));
  peers.forEach(p => lobby.handle(p, hello));
  lobby.handle(peers[0], { type: 'create', rated: true });
  lobby.handle(peers[1], { type: 'join', code: peers[0].room.code });
  peers.forEach(p => lobby.handle(p, { type: 'ready' }));
  peers.forEach(p => lobby.handle(p, { type: 'confirmCharacter', selectionId: peers[0].room.selectionId }));
  return { lobby, peers, room: peers[0].room };
}

test('unchanged inputs reduce packets by two thirds; changes and releases are sent on their frame', () => {
  const b = createInputBatcher(), packets = [];
  for (let f = 0; f < 600; f++) { const p = b.push(f, 0); if (p) packets.push(p); }
  packets.push(b.flush());
  assert.equal(packets.length, 201);
  assert.deepEqual(packets.flatMap(p => p.inputs), Array(600).fill(0));
  assert.equal(b.push(600, 2).inputs.at(-1), 2);
  assert.equal(b.push(601, 2), null);
  assert.deepEqual(b.push(602, 0), { type: 'inputBatch', frame: 601, inputs: [2, 0] });
  b.push(603, 0); b.reset();
  assert.deepEqual(b.push(90, 8), { type: 'inputBatch', frame: 90, inputs: [8] });
});

test('invalid batch tails, duplicates and oversized batches cannot partially mutate or relay', () => {
  const { lobby, peers, room } = setup();
  const base = { type: 'inputBatch', matchId: room.matchId, epoch: 0, frame: 0 };
  const initial = stateHash(room.state), count = peers[1].messages.length;
  for (const inputs of [[0, 0, 32], [0, null], [], [0, 0, 0, 0]]) {
    assert.throws(() => lobby.handle(peers[0], { ...base, inputs }));
    assert.equal(room.next[0], 0); assert.equal(stateHash(room.state), initial);
    assert.equal(peers[1].messages.length, count);
  }
  lobby.handle(peers[0], { ...base, inputs: [0, 2, 0] });
  assert.equal(room.next[0], 3);
  assert.throws(() => lobby.handle(peers[0], { ...base, inputs: [0] }));
  lobby.handle(peers[0], { ...base, epoch: 9, frame: 3, inputs: [0] });
  assert.equal(room.next[0], 3);
});

test('batched inputs converge through asymmetric jitter and a stalled client without changing engine results', () => {
  let tick = 0;
  const { lobby, peers, room } = setup({ now: () => 100000 + tick * 1000 / 60 });
  const seed = peers[0].messages.find(m => m.type === 'start').seed;
  const games = [0, 1].map(side => new RollbackMatch(seed, side));
  const batchers = [createInputBatcher(), createInputBatcher()];
  const incoming = [[], []], outgoing = [[], []];
  let packets = 0;
  peers.forEach((p, side) => { p.send = message => {
    if (message.type === 'inputBatch') outgoing[side].push({ message, at: tick + (tick % 4) });
  }; });
  for (; tick < 2400; tick++) {
    games.forEach((g, side) => {
      if (g.state.frame < 900 && !(side === 1 && tick > 100 && tick < 150)) {
        const p = g.advance(input(g.state.frame, side));
        if (p) {
          const batch = batchers[side].push(p.frame, p.input);
          if (batch) { incoming[side].push({ message: batch, at: tick + tick % (side ? 6 : 3) }); packets++; }
        }
      }
      if (g.state.frame === 900) {
        const batch = batchers[side].flush();
        if (batch) { incoming[side].push({ message: batch, at: tick }); packets++; }
      }
    });
    incoming.forEach((q, side) => {
      while (q.length && q[0].at <= tick) lobby.handle(peers[side], { ...q.shift().message, matchId: room.matchId, epoch: 0 });
    });
    outgoing.forEach((q, side) => {
      while (q.length && q[0].at <= tick) {
        const m = q.shift().message;
        m.inputs.forEach((value, i) => games[side].receive(m.side, m.frame + i, value));
      }
    });
  }
  let reference = createMatch({ seed });
  for (let f = 0; f < 900; f++) reference = stepMatch(reference, [input(f, 0), input(f, 1)]);
  assert.equal(room.state.frame, 900);
  assert.equal(stateHash(room.state), stateHash(reference));
  for (const g of games) {
    assert.equal(g.confirmedState.frame, 900);
    assert.equal(stateHash(g.state), stateHash(reference));
    assert.equal(stateHash(g.confirmedState), stateHash(reference));
  }
  assert.ok(packets < 900, `${packets} packets for 1800 input frames`);
});

test('reconnection discards unsent old-epoch batches and resumes with a fresh sequence', () => {
  const { lobby, peers, room } = setup();
  const b = createInputBatcher(), token = peers[0].messages.find(m => m.type === 'welcome').token;
  const send = (peer, frame) => lobby.handle(peer, { type: 'inputBatch', matchId: room.matchId, epoch: room.epoch, frame, inputs: [0] });
  send(peers[0], 0); send(peers[1], 0);
  b.push(0, 0); b.push(1, 0);
  lobby.disconnect(peers[0]);
  const next = { messages: [], send(m) { this.messages.push(structuredClone(m)); } };
  lobby.handle(next, { ...hello, token });
  for (const p of [next, peers[1]]) lobby.handle(p, { type: 'synced', matchId: room.matchId, epoch: room.epoch, hash: stateHash(room.state) });
  lobby.handle(next, { type: 'inputBatch', matchId: room.matchId, epoch: 0, frame: 1, inputs: [8] });
  assert.equal(room.next[0], 1);
  b.reset();
  lobby.handle(next, { ...b.push(1, 2), matchId: room.matchId, epoch: room.epoch });
  send(peers[1], 1);
  assert.equal(room.state.frame, 2);
});

test('220ms relay delay with jitter keeps 60fps prediction moving and converges after batching', () => {
  function simulate(adaptive) {
    const games = [0, 1].map(side => new RollbackMatch(871, side));
    if (adaptive) games.forEach(game => game.setLatency(220));
    const batchers = games.map(() => createInputBatcher()), queues = [[], []];
    let waiting = 0;
    for (let tick = 0; tick < 2400; tick++) {
      games.forEach((game, side) => {
        const queue = queues[side];
        while (queue.length && queue[0].at <= tick) {
          const packet = queue.shift(); game.receiveBatch(1 - side, packet.frame, packet.inputs);
        }
        if (game.state.frame >= 600) return;
        const packet = game.advance(input(game.state.frame, side));
        let batch = packet ? batchers[side].push(packet.frame, packet.input) : null;
        if (!game.canAdvance || game.state.frame === 600) batch ??= batchers[side].flush();
        if (batch) queues[1 - side].push({ ...batch, at: tick + 13 + tick % 4 });
        if (!packet && tick > 60) waiting++;
      });
    }
    let expected = createMatch({ seed: 871 });
    for (let frame = 0; frame < 600; frame++) expected = stepMatch(expected, [input(frame, 0), input(frame, 1)]);
    games.forEach(game => {
      assert.equal(game.confirmedState.frame, 600);
      assert.equal(stateHash(game.state), stateHash(expected));
    });
    return waiting;
  }
  const fixed = simulate(false), adaptive = simulate(true);
  assert.ok(fixed > 100, `baseline waiting ticks: ${fixed}`);
  assert.ok(adaptive < fixed * .1, `waiting ticks ${fixed} -> ${adaptive}`);
});

test('latency allowance stays bounded and malformed batches cannot partly mutate rollback state', () => {
  const game = new RollbackMatch(9, 0);
  game.setLatency(10000); assert.equal(game.predictionLimit, 45);
  game.setLatency(0); assert.equal(game.predictionLimit, 45);
  for (let i = 0; i < 45; i++) assert.ok(game.advance(0));
  assert.equal(game.advance(0), null);
  const hash = stateHash(game.state);
  assert.throws(() => game.receiveBatch(1, 0, [0, 32]));
  assert.equal(game.received[1], 0); assert.equal(stateHash(game.state), hash);
  game.receiveBatch(1, 0, [0, 0, 0]);
  assert.equal(game.confirmedState.frame, 3);
  assert.ok(game.canAdvance);
});

test('matching predictions need no replay and a changed batch replays only its remaining prediction once', () => {
  const game = new RollbackMatch(44, 0);
  for (let frame = 0; frame < 8; frame++) game.advance(0);
  let replayed = 0;
  const predict = game.predict.bind(game);
  game.predict = () => { replayed++; predict(); };
  game.receiveBatch(1, 0, [0, 0, 0]);
  assert.equal(replayed, 0);
  game.receiveBatch(1, 3, [2, 2, 2]);
  assert.equal(replayed, 2);
  let expected = createMatch({ seed: 44 });
  for (let frame = 0; frame < 8; frame++) expected = stepMatch(expected, [0, frame < 3 ? 0 : 2]);
  assert.equal(stateHash(game.state), stateHash(expected));
});

test('a single 600ms delivery stall expands bounded headroom before stopping and preserves the match', t => {
  function simulate(reserve) {
    const games = [0, 1].map(side => new RollbackMatch(333, side));
    games.forEach(game => game.setLatency(80));
    const batchers = games.map(() => createInputBatcher()), queues = [[], []], streaks = [0, 0];
    let maxWait = 0, waiting = 0;
    for (let tick = 0; tick < 2400; tick++) games.forEach((game, side) => {
      const queue = queues[side];
      while (queue.length && queue[0].at <= tick) {
        const packet = queue.shift(); game.receiveBatch(1 - side, packet.frame, packet.inputs, { deferReplay: true });
      }
      game.reconcile();
      if (game.state.frame >= 600) return;
      if (reserve) game.reservePrediction();
      const packet = game.advance(input(game.state.frame, side));
      streaks[side] = packet ? 0 : streaks[side] + 1;
      if (!packet) waiting++;
      maxWait = Math.max(maxWait, streaks[side]);
      let batch = packet ? batchers[side].push(packet.frame, packet.input) : null;
      if (!game.canAdvance || game.state.frame === 600) batch ??= batchers[side].flush();
      if (batch) queues[1 - side].push({ ...batch, at: tick >= 240 && tick < 276 ? 282 : tick + 6 });
    });
    let expected = createMatch({ seed: 333 });
    for (let frame = 0; frame < 600; frame++) expected = stepMatch(expected, [input(frame, 0), input(frame, 1)]);
    games.forEach(game => {
      assert.equal(game.confirmedState.frame, 600);
      assert.equal(stateHash(game.state), stateHash(expected));
      assert.ok(game.predictionLimit <= 45);
    });
    return { maxWait, waiting };
  }
  const previous = simulate(false), improved = simulate(true);
  t.diagnostic(JSON.stringify({ previous, improved }));
  assert.ok(previous.maxWait >= 15, 'previous window reproduces a visible waiting banner');
  assert.equal(improved.waiting, 0, 'the short outage is absorbed without stalling simulation');
});

test('a backlog of multiple packets reconciles once before the next display without losing confirmed frames', () => {
  const game = new RollbackMatch(44, 0); game.setLatency(0);
  for (let frame = 0; frame < 16; frame++) game.advance(0);
  let replayed = 0;
  const predict = game.predict.bind(game);
  game.predict = () => { replayed++; predict(); };
  const remote = [1, 1, 0, 2, 0, 2, 0, 1, 0];
  const confirmed = [];
  for (let frame = 0; frame < 9; frame += 3) confirmed.push(...game.receiveBatch(1, frame, remote.slice(frame, frame + 3), { deferReplay: true }));
  assert.equal(replayed, 0);
  assert.deepEqual(confirmed.map(state => state.frame), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  game.reconcile();
  assert.equal(replayed, 7);
  game.reconcile(); assert.equal(replayed, 7);
  let expected = createMatch({ seed: 44 });
  for (let frame = 0; frame < 16; frame++) expected = stepMatch(expected, [0, remote[frame] ?? 0]);
  assert.equal(stateHash(game.state), stateHash(expected));
});
