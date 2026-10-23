import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { publicManifest, publicCharacterInfo, validateCharacterInfo, imagePaths, audioPaths, runtimePaths, remapImages, safeFile } from '../scripts/pages/assets.mjs';
import { buildPages } from '../scripts/build-pages.mjs';

test('Pages 실행 팩은 배정된 음성·장면별 음악을 보존하고 중복 없이 수집한다', () => {
  const original = { review:'unused.wav', music:{file:'menu.mp3',scenes:{menu:{file:'menu.mp3'},battle:{file:'battle.mp3'}}}, characters:[{voices:{win:['win.wav'],select:['win.wav']},moods:{idle:{file:'one.png',frames:[{file:'two.png'}]}}}] };
  const result=publicManifest(original);
  assert.deepEqual(result,original); assert.notEqual(result.music,original.music);
  assert.deepEqual([...audioPaths(result)],['menu.mp3','battle.mp3','win.wav']);
  assert.deepEqual([...imagePaths(result)],['one.png','two.png']);
  const mapped=remapImages(result,new Map([['one.png','assets/one.png'],['win.wav','assets/voice.wav']]));
  assert.deepEqual([...imagePaths(mapped)],['assets/one.png','two.png']);
  assert.deepEqual(mapped.characters[0].voices.win,['assets/voice.wav']);
});
test('공개 캐릭터 정보는 선택 화면의 이름·ID만 허용하고 대본·숨은 출연진을 제거한다', () => {
  const source={characters:[{id:'visible',name:'참가자',voices:{select:['select.wav']}},
    {id:'hidden',name:'비공개',selectionVisible:false,moods:{idle:'hidden.png'}}]};
  const manifest=publicManifest(source);
  assert.equal(manifest.characters.length,1);
  assert.equal(source.characters.length,2);
  const info=publicCharacterInfo(source);
  assert.deepEqual(info,{characters:{visible:{name:'참가자',charId:'visible'}}});
  assert.doesNotThrow(()=>validateCharacterInfo(info,manifest));
  assert.throws(()=>validateCharacterInfo({...info,scenes:{opening:[{text:'private dialogue'}]}},manifest));
  assert.throws(()=>validateCharacterInfo({characters:{visible:{name:'참가자',charId:'visible',dialogue:'private'}}},manifest));
});
test('Pages 배포본에는 실행 자료와 루트 README만 포함하고 로컬 MD·서버 데이터·검토본은 제외한다', async (t) => {
  // 로컬 문서를 src에 추가해도 재귀 복사로 노출되지 않아야 한다.
  const localDoc = `src/pages-local-${process.pid}.MD`;
  await writeFile(localDoc, 'local development document');
  t.after(() => rm(localDoc, { force: true }));
  await buildPages();
  const manifest=JSON.parse(await readFile('dist/skins/chiikawa/manifest.json','utf8'));
  assert.equal(manifest.characters.length, 8);
  assert.equal(manifest.characters.filter(character=>character.selectable !== false).length, 4);
  assert.equal(manifest.characters.filter(character=>character.selectionVisible !== false).length, 8);
  const assets=runtimePaths(manifest);
  assert.ok(audioPaths(manifest).size>0);
  assert.ok(manifest.music.scenes.battle.file.endsWith('.mp3'));
  assert.ok(manifest.characters.some(c=>c.voices?.select?.length));
  for(const path of assets) assert.ok((await stat(`dist/skins/chiikawa/${path}`)).size>0);
  const records=JSON.parse(await readFile('skins/chiikawa/pages-runtime/asset-index.json','utf8'));
  for (const record of records) {
    assert.ok(assets.has(record.file));
    const bytes=await readFile(`dist/skins/chiikawa/${record.file}`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);
    assert.equal(bytes.length,record.bytes);
  }
  const info=JSON.parse(await readFile('dist/skins/chiikawa/characters.json','utf8'));
  validateCharacterInfo(info,manifest);
  assert.equal(Object.keys(info.characters).length,8);
  assert.equal(info.scenes,undefined);
  await assert.rejects(stat('dist/skins/chiikawa/story.json'),{code:'ENOENT'});
  const online=await readFile('dist/online.html','utf8');
  assert.ok(online.includes('준비 중')); assert.ok(online.includes('href="./"')); assert.ok(!online.includes('type="module"'));
  async function walk(folder) { const out=[];for(const e of await readdir(folder,{withFileTypes:true})) {const path=`${folder}/${e.name}`;out.push(...(e.isDirectory()?await walk(path):[path]));}return out; }
  const files=await walk('dist');
  assert.ok(!files.some(p=>/(?:^|\/)story\.json$/i.test(p)));
  for(const file of files.filter(p=>p.endsWith('.json'))) {
    const data=JSON.parse(await readFile(file,'utf8'));
    assert.ok(!data.scenes || !Object.values(data.scenes).some(Array.isArray),file);
  }
  assert.deepEqual(files.filter(p=>/\.md$/i.test(p)), ['dist/README.md']);
  assert.equal(await readFile('dist/README.md','utf8'), await readFile('README.md','utf8'));
  assert.ok(!(await readFile('README.md','utf8')).includes('CREDITS.md'));
  const audio=files.filter(p=>/\.(wav|mp3)$/.test(p));
  assert.deepEqual(audio.sort(),[...audioPaths(manifest)].map(p=>`dist/skins/chiikawa/${p}`).sort());
  assert.ok(!files.some(p=>/\.(mp4|mov|pem|key)$/.test(p)));
  assert.ok(!files.some(p=>/\/(preview|samples|current|voice-saved|temporary-bgm)/.test(p)));
  assert.ok(!files.some(p=>/^dist\/(data|server|test|node_modules|\.git)\//.test(p)));
  assert.ok(files.includes('dist/.nojekyll'));
  await assert.rejects(safeFile('skins/chiikawa/pages-runtime','../manifest.json'));
  await assert.rejects(safeFile('skins/chiikawa/pages-runtime','assets/../../outside.wav'));
  await assert.rejects(safeFile('skins/chiikawa/pages-runtime','https://example.com/audio.mp3'));
  await assert.rejects(buildPages('../unsafe-output'));
});
