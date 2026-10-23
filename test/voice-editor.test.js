import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVoiceEditor } from '../server/voice-editor.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'voice-editor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, 'skins', 'test');
  await mkdir(join(folder, 'sounds', 'voice-review', 'samples'), { recursive: true });
  const first = 'sounds/voice-review/samples/first.wav', second = 'sounds/voice-review/samples/second.wav';
  for (const file of [first, second]) await writeFile(join(folder, file), 'test audio');
  const original = { name: 'Fixture', music: { file: 'preserved.mp3' }, characters: [
    { id: 'actor', moods: { idle: 'keep' }, voices: { select: [first], damage: [first, second] } },
    { id: 'other', moods: { idle: 'also keep' } },
  ] };
  const manifestFile = join(folder, 'manifest.json');
  await writeFile(manifestFile, JSON.stringify(original));
  const handle = createVoiceEditor({ root });
  const request = async (method = 'GET', data, { address = '127.0.0.1', origin = 'http://127.0.0.1:5180', host = '127.0.0.1:5180', content = 'application/json' } = {}) => {
    const req = Readable.from(data === undefined ? [] : [JSON.stringify(data)]);
    Object.assign(req, { method, headers: { host, origin, 'content-type': content }, socket: { remoteAddress: address } });
    let status, result;
    await handle(req, { writeHead(code) { status = code; }, end(body) { result = JSON.parse(body); } }, '/api/local/skins/test/voices');
    return { status, ...result };
  };
  return { root, folder, manifestFile, original, first, second, request };
}

test('음성 배정을 저장·복원하며 음악·모션과 미변경 다중 후보를 보존한다', async t => {
  const f = await fixture(t);
  const loaded = await f.request();
  const changed = structuredClone(loaded.voices);
  changed.actor.select = [f.second];
  const saved = await f.request('PUT', { revision: loaded.revision, voices: changed });
  assert.equal(saved.status, 200);
  assert.notEqual(saved.revision, loaded.revision);
  const manifest = JSON.parse(await readFile(f.manifestFile));
  assert.deepEqual(manifest.music, f.original.music);
  assert.deepEqual(manifest.characters[0].moods, f.original.characters[0].moods);
  assert.deepEqual(manifest.characters[0].voices.damage, [f.first, f.second]);
  assert.equal(manifest.characters[1].voices, undefined);
  assert.equal(saved.canRestore, true);
  const backups = await readdir(join(f.folder, '.voice-history'));
  assert.equal(backups.filter(name => name !== 'latest.json').length, 1);
  assert.deepEqual(JSON.parse(await readFile(join(f.folder, '.voice-history', 'latest.json'))).voices, loaded.voices);
  const restored = await f.request('POST', { revision: saved.revision, action: 'restore' });
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.voices, loaded.voices);
  assert.deepEqual(JSON.parse(await readFile(f.manifestFile)), f.original);
});

test('서로 다른 편집기의 오래된 배정표와 동시 덮어쓰기를 거부한다', async t => {
  const f = await fixture(t);
  const loaded = await f.request();
  const changed = structuredClone(loaded.voices);
  changed.actor.select = [f.second];
  const results = await Promise.all([f.request('PUT', { revision: loaded.revision, voices: changed }), f.request('PUT', { revision: loaded.revision, voices: {} })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  // Body parsing and filesystem reads may finish in either order. Exactly
  // one successful request wins; the other must not overwrite that result.
  assert.deepEqual((await f.request()).voices, results.find(r => r.status === 200).voices);
});

test('외부 접속·다른 출처·위조 로컬 호스트와 형식이 다른 저장은 차단한다', async t => {
  const f = await fixture(t);
  const loaded = await f.request();
  const input = { revision: loaded.revision, voices: {} };
  for (const options of [
    { address: '192.168.0.10' }, { origin: 'https://example.com' },
    { host: 'attacker.example:5180', origin: 'http://attacker.example:5180' },
    { origin: '' },
  ]) assert.equal((await f.request('PUT', input, options)).status, 403);
  assert.equal((await f.request('PUT', input, { content: 'text/plain' })).status, 415);
  assert.deepEqual((await f.request()).voices, loaded.voices);
});

test('허용되지 않은 이벤트·누락 파일·경로 탈출·외부 심볼릭 링크는 배정하지 않는다', async t => {
  const f = await fixture(t);
  const loaded = await f.request();
  const outside = join(f.root, 'outside.wav');
  await writeFile(outside, 'outside');
  await symlink(outside, join(f.folder, 'sounds/voice-review/samples/link.wav'));
  for (const voices of [
    { unknown: { select: [f.first] } },
    { actor: { unrecognized: [f.first] } },
    { actor: { select: ['sounds/voice-review/samples/missing.wav'] } },
    { actor: { select: ['sounds/voice-review/../../outside.wav'] } },
    { actor: { select: ['sounds/voice-review/samples/link.wav'] } },
    { actor: { select: [f.first, f.first] } },
  ]) assert.equal((await f.request('PUT', { revision: loaded.revision, voices })).status, 400);
  assert.deepEqual((await f.request()).voices, loaded.voices);
  assert.equal((await f.request('POST', { revision: loaded.revision, action: 'restore' })).status, 400);
});

test('같은 배정의 재저장은 백업을 덮어쓰지 않으며 빈 목록으로 배정을 해제한다', async t => {
  const f = await fixture(t);
  const loaded = await f.request();
  const noop = await f.request('PUT', { revision: loaded.revision, voices: loaded.voices });
  assert.equal(noop.unchanged, true);
  assert.equal(noop.canRestore, false);
  const clear = await f.request('PUT', { revision: loaded.revision, voices: { actor: { select: [] } } });
  assert.equal(clear.status, 200);
  assert.deepEqual(clear.voices.actor.select, []);
});
