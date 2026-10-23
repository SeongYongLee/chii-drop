import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTouchLayout, defaultTouchLayout, loadTouchLayouts, touchButtonRect, TOUCH_LAYOUT_KEY, TOUCH_BUTTONS } from '../src/input/touch-layout.js';

test('터치 배치는 손상된 저장값을 거르고 버튼을 48~96px와 패널 안으로 제한한다', () => {
  const layout = normalizeTouchLayout({ 1: { x: -1, y: 4, size: 5 }, 4: { x: NaN, y: .3, size: 300 } });
  assert.deepEqual(layout[1], { x: 0, y: 1, size: 48 });
  assert.deepEqual(layout[4], { x: .5, y: .3, size: 96 });
  for (const width of [190, 320, 580]) for (const { bit } of TOUCH_BUTTONS) {
    const rect = touchButtonRect(layout[bit], width);
    assert.ok(rect.left >= 0 && rect.top >= 0);
    assert.ok(rect.left + rect.size <= width);
    assert.ok(rect.top + rect.size <= 180);
  }
});

test('가로·세로 양손 기본 패드에서 이동·회전 영역이 서로 겹치지 않는다', () => {
  for (const [orientation, width, height] of [['landscape', 548, 304], ['landscape', 824, 374], ['portrait', 300, 180], ['portrait', 370, 180]]) {
    const layout = defaultTouchLayout(orientation, width);
    const rects = TOUCH_BUTTONS.map(({ bit }) => touchButtonRect(layout[bit], width, height));
    for (let i = 0; i < rects.length; i++) {
      const a = rects[i];
      assert.ok(a.size >= 48 && a.left >= 0 && a.top >= 0 && a.left + a.size <= width && a.top + a.size <= height);
      for (const b of rects.slice(i + 1)) assert.ok(a.left + a.size <= b.left || b.left + b.size <= a.left || a.top + a.size <= b.top || b.top + b.size <= a.top);
    }
    assert.ok(rects[2].left + rects[2].size < width / 2);
    assert.ok(rects[3].left > width / 2);
  }
});

test('가로·세로 터치 배치를 따로 불러오고 저장소 실패는 기본 배치로 처리한다', () => {
  const saved = { portrait: { 1: { x: .2, y: .4, size: 64 } }, landscape: { 1: { x: .8, y: .1, size: 80 } }, junk: {} };
  const layouts = loadTouchLayouts({ getItem(key) { assert.equal(key, TOUCH_LAYOUT_KEY); return JSON.stringify(saved); } });
  assert.equal(layouts.portrait[1].size, 64);
  assert.equal(layouts.landscape[1].x, .8);
  assert.deepEqual(Object.keys(layouts), ['portrait', 'landscape']);
  assert.deepEqual(loadTouchLayouts({ getItem() { throw Error('blocked'); } }), {});
  assert.deepEqual(loadTouchLayouts({ getItem() { return '{'; } }), {});
});
