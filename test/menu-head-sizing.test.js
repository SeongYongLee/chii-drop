import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadImageSkin} from '../src/view/skins/image-skin.js';
import {COMPANION_HEADROOM,COMPANION_SPRITE_SIZE} from '../src/input/menu-companions.js';

test('메뉴 보행·공책 동작은 측정한 얼굴 폭이 같고 발 기준점도 유지된다',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../skins/chiikawa/pages-runtime/manifest.json',import.meta.url)));
 const actor=manifest.characters[0],idle=actor.moods.idle.frames[0];
 const pixel=f=>f.scale/Math.max(f.rect.width,f.rect.height);
 // Independent read-only measurements of the existing generated PNGs, in source pixels.
 const referenceWidth=258*pixel(idle);
 const widths={walk:[213.71428571428572,209,207,209,211,206],menuRest1:[258,201,205,204,202,203,205,258]};
 const foot=1+pixel(idle)*(idle.offsetY-2);
 for(const [mood,measured] of Object.entries(widths)){
  const frames=actor.moods[mood].frames;assert.equal(frames.length,measured.length);
  frames.forEach((f,i)=>{
   assert.ok(Math.abs(measured[i]*pixel(f)-referenceWidth)<1e-8,`${mood} cut ${i}: visible head size changed`);
   assert.ok(Math.abs(1+pixel(f)*(f.offsetY-2)-foot)<1e-8,`${mood} cut ${i}: foot anchor changed`);
  });
 }
});

test('메뉴의 모든 대기·걷기·휴식·반응 컷은 귀가 캔버스 안에 있고 발 위치를 유지한다',async t=>{
 const root=new URL('../skins/chiikawa/pages-runtime/',import.meta.url);
 const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',root)));
 const previous=globalThis.Image;
 globalThis.Image=class{set src(file){const bytes=fs.readFileSync(file);this.width=bytes.readUInt32BE(16);this.height=bytes.readUInt32BE(20);queueMicrotask(()=>this.onload())}};
 t.after(()=>{globalThis.Image=previous});
 t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>manifest}));
 const skin=await loadImageSkin(root.pathname);let call,minY=Infinity;
 const ctx={drawImage:(...args)=>{call=args},save(){},restore(){},translate(){},scale(){}};
 for(const actor of manifest.characters.slice(0,3))for(const mood of ['idle','walk','menuRest1','menuRest2','happy']){
  const total=actor.moods[mood].frames.reduce((n,f)=>n+f.duration,0);
  for(let frame=0;frame<total;frame++){
   skin.drawCharacter(ctx,actor.id,mood,4,4,COMPANION_SPRITE_SIZE-8,{frame,presentation:'selection',reducedMotion:false});
   const y=call[6],height=call[8];minY=Math.min(minY,y);
   assert.ok(y+COMPANION_HEADROOM>=2,`${actor.id} ${mood} frame ${frame}: ears clipped`);
   assert.ok(y+height+COMPANION_HEADROOM<=COMPANION_SPRITE_SIZE+COMPANION_HEADROOM,`${mood}: feet clipped`);
   const oldFootGap=COMPANION_SPRITE_SIZE-y-height;
   const newFootGap=COMPANION_SPRITE_SIZE+COMPANION_HEADROOM-(y+COMPANION_HEADROOM)-height;
   assert.ok(Math.abs(oldFootGap-newFootGap)<1e-10,'여백 추가가 발 기준점을 바꾸면 안 된다');
  }
 }
 assert.ok(minY<0,'기존 정사각형 캔버스에서 잘리던 컷을 실제로 검사해야 한다');
});
