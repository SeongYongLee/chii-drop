import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SCREEN_HEIGHT, SCREEN_WIDTH, setupScreen } from '../src/app/screen.js';
import { portraitGameLayout } from '../src/view/layout.js';

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

test('세로 경기 화면은 실제 높이를 쓰고 회전 후 기존 가로 좌표로 돌아간다', () => {
  let resize, portrait=true;
  const ctx={setTransform(){}};
  const view={devicePixelRatio:2, getComputedStyle:()=>({getPropertyValue:()=>portrait?'1':''}),
    addEventListener:(name,fn)=>{resize=fn}};
  const canvas={clientWidth:370,clientHeight:640,ownerDocument:{defaultView:view},getContext:()=>ctx};
  setupScreen(canvas);
  assert.equal(canvas.width,740);assert.equal(canvas.height,1280);
  assert.equal(ctx.screenHeight,960*640/370);
  portrait=false;canvas.clientWidth=740;canvas.clientHeight=416.25;resize();
  assert.equal(ctx.screenHeight,540);assert.equal(canvas.width,1480);assert.equal(canvas.height,833);
});

test('320~430px 세로 경기의 필드는 6:12 비율을 유지하고 HUD와 조작 영역을 침범하지 않는다',()=>{
  for(const [width,height] of [[320,568],[375,667],[390,844],[430,932]])for(const count of [1,2]){
    const stageHeight=height-16-180-8;
    const logicalHeight=960*stageHeight/(width-20);
    const boxes=portraitGameLayout(logicalHeight,count);
    for(const box of boxes){
      assert.ok(box.x>=0&&box.x+box.width<=960);
      assert.ok(box.y-32*box.scale>=350-1e-9);
      assert.ok(box.y+(384+16)*box.scale<=logicalHeight+1e-9);
      assert.ok(Math.abs(box.width/(384*box.scale)-.5)<1e-10);
    }
    if(count===2)assert.ok(boxes[0].x+boxes[0].width<boxes[1].x);
  }
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
