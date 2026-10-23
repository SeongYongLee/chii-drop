import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createOnlineServer } from '../server/index.js';

for (const prefix of ['animation', 'story-roster']) test(`${prefix} 비교 화면은 로컬에서만 열리고 제작 자료는 제공하지 않는다`, async (t) => {
  const name = `${prefix}-v${process.pid}`;
  const folder = new URL(`../skins/test-artwork/drafts/${name}/`, import.meta.url);
  await mkdir(folder, { recursive: true });
  t.after(() => rm(folder, { recursive: true, force: true }));
  for (const [file, content] of Object.entries({ 'preview.html': '<h1>Sprite review</h1>',
    'generation.json': '{}', 'connect.mjs': 'private script', 'CREDITS.md': 'private notes' })) {
    await writeFile(new URL(file, folder), content);
  }
  const { server, wss } = createOnlineServer();
  t.after(() => { wss.close(); server.emit('close'); });
  const handle = server.listeners('request')[0];
  const request = (file, address) => new Promise((resolve, reject) => {
    let status, headers;
    handle({ url: `/skins/test-artwork/drafts/${name}/${file}`, socket: { remoteAddress: address } }, {
      writeHead(code, values) { status = code; headers = values; },
      end(body) { resolve({ status, headers, body }); },
    }).catch(reject);
  });
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    const page = await request('preview.html?character=char-1&mood=lose', address);
    assert.equal(page.status, 200);
    assert.equal(page.headers['Content-Type'], 'text/html');
    for (const file of ['generation.json', 'connect.mjs', 'CREDITS.md']) assert.equal((await request(file, address)).status, 404);
  }
  for (const address of ['192.168.0.30', '203.0.113.4']) assert.equal((await request('preview.html', address)).status, 404);
});
