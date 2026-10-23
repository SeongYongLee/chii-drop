import test from 'node:test';
import assert from 'node:assert/strict';
import { setupAssetCache, retainMedia } from '../src/app/asset-cache.js';

test('HTTPS 기능이나 Service Worker가 없는 기기에서도 초기화를 막지 않는다', async()=>{
  assert.equal(await setupAssetCache(),null);
});
test('저장 목록은 해시 이미지·음성·음악만 중복 없이 프로젝트 경로로 전달한다',t=>{
  const old=globalThis.document;
  globalThis.document={baseURI:'https://example.test/game/index.html'};
  t.after(()=>{if(old===undefined)delete globalThis.document;else globalThis.document=old;});
  const messages=[], worker={postMessage:value=>messages.push(value)};
  const image='assets/01234567890123456789.png', audio='assets/abcdef01234567890123.wav', music='assets/12345678901234567890.mp3';
  retainMedia(worker,{characters:[{moods:{idle:image,happy:image},voices:{select:[audio]}}],music:{file:music},private:'review.wav'},'skins/chiikawa/pages-runtime');
  assert.deepEqual(messages,[{type:'retain-media',urls:[image,audio,music].map(file=>`https://example.test/game/skins/chiikawa/pages-runtime/${file}`)}]);
  assert.doesNotThrow(()=>retainMedia(null,{},''));
  assert.doesNotThrow(()=>retainMedia({postMessage(){throw new Error('Worker unavailable');}},{file:image},'skins/chiikawa/pages-runtime'));
});
