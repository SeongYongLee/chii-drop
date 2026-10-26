import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, modesForURL } from '../src/app/modes.js';

test('공개·로컬 주소 모두 로컬 대전만 열고 URL로 온라인 잠금을 풀 수 없다', () => {
  for (const url of [undefined, '', 'http://localhost:5183/',
    'http://127.0.0.1/?multiplayer-test=1#online', 'http://[::1]/',
    'https://seongyonglee.github.io/chii-drop/',
    'https://seongyonglee.github.io/chii-drop/?multiplayer-test=1#play']) {
    const modes = modesForURL(url);
    assert.deepEqual(modes, { story: false, multiplayer: true, online: false });
    assert.ok(Object.isFrozen(modes));
  }
  assert.equal(MODES.multiplayer, true);
  assert.equal(MODES.online, false);
});
