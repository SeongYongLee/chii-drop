import test from 'node:test';
import assert from 'node:assert/strict';
import { createSfx, prepareSfx, unlockSfx } from '../src/audio/sfx.js';
import { configureCharacterVoices, playCharacterVoice } from '../src/audio/character-voice.js';
import { loadAudioBuffer } from '../src/audio/buffer-loader.js';

test('첫 입력 전에 음성을 디코딩하고 첫 발성은 추가 요청·디코딩 없이 재생한다', async (t) => {
  const previous = globalThis.window;
  const starts = [], requests = []; let decoded = 0;
  class Context {
    state = 'suspended'; sampleRate = 48000; currentTime = 0;
    createGain() { return { gain: { value: 0, setTargetAtTime() {} }, connect() {}, disconnect() {} }; }
    createBufferSource() { return { connect: (target) => target, disconnect() {}, stop() {}, start() { starts.push(this.buffer); } }; }
    createBuffer() { return 'silent warmup'; }
    async decodeAudioData(bytes) { decoded++; return bytes; }
    resume() { this.state = 'running'; return Promise.resolve(); }
  }
  globalThis.window = { AudioContext: Context };
  t.after(() => { globalThis.window = previous; });
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(url); return { ok: true, arrayBuffer: async () => url };
  });
  const sfx = createSfx();
  await configureCharacterVoices(sfx, { voices: { actor: { select: ['actor-select.wav'] } } });
  await prepareSfx(sfx);
  assert.equal(sfx.context.state, 'suspended'); assert.equal(starts.length, 0);
  assert.equal(decoded, 47); assert.equal(sfx.characterVoiceBuffers.size, 1);
  const beforeRequests = requests.length;
  await unlockSfx(sfx);
  assert.equal(playCharacterVoice(sfx, 'actor', 'select'), true);
  assert.deepEqual(starts, ['silent warmup', 'actor-select.wav']);
  assert.equal(requests.length, beforeRequests); assert.equal(decoded, 47);
});

test('효과음·보이스 공유 로더는 두 작업만 병렬 처리하며 실패 뒤에도 다음 파일을 준비한다', async (t) => {
  let active = 0, peak = 0;
  t.mock.method(globalThis, 'fetch', async (file) => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 3));
    active--;
    return { ok: file !== 'missing', arrayBuffer: async () => file };
  });
  const context = { decodeAudioData: async (bytes) => bytes };
  const results = await Promise.allSettled(['a', 'b', 'missing', 'd', 'e', 'f'].map((file) => loadAudioBuffer(context, file)));
  assert.equal(peak, 2); assert.equal(results.filter((r) => r.status === 'fulfilled').length, 5);
  assert.equal(results.at(-1).value, 'f');
});

test('오디오 장치가 interrupted 상태가 되면 다음 사용자 입력에서 다시 시작한다', async () => {
  let resumed = 0;
  const sfx = { audioWarmed: true, context: { state: 'interrupted', async resume() { resumed++; this.state = 'running'; } } };
  await unlockSfx(sfx);
  assert.equal(resumed, 1);
  assert.equal(sfx.context.state, 'running');
});
