import test from 'node:test';
import assert from 'node:assert/strict';
import {musicTracks,allMusicTracks,mapMusicFiles} from '../src/audio/music-config.js';
import {audioPaths,remapImages} from '../scripts/pages/assets.mjs';
test('복수 음악 경로와 음량은 스킨 로드·공개 실행 자료 재매핑에서 모두 유지한다',()=>{
 const music={file:'a.mp3',gain:.1,tracks:[{file:'a.mp3',gain:.1},{file:'b.mp3',gain:.2}],scenes:{battle:{tracks:[{file:'c.mp3',gain:.3},{file:'d.mp3',gain:.4}]}}};
 const mapped=mapMusicFiles(music,f=>'skin/'+f);assert.equal(mapped.tracks[1].file,'skin/b.mp3');assert.equal(mapped.scenes.battle.tracks[1].gain,.4);
 assert.deepEqual([...audioPaths({music})],['a.mp3','b.mp3','c.mp3','d.mp3']);
 const packed=remapImages({music},new Map([['d.mp3','assets/hash.mp3']]));assert.equal(packed.music.scenes.battle.tracks[1].file,'assets/hash.mp3');assert.equal(music.scenes.battle.tracks[1].file,'d.mp3');assert.equal(allMusicTracks(music).length,4);assert.equal(musicTracks({tracks:[]}).length,0);
});
