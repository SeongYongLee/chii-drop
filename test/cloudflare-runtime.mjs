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
import { SpectatorMatch } from '../src/net/spectator.js';
import manifest from '../skins/chiikawa/pages-runtime/manifest.json' with { type: 'json' };

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
async function confirmSelection(...clients) {
  for (const c of clients) {
    let m; do { m = await take(c, 'room'); } while (m.room.phase !== 'selecting');
    c.send({ type: 'confirmCharacter', selectionId: m.room.selectionId });
  }
}
async function goRoom(c, code) { const next = await client(c.token, code); c.ws.close(); await identity(next); await take(next, 'joined'); return next; }
try {
  await start();
  assert.equal((await fetch(base + '/health').then(r => r.json())).protocol, PROTOCOL);
  assert.equal((await fetch(base + '/socket', { headers: { origin: 'https://untrusted.example' } })).status, 403); checks++;
  const old = await client(undefined, undefined, PROTOCOL - 1); await take(old, 'incompatible'); old.ws.close(); checks++;
  let a = await client(), b = await client();
  await identity(a); await identity(b);
  const avatarId = manifest.characters.find(c => c.selectable !== false && c.selectionVisible !== false).id;
  a.send({ type: 'rename', name: '통합검사', charId: avatarId });
  assert.equal((await take(a, 'profile')).profile.charId, avatarId); checks++;
  a.send({ type: 'create', rated: true, password: 'test', name: '로컬 검증' });
  const { code } = await take(a, 'route');
  b.send({ type: 'join', code, password: 'wrong' }); await take(b, 'error');
  b.send({ type: 'join', code, password: 'test' }); assert.equal((await take(b, 'route')).code, code); checks++;
  a = await goRoom(a, code); b = await goRoom(b, code);
  a.send({ type: 'chat', text: '방 기록 유지 검사' });
  assert.equal((await take(b, 'chat')).message.text, '방 기록 유지 검사'); checks++;
  a.send({ type: 'heartbeat' }); await take(a, 'heartbeatAck'); checks++;
  a.send({ type: 'ready' }); b.send({ type: 'ready' }); await confirmSelection(a, b);
  const startMsg = await take(a, 'start'); await take(b, 'start');
  inputs(a, startMsg.matchId, 0, 0, 60); inputs(b, startMsg.matchId, 0, 0, 60);
  let expected = createMatch({ seed: startMsg.seed });
  for (let f = 0; f < 60; f++) expected = stepMatch(expected, [0, 0]);
  assert.equal((await take(a, 'checksum')).hash, stateHash(expected));
  assert.equal((await take(b, 'checksum')).hash, stateHash(expected)); checks++;
  let observer = await client(); const observerProfile = await identity(observer);
  observer.send({ type: 'watch', code, password: 'wrong' }); await take(observer, 'error');
  observer.send({ type: 'watch', code, password: 'test' }); await take(observer, 'route');
  observer = await goRoom(observer, code);
  assert.equal((await take(observer, 'chatHistory')).messages[0].text, '방 기록 유지 검사');
  observer.send({ type: 'chat', text: '관전 중 응원' });
  assert.equal((await take(a, 'chat')).message.text, '방 기록 유지 검사');
  assert.equal((await take(a, 'chat')).message.text, '관전 중 응원');
  a.send({ type: 'chat', text: '경기 중 플레이어 전송' });
  assert.match((await take(a, 'chatError')).reason, /읽기만/); checks++;
  const observerToken = observer.token;
  const watchSnapshot = await take(observer, 'spectatorSnapshot');
  assert.equal(watchSnapshot.hash, stateHash(expected)); assert.equal(watchSnapshot.paused, false);
  observer.send({ type: 'ready' }); assert.match((await take(observer, 'error')).reason, /관전/); checks++;
  const tokenA = a.token, tokenB = b.token;
  a.ws.terminate(); await take(b, 'paused');
  a = await client(tokenA, code); await identity(a); await take(a, 'joined');
  const snap = await take(a, 'snapshot'); assert.equal(snap.hash, stateHash(expected));
  assert.deepEqual(await take(b, 'snapshot'), snap);
  const watchResync = await take(observer, 'spectatorSnapshot'); assert.equal(watchResync.epoch, snap.epoch);
  const observerGame = new SpectatorMatch(watchResync.state, watchResync.hash);
  for (const c of [a, b]) c.send({ type: 'synced', matchId: startMsg.matchId, epoch: snap.epoch, hash: snap.hash });
  await take(a, 'resumed'); await take(b, 'resumed'); checks++;
  inputs(a, startMsg.matchId, snap.epoch, 60, 120); inputs(b, startMsg.matchId, snap.epoch, 60, 120);
  for (let f = 60; f < 120; f++) expected = stepMatch(expected, [0, 0]);
  assert.equal((await take(a, 'checksum')).hash, stateHash(expected));
  assert.equal((await take(b, 'checksum')).hash, stateHash(expected)); checks++;
  for (let i = 0; i < 10; i++) {
    const packet = await take(observer, 'spectatorFrames'); observerGame.receiveBatch(packet.frame, packet.inputs);
    while (observerGame.canAdvance) observerGame.advance();
  }
  assert.equal(stateHash(observerGame.state), stateHash(expected));
  observer.ws.terminate(); await delay(100);
  observer = await client(observerToken, code); await identity(observer);
  assert.equal((await take(observer, 'joined')).role, 'spectator');
  const spectatorReconnect = await take(observer, 'spectatorSnapshot');
  assert.equal(spectatorReconnect.epoch, snap.epoch); assert.equal(spectatorReconnect.paused, false); checks++;
  // 연결을 끊은 뒤 런타임을 재시작해 같은 SQLite에서 경기 상태·기한을 복원한다.
  a.ws.terminate(); await take(b, 'paused'); b.ws.terminate(); await delay(100);
  await stop(); await start();
  a = await client(tokenA); await identity(a); assert.equal((await take(a, 'route')).code, code);
  a = await goRoom(a, code);
  assert.deepEqual((await take(a, 'chatHistory')).messages.map(m => m.text), ['방 기록 유지 검사', '관전 중 응원']); checks++;
  b = await client(tokenB, code); await identity(b); await take(b, 'joined');
  const restored = await take(b, 'snapshot'); assert.equal(restored.hash, stateHash(expected));
  // 첫 복귀자의 snapshot은 두 번째 복귀 때 epoch가 갱신된다.
  await take(a, 'snapshot'); const finalSnap = await take(a, 'snapshot'); assert.equal(finalSnap.epoch, restored.epoch);
  for (const c of [a, b]) c.send({ type: 'synced', matchId: startMsg.matchId, epoch: restored.epoch, hash: restored.hash });
  await take(a, 'resumed'); await take(b, 'resumed'); checks++;
  observer = await client(observerToken); await identity(observer); assert.equal((await take(observer, 'route')).code, code);
  observer = await goRoom(observer, code);
  assert.equal((await take(observer, 'spectatorSnapshot')).hash, stateHash(expected));
  observer.send({ type: 'leave' }); await take(observer, 'route'); observer.ws.close();
  const observerLobby = await client(observerToken); assert.equal((await identity(observerLobby)).rating, observerProfile.rating);
  await take(observerLobby, 'lobby'); observerLobby.ws.close(); checks++;
  b.messages = b.messages.filter(m => m.type !== 'room');
  a.send({ type: 'watchInstead' });
  assert.equal((await take(a, 'joined')).role, 'spectator'); await take(a, 'reset');
  assert.equal((await take(b, 'reset')).side, 0);
  const retained = (await take(b, 'room')).room;
  assert.equal(retained.code, code); assert.equal(retained.players.length, 1); assert.equal(retained.phase, 'waiting');
  assert.equal(retained.spectators, 1); checks++;
  a.send({ type: 'leave' });
  assert.equal((await take(a, 'route')).code, null);
  const departed = await client(tokenA); await identity(departed); await take(departed, 'lobby'); departed.ws.close();
  let promoted = await client(observerToken); await identity(promoted);
  promoted.send({ type: 'watch', code, password: 'test' }); await take(promoted, 'route');
  promoted = await goRoom(promoted, code); promoted.messages = promoted.messages.filter(m => m.type !== 'room');
  promoted.send({ type: 'takeSeat' }); assert.equal((await take(promoted, 'joined')).side, 1);
  const promotedRoom = (await take(promoted, 'room')).room;
  assert.equal(promotedRoom.code, code); assert.equal(promotedRoom.spectators, 0);
  assert.equal(promotedRoom.players[1].id, observerProfile.id);
  promoted.send({ type: 'watchInstead' }); assert.equal((await take(promoted, 'joined')).role, 'spectator');
  await take(promoted, 'reset');
  let switchedRoom = (await take(promoted, 'room')).room;
  assert.equal(switchedRoom.players.length, 1); assert.equal(switchedRoom.spectators, 1);
  assert.equal(switchedRoom.code, code);
  promoted.send({ type: 'takeSeat' }); assert.equal((await take(promoted, 'joined')).side, 1);
  switchedRoom = (await take(promoted, 'room')).room; assert.equal(switchedRoom.spectators, 0); checks++;
  promoted.send({ type: 'leave' }); await take(promoted, 'route'); promoted.ws.close();
  const afterPromotion = await client(observerToken); assert.equal((await identity(afterPromotion)).rating, observerProfile.rating);
  await take(afterPromotion, 'lobby'); afterPromotion.ws.close(); checks++;
  // 나간 사용자의 claim만 해제하고, 남은 방은 같은 코드로 새 참가자를 받는다.
  let replacement = await client(); await identity(replacement);
  replacement.send({ type: 'join', code, password: 'test' }); await take(replacement, 'route');
  replacement = await goRoom(replacement, code);
  replacement.send({ type: 'leave' }); await take(b, 'reset'); await take(replacement, 'route'); replacement.ws.close();
  b.send({ type: 'leave' }); await take(b, 'route');
  checks++;
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
  xr.send({ type: 'leave' }); await take(yr, 'reset'); await take(xr, 'route');
  yr.send({ type: 'leave' }); await take(yr, 'route'); xr.ws.close(); yr.ws.close();
  // 10클라이언트/5개 방을 실제 프레임 속도로 동시에 진행한다.
  const games = [];
  for (let i = 0; i < 5; i++) {
    let p = await client(), q = await client(); await identity(p); await identity(q);
    p.send({ type: 'create', rated: false }); const route = await take(p, 'route');
    q.send({ type: 'join', code: route.code }); await take(q, 'route');
    p = await goRoom(p, route.code); q = await goRoom(q, route.code);
    p.send({ type: 'ready' }); q.send({ type: 'ready' }); await confirmSelection(p, q);
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
    g.peers[0].send({ type: 'leave' }); await take(g.peers[1], 'reset'); await take(g.peers[0], 'route');
    g.peers[1].send({ type: 'leave' }); await take(g.peers[1], 'route');
    g.peers.forEach(p => p.ws.close());
  }
  checks++;
  let timeoutA = await client(), timeoutB = await client(); await identity(timeoutA); await identity(timeoutB);
  timeoutA.send({ type: 'create', rated: true }); const timeoutRoom = (await take(timeoutA, 'route')).code;
  timeoutB.send({ type: 'join', code: timeoutRoom }); await take(timeoutB, 'route');
  timeoutA = await goRoom(timeoutA, timeoutRoom); timeoutB = await goRoom(timeoutB, timeoutRoom);
  timeoutA.send({ type: 'ready' }); timeoutB.send({ type: 'ready' }); await confirmSelection(timeoutA, timeoutB); await take(timeoutA, 'start'); await take(timeoutB, 'start');
  const timeoutToken = timeoutB.token;
  timeoutA.ws.terminate(); await take(timeoutB, 'paused');
  await take(timeoutB, 'reset', 15000);
  timeoutB.send({ type: 'leave' }); await take(timeoutB, 'route'); timeoutB.ws.close();
  const timeoutWinner = await client(timeoutToken); assert.equal((await identity(timeoutWinner)).rating, 1516); checks++;
  // 총원 6명: 신규 입장만 제한하고, 기존 6명의 역할 전환은 허용한다.
  let fullA = await client(), fullB = await client(); await identity(fullA); await identity(fullB);
  fullA.send({ type: 'create', rated: false }); const fullCode = (await take(fullA, 'route')).code;
  fullB.send({ type: 'join', code: fullCode }); await take(fullB, 'route');
  fullA = await goRoom(fullA, fullCode); fullB = await goRoom(fullB, fullCode);
  const viewers = [];
  for (let i = 0; i < 4; i++) {
    let viewer = await client(); await identity(viewer); viewer.send({ type: 'watch', code: fullCode }); await take(viewer, 'route');
    viewer = await goRoom(viewer, fullCode); viewers.push(viewer);
  }
  const outside = await client(); await identity(outside);
  for (const type of ['watch', 'join']) {
    outside.send({ type, code: fullCode }); assert.match((await take(outside, 'error')).reason, /최대 6명/);
  }
  fullA.send({ type: 'watchInstead' }); assert.equal((await take(fullA, 'joined')).role, 'spectator');
  fullB.messages = fullB.messages.filter(m => m.type !== 'room');
  fullB.send({ type: 'watchInstead' }); assert.equal((await take(fullB, 'joined')).role, 'spectator');
  const allWatching = (await take(fullB, 'room')).room;
  assert.equal(allWatching.players.length, 0); assert.equal(allWatching.spectators, 6); assert.equal(allWatching.memberCapacity, 6);
  outside.send({ type: 'join', code: fullCode }); assert.match((await take(outside, 'error')).reason, /최대 6명/);
  fullA.send({ type: 'takeSeat' }); assert.equal((await take(fullA, 'joined')).side, 0);
  fullB.send({ type: 'takeSeat' }); assert.equal((await take(fullB, 'joined')).side, 1);
  for (const c of [fullA, fullB, ...viewers]) c.messages = c.messages.filter(m => !['room', 'reset'].includes(m.type));
  fullA.send({ type: 'ready' }); fullB.send({ type: 'ready' }); await confirmSelection(fullA, fullB);
  const finalStart = await take(fullA, 'start'); await take(fullB, 'start');
  for (let frame = 0; frame < 3600 && !fullA.messages.some(m => m.type === 'finished'); frame += 3) {
    for (const c of [fullA, fullB]) c.send({ type: 'inputBatch', matchId: finalStart.matchId, epoch: 0, frame, inputs: [4, 4, 4] });
    await delay(50);
  }
  await take(fullA, 'finished'); await take(viewers[0], 'finished');
  viewers[0].send({ type: 'returnRoom' }); assert.match((await take(viewers[0], 'error')).reason, /관전/);
  fullB.send({ type: 'rematch', matchId: finalStart.matchId, ready: true });
  let requestedRoom;
  do { requestedRoom = (await take(fullB, 'room')).room; } while (!requestedRoom.players.some(p => p.rematch));
  assert.equal(requestedRoom.players.filter(p => p.rematch).length, 1);
  for (const c of [fullA, fullB, ...viewers]) c.messages = c.messages.filter(m => m.type !== 'room');
  fullA.send({ type: 'returnRoom', matchId: finalStart.matchId });
  for (const c of [fullA, fullB, ...viewers]) {
    await take(c, 'reset'); const returnedRoom = (await take(c, 'room')).room;
    assert.equal(returnedRoom.code, fullCode); assert.equal(returnedRoom.phase, 'waiting');
    assert.equal(returnedRoom.spectatorList.length, 4);
    assert.ok(returnedRoom.players.every(p => !p.rematch));
    assert.ok(returnedRoom.spectatorList.every(p => p.name && p.connected));
  }
  checks++;
  // 실제 SQLite·알람에서도 양쪽 동의만으로 같은 캐릭터·관전자를 유지해 재대전한다.
  for (const c of [fullA, fullB, ...viewers]) c.messages = [];
  fullA.send({ type: 'ready' }); fullB.send({ type: 'ready' }); await confirmSelection(fullA, fullB);
  const replayStart = await take(fullA, 'start'); await take(fullB, 'start');
  for (let frame = 0; frame < 3600 && !fullA.messages.some(m => m.type === 'finished' && m.matchId === replayStart.matchId); frame += 3) {
    for (const c of [fullA, fullB]) c.send({ type: 'inputBatch', matchId: replayStart.matchId, epoch: 0, frame, inputs: [4, 4, 4] });
    await delay(50);
  }
  await take(fullA, 'finished'); await take(fullB, 'finished');
  for (const c of viewers) c.messages = c.messages.filter(m => m.type !== 'spectatorSnapshot');
  for (const c of [fullA, fullB]) c.send({ type: 'rematch', matchId: replayStart.matchId, ready: true });
  const nextStart = await take(fullA, 'start'); await take(fullB, 'start');
  assert.notEqual(nextStart.matchId, replayStart.matchId);
  assert.deepEqual(nextStart.players.map(p => p.charId), replayStart.players.map(p => p.charId));
  for (const c of viewers) {
    const snapshot = await take(c, 'spectatorSnapshot');
    assert.equal(snapshot.matchId, nextStart.matchId); assert.equal(snapshot.state.frame, 0);
  }
  for (const c of [fullA, fullB]) c.messages = c.messages.filter(m => m.type !== 'checksum' || m.matchId === nextStart.matchId);
  inputs(fullA, nextStart.matchId, 0, 0, 60); inputs(fullB, nextStart.matchId, 0, 0, 60);
  let replayExpected = createMatch({ seed: nextStart.seed });
  for (let frame = 0; frame < 60; frame++) replayExpected = stepMatch(replayExpected, [0, 0]);
  for (const c of [fullA, fullB]) {
    const checksum = await take(c, 'checksum');
    assert.equal(checksum.matchId, nextStart.matchId); assert.equal(checksum.hash, stateHash(replayExpected));
  }
  checks++;
  for (const c of [...viewers, fullA, fullB]) { c.send({ type: 'leave' }); await take(c, 'route'); c.ws.close(); }
  outside.ws.close(); checks++;
  console.log(`Cloudflare 로컬 통합 검증 ${checks}개 통과: Origin·버전·비밀번호·자동 heartbeat·대전·재접속·호스트 재시작·레이트 저장·자동 매칭`);
} catch (error) { console.error(logs); throw error; }
finally {
  await stop();
  proxy.wss.close(); await new Promise(resolve => proxy.server.close(resolve));
  if (process.env.CF_TEST_KEEP_STATE === '1') console.log(`검증 SQLite 보관: ${stateDir}`);
  else await rm(stateDir, { recursive: true, force: true });
}
