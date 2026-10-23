import test from 'node:test';
import assert from 'node:assert/strict';
import { configureMusic, unlockMusic, syncMusicVisibility } from '../src/audio/music.js';
import { createGameScene } from '../src/app/game-scene.js';
import { createKeyboard } from '../src/input/keyboard.js';
import { MOCK_SKIN } from './fixtures/presentation.js';

function harness(t) {
  const created = [];
  const previous = globalThis.Audio;
  globalThis.Audio = class {
    paused = true; plays = 0;
    constructor(file) { this.file = file; created.push(this); }
    play() { this.paused = false; this.plays++; return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute() {} load() {}
  };
  t.after(() => { globalThis.Audio = previous; });
  return { sfx: {}, skin: { music: { file: 'track.mp3', gain: .5 } }, created };
}

test('배경음은 사용자 입력 뒤 반복 재생하고 효과음 음소거와 독립적으로 음량을 조절한다', (t) => {
  const { sfx, skin, created } = harness(t);
  sfx.enabled = false;
  configureMusic(sfx, skin, { volume: .6 });
  assert.equal(created[0].plays, 0);
  unlockMusic(sfx);
  assert.equal(created[0].plays, 1);
  assert.equal(created[0].volume, .3);
  assert.equal(created[0].loop, true);
  configureMusic(sfx, skin, { volume: .2 });
  assert.equal(created.length, 1); assert.equal(created[0].plays, 1);
  assert.equal(created[0].volume, .1);
});

test('음악 끄기·자료 전환은 정지하고 음악이 없는 자료는 파일을 요구하지 않는다', (t) => {
  const { sfx, skin, created } = harness(t);
  configureMusic(sfx, skin); unlockMusic(sfx);
  configureMusic(sfx, skin, { enabled: false });
  assert.equal(created[0].paused, true);
  configureMusic(sfx, skin, { enabled: true });
  assert.equal(created[0].paused, false);
  configureMusic(sfx, {});
  assert.equal(created[0].paused, true); assert.equal(sfx.musicAudio, null);
  unlockMusic(sfx); assert.equal(created.length, 1);
});

test('숨겨진 탭의 음악은 멈추며 복귀 때 설정을 지키고 재생 거부도 처리한다', async (t) => {
  const { sfx, skin, created } = harness(t);
  const previous = globalThis.document;
  globalThis.document = { hidden: false };
  t.after(() => { globalThis.document = previous; });
  configureMusic(sfx, skin); unlockMusic(sfx);
  globalThis.document.hidden = true; syncMusicVisibility(sfx);
  assert.equal(created[0].paused, true);
  globalThis.document.hidden = false;
  created[0].play = () => Promise.reject(new Error('autoplay blocked'));
  syncMusicVisibility(sfx);
  await new Promise((resolve) => setImmediate(resolve));
  configureMusic(sfx, skin, { enabled: false });
  syncMusicVisibility(sfx); assert.equal(created[0].paused, true);
});

test('장면이 바뀌면 이전 곡을 멈추고 해당 곡으로 전환하며 돌아오면 준비한 재생기를 재사용한다', (t) => {
  const { sfx, skin, created } = harness(t);
  skin.music.scenes = { menu: { file: 'menu.mp3', gain: .5 }, story: { file: 'story.mp3' },
    battle: { file: 'battle.mp3' }, intense: { file: 'intense.mp3' }, result: { file: 'result.mp3' } };
  configureMusic(sfx, skin, { scene: 'menu' }); unlockMusic(sfx);
  const menu = sfx.musicAudio; menu.currentTime = 12;
  for (const scene of ['story', 'battle', 'intense', 'result', 'menu']) {
    const previous = sfx.musicAudio;
    configureMusic(sfx, skin, { scene });
    assert.equal(previous.paused, true);
    assert.equal(sfx.musicAudio.file, scene + '.mp3');
    assert.equal(created.filter((audio) => !audio.paused).length, 1);
  }
  assert.equal(created.length, 5); assert.equal(sfx.musicAudio, menu);
  assert.equal(menu.currentTime, 12);
  configureMusic(sfx, skin, { volume: .2 });
  assert.equal(sfx.musicAudio, menu); assert.equal(menu.volume, .1);
});

test('복수 BGM은 무작위 선택하며 반복 선택을 허용하고 음량·음소거 변경에는 다시 뽑지 않는다',t=>{
 const {sfx,skin}=harness(t);skin.music.scenes={battle:{tracks:[{file:'a.mp3',gain:.2},{file:'b.mp3',gain:.7}]}};
 let calls=0;const random=()=>{calls++;return .99};const key={};
 configureMusic(sfx,skin,{scene:'battle',selectionKey:key,random});assert.equal(sfx.musicFile,'b.mp3');assert.equal(calls,1);
 configureMusic(sfx,skin,{scene:'battle',selectionKey:key,volume:.1,random});assert.equal(calls,1);assert.ok(Math.abs(sfx.musicAudio.volume-.07)<1e-9);
 configureMusic(sfx,skin,{scene:'battle',selectionKey:key,enabled:false,random});configureMusic(sfx,skin,{scene:'battle',selectionKey:key,enabled:true,random});assert.equal(calls,1);
 configureMusic(sfx,skin,{scene:'battle',selectionKey:{},random});assert.equal(calls,2);assert.equal(sfx.musicFile,'b.mp3');
 configureMusic(sfx,skin,{scene:'battle',selectionKey:{},random:()=>0});assert.equal(sfx.musicFile,'a.mp3');
});
test('빈 상황 목록은 기본 음악 목록으로 대체하고 단일 곡은 난수를 요구하지 않는다',t=>{
 const {sfx,skin}=harness(t);skin.music.scenes={battle:{tracks:[]}};configureMusic(sfx,skin,{scene:'battle',random:()=>{throw Error('not needed')}});assert.equal(sfx.musicFile,'track.mp3');
 skin.music={tracks:[{file:'one.mp3'},{file:'two.mp3'}],scenes:{battle:{tracks:[]}}};configureMusic(sfx,skin,{scene:'battle',random:()=>.8});assert.equal(sfx.musicFile,'two.mp3');
});

test('CPU 경기의 프레임 진행과 일시정지는 BGM을 유지하고 다시 하기에만 새로 선택한다', t => {
  const { sfx, skin, created } = harness(t);
  skin.music.scenes = { battle: { tracks: [{ file: 'a.mp3' }, { file: 'b.mp3' }] } };
  const previous = globalThis.window;
  globalThis.window = { localStorage: { setItem() {} } };
  t.after(() => { globalThis.window = previous; });
  const app = { sfx: { ...sfx, enabled: false }, skin: MOCK_SKIN,
    keyboard: createKeyboard(), settings: { voice: false }, records: {} };
  const scene = createGameScene({ mode: 'cpu', cpuLevel: 'normal',
    characters: [{ id: 'actor-0' }, { id: 'actor-1' }] });
  let selections = 0;
  const sync = () => configureMusic(app.sfx, skin, { scene: scene.musicScene(),
    selectionKey: scene.musicSession, random: () => selections++ % 2 ? .9 : .1 });
  sync(); unlockMusic(app.sfx);
  const round = scene.musicSession;
  for (let frame = 0; frame < 240; frame++) { scene.update(app); sync(); }
  assert.equal(scene.musicSession, round);
  assert.equal(selections, 1);
  assert.equal(created[0].plays, 1);
  assert.equal(created[0].paused, false);
  app.keyboard.pressed.add('Escape'); scene.update(app); app.keyboard.pressed.clear(); sync();
  assert.equal(scene.musicSession, round);
  assert.equal(selections, 1);
  scene.tap(app, { x: 400, y: 260 }); // 일시정지 메뉴의 다시 하기
  sync();
  assert.notEqual(scene.musicSession, round);
  assert.equal(selections, 2);
  assert.equal(created[0].paused, true);
  assert.equal(created[1].plays, 1);
});
