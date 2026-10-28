import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {loadImageSkin,skinImageFiles} from '../src/view/skins/image-skin.js';
import {createTitleScene} from '../src/app/menu-scenes.js';
import {createKeyboard} from '../src/input/keyboard.js';

test('타이틀 그림은 실행 팩에서 한 장으로 읽고 가로세로 비율을 보존한다',async t=>{
 const root=new URL('../skins/chiikawa/pages-runtime/',import.meta.url);
 const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',root)));
 assert.ok(manifest.titleArt?.file);assert.equal(manifest.titleCast,undefined);
 assert.ok(skinImageFiles(manifest).includes(manifest.titleArt.file));
 const prior=globalThis.Image;
 globalThis.Image=class{set src(url){const bytes=fs.readFileSync(url);this.width=bytes.readUInt32BE(16);this.height=bytes.readUInt32BE(20);queueMicrotask(()=>this.onload())}};
 t.after(()=>{globalThis.Image=prior});
 t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>manifest}));
 const skin=await loadImageSkin(root.pathname), calls=[];
 const ctx={drawImage:(...args)=>calls.push(args)};
 for(const box of [[100,48,760,360],[48,100,864,620]]){
  skin.drawTitleArt(ctx,...box,{frame:999});
  const [image,sx,sy,sw,sh,x,y,w,h]=calls.at(-1);
  assert.ok(image.width>0&&image.height>0);
  assert.equal(sx,0);assert.equal(sy,0);
  assert.ok(Math.abs(w/h-sw/sh)<1e-12,'lettering and characters must not stretch');
  assert.ok(x>=box[0]&&y>=box[1]&&x+w<=box[0]+box[2]+1e-6&&y+h<=box[1]+box[3]+1e-6);
 }
 assert.equal(calls.length,2);
});

test('새 타이틀은 기존 제목 상자·캐릭터 줄을 대체하고 자료가 없으면 기존 타이틀을 사용한다',()=>{
 for(const portrait of [false,true])for(const dedicated of [false,true]){
  const calls=[],text=[],art=[],roster=Array.from({length:4},(_,i)=>({id:`actor-${i}`}));
  const ctx=new Proxy({portraitScreen:portrait,screenHeight:portrait?1280:540,measureText:()=>({width:100}),fillText:s=>text.push(s)}, {get:(o,k)=>o[k]??(()=>{})});
  const skin={characters:roster,branding:{title:'Fallback title',subtitle:'Subtitle'},drawBackground(){},drawCharacter:(_ctx,id,mood,x,y,size)=>calls.push({id,mood,x,y,size})};
  if(dedicated)skin.drawTitleArt=(...args)=>art.push(args.slice(1));
  createTitleScene().draw(ctx,{skin,keyboard:createKeyboard(),mobile:{visible:false}});
  assert.equal(calls.length,dedicated?0:3);
  assert.equal(art.length,dedicated?1:0);
  assert.equal(text.includes('Fallback title'),!dedicated);
  for(const c of calls){assert.equal(c.mood,'idle');assert.ok(c.x>=0&&c.x+c.size<=960)}
  if(!portrait)assert.ok(text.includes('Enter를 눌러 시작'));
 }
});

test('타이틀의 캐릭터만 반응하고 시작 입력·반복 터치·그림 여백을 구분한다',t=>{
 const prev=globalThis.window;
 globalThis.window={matchMedia:()=>({matches:false})};
 t.after(()=>{globalThis.window=prev});
 const hearts=[];
 const ctx=new Proxy({screenHeight:1000,portraitScreen:true,fillText:(s)=>{if(s==='♥')hearts.push(s)}},{get:(o,k)=>o[k]??(()=>{})});
 const box={x:100,y:150,width:760,height:380};
 let started=0;
 const app={keyboard:createKeyboard(),sfx:{enabled:false},mobile:{},goToMenu:()=>started++,skin:{
  characters:[],branding:{},titleInteractions:[{charId:'actor',bounds:{x:.1,y:.2,width:.3,height:.4}}],
  drawTitleArt:()=>box,
 }};
 const scene=createTitleScene();scene.draw(ctx,app);
 assert.equal(scene.tap(app,{x:260,y:280}),true);
 scene.draw(ctx,app);assert.equal(hearts.length,3);
 for(let i=0;i<40;i++)scene.update(app);
 assert.equal(scene.tap(app,{x:260,y:280}),true);
 for(let i=0;i<32;i++)scene.update(app);
 hearts.length=0;scene.draw(ctx,app);assert.equal(hearts.length,0,'연속 터치로 반응이 끝없이 늘어나지 않는다');
 assert.equal(started,0);
 assert.equal(scene.tap(app,{x:50,y:50}),false,'그림 여백은 기존 시작 입력으로 넘긴다');
 app.keyboard.pressed.add('Enter');scene.update(app);assert.equal(started,1);
});

test('세 캐릭터의 얼굴·긴 귀가 각각 반응하고 다른 캐릭터로 바로 전환할 수 있다',t=>{
 const prev=globalThis.window;
 globalThis.window={matchMedia:()=>({matches:false})};
 t.after(()=>{globalThis.window=prev});
 const manifest=JSON.parse(fs.readFileSync(new URL('../skins/chiikawa/pages-runtime/manifest.json',import.meta.url)));
 const interactions=manifest.titleArt.interactions;
 assert.equal(interactions.length,3);
 const hearts=[];
 const ctx=new Proxy({screenHeight:1000,portraitScreen:true,fillText:(s,x)=>{if(s==='♥')hearts.push(x)}},{get:(o,k)=>o[k]??(()=>{})});
 const box={x:100,y:150,width:760,height:380};
 const app={keyboard:createKeyboard(),sfx:{enabled:false},skin:{characters:[],branding:{},titleInteractions:interactions,drawTitleArt:()=>box}};
 const scene=createTitleScene();scene.draw(ctx,app);
 const centers=[];
 for(const hit of interactions){
  const b=hit.bounds;
  assert.ok(manifest.characters.find(c=>c.id===hit.charId)?.voices.select.length);
  assert.equal(scene.tap(app,{x:box.x+(b.x+b.width/2)*box.width,y:box.y+(b.y+b.height/2)*box.height}),true);
  hearts.length=0;scene.draw(ctx,app);assert.equal(hearts.length,3);centers.push(hearts[0]);
 }
 assert.ok(centers[0]<centers[1]&&centers[1]<centers[2],'반응이 누른 캐릭터 위치로 이동한다');
 const b=interactions[2].bounds;
 assert.equal(scene.tap(app,{x:box.x+(b.x+b.width/2)*box.width,y:box.y+.05*box.height}),true,'긴 귀도 누를 수 있다');
 assert.equal(scene.tap(app,{x:480,y:box.y+.95*box.height}),false,'로고 글자는 캐릭터 반응 영역이 아니다');
});
