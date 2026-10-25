import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { RollbackMatch, PROTOCOL, stateHash } from '../src/net/rollback.js';
import { createMatch, stepMatch } from '../src/engine/match.js';
import { RULES_VERSION } from '../src/engine/rules.js';
import { createRooms } from '../server/rooms.js';
import { createOnlineServer } from '../server/index.js';

const input = (frame, side) => (frame % (19 + side) < 8 ? 4 : 0) | (frame % 7 === 0 ? 8 : 0) | (frame % 31 < 10 ? (side ? 1 : 2) : 0);
test('asymmetric jitter, stalls and rollback converge to the reference simulation', () => {
  const peers = [new RollbackMatch(789, 0), new RollbackMatch(789, 1)];
  let reference = createMatch({ seed: 789 });
  const queues = [[], []];
  for (let tick = 0; tick < 2400; tick++) {
    peers.forEach((peer, side) => {
      if (peer.state.frame >= 900) return;
      // 한쪽 탭이 잠시 멈춰도 입력 번호는 건너뛰지 않는다.
      if (side === 1 && tick > 100 && tick < 160) return;
      const packet = peer.advance(input(peer.state.frame, side));
      if (packet) queues[1 - side].push({ ...packet, at: tick + (tick % (side ? 13 : 5)) });
    });
    queues.forEach((queue, recipient) => {
      while (queue.length && queue[0].at <= tick) {
        const p = queue.shift(); peers[recipient].receive(1 - recipient, p.frame, p.input);
      }
    });
  }
  for (let frame = 0; frame < 900; frame++) reference = stepMatch(reference, [input(frame, 0), input(frame, 1)]);
  for (const peer of peers) {
    assert.equal(peer.confirmedState.frame, 900);
    assert.equal(stateHash(peer.state), stateHash(reference));
    assert.equal(stateHash(peer.confirmedState), stateHash(reference));
    assert.ok(peer.rollbacks > 0);
    assert.ok(peer.inputs.every((map) => map.size <= 10));
  }
});
test('prediction stops at the bound and malformed or duplicate inputs are rejected', () => {
  const peer = new RollbackMatch(1, 0);
  for (let f = 0; f < 8; f++) assert.ok(peer.advance(0));
  assert.equal(peer.advance(0), null);
  assert.throws(() => peer.receive(1, 1, 0));
  assert.throws(() => peer.receive(1, 0, 32));
  peer.receive(1, 0, 0);
  assert.throws(() => peer.receive(1, 0, 0));
  assert.ok(peer.advance(0));
});
function fakePeer() { return { messages: [], send(message) { this.messages.push(message); } }; }
const version = { protocol: PROTOCOL, rulesVersion: RULES_VERSION };
function identify(lobby, ...peers) { peers.forEach((p) => lobby.handle(p, { type: 'hello', ...version })); }
test('rooms lock two seats, require readiness, isolate rooms and clean up disconnects', () => {
  const lobby = createRooms();
  const [a, b, c] = [fakePeer(), fakePeer(), fakePeer()];
  identify(lobby, a, b, c);
  lobby.handle(a, { type: 'create', ...version });
  const code = a.room.code;
  lobby.handle(b, { type: 'join', code, ...version });
  lobby.handle(c, { type: 'join', code, ...version });
  assert.equal(c.messages.at(-1).type, 'error');
  lobby.handle(a, { type: 'ready' });
  assert.equal(a.room.state, null);
  lobby.handle(b, { type: 'ready' });
  assert.equal(a.messages.findLast((m) => m.type === 'start').seed, b.messages.findLast((m) => m.type === 'start').seed);
  assert.throws(() => lobby.handle(a, { type: 'input', matchId: a.room.matchId, frame: 1, input: 0 }));
  lobby.handle(a, { type: 'input', matchId: a.room.matchId, frame: 0, input: 8, side: 1 });
  assert.equal(b.messages.at(-1).side, 0);
  lobby.handle(b, { type: 'input', matchId: b.room.matchId, frame: 0, input: 4 });
  assert.equal(a.room.state.frame, 1);
  lobby.leave(a);
  assert.equal(lobby.rooms.size, 0);
  assert.equal(b.room, null);
  assert.ok(b.messages.some((m) => m.type === 'ended'));
});
test('real WebSocket server relays inputs and publishes authoritative checksums', async (t) => {
  const { server, wss } = createOnlineServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  t.after(async () => { clients.forEach((ws) => ws.terminate()); wss.close(); await new Promise((r) => server.close(r)); });
  assert.equal((await fetch(base + '/.git/config')).status, 404);
  assert.equal((await fetch(base + '/server/index.js')).status, 404);
  assert.equal((await fetch(base + '/')).status, 200);
  assert.deepEqual(await (await fetch(base + '/online-config.json')).json(), {enabled:true});
  assert.equal((await fetch(base + '/src/view/controls-guide.css')).status, 200);
  async function client() {
    const ws = new WebSocket(base.replace('http', 'ws') + '/socket', { origin: base }); clients.push(ws);
    const inbox = []; ws.on('message', (data) => inbox.push(JSON.parse(data)));
    await once(ws, 'open');
    return { ws, inbox, send: (m) => ws.send(JSON.stringify(m)) };
  }
  async function waitFor(c, type) {
    for (let n = 0; n < 100; n++) {
      const index = c.inbox.findIndex((m) => m.type === type);
      if (index >= 0) return c.inbox.splice(index, 1)[0];
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`timeout: ${type}`);
  }
  const a = await client(), b = await client();
  a.send({ type: 'hello', ...version }); b.send({ type: 'hello', ...version });
  const identity = await waitFor(a, 'welcome'); await waitFor(b, 'welcome');
  a.send({ type: 'create', ...version }); const { code } = await waitFor(a, 'joined');
  b.send({ type: 'join', code, ...version });
  await waitFor(b, 'joined');
  a.send({ type: 'ready' }); b.send({ type: 'ready' });
  const start = await waitFor(a, 'start'); await waitFor(b, 'start');
  let expected = createMatch({ seed: start.seed });
  for (let f = 0; f < 60; f++) {
    a.send({ type: 'input', matchId: start.matchId, frame: f, input: input(f, 0) });
    b.send({ type: 'input', matchId: start.matchId, frame: f, input: input(f, 1) });
    expected = stepMatch(expected, [input(f, 0), input(f, 1)]);
  }
  const hashA = await waitFor(a, 'checksum'), hashB = await waitFor(b, 'checksum');
  assert.equal(hashA.hash, stateHash(expected)); assert.deepEqual(hashA, hashB);
  a.ws.terminate();
  await waitFor(b, 'paused');
  const rejoined = await client(); rejoined.send({ type: 'hello', ...version, token: identity.token });
  await waitFor(rejoined, 'welcome'); await waitFor(rejoined, 'joined');
  const snapA = await waitFor(rejoined, 'snapshot'), snapB = await waitFor(b, 'snapshot');
  assert.deepEqual(snapA, snapB); assert.equal(snapA.hash, stateHash(expected));
  for (const c of [rejoined, b]) c.send({ type: 'synced', matchId: start.matchId, epoch: snapA.epoch, hash: snapA.hash });
  await waitFor(rejoined, 'resumed'); await waitFor(b, 'resumed');
  for (let f = 60; f < 120; f += 3) {
    for (const [side, c] of [rejoined, b].entries()) c.send({ type: 'inputBatch', matchId: start.matchId, epoch: snapA.epoch,
      frame: f, inputs: Array.from({ length: 3 }, (_, i) => input(f + i, side)) });
    for (let i = 0; i < 3; i++) expected = stepMatch(expected, [input(f + i, 0), input(f + i, 1)]);
  }
  const relay = await waitFor(b, 'inputBatch');
  assert.equal(relay.side, 0); assert.equal(relay.frame, 60);
  assert.deepEqual(relay.inputs, [60, 61, 62].map(f => input(f, 0)));
  assert.equal((await waitFor(rejoined, 'checksum')).hash, stateHash(expected));
  assert.equal((await waitFor(b, 'checksum')).hash, stateHash(expected));
  rejoined.send({ type: 'leave' }); assert.equal((await waitFor(b, 'ended')).type, 'ended');
});
test('authoritative result is emitted once and the completed match stops after the animation', () => {
  const lobby = createRooms(), a = fakePeer(), b = fakePeer();
  identify(lobby, a, b);
  lobby.handle(a, { type: 'create', ...version });
  lobby.handle(b, { type: 'join', code: a.room.code, ...version });
  lobby.handle(a, { type: 'ready' }); lobby.handle(b, { type: 'ready' });
  const room = a.room;
  room.started -= 600000; // 가상 시간이 흐른 대전을 빠르게 검증한다.
  for (let f = 0; f < 5000 && !room.finished; f++) {
    lobby.handle(a, { type: 'input', matchId: room.matchId, frame: f, input: 4 });
    lobby.handle(b, { type: 'input', matchId: room.matchId, frame: f, input: 4 });
  }
  assert.equal(room.finished, true);
  assert.equal(a.messages.filter((m) => m.type === 'result').length, 1);
  assert.equal(a.messages.at(-1).type, 'finished');
  assert.equal(room.state.frame, room.resultFrame + 180);
  const frame = room.state.frame;
  lobby.handle(a, { type: 'input', matchId: room.matchId, frame, input: 0 });
  assert.equal(room.state.frame, frame);
});

test('단일 포트 LAN 화면의 동일 출처만 기본 허용하고 다른 호스트·포트는 거부한다', async (t) => {
  const { server, wss } = createOnlineServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `ws://127.0.0.1:${server.address().port}/socket`;
  t.after(() => { for (const client of wss.clients) client.terminate(); wss.close(); server.close(); });
  const allowed = new WebSocket(url, { origin: 'http://192.168.0.38:5180', headers: { Host: '192.168.0.38:5180' } });
  await once(allowed, 'open'); allowed.close();
  const denied = new WebSocket(url, { origin: 'http://192.168.0.99:5180', headers: { Host: '192.168.0.38:5180' } });
  const [, response] = await once(denied, 'unexpected-response');
  assert.equal(response.statusCode, 403); response.resume(); denied.terminate(); denied.on('error', () => {});
  const wrongPort = new WebSocket(url, { origin: 'http://192.168.0.38:5181', headers: { Host: '192.168.0.38:5180' } });
  const [, wrongPortResponse] = await once(wrongPort, 'unexpected-response');
  assert.equal(wrongPortResponse.statusCode, 403); wrongPortResponse.resume(); wrongPort.on('error', () => {}); wrongPort.terminate();
  const base = `http://127.0.0.1:${server.address().port}`;
  // 로컬 사운드 검토 페이지는 업로드 대상이 아니므로 공개 경로 검사에 넣지 않는다.
  for (const path of ['/', '/online.html', '/online.css', '/src/net/browser.js', '/health']) assert.equal((await fetch(base + path)).status, 200, path);
  assert.equal((await fetch(base + '/data/online.json')).status, 404);
  assert.equal((await fetch(base + '/.git/config')).status, 404);
});
