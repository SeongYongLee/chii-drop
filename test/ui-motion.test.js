import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUiTransition, drawConfirmationStamp, TRANSITION_FRAMES } from '../src/view/ui-motion.js';

function canvasSpy() {
  const images = [], scales = [];
  const ctx = new Proxy({ globalAlpha: 1,
    drawImage: (source) => images.push({ source, alpha: ctx.globalAlpha }),
    scale: (x, y) => scales.push([x, y]),
  }, { get: (object, key) => object[key] ?? (() => {}) });
  return { ctx, images, scales };
}

test('전환 그리기는 시간을 소비하지 않고 정해진 프레임 뒤 이전 화면을 해제한다', () => {
  const transition = createUiTransition(), spy = canvasSpy(), snapshot = {};
  transition.start(snapshot);
  transition.draw(spy.ctx, 960, 540); transition.draw(spy.ctx, 960, 540);
  assert.deepEqual(spy.images.map((image) => image.alpha), [1, 1]);
  for (let i = 0; i < TRANSITION_FRAMES / 2; i++) transition.update();
  transition.draw(spy.ctx, 960, 540);
  assert.equal(spy.images.at(-1).alpha, .5);
  for (let i = 0; i < TRANSITION_FRAMES / 2; i++) transition.update();
  const count = spy.images.length;
  transition.draw(spy.ctx, 960, 540);
  assert.equal(spy.images.length, count);
});

test('빠른 화면 이동은 새 스냅샷으로 즉시 교체하며 이전 전환을 기다리지 않는다', () => {
  const transition = createUiTransition(), spy = canvasSpy(), newer = {};
  transition.start({}); transition.update(); transition.update();
  transition.start(newer);
  transition.draw(spy.ctx, 960, 540);
  assert.deepEqual(spy.images, [{ source: newer, alpha: 1 }]);
});

test('세로 메뉴에서 경기로 전환해도 이전 캐릭터 화면을 세로로 늘리지 않는다', () => {
  const transition = createUiTransition(), calls = [];
  const snapshot = { width: 740, height: 676 };
  const ctx = new Proxy({ globalAlpha: 1, drawImage: (...args) => calls.push(args) },
    { get: (object, key) => object[key] ?? (() => {}) });
  transition.start(snapshot);
  for (const height of [540, 900, 1500]) transition.draw(ctx, 960, height);
  for (const [, x, y, width, height] of calls) {
    assert.equal(x, 0); assert.equal(y, 0);
    assert.equal(width / height, snapshot.width / snapshot.height);
  }
});

test('움직임 줄이기는 화면 겹침과 도장의 확대·투명도 변화를 생략한다', (t) => {
  const previous = globalThis.window;
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  t.after(() => { globalThis.window = previous; });
  const transition = createUiTransition(), spy = canvasSpy();
  transition.start({}, [{ x: 100, y: 100 }]);
  transition.draw(spy.ctx, 960, 540);
  assert.equal(spy.images.length, 0);
  drawConfirmationStamp(spy.ctx, { x: 100, y: 100 }, 0);
  assert.deepEqual(spy.scales, [[1, 1]]);
  assert.equal(spy.ctx.globalAlpha, 1);
});
