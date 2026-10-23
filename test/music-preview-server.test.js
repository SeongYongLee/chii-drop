import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,writeFile,rm } from 'node:fs/promises';
import { createOnlineServer } from '../server/index.js';
test('미배정 BGM 비교 파일과 편집 페이지는 로컬에서만 제공한다',async t=>{
 const name=`test-music-${process.pid}`,folder=new URL(`../skins/${name}/sounds/music-review-v1/`,import.meta.url);await mkdir(new URL('samples/',folder),{recursive:true});t.after(()=>rm(new URL(`../skins/${name}/`,import.meta.url),{recursive:true,force:true}));for(const [file,data]of Object.entries({'preview.html':'review','samples/test.mp3':'audio','catalog.json':'private metadata'}))await writeFile(new URL(file,folder),data);
 const {server,wss}=createOnlineServer();t.after(()=>{wss.close();server.emit('close')});const handle=server.listeners('request')[0];const get=(file,address)=>new Promise((resolve,reject)=>{let status;handle({url:`/skins/${name}/sounds/music-review-v1/${file}`,socket:{remoteAddress:address}},{writeHead(code){status=code},end(){resolve(status)}}).catch(reject)});
 for(const file of ['preview.html','samples/test.mp3']){assert.equal(await get(file,'127.0.0.1'),200);assert.equal(await get(file,'192.168.0.2'),404)}assert.equal(await get('catalog.json','127.0.0.1'),404);
});

test('음악 목록의 첫 곡 이외 배정곡도 런타임으로 제공하고 미배정곡은 차단한다',async t=>{
 const name=`test-music-list-${process.pid}`,skin=new URL(`../skins/${name}/`,import.meta.url),folder=new URL('sounds/music-review-v1/samples/',skin);await mkdir(folder,{recursive:true});t.after(()=>rm(skin,{recursive:true,force:true}));for(const file of ['first.mp3','second.mp3','unused.mp3'])await writeFile(new URL(file,folder),'audio');
 const path=file=>'sounds/music-review-v1/samples/'+file;await writeFile(new URL('manifest.json',skin),JSON.stringify({music:{tracks:[{file:path('first.mp3'),gain:.1}],scenes:{battle:{tracks:[{file:path('first.mp3'),gain:.1},{file:path('second.mp3'),gain:.2}]}}}}));
 const {server,wss}=createOnlineServer();t.after(()=>{wss.close();server.emit('close')});const handle=server.listeners('request')[0];const get=file=>new Promise((resolve,reject)=>{let status;handle({url:`/skins/${name}/${path(file)}`,socket:{remoteAddress:'192.168.0.2'}},{writeHead(code){status=code},end(){resolve(status)}}).catch(reject)});
 assert.equal(await get('second.mp3'),200);assert.equal(await get('unused.mp3'),404);
});
