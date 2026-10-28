import test from 'node:test';
import assert from 'node:assert/strict';
import {createTitleEntrance,titleArrival,TITLE_ENTRANCE_FRAMES} from '../src/input/title-entrance.js';

test('타이틀 캐릭터는 시차를 두고 한 번 내려와 산책 캐릭터에 겹쳐 이어진다',()=>{
 for(let i=0;i<3;i++) {
  assert.equal(titleArrival(0,i).progress,0);
  const depart=34+i*5,landed=depart+46;
  assert.equal(titleArrival(depart-1,i).phase,'title');
  assert.equal(titleArrival(depart,i).phase,'air');
  assert.equal(titleArrival(landed,i).phase,'land');
  assert.equal(titleArrival(landed+7,i).fade,0);
  assert.equal(titleArrival(landed+8,i).phase,'recover');
  assert.equal(titleArrival(landed+20,i).fade,0);
  assert.equal(titleArrival(TITLE_ENTRANCE_FRAMES,i).progress,1);
  assert.equal(titleArrival(TITLE_ENTRANCE_FRAMES,i).fade,1);
  let previous=0;
  for(let age=0;age<TITLE_ENTRANCE_FRAMES;age++) {const p=titleArrival(age,i);assert.ok(p.progress>=previous);previous=p.progress;assert.ok(p.fade>=0&&p.fade<=1);}
 }
 assert.ok(titleArrival(60,0).progress>titleArrival(60,1).progress);
 assert.ok(titleArrival(60,1).progress>titleArrival(60,2).progress);
});

test('타이틀 전환은 실제 메뉴 발 위치를 읽고 완료·크기 변경 시 투명도를 복원한다',t=>{
 const previous=globalThis.window;globalThis.window={matchMedia:()=>({matches:false})};t.after(()=>globalThis.window=previous);
 const style=()=>({removeProperty(key){delete this[key]}});
 const buttons=Array.from({length:3},(_,i)=>({style:style(),querySelector:()=>({getBoundingClientRect:()=>({left:100+i*200,bottom:700,width:104})})}));
 const controls={style:style()},view={innerWidth:960,innerHeight:800,devicePixelRatio:2};
 const calls=[],ctx=new Proxy({}, {get:(o,k)=>o[k]??((...args)=>calls.push([k,...args]))});
 let removed=0;
 const document={defaultView:view,body:{append(){}},getElementById:()=>controls,querySelectorAll:()=>buttons,
  createElement:()=>({style:{},setAttribute(){},getContext:()=>ctx,addEventListener(){},remove(){removed++}})};
 const parts=[];
 const box={x:.1,y:.1,width:.25,height:.6},skin={titleEntrance:{actors:[0,1,2].map(part=>({part,box,poses:{air:`${part}-air`,land:`${part}-land`,recover:`${part}-recover`,settle:`${part}-settle`}})),lettering:{part:3,box}},
  drawTitlePart:(_ctx,key,b)=>{parts.push(key);return b;},drawBackground(){}};
 const entrance=createTitleEntrance(document,{}),source={rect:{left:0,top:0,width:960,height:540},height:540,box:{x:100,y:48,width:760,height:360}};
 assert.equal(entrance.start(skin,source,0),true);
 assert.ok(buttons.every(b=>b.style.opacity==='0'));
 parts.length=0;entrance.draw(82);assert.deepEqual(parts,['0-land','1-air','2-air']);
 parts.length=0;entrance.draw(94);assert.deepEqual(parts,['0-settle','1-recover','2-land']);
 entrance.draw(112);assert.ok(Number(buttons[0].style.opacity)>Number(buttons[2].style.opacity));
 entrance.draw(TITLE_ENTRANCE_FRAMES);assert.equal(entrance.active,false);
 assert.ok(buttons.every(b=>b.style.opacity===undefined));assert.equal(controls.style.opacity,undefined);
 entrance.start(skin,source,200);view.innerWidth=800;entrance.draw(201);assert.equal(entrance.active,false);assert.equal(removed,2);
 globalThis.window.matchMedia=()=>({matches:true});assert.equal(entrance.start(skin,source,300),false);
 assert.equal(entrance.start({},source,300),false);
});
