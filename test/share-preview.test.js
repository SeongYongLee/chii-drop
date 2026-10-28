import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {roomInviteURL} from '../src/net/room-invite.js';

test('초대 미리보기는 JavaScript 실행 없이 현재 타이틀 PNG와 공개 절대 주소를 제공한다',async()=>{
 const html=await readFile('index.html','utf8');
 const head=html.match(/<head>([\s\S]*?)<\/head>/)[1];
 const tags=new Map([...head.matchAll(/<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)"\s*\/>/g)].map(m=>[m[1],m[2]]));
 const manifest=JSON.parse(await readFile('skins/chiikawa/pages-runtime/manifest.json','utf8'));
 const image=new URL(tags.get('og:image'));
 assert.equal(image.protocol,'https:');
 assert.equal(image.hostname,'seongyonglee.github.io');
 assert.equal(image.pathname,`/chii-drop/skins/chiikawa/pages-runtime/${manifest.titleArt.file}`,'타이틀 교체 시 공유 그림도 함께 갱신해야 한다');
 const bytes=await readFile(`skins/chiikawa/pages-runtime/${manifest.titleArt.file}`);
 assert.equal(bytes.toString('hex',0,8),'89504e470d0a1a0a');
 assert.equal(Number(tags.get('og:image:width')),bytes.readUInt32BE(16));
 assert.equal(Number(tags.get('og:image:height')),bytes.readUInt32BE(20));
 assert.equal(tags.get('og:image:type'),'image/png');
 assert.equal(tags.get('twitter:card'),'summary_large_image');
 assert.equal(tags.get('twitter:image'),image.href);
 assert.ok(tags.get('og:title')?.includes('대전 초대'));
 assert.ok(tags.get('og:description')?.length>10);
 assert.equal(tags.get('twitter:title'),tags.get('og:title'));
 assert.equal(tags.get('twitter:description'),tags.get('og:description'));
 // Fixed canonical/og:url would merge room-specific invitations into the home page.
 assert.equal(tags.has('og:url'),false);
 assert.doesNotMatch(head,/rel="canonical"/);
 const invite=new URL(roomInviteURL('https://seongyonglee.github.io/chii-drop/?private=discard','A1B2C3D4'));
 assert.equal(invite.pathname,'/chii-drop/index.html');
 assert.equal(invite.search,'?room=A1B2C3D4');
 assert.equal(invite.hash,'#play');
});
