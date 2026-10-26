import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mixLevels } from '../src/audio/mix-levels.js';
import { createSfx, prepareSfx, setSfxOptions, playSfx } from '../src/audio/sfx.js';
import { playCharacterVoice } from '../src/audio/character-voice.js';
import { loadSettings } from '../src/app/storage.js';
import { configureMusic } from '../src/audio/music.js';

test('이전 전체 음량은 유지하고 새 개별 음량은 10으로 시작한다', t => {
  const previous = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => JSON.stringify({ volume: 3, music: false }) } };
  t.after(() => { globalThis.window = previous; });
  const settings = loadSettings();
  assert.equal(settings.volume, 3);
  assert.equal(settings.music, false);
  assert.deepEqual(mixLevels(settings), { master: .3, effects: 1, music: 3.375, voice: 1 });
  assert.deepEqual(mixLevels({ volume: -1, effectsVolume: 30, musicVolume: NaN, voiceVolume: 5 }),
    { master: 0, effects: 1, music: 3.375, voice: .5 });
});

test('전체·효과음·목소리 음량은 별도로 적용되고 효과음 0에서도 목소리 출력은 유지된다', async t => {
  const previous = globalThis.window, edges = [];
  const node = () => ({ gain: { value: 0 }, connect(target) { edges.push([this, target]); return target; }, disconnect() {} });
  class Context {
    state = 'running'; currentTime = 0; sampleRate = 44100; destination = {};
    createGain() { return node(); }
    createBuffer(_, length) { const samples = new Float32Array(length); return { getChannelData: () => samples }; }
    createBufferSource() { return { ...node(), start() {}, stop() {} }; }
  }
  globalThis.window = { AudioContext: Context };
  t.after(() => { globalThis.window = previous; });
  const sfx = createSfx();
  setSfxOptions(sfx, { enabled: true, volume: .6, effectsVolume: .5, voiceVolume: .8 });
  await prepareSfx(sfx);
  assert.ok(Math.abs(sfx.master.gain.value - .375) < 1e-10);
  assert.equal(sfx.voiceMaster.gain.value, .48);
  setSfxOptions(sfx, { enabled: true, volume: .6, effectsVolume: 0, voiceVolume: .8 });
  assert.equal(sfx.master.gain.value, 0);
  assert.equal(sfx.voiceMaster.gain.value, .48);
  Object.assign(sfx, { characterVoiceEnabled: true, characterVoiceBank: { actor: { select: ['one.wav'] } },
    characterVoiceBuffers: new Map([['one.wav', {}]]) });
  assert.equal(playCharacterVoice(sfx, 'actor', 'select'), true);
  assert.ok(edges.some(([from, to]) => from.gain?.value === 1.4 && to === sfx.voiceMaster));
  playSfx(sfx, 'attackImpact');
  setSfxOptions(sfx, { enabled: true, volume: .6, effectsVolume: 1, voiceVolume: 0 });
  assert.ok(Math.abs(sfx.master.gain.value - .75) < 1e-10);
  assert.equal(sfx.voiceMaster.gain.value, 0);
  setSfxOptions(sfx, { enabled: true, volume: 0 });
  assert.equal(sfx.master.gain.value, 0);
  assert.equal(sfx.voiceMaster.gain.value, 0);
});

test('배경음악은 전체와 배경음악 음량만 곱하고 조절 시 곡을 다시 선택하지 않는다', t => {
  const previous = globalThis.Audio;
  globalThis.Audio = class { paused = true; pause() {} };
  t.after(() => { globalThis.Audio = previous; });
  const sfx = {}, skin = { music: { file: 'music.mp3', gain: .2 } };
  let mix = mixLevels({ volume: 5, musicVolume: 4, effectsVolume: 0, voiceVolume: 0 });
  configureMusic(sfx, skin, { volume: mix.master * mix.music });
  const audio = sfx.musicAudio;
  assert.ok(Math.abs(audio.volume - .135) < 1e-10);
  mix = mixLevels({ volume: 5, musicVolume: 0 });
  configureMusic(sfx, skin, { volume: mix.master * mix.music });
  assert.equal(sfx.musicAudio, audio);
  assert.equal(audio.volume, 0);
});
