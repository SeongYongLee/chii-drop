import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileIdleMotion, idleMotionAt } from '../src/view/character-idle.js';

const clips = [{ total: 46 }, { total: 54 }];
const config = compileIdleMotion({ period: 660, jitter: 150 }, clips);

test('대기 몸동작은 서로 다른 간격과 종류로 짧게 재생한다', () => {
  const starts = [], variants = new Set();
  for (let frame = 0; frame < 20000; frame++) {
    const action = idleMotionAt(frame, frame, 42, config);
    if (!action) continue;
    assert.ok(action.frame < action.clip.total);
    variants.add(action.clip);
    if (action.frame === 0) starts.push(frame);
  }
  assert.equal(variants.size, 2);
  const gaps = starts.slice(1).map((frame, i) => frame - starts[i]);
  assert.ok(new Set(gaps).size > 10);
  assert.ok(gaps.every((gap) => gap >= 360 && gap <= 960));
});

test('공격 후 대기로 돌아와도 진행 중이던 몸동작에 중간부터 합류하지 않는다', () => {
  let start = 0;
  while (!idleMotionAt(start, start, 42, config)) start++;
  assert.equal(idleMotionAt(start, 0, 42, config), null);
  assert.equal(idleMotionAt(start + 20, 20, 42, config), null);
  assert.ok(idleMotionAt(start, 60, 42, config));
});

test('되감기·재그리기는 같은 결과이고 캐릭터별 시드는 다른 결과다', (t) => {
  t.mock.method(Math, 'random', () => { throw new Error('presentation draw consumed random'); });
  const sequence = (seed) => Array.from({ length: 3000 }, (_, frame) => idleMotionAt(frame, frame, seed, config));
  const expected = sequence(42);
  for (let frame = 2999; frame >= 0; frame--) assert.deepEqual(idleMotionAt(frame, frame, 42, config), expected[frame]);
  assert.notDeepEqual(sequence(43), expected);
  for (const value of [null, { period: 0 }, { jitter: -1 }, { period: 200 }, { period: 660.5 }]) {
    assert.equal(compileIdleMotion(value, clips), null);
  }
  assert.ok(compileIdleMotion({}, clips));
  assert.equal(compileIdleMotion({}, []), null);
});
