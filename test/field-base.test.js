import test from 'node:test';
import assert from 'node:assert/strict';
import { drawFieldBase } from '../src/view/field-base.js';
import { CELL, FIELD_BOTTOM, FIELD_WIDTH } from '../src/view/layout.js';

function record(offsets) {
  const calls=[];
  const ctx=new Proxy({}, {get:(target,key)=>(...args)=>calls.push([key,...args])});
  drawFieldBase(ctx,32,offsets);
  return calls;
}

test('정지한 받침은 여섯 장으로 나누지 않고 한 면으로 그린다',()=>{
  const offsets=Object.freeze([0,0,0,0,0,0]),calls=record(offsets);
  assert.equal(calls.filter(call=>call[0]==='clip').length,1);
  assert.ok(calls.some(call=>call[0]==='roundRect' && call[3]===FIELD_WIDTH));
  assert.ok(!calls.some(call=>call[0]==='fillRect'));
});
test('열별 변위는 유지하고 움직이는 조각도 같은 연속 표면을 쓴다',()=>{
  const offsets=Object.freeze([0,4,8,16,32,64]),calls=record(offsets);
  assert.deepEqual(calls.filter(call=>call[0]==='rect').map(call=>call.slice(1,5)),
    offsets.map((offset,c)=>[32+c*CELL,FIELD_BOTTOM+offset,CELL,17]));
  assert.ok(calls.filter(call=>call[0]==='roundRect' && call[3]===FIELD_WIDTH).every(call=>call[1]===32));
  assert.equal(calls.filter(call=>call[0]==='save').length,calls.filter(call=>call[0]==='restore').length);
});
