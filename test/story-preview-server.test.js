import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createOnlineServer } from '../server/index.js';

test('대본 미리보기는 로컬에서만 제공하고 대본 검토 문서는 노출하지 않는다', async t => {
  const folder = new URL(`../skins/test-story-${process.pid}/`, import.meta.url);
  await mkdir(folder, { recursive: true });
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(new URL('story-preview.html', folder), '<h1>Story preview</h1>');
  await writeFile(new URL('STORY.md', folder), 'private notes');
  const { server, wss } = createOnlineServer();
  t.after(() => { wss.close(); server.emit('close'); });
  const handle = server.listeners('request')[0];
  const request = (file, address) => new Promise((resolve, reject) => {
    let status;
    handle({url:`/skins/test-story-${process.pid}/${file}`, socket:{remoteAddress:address}}, {
      writeHead(code) {status=code;}, end() {resolve(status);},
    }).catch(reject);
  });
  assert.equal(await request('story-preview.html?scene=ending&line=29','127.0.0.1'),200);
  assert.equal(await request('story-preview.html','192.168.0.30'),404);
  assert.equal(await request('STORY.md','127.0.0.1'),404);
});
