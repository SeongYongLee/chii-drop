import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { loadImageSkin } from '../src/view/skins/image-skin.js';
import { FIELD_TOP, FIELD_WIDTH, FIELD_HEIGHT } from '../src/view/layout.js';

test('연결을 교정한 동작은 여섯 중간 컷을 한 번씩 쓰고 이전 자세를 반복하지 않는다', () => {
  const root = new URL('../skins/chiikawa/pages-runtime/',import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json',root)));
  const clips = manifest.characters.flatMap(c => Object.values(c.moods).filter(clip => clip.continuousAction));
  assert.equal(clips.length,28);
  assert.equal(clips.filter(clip => clip.motionCycle).length,1);
  for (const clip of clips) {
    const action = clip.frames.filter(p => !p.file);
    assert.ok(action.length>=6);
    if (!clip.motionCycle) assert.equal(new Set(action.map(p => JSON.stringify(p.rect))).size,action.length);
    assert.equal(clip.loop,false);
    assert.ok(clip.frames[0].file && clip.frames.at(-1).file);
    assert.ok(action.at(-1).duration>=action[0].duration);
  }
});

test('필드 연출 캐릭터는 일곱 연쇄마다 다른 원본 동작 컷을 사용한다', () => {
  const root = new URL('../skins/chiikawa/pages-runtime/',import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json',root)));
  const actors = manifest.characters.filter(c => c.fieldChainReaction);
  assert.equal(actors.length,4);
  for (const actor of actors) {
    const used = new Set();
    for (let tier=1;tier<=7;tier++) {
      const clip = actor.moods[`chain${tier}`];
      const poses = new Set(clip.frames.filter(p => !p.file).map(p => `${clip.file}:${JSON.stringify(p.rect)}`));
      assert.ok(poses.size>=6,`level ${tier} needs changing poses`);
      for (const pose of poses) assert.ok(!used.has(pose),`level ${tier} must not repeat another level's action`);
      for (const pose of poses) used.add(pose);
      assert.equal(clip.frames[0].file,actor.moods.idle.file);
      assert.deepEqual(clip.frames[0].rect,actor.moods.idle.frames[0].rect);
      assert.deepEqual(clip.frames.at(-1).rect,actor.moods.idle.frames[0].rect);
      assert.equal(clip.loop,false);
      assert.ok(clip.frames.reduce((sum,p) => sum+p.duration,0)<=132);
    }
    assert.ok(used.size>=42);
  }
});

test('참조 동작 연쇄 시트는 공통 대기 컷으로 시작·종료하고 각 연쇄 단계의 다른 컷을 재생한다', async t => {
  const root = new URL('../skins/chiikawa/pages-runtime/',import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json',root)));
  const actors = manifest.characters.filter(c => c.fieldChainReaction && !c.moods.chain7.travel && c.moods.chain5.file!==c.moods.idle.file);
  assert.equal(actors.length,3);
  const previousImage = globalThis.Image;
  globalThis.Image = class { set src(file) {
    this.srcFile = file;
    const png = fs.readFileSync(file); this.width = png.readUInt32BE(16); this.height = png.readUInt32BE(20);
    queueMicrotask(() => this.onload());
  } };
  t.after(() => { globalThis.Image = previousImage; });
  t.mock.method(globalThis,'fetch',async () => ({ok:true,json:async () => manifest}));
  const skin = await loadImageSkin(root.pathname);
  let call;
  const ctx = {drawImage:(...args) => {call=args;}};
  const size = FIELD_WIDTH*.9, x = 32+(FIELD_WIDTH-size)/2, y = FIELD_TOP+(FIELD_HEIGHT-size)/2;
  const draw = (id,mood,frame,extra={}) => {
    skin.drawCharacter(ctx,id,mood,x,y,size,{frame,presentation:'field',reducedMotion:false,...extra});
    return call;
  };
  for (const actor of actors) {
    assert.equal(new Set(Array.from({length:7},(_,i) => JSON.stringify(actor.moods[`chain${i+1}`]))).size,7);
    const neutral = draw(actor.id,'idle',0,{reducedMotion:true});
    const sequences = new Set();
    for (const tier of [1,2,3,4,5,6,7]) {
      const clip = actor.moods[`chain${tier}`], total = clip.frames.reduce((sum,p) => sum+p.duration,0);
      assert.ok(total<=132);
      assert.equal(clip.loop,false);
      assert.deepEqual(draw(actor.id,`chain${tier}`,0),neutral);
      assert.deepEqual(draw(actor.id,`chain${tier}`,total+1),neutral);
      const newCuts = clip.frames.filter(p => !p.file);
      assert.ok(new Set(newCuts.map(p => JSON.stringify(p.rect))).size>=2);
      sequences.add(JSON.stringify(clip.frames));
      for (let frame=0;frame<total;frame++) {
        const [image,sx,sy,sw,sh,dx,dy,dw,dh] = draw(actor.id,'happy',frame,{chain:tier});
        const happy = call;
        assert.ok(sx>=0 && sy>=0 && sx+sw<=image.width && sy+sh<=image.height);
        assert.ok(dx>=32 && dx+dw<=32+FIELD_WIDTH,`${actor.id} tier ${tier} frame ${frame}: ${dx}..${dx+dw}`);
        assert.ok(dy>=FIELD_TOP && dy+dh<=FIELD_TOP+FIELD_HEIGHT,`${actor.id} tier ${tier} frame ${frame}: ${dy}..${dy+dh}`);
        assert.deepEqual(draw(actor.id,`chain${tier}`,frame),happy);
        if (clip.bodyProportionStable) {
          assert.ok(dh>=neutral[8]*.94 && dh<=neutral[8]*1.14,
            `standing gesture must retain neutral body height: ${dh} vs ${neutral[8]}`);
        }
      }
      const ratio = p => p.scale/Math.max(p.rect.width,p.rect.height);
      for (const cut of newCuts) assert.ok(Math.abs(ratio(cut)-ratio(newCuts[0]))<1e-12);
      const posterTime = clip.frames.slice(0,clip.poster).reduce((sum,p) => sum+p.duration,0);
      const poster = draw(actor.id,`chain${tier}`,posterTime,{reducedMotion:true});
      assert.deepEqual(draw(actor.id,`chain${tier}`,999,{reducedMotion:true}),poster);
    }
    assert.equal(sequences.size,7);
  }
});
