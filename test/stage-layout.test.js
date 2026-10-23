import test from 'node:test';
import assert from 'node:assert/strict';
import { fitStage } from '../src/net/stage-layout.js';

test('game stage fits portrait, desktop and short landscape areas without cropping', () => {
  for (const [width, height] of [[304, 280], [374, 510], [1104, 480], [620, 210]]) {
    for (const focused of [false, true]) {
      const size = fitStage(width, height, focused);
      assert.ok(size.width <= width && size.height <= height);
      assert.ok(Math.abs(size.width / size.height - (focused ? 8 / 9 : 16 / 9)) < 1e-10);
      assert.ok(Math.abs(size.width - width) < 1e-10 || Math.abs(size.height - height) < 1e-10);
    }
  }
});
test('hidden or invalid stage area has no size', () => {
  for (const [w, h] of [[0, 500], [500, 0], [-1, 100], [NaN, 100]]) assert.deepEqual(fitStage(w, h), {width: 0, height: 0});
});
test('portrait stage uses the available height while focused and landscape views retain their ratios',()=>{
  assert.deepEqual(fitStage(370,530,false,true),{width:370,height:530});
  assert.deepEqual(fitStage(370,530,true,true),fitStage(370,530,true));
});
