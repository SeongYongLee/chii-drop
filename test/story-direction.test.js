import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileDirections, poseAt, progress, storyBackground } from '../src/view/story-direction.js';
import { createDialogueScene } from '../src/app/dialogue-scene.js';
import { drawStoryArt } from '../src/view/story-art.js';
import { createKeyboard } from '../src/input/keyboard.js';
const script = { characters: { player: {name:'주역',charId:'round'}, companion:{name:'동행',charId:'pointy'},secretFinal:{name:'손님',charId:'host'} } };
test('엔딩 문턱은 전용 배경을 쓰고 식탁은 간식 수에 따라 같은 구도의 전후 배경을 고른다',()=>{
 assert.equal(storyBackground('threshold',{hostForm:'large'}),'threshold');
 assert.equal(storyBackground('reveal',{hostForm:'large'}),'inside');
 assert.equal(storyBackground('table',{phase:'prepare',snacks:0}),'tableEmpty');
 assert.equal(storyBackground('table',{phase:'prepare',snacks:5}),'table');
 assert.equal(storyBackground('table',{phase:'left',snacks:5}),'table');
 assert.equal(storyBackground('table',{snacks:0,background:'custom'}),'custom');
});
function harness() {
 const figures=[],text=[],calls=[];
 const ctx=new Proxy({globalAlpha:1,measureText:s=>({width:s.length*12}),fillText:s=>text.push(s)}, {get:(o,k)=>o[k]??((...args)=>calls.push([k,...args]))});
 const app={keyboard:createKeyboard(),settings:{voice:false},sfx:{enabled:false},skin:{drawBackground(){},drawCharacter:(_,id,mood)=>figures.push({id,mood,alpha:ctx.globalAlpha})}};
 return {ctx,app,figures,text,calls};
}
test('지문의 무언 반응과 큰 몸은 다음 줄에도 유지되고 새 시각 장면은 무대 상태를 초기화한다',()=>{
 const lines=[{text:'변신',visual:'reveal',stage:{hostForm:'large'},cast:{player:{mood:'sad',motion:'recoil'}}},{who:'companion',text:'기다려',mood:'idle'},{text:'사진',visual:'photo'}];
 const d=compileDirections(lines);
 assert.equal(d[1].cast.player.mood,'sad'); assert.equal(d[1].stage.hostForm,'large'); assert.equal(d[2].stage.hostForm,undefined);
 assert.equal(d[0].cast.companion,undefined); assert.equal(d[1].cast.companion.at,1);
 assert.deepEqual(lines[0].cast.player,{mood:'sad',motion:'recoil'});
});
test('표시 시간을 다시 그려도 진행하지 않고 느린 변신 중에도 Enter·Esc가 즉시 동작한다',()=>{
 const h=harness();let done=0;
 const scene=createDialogueScene({script,lines:[{text:'천천히 드러난다',visual:'reveal',stage:{phase:'unveil',hostForm:'large',pauseFrames:40,duration:120}},{text:'기다린다'}],onDone:()=>done++});
 scene.draw(h.ctx,h.app); const first=JSON.stringify(h.calls); h.calls.length=0;scene.draw(h.ctx,h.app);assert.equal(JSON.stringify(h.calls),first);
 h.app.keyboard.pressed.add('Enter');scene.update(h.app); h.text.length=0;scene.draw(h.ctx,h.app);assert.ok(h.text.includes('천천히 드러난다'));
 scene.update(h.app);h.app.keyboard.pressed=new Set(['Escape']);scene.update(h.app);assert.equal(done,1);
});
test('말하지 않는 주역도 지문 표정을 받고 중간 줄 미리보기에서 앞선 연출을 계승한다',()=>{
 const h=harness();const scene=createDialogueScene({script,startLine:1,lines:[{text:'움찔',cast:{player:{mood:'sad',motion:'recoil'}}},{who:'companion',text:'곁에 있어',mood:'idle'}],onDone(){}});
 scene.draw(h.ctx,h.app);assert.equal(h.figures.find(x=>x.id==='round').mood,'sad');
});
test('사진은 다섯 손님만 사라지고 옛 사진에 현재 주역을 재사용하지 않는다',()=>{
 const h=harness(),guests=['secret01','secret02','secret03','secret04','secretFinal'];
 drawStoryArt(h.ctx,h.app,script,'memory',guests,{fadeGuests:true,progress:0});assert.equal(h.figures.filter(x=>x.alpha>0).length,7);
 h.figures.length=0;drawStoryArt(h.ctx,h.app,script,'memory',guests,{fadeGuests:true,progress:1});assert.equal(h.figures.filter(x=>x.alpha>0).length,2);
 h.figures.length=0;drawStoryArt(h.ctx,h.app,script,'oldPhoto',guests);assert.equal(h.figures.length,0);
});
test('마지막 식탁에는 캐릭터가 다시 등장하지 않고 동작 줄이기에서는 최종 자세를 표시한다',()=>{
 const h=harness();drawStoryArt(h.ctx,h.app,script,'table',[],{phase:'left',snacks:5});assert.equal(h.figures.length,0);
 assert.equal(progress(0,120,true),1);assert.deepEqual(poseAt({motion:'hop'},10,true),{x:0,y:0,angle:0});assert.equal(poseAt({motion:'recoil'},0,true).x,-18);
});

test('제작 배경이 있으면 임시 식탁·방 도형과 중복 접시·컵을 그리지 않는다',()=>{
 const h=harness();h.app.skin.hasBackground=()=>true;
 drawStoryArt(h.ctx,h.app,script,'table',[],{phase:'left',snacks:5});
 assert.equal(h.calls.filter(c=>c[0]==='roundRect'||c[0]==='ellipse').length,0);
 h.calls.length=0;
 drawStoryArt(h.ctx,h.app,script,'inside',[],{phase:'gather'});
 assert.equal(h.calls.filter(c=>c[0]==='roundRect').length,0);
});

test('빈자리의 위쪽 자막은 다섯 접시가 있는 하단을 가리지 않는다',()=>{
 const h=harness();h.app.skin.hasBackground=()=>true;
 const scene=createDialogueScene({script,lines:[{text:'남아 있다',visual:'table',stage:{phase:'left',layout:'caption'}}],onDone(){}});
 scene.draw(h.ctx,h.app);
 const boxes=h.calls.filter(c=>c[0]==='roundRect');
 assert.ok(boxes.some(c=>c[2]===22&&c[4]===94));
 assert.ok(boxes.every(c=>c[2]<120));
});
