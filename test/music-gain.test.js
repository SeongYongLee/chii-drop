import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configureMusic, syncMusicGain } from '../src/audio/music.js';
import { createSfx, unlockSfx } from '../src/audio/sfx.js';

function harness(t) {
  const previousAudio = globalThis.Audio, previousWindow = globalThis.window;
  const routes = [], edges = [], elements = [];
  globalThis.Audio = class {
    paused = true; muted = false; plays = 0;
    constructor(file) { this.file = file; elements.push(this); }
    // 모바일 Safari처럼 volume 쓰기를 반영하지 않는다.
    get volume() { return 1; } set volume(_) {}
    pause() { this.paused = true; }
    play() {
      this.paused = false; this.plays++;
      assert.ok(routes.some(route => route.audio === this), '재생 전부터 Web Audio를 거친다');
      return Promise.resolve();
    }
  };
  class Context {
    state = 'suspended'; currentTime = 0; destination = {}; sampleRate = 44100;
    createGain() { return { gain: { value: 0 }, connect: target => { edges.push(target); return target; } }; }
    createMediaElementSource(audio) {
      assert.ok(!routes.some(route => route.audio === audio), '같은 요소를 두 번 연결하지 않는다');
      const source = { audio, connect(target) { edges.push(target); return target; } };
      routes.push(source); return source;
    }
    createBuffer() { return {}; }
    createBufferSource() { return { connect() {}, disconnect() {}, start() {} }; }
    resume() { this.state = 'running'; return Promise.resolve(); }
  }
  globalThis.window = { AudioContext: Context };
  t.after(() => { globalThis.Audio = previousAudio; globalThis.window = previousWindow; });
  const skin = { music: { scenes: { menu: { file: 'a.mp3', gain: .2 }, battle: { file: 'b.mp3', gain: .4 } } } };
  return { sfx: createSfx(), skin, routes, edges, elements, Context };
}

test('volume 설정을 무시하는 Safari에서도 재생 전 음량 경로를 만들고 0은 확실히 무음이다', async t => {
  const { sfx, skin, routes, edges } = harness(t);
  configureMusic(sfx, skin, { volume: .5, scene: 'menu' });
  assert.equal(sfx.musicAudio.volume, 1);
  assert.equal(routes.length, 0);
  await unlockSfx(sfx);
  assert.equal(routes.length, 1);
  assert.equal(sfx.musicAudio.plays, 1);
  assert.equal(sfx.musicGain.gain.value, .1);
  assert.ok(edges.includes(sfx.context.destination));
  assert.notEqual(sfx.musicGain, sfx.master);
  assert.notEqual(sfx.musicGain, sfx.voiceMaster);
  configureMusic(sfx, skin, { volume: 0, scene: 'menu' });
  assert.equal(sfx.musicGain.gain.value, 0);
  assert.equal(sfx.musicAudio.muted, true);
  assert.equal(sfx.musicAudio.volume, 1, '요소의 volume 지원에 의존하지 않는다');
  configureMusic(sfx, skin, { volume: .25, scene: 'menu' });
  assert.equal(sfx.musicGain.gain.value, .05);
  assert.equal(sfx.musicAudio.muted, false);
  assert.equal(sfx.musicAudio.plays, 1, '음량 변경으로 곡을 다시 시작하지 않는다');
});

test('장면 변경과 캐시 복귀에도 음악 요소를 한 번만 연결하고 최신 음량을 반영한다', async t => {
  const { sfx, skin, routes, elements } = harness(t);
  configureMusic(sfx, skin, { volume: .5, scene: 'menu' });
  await unlockSfx(sfx);
  const gain = sfx.musicGain;
  configureMusic(sfx, skin, { volume: .5, scene: 'battle' });
  assert.equal(elements[0].paused, true);
  assert.equal(sfx.musicGain.gain.value, .2);
  configureMusic(sfx, skin, { volume: .25, scene: 'menu' });
  assert.equal(sfx.musicAudio, elements[0]);
  assert.equal(elements[1].paused, true);
  assert.equal(sfx.musicGain, gain);
  assert.equal(gain.gain.value, .05);
  for (let i = 0; i < 5; i++) syncMusicGain(sfx);
  assert.equal(routes.length, 2);
  configureMusic(sfx, skin, { enabled: false, scene: 'menu' });
  assert.equal(sfx.musicAudio.muted, true);
  assert.equal(sfx.musicAudio.paused, true);
});

test('음악·효과음·목소리는 동일한 최종 압축 출력을 공유하되 개별 음량은 독립적이다', async t => {
  const { sfx, skin, Context, edges } = harness(t);
  let compressor;
  Context.prototype.createDynamicsCompressor = function () {
    compressor = { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {},
      connect(target) { edges.push([this, target]); return target; } };
    return compressor;
  };
  // 입력 출력의 간선을 기록해 음악만 최종 압축을 우회하는 재발을 막는다.
  Context.prototype.createGain = function () {
    return { gain: { value: 0 }, connect(target) { edges.push([this, target]); return target; } };
  };
  configureMusic(sfx, skin, { scene: 'menu', volume: .5 });
  await unlockSfx(sfx);
  assert.equal(sfx.outputNode, compressor);
  for (const bus of [sfx.master, sfx.voiceMaster, sfx.musicGain]) {
    assert.ok(edges.some(edge => edge[0] === bus && edge[1] === compressor));
    assert.ok(!edges.some(edge => edge[0] === bus && edge[1] === sfx.context.destination));
  }
  assert.ok(edges.some(edge => edge[0] === compressor && edge[1] === sfx.context.destination));
  configureMusic(sfx, skin, { scene: 'menu', volume: 0 });
  assert.equal(sfx.musicGain.gain.value, 0);
  assert.equal(sfx.voiceMaster.gain.value, .6);
  assert.equal(sfx.master.gain.value, .75);
});
