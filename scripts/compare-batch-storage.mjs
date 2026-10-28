// Cloudflare 계정·원격 자원을 사용하지 않는다. 실제 local workerd/SQLite의 방 저장 횟수를 읽는다.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import WebSocket from 'ws';
import { createInputBatcher } from '../src/net/input-batch.js';
import { PROTOCOL, RollbackMatch, stateHash } from '../src/net/rollback.js';
import { createMatch, stepMatch } from '../src/engine/match.js';
import { RULES_VERSION } from '../src/engine/rules.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = await mkdtemp(join(tmpdir(), 'chii-batch-storage-'));
const reserved = createServer(); reserved.listen(0, '127.0.0.1'); await once(reserved, 'listening');
const port = reserved.address().port; await new Promise(r => reserved.close(r));
const origin = 'http://127.0.0.1:5180', base = `http://127.0.0.1:${port}`;
const child = spawn('node_modules/.bin/wrangler', ['dev', '--local', '--port', String(port), '--persist-to', dir,
  '--var', `ALLOWED_ORIGINS:${origin}`, '--var', 'INPUT_BATCH_EXPERIMENT:true'],
{ env: { ...process.env, WRANGLER_LOG_PATH: join(dir, 'wrangler.log'), WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', data => { logs = (logs + data).slice(-8000); }); child.stderr.on('data', data => { logs = (logs + data).slice(-8000); });
const sockets = [];
async function take(c, type) {
  for (let i = 0; i < 1000; i++) {
    const at = c.messages.findIndex(m => m.type === type);
    if (at >= 0) return c.messages.splice(at, 1)[0];
    if (c.messages.some(m => ['error', 'incompatible'].includes(m.type))) throw new Error(JSON.stringify(c.messages.filter(m => ['error', 'incompatible'].includes(m.type))));
    await sleep(5);
  }
  throw new Error(`timeout ${type}`);
}
async function client(limit, token, code) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/socket' + (code ? `?room=${code}` : ''), { origin });
  const c = { ws, messages: [], inputMessages: 0, inputBytes: 0, game: null };
  sockets.push(ws);
  c.send = msg => { const data = JSON.stringify(msg); if (msg.type === 'inputBatch') { c.inputMessages++; c.inputBytes += Buffer.byteLength(data); } ws.send(data); };
  ws.on('message', data => {
    const m = JSON.parse(data); c.messages.push(m);
    if (m.type === 'inputBatch' && c.game) c.game.receiveBatch(m.side, m.frame, m.inputs);
  });
  await once(ws, 'open'); c.send({ type: 'hello', protocol: PROTOCOL, rulesVersion: RULES_VERSION, token, inputBatchLimit: limit });
  const identity = await take(c, 'welcome'); c.token = identity.token ?? token; c.limit = identity.inputBatchLimit;
  return c;
}
async function meter(code) {
  for (const path of await readdir(dir, { recursive: true })) if (path.endsWith('.sqlite')) {
    let db;
    try {
      db = new DatabaseSync(join(dir, path), { readOnly: true });
      const row = db.prepare("SELECT value FROM state WHERE key = 'state'").get();
      if (row) { const state = JSON.parse(row.value); if (state.code === code && state.meter) return { ...state.meter, frame: state.rooms[0]?.state?.frame }; }
    } catch { /* 다른 로컬 DB에는 state 테이블이 없을 수 있다. */ }
    finally { db?.close(); }
  }
  throw new Error('room meter not found');
}
try {
  let ready = false;
  for (let i = 0; i < 300; i++) { try { ready = (await fetch(base + '/health')).ok; } catch {} if (ready) break; await sleep(50); }
  if (!ready) throw new Error('workerd startup failed ' + logs);
  const results = [];
  for (const policy of ['3', '4', 'adaptive6']) {
    const limit = policy === 'adaptive6' ? 6 : Number(policy);
    let a = await client(limit), b = await client(limit);
    a.send({ type: 'create', rated: false }); const code = (await take(a, 'route')).code;
    b.send({ type: 'join', code }); await take(b, 'route');
    const previous = [a, b]; a = await client(limit, a.token, code); b = await client(limit, b.token, code);
    previous.forEach(c => c.ws.close());
    for (const c of [a, b]) { await take(c, 'joined'); assert.equal(c.limit, limit); c.send({ type: 'ready' }); }
    for (const c of [a, b]) { let m; do { m = await take(c, 'room'); } while (!m.room.selectionId); c.send({ type: 'confirmCharacter', selectionId: m.room.selectionId }); }
    const start = await take(a, 'start'); await take(b, 'start');
    const before = await meter(code);
    const clients = [a, b]; clients.forEach((c, side) => { c.game = new RollbackMatch(start.seed, side); c.game.setLatency(0); c.batcher = createInputBatcher({ maxBatch: limit, adaptive: policy === 'adaptive6' }); });
    const began = performance.now(); let tick = 0;
    while (clients.some(c => c.game.state.frame < 600)) {
      for (const c of clients) if (c.game.state.frame < 600) {
        c.game.reservePrediction(); const packet = c.game.advance(0);
        c.batcher.setPressure(c.game.state.frame - c.game.confirmedState.frame > 12);
        const batch = packet ? c.batcher.push(packet.frame, packet.input) : c.batcher.flush();
        if (batch) c.send({ ...batch, matchId: start.matchId, epoch: 0 });
      }
      tick++; await sleep(Math.max(0, began + tick * 1000 / 60 - performance.now()));
      if (tick > 1200) throw new Error('input stream stalled');
    }
    for (const c of clients) { const batch = c.batcher.flush(); if (batch) c.send({ ...batch, matchId: start.matchId, epoch: 0 }); }
    for (let i = 0; i < 1000 && clients.some(c => c.game.confirmedState.frame < 600); i++) await sleep(5);
    for (const c of clients) { let sum; do { sum = await take(c, 'checksum'); } while (sum.frame < 600); }
    const after = await meter(code);
    let expected = createMatch({ seed: start.seed }); for (let i = 0; i < 600; i++) expected = stepMatch(expected, [0, 0]);
    clients.forEach(c => assert.equal(stateHash(c.game.confirmedState), stateHash(expected)));
    assert.equal(after.frame, 600); assert.equal(after.inputFrames - before.inputFrames, 1200);
    const result = { policy, frames: 600, inputFrames: after.inputFrames - before.inputFrames,
      inputMessages: after.inputMessages - before.inputMessages, inputBytes: a.inputBytes + b.inputBytes,
      roomSnapshotWrites: after.writes - before.writes,
      note: 'Actual room state upserts from local SQLite meter; excludes Directory writes and alarm metadata. Zero-input storage workload, not the attack timing fixture.' };
    results.push(result); console.log(JSON.stringify(result));
    for (const c of clients) c.send({ type: 'leave' });
    for (const c of clients) { await take(c, 'route'); c.ws.close(); }
  }
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify({ results }, null, 2));
} finally {
  for (const ws of sockets) ws.terminate();
  if (child.exitCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; }
  await rm(dir, { recursive: true, force: true });
}
