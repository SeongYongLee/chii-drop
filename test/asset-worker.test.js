import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const origin='https://example.test/game/';
const media=id=>`${origin}skins/chiikawa/pages-runtime/assets/${String(id).padStart(20,'0')}.mp3`;
async function harness({brokenStorage=false, quota=false, existingStorage}={}) {
  const handlers={}, stored=existingStorage ?? new Map(), requests=[];
  let offline=false;
  const cache={
    async match(key){return stored.get(typeof key==='string'?key:key.url)?.clone();},
    async put(key,response){if(quota)throw new Error('QuotaExceededError');stored.set(typeof key==='string'?key:key.url,response.clone());},
    async keys(){return [...stored.keys()].map(url=>new Request(url));},
    async delete(key){return stored.delete(typeof key==='string'?key:key.url);},
  };
  await runInNewContext(await readFile('asset-worker.js','utf8'),{
    self:{registration:{scope:origin},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(name,fn)=>handlers[name]=fn},
    caches:{open:async()=>{if(brokenStorage)throw new Error('Storage unavailable');return cache;}},
    fetch:async request=>{if(offline)throw new Error('Offline');requests.push(request);return new Response('0123456789',{headers:{'Content-Type':'audio/mpeg'}});},
    URL,Request,Response,Headers,Map,Set,Number,JSON,Promise,
  });
  return {requests,stored,offline:()=>{offline=true;},
    async get(url=media(1),headers={}){let response;handlers.fetch({request:new Request(url,{headers}),respondWith:p=>response=p});return response?await response:null;},
    async retain(urls){let done;handlers.message({data:{type:'retain-media',urls},waitUntil:p=>done=p});await done;},
  };
}

test('재접속한 worker도 저장한 해시 자료를 네트워크 없이 재사용한다',async()=>{
  const h=await harness();
  assert.equal(await (await h.get()).text(),'0123456789');
  const next=await harness({existingStorage:h.stored}); next.offline();
  assert.equal(await (await next.get()).text(),'0123456789');
  assert.equal(next.requests.length,0);assert.equal(h.requests.length,1);
});
test('동시 요청은 한 번 받고 새 해시만 추가로 다운로드한다',async()=>{
  const h=await harness();
  const results=await Promise.all([h.get(),h.get(),h.get()]);
  assert.deepEqual(await Promise.all(results.map(r=>r.text())),['0123456789','0123456789','0123456789']);
  assert.equal(h.requests.length,1);
  await h.get(media(2));assert.equal(h.requests.length,2);
  await h.get(media(1));assert.equal(h.requests.length,2);
});
test('HTML·실행 코드·매니페스트·원본 파일·다른 사이트는 저장하거나 가로채지 않는다',async()=>{
  const h=await harness();
  for(const path of ['index.html','src/app/main.js','skins/chiikawa/pages-runtime/manifest.json','skins/chiikawa/source.wav'])assert.equal(await h.get(origin+path),null);
  assert.equal(await h.get(media(1).replace('example.test','other.test')),null);
  assert.equal(h.stored.size,0);assert.equal(h.requests.length,0);
});
test('Safari 음악 부분 요청은 전체 파일을 저장한 뒤 캐시에서 206으로 응답한다',async()=>{
  const h=await harness();
  const first=await h.get(media(1),{Range:'bytes=2-5'});
  assert.equal(first.status,206);assert.equal(first.headers.get('content-range'),'bytes 2-5/10');
  assert.equal(await first.text(),'2345');assert.equal(h.requests[0].headers.has('range'),false);
  h.offline();
  assert.equal(await (await h.get(media(1),{Range:'bytes=-3'})).text(),'789');
  assert.equal(await (await h.get(media(1),{Range:'bytes=8-'})).text(),'89');
  for(const range of ['bytes=99-','bytes=5-2','bytes=-0','bytes=0-1,3-4'])assert.equal((await h.get(media(1),{Range:range})).status,416);
});
test('저장 불가·용량 초과 때도 네트워크 응답으로 실행한다',async()=>{
  for(const options of [{brokenStorage:true},{quota:true}]){
    const h=await harness(options);
    assert.equal(await (await h.get()).text(),'0123456789');
    assert.equal(h.stored.size,0);
  }
});
test('업데이트는 현재·직전 자료를 유지하고 세 세대 전 미사용 자료만 정리한다',async()=>{
  const h=await harness();
  await h.get(media(1));await h.retain([media(1)]);
  await h.get(media(2));await h.retain([media(2)]);
  assert.ok(h.stored.has(media(1)));
  await h.retain([media(2)]);assert.ok(h.stored.has(media(1)));
  await h.get(media(3));await h.retain([media(3)]);
  assert.ok(!h.stored.has(media(1)));assert.ok(h.stored.has(media(2)));assert.ok(h.stored.has(media(3)));
});
