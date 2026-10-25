import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { loadImageSkin } from '../src/view/skins/image-skin.js';
import { FIELD_TOP, FIELD_WIDTH, FIELD_HEIGHT } from '../src/view/layout.js';

test('참조 동작 연쇄 시트는 공통 대기 컷으로 시작·종료하고 세 단계의 다른 컷을 재생한다', async t => {
  const root = new URL('../skins/chiikawa/pages-runtime/',import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json',root)));
  const actors = manifest.characters.filter(c => c.fieldChainReaction && !c.moods.chain5.travel && c.moods.chain5.file!==c.moods.idle.file);
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
    const neutral = draw(actor.id,'idle',0,{reducedMotion:true});
    const sequences = new Set();
    for (const tier of [3,5,7]) {
      const clip = actor.moods[`chain${tier}`], total = clip.frames.reduce((sum,p) => sum+p.duration,0);
      assert.ok(total<=132);
      assert.equal(clip.loop,false);
      assert.deepEqual(draw(actor.id,`chain${tier}`,0),neutral);
      assert.deepEqual(draw(actor.id,`chain${tier}`,total+1),neutral);
      const newCuts = clip.frames.filter(p => !p.file);
      assert.ok(new Set(newCuts.map(p => JSON.stringify(p.rect))).size>=5);
      sequences.add(JSON.stringify(clip.frames));
      for (let frame=0;frame<total;frame++) {
        const [image,sx,sy,sw,sh,dx,dy,dw,dh] = draw(actor.id,'happy',frame,{chain:tier});
        const happy = call;
        assert.ok(sx>=0 && sy>=0 && sx+sw<=image.width && sy+sh<=image.height);
        assert.ok(dx>=32 && dx+dw<=32+FIELD_WIDTH);
        assert.ok(dy>=FIELD_TOP && dy+dh<=FIELD_TOP+FIELD_HEIGHT);
        assert.deepEqual(draw(actor.id,`chain${tier}`,frame),happy);
      }
      const ratio = p => p.scale/Math.max(p.rect.width,p.rect.height);
      for (const cut of newCuts) assert.ok(Math.abs(ratio(cut)-ratio(newCuts[0]))<1e-12);
      const posterTime = clip.frames.slice(0,clip.poster).reduce((sum,p) => sum+p.duration,0);
      const poster = draw(actor.id,`chain${tier}`,posterTime);
      assert.deepEqual(draw(actor.id,`chain${tier}`,999,{reducedMotion:true}),poster);
    }
    assert.equal(sequences.size,3);
  }
});
