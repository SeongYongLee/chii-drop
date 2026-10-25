import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { compileTravel, travelAt } from '../src/view/character-travel.js';
import { loadImageSkin } from '../src/view/skins/image-skin.js';
import { FIELD_TOP, FIELD_WIDTH, FIELD_HEIGHT } from '../src/view/layout.js';

test('동선은 프레임 사이를 연속 이동하고 정지·종료·반복을 지킨다', () => {
  const points = [{ frame: 0, x: 0, y: 0 }, { frame: 10, x: .2, y: -.1 }, { frame: 20, x: 0, y: 0 }];
  const clip = { travel: compileTravel(points, 21), total: 21, loop: false, loopStart: 0 };
  assert.deepEqual(travelAt(clip, 5), { x: .1, y: -.05 });
  assert.deepEqual(travelAt(clip, 999), { x: 0, y: 0 });
  assert.deepEqual(travelAt(clip, -1), { x: 0, y: 0 });
  assert.deepEqual(travelAt(clip, 10, true), { x: 0, y: 0 });
  assert.deepEqual(travelAt({}, 10), { x: 0, y: 0 });
  for (let frame = 0; frame < 21; frame++) {
    assert.ok(Math.abs(travelAt(clip, frame + 1).x - travelAt(clip, frame).x) <= .0200001);
    assert.deepEqual(travelAt({ ...clip, loop: true }, frame + 21), travelAt(clip, frame));
  }
  assert.deepEqual(points, clip.travel);
  assert.notEqual(points, clip.travel);
});

test('잘못된 동선 메타데이터는 채택하지 않는다', () => {
  const first = { frame: 0, x: 0, y: 0 };
  for (const points of [[], [first], [first, first], [first, { frame: 10, x: NaN, y: 0 }],
    [first, { frame: 10, x: 2, y: 0 }], [first, { frame: 20, x: 0, y: 0 }],
    [{ frame: 1, x: 0, y: 0 }, { frame: 10, x: 0, y: 0 }]]) {
    assert.equal(compileTravel(points, 20), null);
  }
});

test('실행 팩의 달리기 연쇄는 독립 동작 컷·별 모양 동선·공통 대기 컷을 포함한다', () => {
  const root = new URL('../skins/chiikawa/pages-runtime/', import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root)));
  const actors = manifest.characters.filter(c => c.moods?.chain5?.travel);
  assert.ok(actors.length > 0);
  for (const actor of actors) for (const tier of [3, 5, 7]) {
    const clip = actor.moods[`chain${tier}`], total = clip.frames.reduce((sum, p) => sum + p.duration, 0);
    assert.ok(total <= 132);
    assert.ok(compileTravel(clip.travel, total));
    assert.ok(compileTravel(clip.fieldTravel, total));
    assert.ok(Math.min(...clip.fieldTravel.map(p => p.y)) <= -.4);
    assert.ok(Math.max(...clip.fieldTravel.map(p => p.y)) >= .5);
    const route = clip.fieldTravel.filter((p,i,list) => i===0 || p.x!==list[i-1].x || p.y!==list[i-1].y)
      .filter(p => p.x!==0 || p.y!==0).slice(0,6);
    assert.equal(new Set(route.slice(0,5).map(p => `${p.x}:${p.y}`)).size,5);
    assert.deepEqual([route[0].x,route[0].y],[route[5].x,route[5].y]);
    const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    let intersections = 0;
    for (let a=0;a<5;a++) for (let b=a+2;b<5;b++) {
      if (a===0 && b===4) continue;
      if (cross(route[a],route[a+1],route[b])*cross(route[a],route[a+1],route[b+1])<0 &&
          cross(route[b],route[b+1],route[a])*cross(route[b],route[b+1],route[a+1])<0) intersections++;
    }
    assert.equal(intersections,5,'오각형 테두리가 아니라 중앙을 가로지르는 오각별이다');
    assert.deepEqual(clip.frames[0].rect, actor.moods.idle.frames[0].rect);
    assert.equal(clip.frames[0].file, actor.moods.idle.file);
    assert.deepEqual(clip.frames.at(-1).rect, actor.moods.idle.frames[0].rect);
    assert.deepEqual(travelAt({ ...clip, total }, total), { x: 0, y: 0 });
    assert.ok(clip.travel.some(p => p.x >= .2) && clip.travel.some(p => p.x <= -.2));
    assert.ok(clip.frames.some(p => p.flipX));
    const poses = clip.frames.filter(p => !p.file);
    assert.ok(new Set(poses.map(p => JSON.stringify(p.rect))).size >= 6);
    const png = fs.readFileSync(new URL(clip.file, root));
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    for (const { rect: r, scale } of poses) {
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= width && r.y + r.height <= height);
      assert.ok(Number.isFinite(scale) && scale > 0);
      assert.ok(Math.abs(scale / Math.max(r.width, r.height) - poses[0].scale / Math.max(poses[0].rect.width, poses[0].rect.height)) < 1e-12);
    }
  }
});

test('필드 전용 상하 동선은 실제 크기의 귀·발까지 필드 안에 유지하고 정지 모드에서는 생략한다', async t => {
  const root = new URL('../skins/chiikawa/pages-runtime/', import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root)));
  const previousImage = globalThis.Image;
  globalThis.Image = class { set src(file) {
    const png = fs.readFileSync(file); this.width = png.readUInt32BE(16); this.height = png.readUInt32BE(20);
    queueMicrotask(() => this.onload());
  } };
  t.after(() => { globalThis.Image = previousImage; });
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => manifest }));
  const skin = await loadImageSkin(root.pathname);
  let matrix = [1, 1, 0, 0], box;
  const stack = [];
  const ctx = { save() { stack.push([...matrix]); }, restore() { matrix = stack.pop(); },
    translate(x,y) { matrix[2] += matrix[0]*x; matrix[3] += matrix[1]*y; },
    scale(x,y) { matrix[0] *= x; matrix[1] *= y; },
    drawImage(image,sx,sy,sw,sh,x,y,w,h) {
      const xs = [x*matrix[0]+matrix[2],(x+w)*matrix[0]+matrix[2]];
      box = { left: Math.min(...xs), right: Math.max(...xs), top: y*matrix[1]+matrix[3], bottom: (y+h)*matrix[1]+matrix[3] };
    } };
  const size = FIELD_WIDTH*.9, x = 32+(FIELD_WIDTH-size)/2, y = FIELD_TOP+(FIELD_HEIGHT-size)/2;
  for (const actor of manifest.characters.filter(c => c.moods?.chain5?.fieldTravel)) for (const tier of [3,5,7]) {
    const clip = actor.moods[`chain${tier}`], total = clip.frames.reduce((sum,p) => sum+p.duration,0);
    const heights = [];
    for (let frame=0;frame<total;frame++) {
      skin.drawCharacter(ctx,actor.id,'happy',x,y,size,{frame,chain:tier,presentation:'field',reducedMotion:false});
      assert.ok(box.left >= 32-1e-6 && box.right <= 32+FIELD_WIDTH+1e-6, `horizontal bounds: ${JSON.stringify(box)}`);
      assert.ok(box.top >= FIELD_TOP-1e-6 && box.bottom <= FIELD_TOP+FIELD_HEIGHT+1e-6, `vertical bounds: ${JSON.stringify(box)}`);
      heights.push((box.top+box.bottom)/2);
      assert.deepEqual(travelAt({ ...clip,total },frame,true,true),{x:0,y:0});
    }
    assert.ok(Math.max(...heights)-Math.min(...heights)>100);
    assert.equal(stack.length,0);
  }
});
