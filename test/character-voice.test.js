import test from 'node:test';
import assert from 'node:assert/strict';
import { configureCharacterVoices, playCharacterEvents, playCharacterVoice } from '../src/audio/character-voice.js';

function harness() {
  const starts = [], stops = [];
  const context = { state: 'running', currentTime: 0,
    decodeAudioData: async (bytes) => bytes,
    createBufferSource: () => ({ connect: (node) => node, disconnect() {},
      start() { starts.push(this.buffer); }, stop() { stops.push(this.buffer); } }),
    createGain: () => ({ gain: { value: 0, setTargetAtTime() {} }, connect() {}, disconnect() {} }),
  };
  const voices = { actor: { select: ['select.wav'], chain1: ['one.wav'], chain7: ['seven.wav'],
    damage: ['hurt.wav'], win: ['win.wav'] } };
  return { sfx: { context, master: {}, enabled: true }, skin: { voices }, starts, stops };
}

test('스킨 음성은 중복 없이 준비하고 누락 파일이 있어도 나머지를 재생한다', async (t) => {
  const { sfx, skin, starts } = harness();
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(url); return { ok: url !== 'hurt.wav', arrayBuffer: async () => url };
  });
  const counts = await Promise.all([configureCharacterVoices(sfx, skin), configureCharacterVoices(sfx, skin)]);
  assert.deepEqual(counts, [4, 4]); assert.equal(requests.length, 5);
  assert.equal(playCharacterVoice(sfx, 'actor', 'select'), true);
  assert.deepEqual(starts, ['select.wav']);
  assert.equal(playCharacterVoice(sfx, 'unknown', 'select'), false);
});

test('연쇄·공격 이벤트는 한 번만 발성하고 7연쇄 이상은 마지막 발성을 쓴다', async (t) => {
  const { sfx, skin, starts } = harness();
  t.mock.method(globalThis, 'fetch', async (url) => ({ ok: true, arrayBuffer: async () => url }));
  await configureCharacterVoices(sfx, skin);
  playCharacterEvents(sfx, 'actor', [{ type: 'clear', chain: 1 }, { type: 'attack', amount: 30 }], 0);
  sfx.context.currentTime = 1;
  playCharacterEvents(sfx, 'actor', [{ type: 'clear', chain: 10 }], 0);
  assert.deepEqual(starts, ['one.wav', 'seven.wav']);
});

test('승리 발성은 직전 연쇄를 정리하고 낮은 우선순위 피격음에 끊기지 않는다', async (t) => {
  const { sfx, skin, starts, stops } = harness();
  t.mock.method(globalThis, 'fetch', async (url) => ({ ok: true, arrayBuffer: async () => url }));
  await configureCharacterVoices(sfx, skin);
  playCharacterVoice(sfx, 'actor', 'clear');
  playCharacterVoice(sfx, 'actor', 'win');
  sfx.context.currentTime = 1;
  assert.equal(playCharacterVoice(sfx, 'actor', 'damage'), false);
  assert.deepEqual(starts, ['one.wav', 'win.wav']); assert.deepEqual(stops, ['one.wav']);
  await configureCharacterVoices(sfx, skin, false);
  assert.deepEqual(stops, ['one.wav', 'win.wav']);
  assert.equal(playCharacterVoice(sfx, 'actor', 'select'), false);
});

test('다른 플레이어 발성은 독립적이며 음성 자료 없음·음소거에서는 재생하지 않는다', async (t) => {
  const { sfx, skin, starts } = harness();
  t.mock.method(globalThis, 'fetch', async (url) => ({ ok: true, arrayBuffer: async () => url }));
  await configureCharacterVoices(sfx, skin);
  playCharacterVoice(sfx, 'actor', 'select', { channel: 0 });
  playCharacterVoice(sfx, 'actor', 'select', { channel: 1 });
  assert.equal(starts.length, 2);
  sfx.enabled = false;
  assert.equal(playCharacterVoice(sfx, 'actor', 'win'), true, '효과음을 꺼도 켜 둔 목소리는 재생한다');
  await configureCharacterVoices(sfx, {});
  sfx.enabled = true; assert.equal(playCharacterVoice(sfx, 'actor', 'win'), false);
});
