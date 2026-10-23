import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SCREEN_HEIGHT, SCREEN_WIDTH, setupScreen } from '../src/app/screen.js';

test('setupScreen은 논리 해상도에 기기 배율을 곱한 크기로 캔버스를 맞춘다', () => {
  const calls = [];
  const ctx = { setTransform: (...args) => calls.push(args) };
  const canvas = { getContext: () => ctx };

  const result = setupScreen(canvas, 2);

  assert.equal(result, ctx);
  assert.equal(canvas.width, SCREEN_WIDTH * 2);
  assert.equal(canvas.height, SCREEN_HEIGHT * 2);
  assert.deepEqual(calls, [[2, 0, 0, 2, 0, 0]]);
});

test('큰 화면과 화면 밀도 변화에 맞춰 재설정하며 논리 좌표는 유지한다', () => {
  let onResize, onLayout;
  const transforms = [];
  const view = { devicePixelRatio: 2, addEventListener: (name, fn) => { if (name === 'resize') onResize = fn; },
    ResizeObserver: class { constructor(fn) { onLayout = fn; } observe() {} } };
  const canvas = { clientWidth: 1920, clientHeight: 1080, ownerDocument: { defaultView: view },
    getContext: () => ({ setTransform: (...args) => transforms.push(args) }) };
  setupScreen(canvas);
  assert.equal(canvas.width, 3840);
  assert.equal(canvas.height, 2160);
  assert.deepEqual(transforms.at(-1), [4, 0, 0, 4, 0, 0]);
  canvas.clientWidth = 480; canvas.clientHeight = 270;
  onLayout();
  assert.equal(canvas.width, 960);
  assert.equal(canvas.height, 540);
  view.devicePixelRatio = 3;
  onResize();
  assert.equal(canvas.width, 1440);
  assert.equal(canvas.height, 810);
  assert.deepEqual(transforms.at(-1), [1.5, 0, 0, 1.5, 0, 0]);
});
