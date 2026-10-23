import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blinkSeed, blinkTime, compileBlink } from '../src/view/character-blink.js';

const frames = [130, 4, 5, 3, 40].map((duration) => ({ duration }));
const config = (overrides = {}) => compileBlink({ doubleChance: 0, ...overrides }, frames, 0);
const starts = (seed, settings, length = 5000) => {
  const result = [];
  for (let t = 0; t < length; t++) if (blinkTime(t, seed, settings) === 0) result.push(t);
  return result;
};

test('깜빡임은 매번 다른 간격이고 캐릭터·표시 인스턴스마다 독립적이다', () => {
  const settings = config();
  const sequences = ['char-1/left', 'char-2/left', 'char-1/right'].map((key) => starts(blinkSeed(key, 42), settings));
  for (const sequence of sequences) {
    const gaps = sequence.slice(1).map((value, i) => value - sequence[i]);
    assert.ok(new Set(gaps).size > 5);
    assert.ok(gaps.every((gap) => gap >= settings.period - settings.jitter * 2 && gap <= settings.period + settings.jitter * 2));
  }
  assert.notDeepEqual(sequences[0], sequences[1]);
  assert.notDeepEqual(sequences[0], sequences[2]);
  assert.notDeepEqual(sequences[0], starts(blinkSeed('char-1/left', 43), settings));
});

test('같은 시드·시간은 호출 순서나 횟수와 무관하며 전역 난수를 소비하지 않는다', (t) => {
  t.mock.method(Math, 'random', () => { throw new Error('global random used'); });
  const seed = blinkSeed('portrait', 23), settings = config();
  const expected = Array.from({ length: 1000 }, (_, i) => blinkTime(i, seed, settings));
  for (let i = 999; i >= 0; i--) assert.equal(blinkTime(i, seed, settings), expected[i]);
  for (const time of [-1, NaN, Infinity]) assert.equal(blinkTime(time, seed, settings), -1);
});

test('드문 두 번 깜빡임은 잠깐 눈을 뜬 뒤 같은 길이로 재생한다', () => {
  const seed = blinkSeed('double', 9);
  const single = config({ doubleChance: 0 }), double = config({ doubleChance: 1 });
  const start = starts(seed, single, single.period)[0];
  for (let i = 0; i < single.duration; i++) {
    assert.equal(blinkTime(start + i, seed, double), i);
    assert.equal(blinkTime(start + single.duration + single.gap + i, seed, double), i);
    assert.equal(blinkTime(start + single.duration + single.gap + i, seed, single), -1);
  }
  for (let i = 0; i < single.gap; i++) assert.equal(blinkTime(start + single.duration + i, seed, double), -1);
  const rare = config({ doubleChance: 0.12 });
  const count = starts(seed, rare, rare.period * 200).length;
  assert.ok(count > 200 && count < 260);
});

test('잘못된 범위·겹치는 대표 컷·짧은 대기 구간은 거부한다', () => {
  for (const values of [{ from: -1 }, { to: 5 }, { period: 20 }, { jitter: 105 },
    { gap: 0 }, { doubleChance: -0.1 }, { doubleChance: 2 }, { period: 210.5 }]) {
    assert.equal(compileBlink(values, frames, 0), null);
  }
  assert.equal(compileBlink({}, frames, 2), null);
  assert.ok(config());
});
