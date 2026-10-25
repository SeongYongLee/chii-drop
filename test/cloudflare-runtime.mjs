// 실제 workerd + SQLite + WebSocket 통합 검증. Cloudflare 계정/원격 자원을 쓰지 않는다.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import WebSocket from 'ws';
import { PROTOCOL, stateHash } from '../src/net/rollback.js';
import { RULES_VERSION } from '../src/engine/rules.js';
import { createMatch, stepMatch } from '../src/engine/match.js';
import { createInputBatcher } from '../src/net/input-batch.js';
import { createOnlineServer } from '../server/index.js';

const delay = ms => new Promise(r => setTimeout(r, ms));
const reserved = createServer(); reserved.listen(0, '127.0.0.1'); await once(reserved, 'listening');
const port = reserved.address().port; await new Promise(r => reserved.close(r));
const base = `http://127.0.0.1:${port}`, origin = 'http://127.0.0.1:5180';
const stateDir = await mkdtemp(join(tmpdir(), 'chii-cf-test-'));
let child, logs = '', checks = 0;
const sockets = [];
const proxy = createOnlineServer({ cloudflareURL: base });
proxy.server.listen(0, '127.0.0.1'); await once(proxy.server, 'listening');
const browserBase = `http://127.0.0.1:${proxy.server.address().port}`;
async function start() {
  child = spawn('node_modules/.bin/wrangler', ['dev', '--local', '--port', String(port), '--persist-to', stateDir,
    '--var', `ALLOWED_ORIGINS:${origin}`, '--var', 'RECONNECT_GRACE_MS:10000'],
  { env: { ...process.env, WRANGLER_LOG_PATH: join(stateDir, 'wrangler.log'), WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', b => { logs = (logs + b).slice(-12000); });
  child.stderr.on('data', b => { logs = (logs + b).slice(-12000); });
  for (let n = 0; n < 240; n++) {
    try { if ((await fetch(base + '/health')).ok) return; } catch {}
    if (child.exitCode !== null) throw new Error('workerd exited');
    await delay(50);
  }
  throw new Error('workerd startup timeout');
}
async function stop() {
  sockets.forEach(c => c.ws.terminate());
  if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; }
}
async function client(token, code, protocol = PROTOCOL) {
  const ws = new WebSocket(browserBase.replace('http', 'ws') + '/socket' + (code ? `?room=${code}` : ''), { origin: browserBase });
  const c = { ws, messages: [], send: msg => ws.send(JSON.stringify(msg)), token };
  sockets.push(c);
  ws.on('message', bytes => c.messages.push(JSON.parse(bytes))); ws.on('error', () => {});
  await once(ws, 'open'); c.send({ type: 'hello', token, protocol, rulesVersion: RULES_VERSION });
  return c;
}
async function take(c, type, timeout = 5000) {
  for (let n = 0; n < timeout / 25; n++) {
    const i = c.messages.findIndex(m => m.type === type);
    if (i >= 0) return c.messages.splice(i, 1)[0];
    await delay(25);
  }
  throw new Error(`timeout ${type}; inbox ${c.messages.map(m => m.type + (m.reason ? ':' + m.reason : '')).join(',')}`);
}
async function identity(c) { const m = await take(c, 'welcome'); c.token ??= m.token; return m.profile; }
function inputs(c, matchId, epoch, from, until) {
  for (let f = from; f < until; f += 3) c.send({ type: 'inputBatch', matchId, epoch, frame: f, inputs: [0, 0, 0] });
}
async function goRoom(c, code) { const next = await client(c.token, code); c.ws.close(); await identity(next); await take(next, 'joined'); return next; }
try {
  await start();
  assert.equal((await fetch(base + '/health').then(r => r.json())).protocol, PROTOCOL);
  assert.equal((await fetch(base + '/socket', { headers: { origin: 'https://untrusted.example' } })).status, 403); checks++;
  const old = await client(undefined, undefined, PROTOCOL - 1); await take(old, 'incompatible'); old.ws.close(); checks++;
  let a = await client(), b = await client();
  await identity(a); await identity(b);
  a.send({ type: 'create', rated: true, password: 'test', name: '로컬 검증' });
  const { code } = await take(a, 'route');
  b.send({ type: 'join', code, password: 'wrong' }); await take(b, 'error');
  b.send({ type: 'join', code, password: 'test' }); assert.equal((await take(b, 'route')).code, code); checks++;
  a = await goRoom(a, code); b = await goRoom(b, code);
  a.send({ type: 'heartbeat' }); await take(a, 'heartbeatAck'); checks++;
  a.send({ type: 'ready' }); b.send({ type: 'ready' });
  const startMsg = await take(a, 'start'); await take(b, 'start');
  inputs(a, startMsg.matchId, 0, 0, 60); inputs(b, startMsg.matchId, 0, 0, 60);
  let expected = createMatch({ seed: startMsg.seed });
  for (let f = 0; f < 60; f++) expected = stepMatch(expected, [0, 0]);
  assert.equal((await take(a, 'checksum')).hash, stateHash(expected));
  assert.equal((await take(b, 'checksum')).hash, stateHash(expected)); checks++;
  const tokenA = a.token, tokenB = b.token;
  a.ws.terminate(); await take(b, 'paused');
  a = await client(tokenA, code); await identity(a); await take(a, 'joined');
  const snap = await take(a, 'snapshot'); assert.equal(snap.hash, stateHash(expected));
  assert.deepEqual(await take(b, 'snapshot'), snap);
  for (const c of [a, b]) c.send({ type: 'synced', matchId: startMsg.matchId, epoch: snap.epoch, hash: snap.hash });
  await take(a, 'resumed'); await take(b, 'resumed'); checks++;
  inputs(a, startMsg.matchId, snap.epoch, 60, 120); inputs(b, startMsg.matchId, snap.epoch, 60, 120);
  for (let f = 60; f < 120; f++) expected = stepMatch(expected, [0, 0]);
  assert.equal((await take(a, 'checksum')).hash, stateHash(expected));
  assert.equal((await take(b, 'checksum')).hash, stateHash(expected)); checks++;
  // 연결을 끊은 뒤 런타임을 재시작해 같은 SQLite에서 경기 상태·기한을 복원한다.
  a.ws.terminate(); await take(b, 'paused'); b.ws.terminate(); await delay(100);
  await stop(); await start();
  a = await client(tokenA); await identity(a); assert.equal((await take(a, 'route')).code, code);
  a = await goRoom(a, code);
  b = await client(tokenB, code); await identity(b); await take(b, 'joined');
  const restored = await take(b, 'snapshot'); assert.equal(restored.hash, stateHash(expected));
  // 첫 복귀자의 snapshot은 두 번째 복귀 때 epoch가 갱신된다.
  await take(a, 'snapshot'); const finalSnap = await take(a, 'snapshot'); assert.equal(finalSnap.epoch, restored.epoch);
  for (const c of [a, b]) c.send({ type: 'synced', matchId: startMsg.matchId, epoch: restored.epoch, hash: restored.hash });
  await take(a, 'resumed'); await take(b, 'resumed'); checks++;
  a.send({ type: 'leave' }); await take(b, 'ended'); await take(b, 'route');
  a.ws.close(); b.ws.close();
  let winner = await client(tokenB); assert.equal((await identity(winner)).rating, 1516);
  await stop(); await start();
  winner = await client(tokenB); assert.equal((await identity(winner)).rating, 1516);
  const loser = await client(tokenA); assert.equal((await identity(loser)).rating, 1484); checks++;
  winner.ws.close(); loser.ws.close();
  // 자동 매칭도 서로 다른 로비 소켓에서 방별 소켓으로 전환한다.
  const x = await client(), y = await client(); await identity(x); await identity(y);
  x.send({ type: 'queue', rated: false }); y.send({ type: 'queue', rated: false });
  const rx = await take(x, 'route'), ry = await take(y, 'route'); assert.equal(rx.code, ry.code); checks++;
  const xr = await goRoom(x, rx.code), yr = await goRoom(y, ry.code);
  xr.send({ type: 'leave' }); await take(yr, 'route'); xr.ws.close(); yr.ws.close();
  // 10클라이언트/5개 방을 실제 프레임 속도로 동시에 진행한다.
  const games = [];
  for (let i = 0; i < 5; i++) {
    let p = await client(), q = await client(); await identity(p); await identity(q);
    p.send({ type: 'create', rated: false }); const route = await take(p, 'route');
    q.send({ type: 'join', code: route.code }); await take(q, 'route');
    p = await goRoom(p, route.code); q = await goRoom(q, route.code);
    p.send({ type: 'ready' }); q.send({ type: 'ready' });
    const start = await take(p, 'start'); await take(q, 'start');
    games.push({ peers: [p, q], start, batchers: [createInputBatcher(), createInputBatcher()] });
  }
  for (let frame = 0; frame < 61; frame++) {
    for (const g of games) g.peers.forEach((p, side) => {
      const batch = g.batchers[side].push(frame, 0);
      if (batch) p.send({ ...batch, matchId: g.start.matchId, epoch: 0 });
    });
    await delay(1000 / 60);
  }
  for (const g of games) {
    let expected = createMatch({ seed: g.start.seed });
    for (let f = 0; f < 60; f++) expected = stepMatch(expected, [0, 0]);
    for (const p of g.peers) assert.equal((await take(p, 'checksum')).hash, stateHash(expected));
    g.peers[0].send({ type: 'leave' }); await take(g.peers[1], 'route');
    g.peers.forEach(p => p.ws.close());
  }
  checks++;
  let timeoutA = await client(), timeoutB = await client(); await identity(timeoutA); await identity(timeoutB);
  timeoutA.send({ type: 'create', rated: true }); const timeoutRoom = (await take(timeoutA, 'route')).code;
  timeoutB.send({ type: 'join', code: timeoutRoom }); await take(timeoutB, 'route');
  timeoutA = await goRoom(timeoutA, timeoutRoom); timeoutB = await goRoom(timeoutB, timeoutRoom);
  timeoutA.send({ type: 'ready' }); timeoutB.send({ type: 'ready' }); await take(timeoutA, 'start'); await take(timeoutB, 'start');
  const timeoutToken = timeoutB.token;
  timeoutA.ws.terminate(); await take(timeoutB, 'paused');
  await take(timeoutB, 'ended', 15000); await take(timeoutB, 'route'); timeoutB.ws.close();
  const timeoutWinner = await client(timeoutToken); assert.equal((await identity(timeoutWinner)).rating, 1516); checks++;
  console.log(`Cloudflare 로컬 통합 검증 ${checks}개 통과: Origin·버전·비밀번호·자동 heartbeat·대전·재접속·호스트 재시작·레이트 저장·자동 매칭`);
} catch (error) { console.error(logs); throw error; }
finally {
  await stop();
  proxy.wss.close(); await new Promise(resolve => proxy.server.close(resolve));
  if (process.env.CF_TEST_KEEP_STATE === '1') console.log(`검증 SQLite 보관: ${stateDir}`);
  else await rm(stateDir, { recursive: true, force: true });
}
