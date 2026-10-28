import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameStats } from '../src/net/frame-stats.js';
test('performance samples separate draw time from background simulation and count player input stalls',()=>{
  const stats=createFrameStats();
  assert.equal(stats.record(0,{render:true,simulation:2,drawing:3,waiting:false}),false);
  assert.equal(stats.record(500,{render:false,simulation:1,drawing:0,waiting:true}),false);
  assert.equal(stats.record(1000,{render:true,simulation:3,drawing:5,waiting:false}),true);
  assert.deepEqual(stats.current,{fps:2,simulation:2,drawing:4,peak:8,waiting:1});
  stats.record(2000,{render:true,simulation:1,drawing:1,waiting:false});assert.equal(stats.current.waiting,0);
});
