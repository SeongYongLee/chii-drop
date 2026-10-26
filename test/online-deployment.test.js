import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseOnlineConfig } from '../src/net/config.js';
import { runtimeConfig } from '../server/runtime-config.js';
import { createOnlineServer } from '../server/index.js';
import { createProfileStore } from '../server/profiles.js';
import { PROTOCOL, stateHash } from '../src/net/rollback.js';
import { RULES_VERSION } from '../src/engine/rules.js';
import { checkOnline } from '../scripts/check-online.mjs';

const origin = 'https://seongyonglee.github.io';
test('Pages의 프로젝트 경로와 별개인 wss 주소를 사용하고 위험한 공개 설정은 거부한다', () => {
  assert.deepEqual(parseOnlineConfig({ enabled: true, serverUrl: 'https://game.example' }, origin + '/chii-drop/online.html'), { enabled: true, socketURL: 'wss://game.example/socket' });
  assert.equal(parseOnlineConfig({ enabled: true, serverUrl: 'https://game.example' }, 'http://localhost:5180/chii-drop/').socketURL, 'wss://game.example/socket');
  assert.equal(parseOnlineConfig({ enabled: true }, 'http://192.168.0.38:5180/online.html').socketURL, 'ws://192.168.0.38:5180/socket');
  assert.equal(parseOnlineConfig({ enabled: false, serverUrl: null }, origin).enabled, false);
  for (const serverUrl of ['http://game.example', 'https://user:pass@game.example', 'https://game.example/socket', 'https://game.example?key=x', 'javascript:alert(1)']) {
    assert.throws(() => parseOnlineConfig({ enabled: true, serverUrl }, origin));
  }
  assert.throws(() => parseOnlineConfig({ enabled: true, serverUrl: 'http://localhost:5180' }, origin));
  assert.throws(() => parseOnlineConfig({ enabled: true }, origin));
});
test('운영 시작에는 명시적 Origin과 영구 데이터 경로가 필요하며 개발 기본값은 유지한다', () => {
  assert.equal(runtimeConfig({}).serveStatic, true);
  assert.throws(() => runtimeConfig({ NODE_ENV: 'production' }));
  assert.throws(() => runtimeConfig({ NODE_ENV: 'production', ALLOWED_ORIGINS: origin, ONLINE_DATA_FILE: './data/file' }));
  for (const ALLOWED_ORIGINS of ['*', origin + '/chii-drop', 'http://public.example', 'https://user:pass@game.example']) assert.throws(() => runtimeConfig({ ALLOWED_ORIGINS }));
  assert.throws(() => runtimeConfig({ PORT: 'abc' }));
  const config = runtimeConfig({ NODE_ENV: 'production', ALLOWED_ORIGINS: ' ' + origin + ' ', ONLINE_DATA_FILE: '/var/data/online.json', PORT: '10000' });
  assert.equal(config.serveStatic, false); assert.equal(config.port, 10000); assert.deepEqual(config.origins, [origin]);
});
test('운영 서버는 Pages Origin만 허용하고 편집·정적 자료를 차단하며 두 클라이언트 대전을 처리한다', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'online-production-'));
  const file = join(folder, 'online.json');
  const { server, wss, lobby } = createOnlineServer({ serveStatic: false, origins: [origin], profiles: createProfileStore({ file }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { for (const ws of wss.clients) ws.terminate(); wss.close(); await new Promise(r => server.close(r)); await rm(folder, { recursive: true, force: true }); });
  assert.equal((await checkOnline(base, origin)).rulesVersion, RULES_VERSION);
  for (const path of ['/', '/online.html', '/online-config.json', '/src/net/browser.js', '/data/online.json', '/api/local/skins/chiikawa/voices', '/api/local/skins/chiikawa/music', '/skins/chiikawa/manifest.json']) {
    assert.equal((await fetch(base + path)).status, 404, path);
    assert.equal((await fetch(base + path, { method: 'POST', body: '{}' })).status, 404, path);
  }
  await assert.rejects(checkOnline(base, 'https://other.example'));
  const version = await (await fetch(base + '/version.json')).json();
  assert.equal(version.protocol, PROTOCOL); assert.equal(version.rulesVersion, RULES_VERSION);
  async function client() {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/socket', { origin }), messages = [];
    ws.on('message', data => messages.push(JSON.parse(data))); await once(ws, 'open');
    return { ws, messages, send: m => ws.send(JSON.stringify(m)) };
  }
  async function wait(c, type) {
    for (let n = 0; n < 200; n++) {
      const index = c.messages.findIndex(m => m.type === type);
      if (index >= 0) return c.messages.splice(index, 1)[0];
      await new Promise(r => setTimeout(r, 5));
    }
    throw new Error('timeout ' + type);
  }
  const a = await client(), b = await client();
  for (const c of [a, b]) c.send({ type: 'hello', protocol: PROTOCOL, rulesVersion: RULES_VERSION });
  const identity = await wait(a, 'welcome'); await wait(b, 'welcome');
  a.send({ type: 'create' }); const { code } = await wait(a, 'joined');
  b.send({ type: 'join', code }); await wait(b, 'joined');
  a.send({ type: 'ready' }); b.send({ type: 'ready' });
  for (const c of [a, b]) {
    let m; do { m = await wait(c, 'room'); } while (m.room.phase !== 'selecting');
    c.send({ type: 'confirmCharacter', selectionId: m.room.selectionId });
  }
  const start = await wait(a, 'start'); await wait(b, 'start');
  for (let frame = 0; frame < 60; frame++) for (const c of [a, b]) c.send({ type: 'input', matchId: start.matchId, frame, input: 0 });
  const hashA = await wait(a, 'checksum'), hashB = await wait(b, 'checksum');
  assert.deepEqual(hashA, hashB); assert.equal(hashA.hash, stateHash(lobby.rooms.get(code).state));
  assert.equal((await (await fetch(base + '/health')).json()).activeMatches, 1);
  const restored = createProfileStore({ file }); assert.equal(restored.authenticate(identity.token).profile.id, identity.profile.id);
  const old = await client(); old.send({ type: 'hello', protocol: PROTOCOL - 1, rulesVersion: RULES_VERSION });
  assert.equal((await wait(old, 'incompatible')).type, 'incompatible');
});
