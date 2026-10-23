import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSkinScript } from '../src/story/script.js';

test('일반 플레이는 캐릭터 정보만 읽고 실패하더라도 전체 대본으로 우회하지 않는다', async (t) => {
  const requests=[];
  t.mock.method(globalThis,'fetch',async(url)=>{
    requests.push(url);
    return {ok:true,json:async()=>({characters:{actor:{name:'참가자',charId:'actor'}},scenes:{private:[]}})};
  });
  const script=await loadSkinScript('skins/sample');
  assert.deepEqual(requests,['skins/sample/characters.json']);
  assert.deepEqual(script.scenes,{});
  t.mock.method(globalThis,'fetch',async(url)=>{requests.push(url);return {ok:false};});
  assert.equal(await loadSkinScript('skins/sample'),null);
  assert.ok(requests.every(url=>!url.endsWith('story.json')));
});

test('스토리 모드를 명시적으로 활성화했을 때 공개 대본을 읽는다',async(t)=>{
  t.mock.method(globalThis,'fetch',async(url)=>{
    assert.equal(url,'skins/sample/story.json');
    return {ok:true,json:async()=>({characters:{},scenes:{opening:[]}})};
  });
  assert.deepEqual(await loadSkinScript('skins/sample',{includeStory:true}),{characters:{},scenes:{opening:[]}});
});
