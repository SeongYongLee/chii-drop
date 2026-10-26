import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMatch } from '../src/engine/match.js';
import { createEffects, tickCharacters, tickEffect, setMood } from '../src/view/effects.js';
import { drawGame } from '../src/view/renderer.js';
import { drawFieldChain, FIELD_CHAIN_FRAMES, FIELD_CHAIN_FADE, fieldChainPresentation } from '../src/view/field-chain.js';

test('1연쇄부터 독립 시계로 재생하며 새 연쇄에서 재시작하고 최대 수명에 종료한다', () => {
  const match = createMatch({ seed: 42, playerCount: 1 }), player = match.players[0];
  const [effect] = createEffects(1);
  let age = 0;
  for (const chain of [1, 2, 3, 4, 5, 7]) {
    player.events = [{ type: 'clear', chain, points: 40, groups: [{ cells: [{ x: 0, y: 12 }] }] }];
    const before = structuredClone(match);
    tickEffect(effect, player, { table: match.table, opponentSide: null });
    assert.deepEqual(match, before);
    assert.deepEqual(effect.fieldChain, chain < 1 ? null : { chain, frame: 0, age, endFrame: null });
    tickCharacters([effect]);
    if (chain >= 1) age += 1;
  }
  setMood(effect, 'sad'); // 중앙 초상화가 피격으로 바뀌어도 이미 시작한 연쇄 컷은 유지한다.
  assert.equal(effect.fieldChain.frame, 1);
  player.events = [{ type: 'chainEnd', chain: 7 }];
  tickEffect(effect, player, { table: match.table, opponentSide: null });
  for (let i = 0; i < FIELD_CHAIN_FRAMES + FIELD_CHAIN_FADE*4; i++) tickCharacters([effect]);
  assert.equal(effect.fieldChain, null);
});

test('허용된 캐릭터만 필드 안에 불투명하게 그리고 블록은 그 위에 그린다', () => {
  for (const height of [540, 1600]) {
    const match = createMatch({ seed: 42, playerCount: 1 }), effects = createEffects(1), calls = [];
    effects[0].fieldChain = { chain: 5, frame: 12 };
    match.players[0].board.cells[13 * 6] = 1;
    const stack = [];
    const ctx = new Proxy({ canvas: { width: 960, height }, globalAlpha: 1,
      save() { stack.push(this.globalAlpha); }, restore() { this.globalAlpha = stack.pop(); },
      measureText: () => ({ width: 20 }),
    }, { get: (target, key) => key in target ? target[key] : (...args) => calls.push([key, ...args]) });
    const skin = { fieldChainCharacters: ['char-1'], drawBackground() {},
      drawBlob() { calls.push(['blob']); },
      drawCharacter(ctx, id, mood, x, y, size, motion) { calls.push(['character', motion.instance, ctx.globalAlpha, motion.chain, motion.frame]); },
    };
    drawGame(ctx, { skin, match, effects, characters: [{ id: 'char-1', name: 'Character' }], showGhost: false });
    const index = calls.findIndex(c => c[0] === 'character' && c[1] === 'field-chain-0');
    assert.ok(index >= 0);
    assert.deepEqual(calls[index].slice(2), [1, 5, 0]);
    assert.ok(!calls.some(c => c[0] === 'character' && c[1] === 'portrait-0'));
    assert.ok(calls.some(c => c[0] === 'fillText' && c[1] === 'Character'));
    assert.ok(calls.slice(0, index).some(c => c[0] === 'clip'));
    assert.ok(calls.findIndex(c => c[0] === 'blob') > index);
    const count = calls.length;
    drawFieldChain(ctx, skin, { id: 'char-2' }, effects[0], match.players[0], 32);
    match.players[0].lost = true;
    drawFieldChain(ctx, skin, { id: 'char-1' }, effects[0], match.players[0], 32);
    assert.equal(calls.length, count);
    assert.equal(stack.length, 0);
  }
});

test('중앙과 필드 그림은 순서대로 부드럽게 전환하며 동시에 보이지 않는다', () => {
  const skin = { fieldChainCharacters: ['char-1'], fieldChainFrames: () => 60 };
  const character = { id: 'char-1' }, player = { lost: false };
  const effect = { fieldChain: { chain: 3, frame: 0, age: 0, endFrame: 80 } };
  const states = [];
  for (let frame = 0; frame <= 100; frame++) {
    Object.assign(effect.fieldChain, { frame, age: frame });
    const before = structuredClone(effect);
    const state = fieldChainPresentation(skin, character, effect, player, false);
    states.push(state);
    assert.ok(state.fieldAlpha >= 0 && state.fieldAlpha <= 1);
    assert.ok(state.portraitAlpha >= 0 && state.portraitAlpha <= 1);
    assert.equal(state.fieldAlpha * state.portraitAlpha, 0);
    assert.deepEqual(effect, before);
    if (frame) {
      assert.ok(Math.abs(state.fieldAlpha-states[frame-1].fieldAlpha) < .25);
      assert.ok(Math.abs(state.portraitAlpha-states[frame-1].portraitAlpha) < .25);
    }
  }
  assert.equal(states[0].portraitAlpha, 1);
  assert.equal(states[12].fieldAlpha, 1);
  assert.equal(states[12].frame, 0, '입장 전환이 클립의 첫 동작을 건너뛰지 않는다');
  assert.equal(states[100].portraitAlpha, 1);
  Object.assign(effect.fieldChain, { frame: 250, age: 250, endFrame: null });
  assert.equal(fieldChainPresentation(skin, character, effect, player, false).portraitAlpha, 0, '다음 연쇄를 기다리는 동안 중앙이 깜빡이지 않는다');
  Object.assign(effect.fieldChain, { chain: 5, frame: 0 });
  const continued = fieldChainPresentation(skin, character, effect, player, false);
  assert.equal(continued.fieldAlpha, 1); assert.equal(continued.portraitAlpha, 0); assert.equal(continued.frame, 0);
  assert.equal(fieldChainPresentation(skin, character, effect, { lost: true }, false).portraitAlpha, 1);
  Object.assign(effect.fieldChain, { frame: 0, age: 0, endFrame: 80 });
  assert.equal(fieldChainPresentation(skin, character, effect, player, true).fieldAlpha, 1);
});
