import test from 'node:test';
import assert from 'node:assert/strict';
import { drawSoftBlob, softBlobColor } from '../src/view/skins/soft-blobs.js';
import { GARBAGE } from '../src/engine/field.js';
import { loadImageSkin } from '../src/view/skins/image-skin.js';
import { blobColor } from '../src/view/skins/blobs.js';

function context() {
  const calls=[];
  return {calls,ctx:new Proxy({}, {get:(target,key)=>key in target?target[key]:(...args)=>{
    for(const value of args)if(typeof value==='number')assert.ok(Number.isFinite(value),`${key}: ${value}`);
    calls.push([key,...args]);
  }})};
}
test('말랑 블록 5색·16연결·착지·소거는 입력을 바꾸거나 난수를 쓰지 않고 반복 그리기가 같다',t=>{
  t.mock.method(Math,'random',()=>{throw Error('render random')});
  for(const color of [1,2,3,4,5])for(let links=0;links<16;links++){
    for(const shape of ['normal','squash','stretch','pop0','pop1','pop2','pop3']){
      const style=Object.freeze({links,shape,axis:true}),a=context(),b=context();
      drawSoftBlob(a.ctx,color,0,0,32,style);drawSoftBlob(b.ctx,color,0,0,32,style);
      assert.deepEqual(a.calls,b.calls);
      assert.equal(a.calls.filter(c=>c[0]==='save').length,a.calls.filter(c=>c[0]==='restore').length);
    }
  }
});
test('5색은 다른 색과 문양을 갖고 방해 블록은 기존 풀 그림으로 구분된다',()=>{
  const signatures=[];
  assert.equal(new Set([1,2,3,4,5].map(softBlobColor)).size,5);
  for(const color of [1,2,3,4,5]){const h=context();drawSoftBlob(h.ctx,color,0,0,32);signatures.push(JSON.stringify(h.calls))}
  assert.equal(new Set(signatures).size,5);
  for(const shape of ['normal','gpop0','gpop1','gpop2']){const h=context();drawSoftBlob(h.ctx,GARBAGE,0,0,32,{shape});assert.ok(h.calls.some(c=>c[0]==='quadraticCurveTo'))}
});

test('스킨의 말랑 스타일 선택은 블록·입자 색을 함께 바꾸고 미지정 스킨은 기존 표시를 쓴다',async t=>{
  let blobStyle='soft';
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({garbageStyle:'grass',blobStyle})}));
  const soft=await loadImageSkin('skin');
  assert.equal(soft.blobColor(1),softBlobColor(1));
  const h=context();soft.drawBlob(h.ctx,1,0,0,32,{links:6});
  const expected=context();drawSoftBlob(expected.ctx,1,0,0,32,{links:6});
  assert.deepEqual(h.calls,expected.calls);
  blobStyle=undefined;
  const basic=await loadImageSkin('skin');
  assert.equal(basic.blobColor(1),blobColor(1));
});

test('소품 스킨은 실제 5색 매핑을 유지하며 모든 연결·표시 단계에서 유효한 경로를 그린다', async t => {
  const { readFile } = await import('node:fs/promises');
  const { createPropBlobs } = await import('../src/view/skins/prop-blobs.js');
  const manifest = JSON.parse(await readFile(new URL('../skins/chiikawa/pages-runtime/manifest.json', import.meta.url), 'utf8'));
  const props = createPropBlobs(manifest.blobArt);
  assert.ok(props);
  assert.equal(new Set([1,2,3,4,5].map(props.blobColor)).size, 5);
  t.mock.method(Math, 'random', () => { throw Error('render random'); });
  for (const color of [1,2,3,4,5]) for (let links=0; links<16; links++) {
    for (const shape of ['normal','squash','stretch','pop0','pop1','pop2','pop3']) {
      const a=context(), b=context(), style=Object.freeze({links,shape,axis:true});
      props.drawBlob(a.ctx,color,0,0,160,style);props.drawBlob(b.ctx,color,0,0,160,style);
      assert.deepEqual(a.calls,b.calls);
      assert.equal(a.calls.filter(c=>c[0]==='save').length,a.calls.filter(c=>c[0]==='restore').length);
    }
  }
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({garbageStyle:'grass',blobArt:manifest.blobArt})}));
  const skin=await loadImageSkin('skin');
  const a=context(),b=context();
  skin.drawBlob(a.ctx,2,0,0,32,{links:6});props.drawBlob(b.ctx,2,0,0,32,{links:6});
  assert.deepEqual(a.calls,b.calls);
  assert.equal(skin.blobColor(5),props.blobColor(5));
});

test('블록 그림자는 몸체와 분리해 먼저 그릴 수 있고 필요할 때 생략한다', async () => {
  const {readFile}=await import('node:fs/promises');
  const {createPropBlobs}=await import('../src/view/skins/prop-blobs.js');
  const {blobArt}=JSON.parse(await readFile(new URL('../skins/chiikawa/pages-runtime/manifest.json',import.meta.url),'utf8'));
  const props=createPropBlobs(blobArt);
  for (const color of [1,2,3,4,5,GARBAGE]) {
    const shadow=context(), next=context(), body=context();
    props.drawBlob(shadow.ctx,color,0,0,32,{links:6,shadowOnly:true});
    props.drawBlob(next.ctx,color,0,0,32,{links:6,shadow:false});
    props.drawBlob(body.ctx,color,0,0,32,{links:6});
    assert.equal(shadow.calls.filter(c=>c[0]==='fill').length,1,'그림자 패스에 무늬나 몸체를 중복하지 않는다');
    assert.equal(shadow.calls.some(c=>c[0]==='stroke'),false);
    assert.ok(body.calls.filter(c=>c[0]==='fill').length>next.calls.filter(c=>c[0]==='fill').length);
    assert.equal(shadow.calls.filter(c=>c[0]==='save').length,shadow.calls.filter(c=>c[0]==='restore').length);
  }
});
