import assert from 'node:assert/strict';
import { test } from 'node:test';

import { blipFor, voiceProfile } from '../src/audio/voice.js';

function blips(profile, text, mood) {
  return [...text].map((_, i) => blipFor(profile, text, i, mood));
}

test('같은 캐릭터와 대사는 항상 같은 소리를 낸다', () => {
  const a = blips(voiceProfile('hachiware'), '이거 다 같이 승부로 나눠서 하면 어때?');
  const b = blips(voiceProfile('hachiware'), '이거 다 같이 승부로 나눠서 하면 어때?');
  assert.deepEqual(a, b);
});

test('캐릭터마다 목소리가 다르고, 대본 값으로 덮어쓸 수 있다', () => {
  assert.notDeepEqual(voiceProfile('chiikawa'), voiceProfile('rakko'));
  const custom = voiceProfile('chiikawa', { pitch: 700, rate: 1 });
  assert.equal(custom.pitch, 700);
  assert.equal(custom.rate, 1);
});

test('공백·문장부호·말줄임표에서는 소리를 내지 않는다', () => {
  const profile = voiceProfile('x', { rate: 1 });
  const result = blips(profile, '……응! 가자.');
  assert.deepEqual(
    result.map((b) => b !== null),
    [false, false, true, false, false, true, true, false],
  );
});

test('rate 글자마다 한 번씩 소리를 낸다', () => {
  const profile = voiceProfile('x', { rate: 2 });
  const sounded = blips(profile, '가나다라마바').filter(Boolean).length;
  assert.equal(sounded, 3);
});

test('기쁜 표정은 음이 높고 슬픈 표정은 낮다', () => {
  const profile = voiceProfile('x', { rate: 1, spread: 0 });
  const idle = blipFor(profile, '가', 0, 'idle').freq;
  assert.ok(blipFor(profile, '가', 0, 'happy').freq > idle);
  assert.ok(blipFor(profile, '가', 0, 'sad').freq < idle);
  assert.equal(blipFor(profile, '가', 0, 'fever').wave, 'sawtooth');
});

test('물음표로 끝나면 끝 음이 올라간다', () => {
  const profile = voiceProfile('x', { rate: 1, spread: 0 });
  const plain = blipFor(profile, '그래', 1).freq;
  const asking = blipFor(profile, '그래?', 1).freq;
  assert.ok(asking > plain);
});
