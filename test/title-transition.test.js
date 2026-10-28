import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTitleTransition, titleFlight } from '../src/input/title-transition.js';

const source={box:{x:0,y:0,width:960,height:480},width:960,height:480,
  interactions:[{charId:'a',bounds:{x:.1,y:.1,width:.3,height:.5}}]};
test('비행 시작 위치는 타이틀과 목적지 좌표·방향을 반영한다',()=>{
  const rect={left:100,top:50,width:480,height:240}, target={left:20,top:500,width:100,height:120};
  const right=titleFlight(source,rect,'a',target),left=titleFlight(source,rect,'a',target,-1);
  assert.equal(right.x,150);assert.equal(left.x,-150);
  assert.equal(right.scale,1.44);
  assert.ok(right.y<0);
  assert.equal(titleFlight(source,rect,'missing',target),null);
  assert.equal(titleFlight(source,rect,'a',{...target,width:0}),null);
});
function fixture(){
  const created=[],handles=[];
  class Element {
    constructor(tag){this.tag=tag;this.style={};this.dataset={};this.children=[];this.inert=false;created.push(this);}
    setAttribute(){} append(child){this.children.push(child);} remove(){this.removed=true;}
    getContext(){return {drawImage(){}};}
    getBoundingClientRect(){return {left:20,top:500,width:100,height:120};}
    animate(frames,options){let resolve;const finished=new Promise(r=>{resolve=r});const handle={finished,frames,options,resolve,cancel(){this.cancelled=true;resolve();}};handles.push(handle);return handle;}
  }
  const body=new Element('body'),menu=new Element('menu'),cast=new Element('cast'),sprite=new Element('sprite');
  cast.querySelectorAll=()=>[sprite];
  const document={body,createElement:tag=>new Element(tag),querySelector:()=>cast};
  const canvas=new Element('canvas');canvas.width=960;canvas.height=480;
  let completed=0;
  const transition=createTitleTransition({document,canvas,menu,onComplete:()=>completed++});
  return {transition,menu,cast,document,created,handles,get completed(){return completed;}};
}
test('착지까지 실제 캐릭터 캔버스를 사용하고 입력 잠금을 자동 해제한다',async()=>{
  const f=fixture(),prepared=f.transition.prepare(source);
  f.transition.start(prepared,[{id:'a',facing:1}]);
  assert.equal(f.transition.active,true);assert.equal(f.menu.inert,true);assert.equal(f.cast.inert,true);
  assert.equal(f.created.filter(e=>e.tag==='canvas').length,2,'추가 캐릭터 복제 없이 타이틀 잔상만 만든다');
  f.handles.forEach(a=>a.resolve());
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.transition.active,false);assert.equal(f.menu.inert,false);assert.equal(f.cast.inert,false);
  assert.equal(f.completed,1);assert.equal(f.document.body.dataset.titleTransition,undefined);
  f.transition.cancel();assert.equal(f.completed,1,'빈 취소는 이후 프레임 입력을 지우지 않는다');
});
test('회전·화면 이탈 취소 뒤 이전 완료 콜백이 새 전환을 종료하지 않는다',async()=>{
  const f=fixture();f.transition.start(f.transition.prepare(source),[{id:'a'}]);
  const first=[...f.handles];f.transition.cancel();
  f.transition.start(f.transition.prepare(source),[{id:'a'}]);
  first.forEach(a=>a.resolve());await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.transition.active,true);assert.equal(f.menu.inert,true);
  f.transition.cancel();assert.equal(f.menu.inert,false);
});
test('분리 위치나 브라우저 애니메이션 기능이 없으면 일반 메뉴 전환을 유지한다',()=>{
  const f=fixture();assert.equal(f.transition.prepare(undefined),null);
  f.menu.animate=undefined;assert.equal(f.transition.prepare(source),null);
  assert.equal(f.transition.active,false);
});
test('동작 줄이기 설정에서는 낙하 연출과 입력 잠금을 만들지 않는다',t=>{
  const prior=globalThis.matchMedia;
  globalThis.matchMedia=()=>({matches:true});
  t.after(()=>{if(prior===undefined)delete globalThis.matchMedia;else globalThis.matchMedia=prior;});
  const f=fixture();assert.equal(f.transition.prepare(source),null);
  assert.equal(f.menu.inert,false);assert.equal(f.transition.active,false);
});
