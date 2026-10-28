import test from 'node:test';
import assert from 'node:assert/strict';
import { loadImageSkin } from '../src/view/skins/image-skin.js';

test('장면별 배경은 공유 파일을 한 번 로드하고 누락 장면은 공통 배경으로 표시한다', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ok:true,json:async()=>({
    background:{file:'common.png'},backgrounds:{market:{file:'tea.png'},'game:market':{file:'tea.png'},inside:{file:'missing.png'}},
    battleSceneries:['market','inside','missing'],
  })}));
  const previous=globalThis.Image,loads=[];
  globalThis.Image=class{width=1600;height=900;set src(url){this.url=url;loads.push(url);queueMicrotask(()=>url.includes('missing')?this.onerror():this.onload())}};
  t.after(()=>{globalThis.Image=previous});
  const skin=await loadImageSkin('skin');
  assert.deepEqual(skin.battleSceneries, ['market']);
  const draws=[],ctx={drawImage:(image)=>draws.push(image.url)};
  for(const scene of ['market','game:market','inside','unknown'])skin.drawBackground(ctx,960,540,scene);
  assert.deepEqual(draws,['skin/tea.png','skin/tea.png','skin/common.png','skin/common.png']);
  assert.equal(loads.filter(url=>url==='skin/tea.png').length,1);
});

test('배경 미리보기는 로컬에서만 열고 생성 기록은 제공하지 않는다', async (t) => {
  const { mkdir, writeFile, rm } = await import('node:fs/promises');
  const { createOnlineServer } = await import('../server/index.js');
  const folder = new URL(`../skins/test-background-${process.pid}/backgrounds/`, import.meta.url);
  await mkdir(folder, {recursive:true});
  await writeFile(new URL('preview.html',folder),'<h1>Background preview</h1>');
  await writeFile(new URL('generation.json',folder),'{}');
  t.after(()=>rm(new URL('../',folder),{recursive:true,force:true}));
  const {server,wss}=createOnlineServer();
  t.after(()=>{wss.close();server.emit('close')});
  const handler=server.listeners('request')[0];
  async function status(file,address){
    let code;
    await handler({url:`/skins/test-background-${process.pid}/backgrounds/${file}`,socket:{remoteAddress:address}},
      {writeHead(value){code=value},end(){}});
    return code;
  }
  assert.equal(await status('preview.html','127.0.0.1'),200);
  assert.equal(await status('preview.html','192.168.0.30'),404);
  assert.equal(await status('generation.json','127.0.0.1'),404);
});

test('CSS가 같은 배경을 표시하면 Canvas는 중복 이미지를 그리지 않고 이전 프레임만 지운다', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ok:true,json:async()=>({ background:{file:'common.png'},backgrounds:{'game:market':{file:'tea.png'}} })}));
  const previous = globalThis.Image;
  globalThis.Image = class { width=1600;height=900;set src(url){this.url=url;queueMicrotask(()=>this.onload());}get src(){return this.url;} };
  t.after(()=>{globalThis.Image=previous;});
  const skin = await loadImageSkin('skin'); let draws=0, clears=0;
  const ctx={canvasBackdrop:true,pageBackdropUrl:'skin/tea.png',drawImage(){draws++;},clearRect(x,y,w,h){assert.deepEqual([x,y,w,h],[0,0,960,540]);clears++;}};
  for(let n=0;n<600;n++)skin.drawBackground(ctx,960,540,'game:market');
  assert.equal(draws,0);assert.equal(clears,600);
  // 전환 중 다른 배경이거나 CSS 배경이 없으면 원래 경로로 그린다.
  skin.drawBackground(ctx,960,540,'unknown');assert.equal(draws,1);
  ctx.canvasBackdrop=false;skin.drawBackground(ctx,960,540,'game:market');assert.equal(draws,2);
});
