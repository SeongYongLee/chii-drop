// 두 실제 로컬 WebSocket 클라이언트. JSON payload만 계측하며 TCP/TLS 헤더는 포함하지 않는다.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import WebSocket from 'ws';
import { createOnlineServer } from '../server/index.js';
import { createMatch } from '../src/engine/match.js';
import { PROTOCOL, RollbackMatch, stateHash } from '../src/net/rollback.js';
import { StateStreamMatch } from '../src/net/state-stream.js';
import { createInputBatcher } from '../src/net/input-batch.js';
import { RULES_VERSION } from '../src/engine/rules.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const frames = 600;
const quantile = (a, p) => a.length ? +[...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(2) : null;
function orderedDelay(client, direction, due, callback) {
  const key = `${direction}Chain`;
  client[key] = (client[key] ?? Promise.resolve()).then(() => sleep(Math.max(0, due - performance.now()))).then(callback);
}
function events(state) {
  return state.players.flatMap((p, side) => p.events.filter(e => ['attack', 'offset', 'garbage'].includes(e.type)).map((e, i) => `${state.frame}:${side}:${e.type}:${i}`));
}
function fixture() {
  const state = createMatch({ seed: 927 });
  const color = state.players[0].piece.pivot;
  for (let y = 12; y < 14; y++) for (let x = 0; x < 4; x++) state.players[0].board.cells[y * 6 + x] = color;
  return state;
}
function input(frame, side, pattern = 'mixed') {
  if (frame < 120) return 4 | (side ? 2 : 1);
  if (pattern === 'rapid') return 4 | (Math.floor(frame / 3) % 2 ? 1 : 2) | (frame % 7 === 0 ? 8 : 0);
  return 4 | (Math.floor((frame - 120) / 70) % 2 ? 1 : 2) | (frame % 47 === 0 ? 8 : 0);
}
export async function compare(mode, network, { batchPolicy = '3', pattern = 'mixed' } = {}) {
  const batchLimit = batchPolicy === 'adaptive6' ? 6 : Number(batchPolicy);
  let measuring = false;
  const authoritativeEvents = new Map(), authoritativeFrames = new Map(), clients = [];
  const server = createOnlineServer({ onFrame(state) {
    if (measuring) authoritativeFrames.set(state.frame, performance.now());
    if (measuring) for (const key of events(state)) authoritativeEvents.set(key, performance.now());
  } });
  server.server.listen(0, '127.0.0.1'); await once(server.server, 'listening');
  const origin = `http://127.0.0.1:${server.server.address().port}`;
  const delayFor = frame => network === 'local' ? 0 : (network === 'rtt220-spike600' ? 110 : 50)
    + 20 * Math.sin(frame * .43) + (frame >= 250 && frame < 260 ? network === 'rtt220-spike600' ? 600 : 200 : 0);
  try {
    for (let side = 0; side < 2; side++) {
      const ws = new WebSocket(origin.replace('http', 'ws') + '/socket', { origin });
      const c = { ws, side, inbox: [], sent: 0, received: 0, upBytes: 0, downBytes: 0, ordinary: 0, critical: 0,
        effects: new Map(), confirmedAt: new Map(), generatedAt: new Map(), changeDelay: [], cpu: [], ownCorrectionCells: [], stalls: 0, upDue: 0, downDue: 0,
        batcher: createInputBatcher({ maxBatch: batchLimit, adaptive: batchPolicy === 'adaptive6' }) };
      c.observe = states => { for (const state of states) {
        c.confirmedAt.set(state.frame, performance.now());
        for (const key of events(state)) c.effects.set(key, performance.now());
      } };
      c.send = msg => {
        const data = JSON.stringify(msg);
        if (measuring) { c.sent++; c.upBytes += Buffer.byteLength(data); }
        if (measuring && msg.type === 'inputBatch') msg.inputs.forEach((value, i) => {
          const f = msg.frame + i;
          if (f === 0 || value !== input(f - 1, side, pattern)) c.changeDelay.push(performance.now() - c.generatedAt.get(f));
        });
        const due = measuring ? Math.max(c.upDue, performance.now() + delayFor(msg.frame ?? 0)) : performance.now();
        c.upDue = due;
        orderedDelay(c, 'up', due, () => { if (ws.readyState === 1) ws.send(data); });
      };
      ws.on('message', data => {
        const msg = JSON.parse(data);
        if (measuring) { c.received++; c.downBytes += data.length; }
        const due = measuring ? Math.max(c.downDue, performance.now() + delayFor(msg.frame ?? 0)) : performance.now();
        c.downDue = due;
        orderedDelay(c, 'down', due, () => {
          c.inbox.push(msg);
          if (!measuring || !c.game) return;
          const before = c.game.state, start = performance.now();
          if (msg.type === 'inputBatch') c.observe(c.game.receiveBatch(msg.side, msg.frame, msg.inputs));
          if (msg.type === 'state15') {
            c[msg.critical ? 'critical' : 'ordinary']++;
            c.observe(c.game.receiveState(msg));
          }
          const after = c.game.state;
          if (before.frame === after.frame && before.players[side].piece && after.players[side].piece) c.ownCorrectionCells.push(Math.max(
            Math.abs(before.players[side].piece.x - after.players[side].piece.x),
            Math.abs(before.players[side].piece.h - after.players[side].piece.h) / 32));
          c.cpu.push(performance.now() - start);
        });
      });
      await once(ws, 'open');
      c.send({ type: 'hello', protocol: PROTOCOL, rulesVersion: RULES_VERSION, transport: mode, inputBatchLimit: batchLimit });
      clients.push(c);
    }
    async function take(c, type) {
      for (let i = 0; i < 2000; i++) {
        const index = c.inbox.findIndex(m => m.type === type);
        if (index >= 0) return c.inbox.splice(index, 1)[0];
        await sleep(5);
      }
      throw new Error(`timeout ${type}`);
    }
    const [a, b] = clients;
    assert.equal((await take(a, 'welcome')).inputBatchLimit, batchLimit);
    assert.equal((await take(b, 'welcome')).inputBatchLimit, batchLimit);
    a.send({ type: 'create', rated: false }); const joined = await take(a, 'joined');
    b.send({ type: 'join', code: joined.code }); await take(b, 'joined');
    for (const c of clients) c.send({ type: 'ready' });
    let choosing;
    do { choosing = (await take(a, 'room')).room; } while (!choosing.selectionId);
    for (const c of clients) c.send({ type: 'confirmCharacter', selectionId: choosing.selectionId });
    const start = await take(a, 'start'); await take(b, 'start');
    const room = server.lobby.rooms.get(joined.code);
    room.state = fixture();
    server.lobby.synchronize(room);
    const snapshot = await take(a, 'snapshot'); await take(b, 'snapshot');
    for (const c of clients) {
      c.game = mode === 'state15' ? new StateStreamMatch(927, c.side) : new RollbackMatch(927, c.side);
      c.game.restore(snapshot.state, snapshot.hash); c.game.setLatency(network === 'local' ? 0 : network === 'rtt220-spike600' ? 260 : 140);
      c.send({ type: 'synced', matchId: start.matchId, epoch: snapshot.epoch, hash: snapshot.hash });
    }
    await take(a, 'resumed'); await take(b, 'resumed');
    measuring = true; const began = performance.now(); let ticks = 0;
    while (clients.some(c => c.game.state.frame < frames)) {
      for (const c of clients) {
        if (c.game.state.frame >= frames) continue;
        c.game.reservePrediction();
        const packet = c.game.advance(input(c.game.state.frame, c.side, pattern));
        if (!packet) {
          c.stalls++; const tail = c.batcher.flush();
          if (tail) c.send({ ...tail, matchId: start.matchId, epoch: snapshot.epoch });
          continue;
        }
        assert.equal(c.game.state.frame, packet.frame + 1, 'own input advances immediately');
        c.generatedAt.set(packet.frame, performance.now());
        c.observe(packet.confirmed);
        c.batcher.setPressure(c.game.state.frame - c.game.confirmedState.frame > 12);
        const batch = c.batcher.push(packet.frame, packet.input);
        if (batch) c.send({ ...batch, matchId: start.matchId, epoch: snapshot.epoch });
      }
      ticks++;
      await sleep(Math.max(0, began + ticks * 1000 / 60 - performance.now()));
      if (performance.now() - began > 20000) throw new Error('simulation stalled ' + JSON.stringify({ server: room.state.frame, paused: room.paused,
        clients: clients.map(c => ({ frame: c.game.state.frame, confirmed: c.game.confirmedState.frame, socket: c.ws.readyState, errors: c.inbox.filter(m => ['error', 'paused'].includes(m.type)) })) }));
    }
    for (const c of clients) { const batch = c.batcher.flush(); if (batch) c.send({ ...batch, matchId: start.matchId, epoch: snapshot.epoch }); }
    for (let i = 0; i < 600 && clients.some(c => c.game.confirmedState.frame !== frames); i++) await sleep(5);
    assert.equal(room.state.frame, frames);
    for (const c of clients) {
      assert.equal(stateHash(c.game.confirmedState), stateHash(room.state));
      assert.deepEqual([...c.effects.keys()].sort(), [...authoritativeEvents.keys()].sort(), 'all attack events retain their exact server frame');
    }
    const attackDelay = clients.flatMap(c => [...c.effects].map(([key, at]) => at - authoritativeEvents.get(key)));
    const generatedForEvent = key => Math.min(...clients.map(c => c.generatedAt.get(Number(key.split(':')[0]) - 1)));
    const totalAttackDelay = clients.flatMap(c => [...c.effects].map(([key, at]) => at - generatedForEvent(key)));
    const serverAttackDelay = [...authoritativeEvents].map(([key, at]) => at - generatedForEvent(key));
    const inputBorn = frame => Math.min(...clients.map(c => c.generatedAt.get(frame - 1)));
    const serverFrameDelay = [...authoritativeFrames].map(([frame, at]) => at - inputBorn(frame));
    const clientFrameDelay = clients.flatMap(c => [...c.confirmedAt].map(([frame, at]) => at - inputBorn(frame)));
    return { mode, batchPolicy, pattern, network, frames, seconds: +(frames / 60).toFixed(2), hash: stateHash(room.state), attackEvents: authoritativeEvents.size,
      upstreamMessages: clients.reduce((n, c) => n + c.sent, 0), downstreamMessages: clients.reduce((n, c) => n + c.received, 0),
      upstreamBytes: clients.reduce((n, c) => n + c.upBytes, 0), downstreamBytes: clients.reduce((n, c) => n + c.downBytes, 0),
      ordinaryStatePackets: clients.reduce((n, c) => n + c.ordinary, 0), immediateStatePackets: clients.reduce((n, c) => n + c.critical, 0),
      stalledFrames: clients.reduce((n, c) => n + c.stalls, 0), ownCorrectionMaxCells: Math.max(0, ...clients.flatMap(c => c.ownCorrectionCells)),
      changedInputSendDelayMaxMs: Math.max(0, ...clients.flatMap(c => c.changeDelay)),
      inputServerConfirmMedianMs: quantile(serverFrameDelay, .5), inputServerConfirmP95Ms: quantile(serverFrameDelay, .95),
      inputClientConfirmP95Ms: quantile(clientFrameDelay, .95),
      attackEndToEndP95Ms: quantile(totalAttackDelay, .95), serverAttackConfirmP95Ms: quantile(serverAttackDelay, .95),
      receiveCpuP95Ms: quantile(clients.flatMap(c => c.cpu), .95), attackDisplayDelayMedianMs: quantile(attackDelay, .5), attackDisplayDelayP95Ms: quantile(attackDelay, .95) };
  } finally {
    measuring = false;
    for (const c of clients) c.ws.terminate();
    server.wss.close(); await new Promise(r => server.server.close(r));
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const results = [];
for (const network of ['local', 'rtt100-jitter20-spike200']) for (const mode of ['inputs', 'state15']) {
  const result = await compare(mode, network); results.push(result); console.log(JSON.stringify(result));
}
assert.ok(results.every(r => r.hash === results[0].hash));
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify({ description: '600-frame fixed-seed scenario, two WebSockets, JSON payload bytes, simulated ordered per-direction delays', results }, null, 2));
}
