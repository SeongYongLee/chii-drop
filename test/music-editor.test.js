import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp,mkdir,readFile,rm,symlink,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMusicEditor } from '../server/music-editor.js';
import { createVoiceEditor } from '../server/voice-editor.js';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'music-editor-'));t.after(()=>rm(root,{recursive:true,force:true}));const folder=join(root,'skins/test');
 await mkdir(join(folder,'sounds/music-review-v1/samples'),{recursive:true});await mkdir(join(folder,'sounds/voice-test'),{recursive:true});
 const first='sounds/music-review-v1/samples/first.mp3',second='sounds/music-review-v1/samples/second.mp3';for(const file of [first,second,'sounds/voice-test/a.wav','sounds/voice-test/b.wav'])await writeFile(join(folder,file),'audio');
 const music={file:first,gain:.15,scenes:{menu:{file:first,gain:.15},battle:{file:first,gain:.12}}};const original={branding:{title:'Fixture'},music,characters:[{id:'actor',voices:{select:['sounds/voice-test/a.wav']}}]};
 const manifestFile=join(folder,'manifest.json');await writeFile(manifestFile,JSON.stringify(original));await writeFile(join(folder,'sounds/music-review-v1/catalog.json'),JSON.stringify({tracks:[{file:first},{file:second}]}));
 const handler=createMusicEditor({root});
 const invoke=async(handle,path,method='GET',data,overrides={})=>{const {address='127.0.0.1',origin='http://127.0.0.1:5180',host='127.0.0.1:5180'}=overrides;const req=Object.assign(Readable.from(data?[JSON.stringify(data)]:[]),{method,headers:{host,origin,'content-type':'application/json',...overrides.headers},socket:{remoteAddress:address}});let status,result;await handle(req,{writeHead(code){status=code},end(body){result=JSON.parse(body)}},path);return {status,...result}};
 return {root,folder,manifestFile,original,first,second,invoke,request:(method,data,options)=>invoke(handler,'/api/local/skins/test/music',method,data,options)};
}
test('BGM 배정 저장·되돌리기는 캐릭터 음성과 제목을 유지한다',async t=>{const f=await fixture(t),before=await f.request();const music=structuredClone(before.music);music.scenes.battle={file:f.second,gain:.06};const saved=await f.request('PUT',{revision:before.revision,music});assert.equal(saved.status,200);assert.equal(saved.canRestore,true);let m=JSON.parse(await readFile(f.manifestFile));assert.deepEqual(m.characters,f.original.characters);assert.deepEqual(m.branding,f.original.branding);assert.equal(m.music.scenes.battle.file,f.second);const restored=await f.request('POST',{revision:saved.revision,action:'restore'});assert.equal(restored.status,200);assert.deepEqual(JSON.parse(await readFile(f.manifestFile)),f.original)});
test('음악 편집은 원격 주소·외부 Origin·Origin 없는 쓰기를 거부한다',async t=>{const f=await fixture(t),before=await f.request();for(const overrides of [{address:'192.168.0.1'},{host:'other.test:5180'},{origin:'https://other.test'},{origin:null},{headers:{'sec-fetch-site':'cross-site'}}])assert.equal((await f.request('PUT',{revision:before.revision,music:before.music},overrides)).status,403)});
test('목록 밖 파일·잘못된 배율·지원하지 않는 상황·심볼릭 링크를 거부한다',async t=>{const f=await fixture(t),before=await f.request();for(const change of [m=>m.file='sounds/other.mp3',m=>m.gain=2,m=>m.gain=-.1,m=>m.scenes.extra={file:f.first,gain:.1},m=>delete m.scenes.menu]){const music=structuredClone(before.music);change(music);assert.equal((await f.request('PUT',{revision:before.revision,music})).status,400)}await rm(join(f.folder,f.second));await writeFile(join(f.root,'outside.mp3'),'outside');await symlink(join(f.root,'outside.mp3'),join(f.folder,f.second));const music=structuredClone(before.music);music.file=f.second;assert.equal((await f.request('PUT',{revision:before.revision,music})).status,400)});
test('별도 편집기의 동시 BGM 저장은 한 번만 성공하고 오래된 배정은 충돌로 처리한다',async t=>{const f=await fixture(t),before=await f.request(),other=createMusicEditor({root:f.root}),a=structuredClone(before.music),b=structuredClone(before.music);a.file=f.second;b.gain=.3;const results=await Promise.all([f.request('PUT',{revision:before.revision,music:a}),f.invoke(other,'/api/local/skins/test/music','PUT',{revision:before.revision,music:b})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409])});
test('음성과 음악을 동시에 저장해도 서로의 배정을 덮어쓰지 않는다',async t=>{const f=await fixture(t),voice=createVoiceEditor({root:f.root}),before=await f.request(),v=await f.invoke(voice,'/api/local/skins/test/voices'),music=structuredClone(before.music);music.scenes.battle.file=f.second;const results=await Promise.all([f.request('PUT',{revision:before.revision,music}),f.invoke(voice,'/api/local/skins/test/voices','PUT',{revision:v.revision,voices:{actor:{select:['sounds/voice-test/b.wav']}}})]);assert.ok(results.every(r=>r.status===200));const m=JSON.parse(await readFile(f.manifestFile));assert.equal(m.music.scenes.battle.file,f.second);assert.equal(m.characters[0].voices.select[0],'sounds/voice-test/b.wav')});

test('음악 여러 곡·개별 음량·빈 상황 목록을 저장하고 복원한다',async t=>{
 const f=await fixture(t),loaded=await f.request(),music=structuredClone(loaded.music);
 music.scenes.battle={file:f.first,gain:.1,tracks:[{file:f.first,gain:.1},{file:f.second,gain:.2}]};music.scenes.menu={tracks:[]};
 const saved=await f.request('PUT',{revision:loaded.revision,music});assert.equal(saved.status,200);assert.equal(saved.music.scenes.battle.tracks.length,2);assert.equal(saved.music.scenes.battle.tracks[1].gain,.2);
 const result=await f.request('POST',{revision:saved.revision,action:'restore'});assert.deepEqual(result.music,loaded.music);
});
test('음악 목록의 숨은 파일·중복·빈 기본 목록·대표곡 불일치를 거부한다',async t=>{
 const f=await fixture(t),loaded=await f.request();
 for(const scene of [{tracks:[{file:f.first,gain:.1},{file:'sounds/other.mp3',gain:.1}]},{tracks:[{file:f.first,gain:.1},{file:f.first,gain:.1}]},{file:f.first,gain:.1,tracks:[{file:f.second,gain:.1}]}]){const music=structuredClone(loaded.music);music.scenes.battle=scene;assert.equal((await f.request('PUT',{revision:loaded.revision,music})).status,400)}
 const music=structuredClone(loaded.music);music.tracks=[];delete music.file;delete music.gain;assert.equal((await f.request('PUT',{revision:loaded.revision,music})).status,400);
});
