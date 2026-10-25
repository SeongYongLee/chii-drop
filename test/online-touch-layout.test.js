import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitTouch } from '../src/net/touch-layout.js';

test('온라인 가로 패드는 작은 휴대폰과 최대 설정에서도 양손 영역이 겹치지 않는다', () => {
  for (const [width, height] of [[568, 276], [643, 276], [820, 366]]) {
    for (const setting of [{}, { size: 80, gap: 18, edge: 24, lift: 28 }]) {
      const layout = fitTouch(setting, width, height, true);
      assert.ok(layout.size >= 48);
      assert.ok(2 * layout.wing + 2 * layout.edge < width);
      assert.ok(layout.controlHeight <= height);
    }
  }
});

test('온라인 세로 패드도 좁은 화면에서 누를 수 있는 크기와 양손 간격을 유지한다', () => {
  for (const width of [296, 366, 406]) {
    const layout = fitTouch({ size: 80, gap: 18, edge: 24 }, width, 400, false);
    assert.ok(layout.size >= 48);
    assert.ok(layout.wing * 2 + layout.edge * 2 <= width);
  }
});
