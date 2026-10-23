import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createOnlineServer } from '../server/index.js';

test('음성 검토 HTML과 WAV는 로컬에서만 제공하고 스크립트·메모는 공개하지 않는다', async (t) => {
  const name = `voice-preview-test-${process.pid}`;
  const folder = new URL(`../skins/test-artwork/sounds/${name}/`, import.meta.url);
  await mkdir(new URL('samples/', folder), { recursive: true });
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(new URL('preview.html', folder), '<h1>Voice review</h1>');
  await writeFile(new URL('samples/clip-001.wav', folder), 'sample');
  await writeFile(new URL('CREDITS.md', folder), 'Source record');
  await writeFile(new URL('process.py', folder), 'private script');
  await writeFile(new URL('input-review.json', folder), '{}');
  const { server, wss } = createOnlineServer();
  t.after(() => { wss.close(); server.emit('close'); });
  const handle = server.listeners('request')[0];
  const request = (path, address) => new Promise((resolve, reject) => {
    let status, headers;
    handle({ url: `/skins/test-artwork/sounds/${name}/${path}`, socket: { remoteAddress: address } }, {
      writeHead(code, values) { status = code; headers = values; },
      end(body) { resolve({ status, headers, body }); },
    }).catch(reject);
  });
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    const page = await request('preview.html', address);
    assert.equal(page.status, 200);
    assert.equal(page.headers['Content-Type'], 'text/html');
    const audio = await request('samples/clip-001.wav', address);
    assert.equal(audio.status, 200);
    assert.equal(audio.headers['Content-Type'], 'audio/wav');
    assert.equal(audio.body.toString(), 'sample');
    assert.equal((await request('CREDITS.md', address)).status, 200);
    assert.equal((await request('process.py', address)).status, 404);
    assert.equal((await request('input-review.json', address)).status, 404);
  }
  for (const path of ['preview.html', 'samples/clip-001.wav', 'CREDITS.md']) {
    assert.equal((await request(path, '192.168.0.30')).status, 404);
  }
});

test('IP 접속에도 매니페스트에 배정된 음성만 제공하며 미배정 파일과 검토 기록은 차단한다', async (t) => {
  const name = `voice-runtime-test-${process.pid}`;
  const folder = new URL(`../skins/${name}/`, import.meta.url);
  await mkdir(new URL('sounds/voice-test/current/actor/', folder), { recursive: true });
  t.after(() => rm(folder, { recursive: true, force: true }));
  const selected = 'sounds/voice-test/current/actor/selected.wav';
  const unused = 'sounds/voice-test/current/actor/unused.wav';
  const music = 'sounds/voice-test/music.mp3';
  const battle = 'sounds/voice-test/battle.mp3';
  await writeFile(new URL('manifest.json', folder), JSON.stringify({ music: { file: music, scenes: { battle: { file: battle } } }, characters: [
    { id: 'actor', voices: { select: [selected] } },
  ] }));
  await writeFile(new URL(selected, folder), 'selected voice');
  await writeFile(new URL(unused, folder), 'unused voice');
  await writeFile(new URL(music, folder), 'assigned music');
  await writeFile(new URL(battle, folder), 'assigned scene music');
  await writeFile(new URL('sounds/voice-test/preview.html', folder), 'private review');
  const { server, wss } = createOnlineServer();
  t.after(() => { wss.close(); server.emit('close'); });
  const handle = server.listeners('request')[0];
  const request = (path) => new Promise((resolve, reject) => {
    let status, headers;
    handle({ url: `/skins/${name}/${path}`, socket: { remoteAddress: '192.168.0.30' } }, {
      writeHead(code, values) { status = code; headers = values; },
      end(body) { resolve({ status, headers, body }); },
    }).catch(reject);
  });
  const voice = await request(selected);
  assert.equal(voice.status, 200);
  assert.equal(voice.headers['Content-Type'], 'audio/wav');
  assert.equal(voice.body.toString(), 'selected voice');
  const track = await request(music);
  assert.equal(track.status, 200); assert.equal(track.headers['Content-Type'], 'audio/mpeg');
  assert.equal((await request(battle)).status, 200);
  assert.equal((await request(unused)).status, 404);
  assert.equal((await request('sounds/voice-test/preview.html')).status, 404);
  assert.equal((await request('sounds/voice-test/CREDITS.md')).status, 404);
  await writeFile(new URL('manifest.json', folder), '{invalid');
  assert.equal((await request(selected)).status, 404);
});
