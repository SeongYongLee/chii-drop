import test from 'node:test';
import assert from 'node:assert/strict';
import {createMenuCompanions} from '../src/input/menu-companions.js';
import {createMenuCompanionCast} from '../src/app/menu-companions.js';

class Element extends EventTarget {
 constructor(tag){super();this.tag=tag;this.children=[];this.attrs={};this.dataset={};this.style={};this.ctx={setTransform(){},clearRect(){}};}
 append(child){this.children.push(child);}
 replaceChildren(){this.children=[];}
 setAttribute(k,v){this.attrs[k]=v;}
 getContext(){return this.ctx;}
}
test('하단 캐릭터 버튼은 애니메이션 중 재생성되지 않고 최신 반응을 실행하며 다른 화면에서 숨긴다',()=>{
 const root=new Element('div'),body=new Element('body'),doc={body,createElement:tag=>new Element(tag)};
 root.getBoundingClientRect=()=>({left:100,bottom:500,width:420});
 let unlocked=0,version=0;
 const painted=[],clicked=[];
 const component=createMenuCompanions(doc,root,()=>unlocked++);
 const entries=()=>['a','b','c'].map((id,i)=>({id,name:`배우 ${i}`,draw:()=>painted.push([id,version]),react:()=>clicked.push([id,version])}));
 component.sync(entries());
 const host=body.children[0],buttons=[...host.children];
 assert.equal(root.children.length,0,'캐릭터는 메뉴 카드 내부에 들어가지 않는다');
 assert.deepEqual(host.style,{left:'16px',top:'508px',width:'388px'});
 assert.equal(host.attrs.role,'group');assert.equal(buttons.length,3);
 assert.equal(buttons[0].children[0].width,224);
 assert.equal(buttons[0].children[0].height,272,'위쪽 여백은 캔버스를 늘려 확보하며 캐릭터 가로 크기는 유지한다');
 assert.equal(buttons[1].attrs['aria-label'],'배우 1 반응 보기');
 version=1;component.sync(entries());
 assert.deepEqual(host.children,buttons,'프레임마다 버튼을 교체해 포커스를 잃지 않는다');
 buttons[1].dispatchEvent(new Event('click'));
 assert.deepEqual(clicked,[['b',1]]);assert.equal(unlocked,1);
 assert.equal(painted.length,6);
 component.sync([]);assert.equal(host.hidden,true);assert.equal(body.dataset.menuCompanions,'false');
 component.sync(entries());assert.equal(host.hidden,false);assert.equal(host.children[1],buttons[1]);
 doc.documentElement={clientWidth:1280};component.sync(entries());
 assert.equal(host.style.width,'1248px','큰 화면에서도 배경의 좌우 끝까지 이동할 수 있다');
 assert.equal(host.style.left,'16px');
});

test('메뉴와 온라인 앵커 높이가 바뀌어도 캐릭터는 하단 안내 위 같은 위치를 유지한다',()=>{
 const root=new Element('div'),body=new Element('body'),footer=new Element('footer');
 let bottom=400;
 root.getBoundingClientRect=()=>({left:20,bottom,width:320});
 footer.getBoundingClientRect=()=>({top:600});
 const doc={body,documentElement:{clientWidth:360},getElementById:()=>footer,createElement:tag=>new Element(tag)};
 const component=createMenuCompanions(doc,root,()=>{});
 const entries=[{id:'a',name:'배우',draw(){}}];
 component.sync(entries);const host=body.children[0],placement={...host.style};
 assert.equal(host.style.top,'484px');
 bottom=590;component.sync(entries);assert.deepEqual(host.style,placement);
 component.sync(entries,{getBoundingClientRect:()=>({left:0,bottom:620,width:360})});
 assert.deepEqual(host.style,placement,'온라인 메뉴도 같은 안내 기준을 사용한다');
});

test('메인 메뉴의 세 캐릭터는 각자 대기·기쁨 시간을 유지하고 72프레임 뒤 대기로 돌아간다',t=>{
 const previous=globalThis.window;globalThis.window={matchMedia:()=>({matches:false})};
 t.after(()=>{globalThis.window=previous});
 const calls=[];
 const app={animationFrame:100,sfx:{enabled:false},skin:{characters:['a','b','c','d'].map(id=>({id,name:id})),
  drawCharacter:(_ctx,id,mood,_x,_y,_size,motion)=>calls.push({id,mood,frame:motion.frame,instance:motion.instance})}};
 const cast=createMenuCompanionCast();let entries=cast.entries(app);
 assert.equal(entries.length,3);entries.forEach(e=>e.draw({},112));
 assert.deepEqual(calls.map(c=>c.mood),['idle','idle','idle']);
 entries[0].react();app.animationFrame=120;
 entries=cast.entries(app);calls.length=0;entries.forEach(e=>e.draw({},112));
 assert.deepEqual(calls.map(c=>c.mood),['happy','idle','idle']);assert.equal(calls[0].frame,20);
 entries[0].react();entries[1].react();app.animationFrame=172;
 entries=cast.entries(app);calls.length=0;entries.forEach(e=>e.draw({},112));
 assert.deepEqual(calls.map(c=>c.mood),['idle','happy','idle'],'연타는 연장하지 않고 캐릭터별 시간은 독립이다');
 assert.equal(new Set(calls.map(c=>c.instance)).size,3);
 const before=entries.map(e=>e.position);
 app.scene={touchLayout:'list-menu'};app.animationFrame=173;
 const after=cast.entries(app).map(e=>e.position);
 assert.ok(Math.abs(after[0]-before[0])<.01,'새 메뉴 장면에서 출발점으로 돌아가지 않는다');
});

test('걷기는 짧은 구간에만 나오고 휴식 행동 중에는 제자리를 유지한다',t=>{
 const previous=globalThis.window;globalThis.window={matchMedia:()=>({matches:false})};
 t.after(()=>{globalThis.window=previous});
 let mood;
 const app={menuFrame:0,sfx:{enabled:false},skin:{characters:[{id:'a',name:'배우'}],drawCharacter:(_ctx,_id,m)=>{mood=m;}}};
 const cast=createMenuCompanionCast();let lastX,walking=0,turned=false;const actions=new Set();
 for(let frame=0;frame<18000;frame++){
  app.menuFrame=frame;let entries=cast.entries(app);entries=cast.entries(app);
  const e=entries[0];e.draw({},112);
  assert.ok(e.position>=0&&e.position<=1);
  if(mood==='walk')walking++;
  if(mood.startsWith('menuRest')){actions.add(mood);assert.equal(e.position,lastX,'휴식 행동에는 이동을 섞지 않는다');}
  if(e.facing<0)turned=true;
  lastX=e.position;
 }
 assert.ok(walking/18000>.1&&walking/18000<.28,`걷기 비율: ${walking/18000}`);
 assert.deepEqual([...actions].sort(),['menuRest1','menuRest2']);assert.equal(turned,true);
});

test('걷다가 클릭하면 잠깐 멈춰 반응한 뒤 같은 위치에서 걷기를 재개한다',t=>{
 const previous=globalThis.window;globalThis.window={matchMedia:()=>({matches:false})};
 t.after(()=>{globalThis.window=previous});
 const app={menuFrame:0,sfx:{enabled:false},skin:{characters:[{id:'a',name:'배우'}],drawCharacter(){}}};
 const cast=createMenuCompanionCast();let entry;
 for(let frame=0;frame<=500;frame++){app.menuFrame=frame;entry=cast.entries(app)[0];}
 entry.react();const x=entry.position;
 for(let i=0;i<70;i++){app.menuFrame++;assert.equal(cast.entries(app)[0].position,x);}
 app.menuFrame+=3;assert.notEqual(cast.entries(app)[0].position,x);
});

test('빠른 왕복은 다른 캐릭터 때문에 중간에 끊기지 않고 양쪽 끝을 방문한다',t=>{
 const previous=globalThis.window;globalThis.window={matchMedia:()=>({matches:false})};
 t.after(()=>{globalThis.window=previous});
 const app={menuFrame:0,sfx:{enabled:false},skin:{characters:[{id:'a'},{id:'b'},{id:'c',menuCompanion:{dash:true}}],drawCharacter(){}}};
 const cast=createMenuCompanionCast();let reachedLeft=false,reachedRight=false,fastest=0,last=.85;
 let crossings=0,wasMoving=false;
 for(let frame=0;frame<1600;frame++){
  app.menuFrame=frame;const actor=cast.entries(app)[2];
  if(actor.depth===1){
   fastest=Math.max(fastest,Math.abs(actor.position-last));
   if(actor.position===1)reachedRight=true;
   wasMoving=true;
  }else if(wasMoving){
   if(actor.position===0)reachedLeft=true;
   crossings++;wasMoving=false;
  }
  last=actor.position;
 }
 assert.ok(reachedLeft&&reachedRight,'대상 캐릭터는 양쪽 끝에 도착해야 한다');
 assert.ok(fastest>.01,'일반 걸음보다 확실히 빠르다');assert.ok(crossings>=1);
});

test('타이틀에서 내려오는 동안 산책·휴식 행동이 먼저 시작되지 않고 정면 대기로 기다린다',t=>{
 const previous=globalThis.window;globalThis.window={matchMedia:()=>({matches:false})};t.after(()=>globalThis.window=previous);
 const calls=[],app={menuFrame:0,menuEntranceActive:true,sfx:{enabled:false},skin:{characters:[{id:'a'},{id:'b'},{id:'c'}],
  drawCharacter:(_ctx,id,mood,_x,_y,_size,motion)=>calls.push({id,mood,still:motion.reducedMotion})}};
 const cast=createMenuCompanionCast();let positions;
 for(let frame=0;frame<140;frame++){
  app.menuFrame=frame;const entries=cast.entries(app);positions??=entries.map(e=>e.position);
  assert.deepEqual(entries.map(e=>e.position),positions);assert.ok(entries.every(e=>e.facing===1));
  entries.forEach(e=>e.draw({},112));
 }
 assert.ok(calls.every(c=>c.mood==='idle'&&c.still));
 app.menuEntranceActive=false;app.menuFrame=140;calls.length=0;cast.entries(app).forEach(e=>e.draw({},112));
 assert.ok(calls.every(c=>c.mood==='idle'),'착지 직후 다른 휴식 소품이나 걷기로 바뀌지 않는다');
});
