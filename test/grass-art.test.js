import test from 'node:test';
import assert from 'node:assert/strict';
import { drawGrassGarbage, drawGrassWarning, GRASS_COLOR } from '../src/view/skins/grass.js';
import { softBlobColor } from '../src/view/skins/soft-blobs.js';
import { blobColor } from '../src/view/skins/blobs.js';
import { GARBAGE } from '../src/engine/field.js';

function recorder(){
 const calls=[];
 const ctx=new Proxy({}, {get:(target,key)=>key in target?target[key]:(...args)=>{
  for(const n of args)if(typeof n==='number')assert.ok(Number.isFinite(n),`${key}: ${n}`);
  calls.push([key,...args]);
 }});
 return {ctx,calls};
}
test('잡초는 20·32px와 뽑힘 단계에서 안정적으로 그려지고 기존 축소율을 따른다',t=>{
 t.mock.method(Math,'random',()=>{throw Error('random in grass drawing')});
 for(const size of [20,32])for(const [stage,scale]of [['normal',1],['gpop0',.85],['gpop1',.6],['gpop2',.35]]){
  const a=recorder(),b=recorder();
  drawGrassGarbage(a.ctx,4,8,size,stage);drawGrassGarbage(b.ctx,4,8,size,stage);
  assert.deepEqual(a.calls,b.calls);
  assert.deepEqual(a.calls.find(c=>c[0]==='scale'),['scale',size*scale/32,size*scale/32]);
  assert.equal(a.calls.filter(c=>c[0]==='save').length,a.calls.filter(c=>c[0]==='restore').length);
 }
});
test('네 가지 큰 예고는 각기 다른 운반 형태이며 반복 그리기가 같고 상태를 누수하지 않는다',()=>{
 const signatures=[];
 for(const unit of [30,200,300,400]){
  const a=recorder(),b=recorder();drawGrassWarning(a.ctx,unit,0,0);drawGrassWarning(b.ctx,unit,0,0);
  assert.deepEqual(a.calls,b.calls);
  assert.equal(a.calls.filter(c=>c[0]==='save').length,a.calls.filter(c=>c[0]==='restore').length);
  signatures.push(JSON.stringify(a.calls));
 }
 assert.equal(new Set(signatures).size,4);
 assert.equal(softBlobColor(GARBAGE),GRASS_COLOR);
 assert.equal(blobColor(GARBAGE),GRASS_COLOR);
 assert.notEqual(softBlobColor(4),GRASS_COLOR);
});
