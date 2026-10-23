import test from 'node:test';
import assert from 'node:assert/strict';
import { drawStoryForm } from '../src/view/story-art.js';

test('공개된 큰 모습도 대전의 감정·프레임과 정지 설정을 전용 스프라이트로 전달한다', () => {
  const calls=[];
  const skin={characterRoster:[{id:'form-1'}],drawCharacter:(...args)=>calls.push(args)};
  const ctx={};
  for (const mood of ['idle','happy','win','lose','trailing']) {
    drawStoryForm(ctx,{charId:'form-1'},10,20,200,false,skin,{mood,frame:47,reducedMotion:true});
    const [target,id,actualMood,x,y,size,motion]=calls.at(-1);
    assert.equal(target,ctx);assert.equal(id,'form-1');assert.equal(actualMood,mood);
    assert.deepEqual([x,y,size],[10,20,200]);assert.equal(motion.frame,47);assert.equal(motion.reducedMotion,true);
  }
});

test('문턱에서 손을 내미는 큰 모습은 전용 손짓의 정지 컷을 유지한다', () => {
  let call;
  const skin={characterRoster:[{id:'form-1'}],drawCharacter:(...args)=>{call=args}};
  drawStoryForm({}, {charId:'form-1'},0,0,200,true,skin,{frame:900});
  assert.equal(call[2],'fever');assert.equal(call[6].reducedMotion,true);
});

test('큰 모습의 이미지가 없는 기본 스킨에서는 기존 도형 표현을 유지한다', () => {
  let ovals=0, sprites=0;
  const ctx=new Proxy({ellipse(){ovals++}}, {get:(o,k)=>o[k]??(()=>{})});
  drawStoryForm(ctx,{charId:'unavailable'},0,0,200,false,{drawCharacter(){sprites++}});
  assert.ok(ovals>0);assert.equal(sprites,0);
});
