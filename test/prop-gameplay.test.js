import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadImageSkin } from '../src/view/skins/image-skin.js';
import { createPropBlobs } from '../src/view/skins/prop-blobs.js';
import { drawGame } from '../src/view/renderer.js';
import { createMotionReplay } from './fixtures/motion-replay.js';

const manifest = JSON.parse(await readFile(new URL('../skins/chiikawa/pages-runtime/manifest.json', import.meta.url), 'utf8'));
function context() {
  let depth=0;
  const calls=[];
  const ctx=new Proxy({
    save(){depth++}, restore(){assert.ok(--depth>=0)},
    measureText:s=>({width:String(s).length*10}),
  }, {get:(target,key)=>key in target?target[key]:(...args)=>{
    for(const value of args)if(typeof value==='number')assert.ok(Number.isFinite(value),key);
    calls.push([key,...args]);
  }});
  return {ctx,calls,check:()=>assert.equal(depth,0)};
}

test('도안만 있는 스킨도 로드되며 이전 이미지가 있어도 모든 동작에 같은 도안을 쓴다',async t=>{
  let blobs={};
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({blobArt:manifest.blobArt,blobs})}));
  const previous=globalThis.Image;
  globalThis.Image=class{width=32;height=32;set src(value){queueMicrotask(()=>this.onload())}};
  t.after(()=>{globalThis.Image=previous});
  const expected=createPropBlobs(manifest.blobArt);
  for(const legacy of [false,true]){
    blobs=legacy?{1:'old.png',2:'old.png',3:'old.png',4:'old.png',5:'old.png'}:{};
    const skin=await loadImageSkin('skin');assert.ok(skin);
    for(const color of [1,2,3,4,5])for(const style of [{},{axis:true},{links:6},{shape:'squash'},{shape:'stretch'},{shape:'pop0'},{shape:'pop1'},{shape:'pop2'},{shape:'pop3'}]){
      const a=context(),b=context();
      skin.drawBlob(a.ctx,color,10,20,32,style);expected.drawBlob(b.ctx,color,10,20,32,style);
      assert.deepEqual(a.calls,b.calls);a.check();
      assert.ok(!a.calls.some(call=>call[0]==='drawImage'));
    }
  }
});

test('5종 모두 실제 엔진의 착지·연결·소거·재낙하를 렌더링하며 경기 상태를 바꾸지 않는다',async t=>{
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({blobArt:manifest.blobArt,garbageStyle:'grass'})}));
  const loaded=await loadImageSkin('skin');
  for(let color=1;color<=5;color++){
    const frames=createMotionReplay(color),seen=new Set();
    let connected=false,fallAfterClear=false;
    const h=context();
    const skin={...loaded,drawBackground(){},drawCharacter(){},drawBlob(ctx,c,x,y,size,style={}){
      if(c===color){if(style.shape)seen.add(style.shape);if(style.links)connected=true;}
      loaded.drawBlob(ctx,c,x,y,size,style);
    }};
    for(const view of frames){
      const before=structuredClone(view);
      drawGame(h.ctx,{...view,skin,characters:[],showGhost:true});
      assert.deepEqual(view,before);
      h.check();h.calls.length=0;
      const player=view.match.players[0];
      if(player.phase==='chain-fall'&&player.board.offset.some(value=>value<0))fallAfterClear=true;
    }
    for(const shape of ['squash','stretch','pop0','pop1','pop2','pop3'])assert.ok(seen.has(shape),`${color}: ${shape}`);
    assert.ok(connected,`${color}: connected`);
    assert.ok(fallAfterClear,`${color}: chain fall`);
    const end=frames.at(-1).match.players[0];
    assert.equal(end.board.cells.filter(value=>value===color).length,0);
    assert.equal(end.maxChain,1);
    assert.equal(end.score,53);
  }
});
