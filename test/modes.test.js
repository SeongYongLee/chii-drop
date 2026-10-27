import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, modesForURL } from '../src/app/modes.js';

test('공개·로컬 주소 모두 온라인 대전을 제공하며 URL로 스토리를 열 수 없다', () => {
  for (const url of [undefined, '', 'http://localhost:5183/',
    'http://127.0.0.1/?multiplayer-test=1#online', 'http://[::1]/',
    'https://seongyonglee.github.io/chii-drop/',
    'https://seongyonglee.github.io/chii-drop/?multiplayer-test=1#play']) {
    const modes = modesForURL(url);
    assert.deepEqual(modes, { story: false, multiplayer: true, online: true });
    assert.ok(Object.isFrozen(modes));
  }
  assert.equal(MODES.multiplayer, true);
  assert.equal(MODES.online, true);
});
