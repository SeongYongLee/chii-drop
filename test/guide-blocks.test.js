import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guideDemo, drawGuideBlocks, createGuideBlocks } from '../src/view/guide-blocks.js';
import { GARBAGE } from '../src/engine/field.js';

test('안내 예제는 실제 엔진으로 4개 소거·2연쇄·방해 착지를 재생한다',()=>{
  const connect=guideDemo('connect'),chain=guideDemo('chain'),attack=guideDemo('attack');
  assert.equal(connect.at(-1).players[0].maxChain,1);
  assert.equal(chain.at(-1).players[0].maxChain,2);
  assert.equal(chain.at(-1).players[0].board.cells.some(Boolean),false);
  assert.ok(chain.some(frame=>frame.players[0].phase==='chain-fall' && frame.players[0].board.offset.some(v=>v<0)));
  assert.ok(attack.some(frame=>frame.projectiles.length>0));
  const receiver=attack.at(-1).players[1];
  assert.equal(receiver.phase,'turn-start');
  assert.ok(receiver.board.cells.includes(GARBAGE));
  receiver.board.cells.forEach((color,i)=>{if(color===GARBAGE)assert.equal(receiver.board.offset[i],0);});
  assert.equal(guideDemo('connect'),connect,'고정 예제는 매 프레임 다시 시뮬레이션하지 않는다');
});
function context(){return new Proxy({},{get:(o,k)=>o[k]??(()=>{})});}
test('안내는 현재 스킨의 연결·소거 모양과 그림자 패스를 그대로 사용한다',()=>{
  const calls=[],skin={drawBlobShadowPass:true,drawBlob:(_ctx,color,x,y,size,style)=>calls.push({color,x,y,size,style:{...style}})};
  const frames=guideDemo('connect');
  const flash=frames.findIndex(frame=>frame.players[0].phase==='flash');
  drawGuideBlocks(context(),skin,'connect',(flash+40)*1000/60+.1);
  assert.ok(calls.some(call=>call.style.links>0));
  assert.ok(calls.some(call=>call.style.shadowOnly));
  calls.length=0;
  const pop=frames.findIndex(frame=>frame.players[0].phase==='pop');
  drawGuideBlocks(context(),skin,'connect',(pop+40)*1000/60+.1);
  assert.ok(calls.some(call=>call.style.shape?.startsWith('pop')));
  assert.doesNotThrow(()=>drawGuideBlocks(context(),undefined,'chain',0,true),'스킨이 없으면 기본 도형을 사용한다');
});
test('그림은 조작 탭·닫기·백그라운드에서 멈추고 동작 줄이기 설정을 반영한다',()=>{
  const doc=new EventTarget(),media=new EventTarget();media.matches=false;
  doc.createElement=()=>({getContext:()=>context(),setAttribute(){}});
  let pending=new Map(),id=0;
  const view={document:doc,matchMedia:()=>media,requestAnimationFrame:fn=>{pending.set(++id,fn);return id;},cancelAnimationFrame:key=>pending.delete(key)};
  const pictures=[{kind:'connect',element:{append(){}}}];
  const player=createGuideBlocks(view,{drawBlob(){}},pictures);
  player.show(true);assert.equal(pending.size,1);
  player.show(false);assert.equal(pending.size,0);
  player.show(true);media.matches=true;media.dispatchEvent(new Event('change'));assert.equal(pending.size,0);
  media.matches=false;media.dispatchEvent(new Event('change'));assert.equal(pending.size,1);
  doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(pending.size,0);
  doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(pending.size,1);
  player.dispose();assert.equal(pending.size,0);
  media.dispatchEvent(new Event('change'));assert.equal(pending.size,0);
});
test('처음 세 블록은 이미 이어져 있고 예고는 1연쇄보다 2연쇄에 많이 쌓인 뒤 떨어진다',()=>{
  const first=guideDemo('connect')[0];
  const row=first.effects[0].connections.bits.slice(-6);
  assert.equal(row[1]&2,2);assert.equal(row[2]&10,10);assert.equal(row[3]&8,8);
  const frames=guideDemo('attack');
  const few=frames.findIndex(frame=>frame.effects[1].warning.value===1);
  const many=frames.findIndex(frame=>frame.effects[1].warning.value===8);
  const fall=frames.findIndex(frame=>frame.players[1].board.cells.includes(GARBAGE));
  assert.ok(few>0 && many>few && fall>many+60);
  assert.equal(frames.at(-1).players[1].board.cells.filter(color=>color===GARBAGE).length,8);
  assert.equal(frames[few].effects[1].warning.value,1,'예전 프레임의 예고 값도 보존한다');
});
