import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FOLEY_FILES, playRecordedSfx, preloadRecordedSfx } from '../src/audio/foley-bank.js';
import { playSfx } from '../src/audio/sfx.js';
import { boardSoundEvents } from '../src/audio/board-sounds.js';
import { GARBAGE } from '../src/engine/field.js';
import { createMatch, stepMatch } from '../src/engine/match.js';

function audioHarness() {
  const starts = [];
  const context = { currentTime: 0, state: 'running', sampleRate: 44100,
    createBuffer: (_, length) => { const samples = new Float32Array(length); return { getChannelData: () => samples }; },
    createBufferSource: () => ({ connect: (target) => target, disconnect() {}, stop() {},
      start() { starts.push(this.buffer); } }),
    createGain: () => ({ gain: { value: 0, setTargetAtTime() {} }, connect() {}, disconnect() {} }),
  };
  const buffers = new Map(Object.values(FOLEY_FILES).flat().map((file) => [file, { file }]));
  return { sfx: { context, master: {}, buffers, enabled: true }, starts };
}

test('회전은 변주를 순환하고 같은 프레임의 중복음은 막으며 음소거를 지킨다', () => {
  const { sfx, starts } = audioHarness();
  for (let i = 0; i < 5; i++) { sfx.context.currentTime = i * .05; playSfx(sfx, 'rotate'); }
  assert.equal(new Set(starts.slice(0, 4)).size, 4);
  assert.ok(starts.every(buffer => !buffer.file));
  assert.equal(starts[0], starts[4]);
  playSfx(sfx, 'rotate'); assert.equal(starts.length, 5);
  sfx.enabled = false; sfx.context.currentTime += 1; playSfx(sfx, 'rotate');
  assert.equal(starts.length, 5);
});

test('큰 방해 예고는 무거운 소리를 쓰고 플레이어별 중복 제한은 독립적이다', () => {
  const { sfx, starts } = audioHarness();
  playSfx(sfx, 'warning', { total: 6, channel: 0 });
  playSfx(sfx, 'warning', { total: 200, channel: 1 });
  assert.ok(starts[0].file.includes('/warning-'));
  assert.ok(starts[1].file.includes('/warning-heavy-'));
});

test('일부 녹음 파일을 못 읽어도 나머지를 준비하고 자료가 없으면 대체음으로 넘긴다', async (t) => {
  t.mock.method(globalThis, 'fetch', async (file) => ({ ok: !file.endsWith('rotate-02.wav'), arrayBuffer: async () => new ArrayBuffer(2) }));
  const sfx = { context: { decodeAudioData: async () => ({ decoded: true }) } };
  const loaded = await preloadRecordedSfx(sfx);
  assert.equal(loaded, Object.values(FOLEY_FILES).flat().length - 1);
  assert.equal(playRecordedSfx({ buffers: new Map() }, 'rotate'), false);
});

test('예고 증가·일반 착지·잡초 착지를 구분하고 정지한 착지 카운터는 반복하지 않는다', () => {
  const before = createMatch({ seed: 4 }).players[0], after = structuredClone(before);
  after.board.cells[80] = 1; after.board.land[80] = 1;
  after.board.cells[81] = GARBAGE; after.board.land[81] = 1;
  after.stocks.a = 30;
  const original = structuredClone(after);
  assert.deepEqual(boardSoundEvents(before, after), [
    { type: 'land', amount: 1 }, { type: 'garbageLand', amount: 1 }, { type: 'warning', amount: 30, total: 30 },
  ]);
  assert.deepEqual(boardSoundEvents(after, after), []);
  assert.deepEqual(after, original);
  const decreased = structuredClone(after); decreased.stocks.a = 6;
  assert.deepEqual(boardSoundEvents(after, decreased), []);
});

test('낙하 중인 쌍의 첫 접촉에 소리가 나고 나중의 고정 이벤트에서 중복되지 않는다', () => {
  let match = createMatch({ seed: 4, playerCount: 1 });
  let touchedAt = null, lockedAt = null;
  for (let frame = 1; frame <= 500; frame++) {
    const before = match.players[0]; match = stepMatch(match, [0]);
    const after = match.players[0], sounds = boardSoundEvents(before, after);
    if (sounds.some((s) => s.type === 'land') && touchedAt === null) touchedAt = frame;
    if (after.events.some((e) => e.type === 'lock')) {
      lockedAt = frame;
      assert.ok(!sounds.some((s) => s.type === 'land'));
      break;
    }
  }
  assert.ok(touchedAt !== null && touchedAt < lockedAt);
});
