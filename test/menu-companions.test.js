import test from 'node:test';
import assert from 'node:assert/strict';
import {createMenuCompanions} from '../src/input/menu-companions.js';
import {createMainMenu,createListMenu} from '../src/app/menu-scenes.js';

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
 assert.deepEqual(host.style,{left:'130px',top:'508px',width:'360px'});
 assert.equal(host.attrs.role,'group');assert.equal(buttons.length,3);
 assert.equal(buttons[1].attrs['aria-label'],'배우 1 반응 보기');
 version=1;component.sync(entries());
 assert.deepEqual(host.children,buttons,'프레임마다 버튼을 교체해 포커스를 잃지 않는다');
 buttons[1].dispatchEvent(new Event('click'));
 assert.deepEqual(clicked,[['b',1]]);assert.equal(unlocked,1);
 assert.equal(painted.length,6);
 component.sync([]);assert.equal(host.hidden,true);assert.equal(body.dataset.menuCompanions,'false');
 component.sync(entries());assert.equal(host.hidden,false);assert.equal(host.children[1],buttons[1]);
});

test('메인 메뉴의 세 캐릭터는 각자 대기·기쁨 시간을 유지하고 72프레임 뒤 대기로 돌아간다',t=>{
 const previous=globalThis.window;globalThis.window={matchMedia:()=>({matches:false})};
 t.after(()=>{globalThis.window=previous});
 const calls=[];
 const app={animationFrame:100,sfx:{enabled:false},skin:{characters:['a','b','c','d'].map(id=>({id,name:id})),
  drawCharacter:(_ctx,id,mood,_x,_y,_size,motion)=>calls.push({id,mood,frame:motion.frame,instance:motion.instance})}};
 const scene=createMainMenu();let entries=scene.menuCompanions(app);
 assert.equal(entries.length,3);entries.forEach(e=>e.draw({},112));
 assert.deepEqual(calls.map(c=>c.mood),['idle','idle','idle']);
 entries[0].react();app.animationFrame=120;
 entries=scene.menuCompanions(app);calls.length=0;entries.forEach(e=>e.draw({},112));
 assert.deepEqual(calls.map(c=>c.mood),['happy','idle','idle']);assert.equal(calls[0].frame,20);
 entries[0].react();entries[1].react();app.animationFrame=172;
 entries=scene.menuCompanions(app);calls.length=0;entries.forEach(e=>e.draw({},112));
 assert.deepEqual(calls.map(c=>c.mood),['idle','happy','idle'],'연타는 연장하지 않고 캐릭터별 시간은 독립이다');
 assert.equal(new Set(calls.map(c=>c.instance)).size,3);
 assert.equal(createListMenu({title:'다른 메뉴',items:()=>[]}).menuCompanions,undefined);
});
