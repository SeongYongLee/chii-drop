import test from 'node:test';
import assert from 'node:assert/strict';
import { createTitleScene, createMainMenu, createSinglePlayerMenu, createMultiplayerMenu } from '../src/app/menu-scenes.js';
import { createGameScene } from '../src/app/game-scene.js';
import { createKeyboard } from '../src/input/keyboard.js';
import { MOCK_SKIN } from './fixtures/presentation.js';
import { CPU_LEVELS } from '../src/cpu/cpu.js';
import { drawPortraitSurface } from '../src/view/portrait-ui.js';

test('공용 스킨 배경이 있으면 세로 캔버스를 투명하게 두고 기본 스킨은 종이 바탕을 유지한다',()=>{
  const calls=[];
  const ctx=new Proxy({screenHeight:1400,pageBackdrop:true,clearRect:(...args)=>calls.push(['clear',...args]),
    fillRect:(...args)=>calls.push(['fill',...args])},{get:(o,k)=>o[k]??(()=>{})});
  drawPortraitSurface(ctx);assert.deepEqual(calls,[['clear',0,0,960,1400]]);
  calls.length=0;ctx.pageBackdrop=false;drawPortraitSurface(ctx);
  assert.deepEqual(calls[0],['fill',0,0,960,1400]);
});

test('세로 공용 배경 설정이 남아 있어도 가로 경기는 기존 캔버스 배경을 그린다',()=>{
  const h=harness(),scenes=[];
  h.ctx.portraitScreen=false;h.ctx.pageBackdrop=true;h.ctx.screenHeight=540;
  h.app.skin.drawBackground=(_ctx,_width,_height,scene)=>scenes.push(scene);
  const scene=createGameScene({mode:'solo',characters:MOCK_SKIN.characters.slice(0,1)});
  scene.draw(h.ctx,h.app);h.check();
  assert.deepEqual(scenes,['game']);
});

function harness(height=1300){
  let depth=0;const text=[],characters=[];
  const ctx=new Proxy({portraitScreen:true,screenHeight:height,save(){depth++},restore(){assert.ok(--depth>=0)},
    fillText:s=>text.push(s),measureText:s=>({width:String(s).length*24})},
    {get:(o,key)=>key in o?o[key]:(...args)=>{for(const n of args)if(typeof n==='number')assert.ok(Number.isFinite(n),key)}});
  const app={keyboard:createKeyboard(),animationFrame:0,mobile:{visible:true},sfx:{enabled:false},settings:{},
    records:{soloBest:0,soloMaxChain:0,cpu:Object.fromEntries(CPU_LEVELS.map(({id})=>[id,{win:0,lose:0}]))},
    skin:{...MOCK_SKIN,drawBackground(){throw Error('portrait should not use the retired scene background')},
      drawCharacter:(...args)=>characters.push(args)},setScene(scene){app.scene=scene},goToSinglePlayer(){}};
  return {ctx,app,text,characters,check:()=>assert.equal(depth,0)};
}

test('세로 타이틀·메인·싱글·설정·기록은 큰 캐릭터와 직접 선택 항목을 사용한다',()=>{
  for(const height of [700,1300,1900]){
    const h=harness(height),main=createMainMenu();
    for(const scene of [createTitleScene(),main,createSinglePlayerMenu(),createMultiplayerMenu()]){scene.draw(h.ctx,h.app);h.check()}
    for(const label of ['설정','기록']){
      main.touchItems(h.app).find(item=>item.label===label).activate();h.app.scene.draw(h.ctx,h.app);h.check();
    }
    assert.ok(h.characters.every(call=>call[5]>=150));
  }
});

test('세로 캐릭터 선택은 네 칸짜리 가로 시안을 축소하지 않고 선택한 캐릭터를 확대한다',()=>{
  const h=harness(),single=createSinglePlayerMenu();
  single.touchItems(h.app).find(item=>item.label==='연습').activate();
  const scene=h.app.scene;scene.draw(h.ctx,h.app);h.check();
  assert.equal(h.characters.length,1);assert.ok(h.characters[0][5]>=300);
  assert.ok(h.text.includes('연습'));
});

test('확대한 세로 일시정지 팝업은 실제 터치 위치로 재개할 수 있다',()=>{
  const h=harness(1440),scene=createGameScene({mode:'solo',characters:MOCK_SKIN.characters.slice(0,1)});
  h.app.keyboard.pressed.add('Escape');scene.update(h.app);h.app.keyboard.pressed.clear();
  assert.equal(scene.touchMode(),'menu');
  scene.tap(h.app,{x:480,y:720+(220-270)*1.85},{height:1440,portrait:true});
  assert.equal(scene.touchMode(),'game');
});
