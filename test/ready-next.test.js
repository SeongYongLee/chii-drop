import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSession, stepSession, READY_FRAMES } from '../src/app/session.js';
import { createEffects, tickEffect } from '../src/view/effects.js';
import { createGameScene } from '../src/app/game-scene.js';
import { MOCK_SKIN } from './fixtures/presentation.js';
import { CELL, SIDES } from '../src/view/layout.js';

for (const mode of ['solo', 'cpu', 'versus', 'story']) test(`${mode}: 준비·시작 카운트다운 동안 첫 쌍이 NEXT에 남는다`, () => {
  let session = createSession({ mode, seed: 7, cpuLevel: 'normal', cpuSeed: 8 });
  const effects = createEffects(session.match.players.length), initial = structuredClone(session.match);
  const tick = () => session.match.players.forEach((player, i) => tickEffect(effects[i], player, {
    table: session.match.table, opponentSide: effects.length > 1 ? 1 - i : null,
  }));
  tick();
  for (let frame = 0; frame < READY_FRAMES; frame++) {
    session = stepSession(session, [0, 0]); tick();
    assert.deepEqual(session.match, initial);
    for (const effect of effects) {
      assert.equal(effect.next.frame, 0);
      assert.equal(effect.next.waiting, true);
      assert.deepEqual(effect.next.outgoing, initial.table[0]);
    }
  }
  assert.equal(session.phase, 'playing');
  for (let frame = 0; frame < 4; frame++) { session = stepSession(session, [0, 0]); tick(); }
  assert.ok(effects.every(effect => effect.next.frame > 0));
  assert.ok(session.match.players.every(player => player.piece));
});

test('게임 화면을 처음 그리기 전부터 첫 NEXT 쌍이 준비된다', () => {
  const scene = createGameScene({ mode: 'solo', characters: [{ id: 'actor-0', name: '참가자' }] });
  const calls = [], skin = { ...MOCK_SKIN, drawBlob(ctx, color, x, y) { calls.push({ x, y }); } };
  const ctx = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) });
  scene.draw(ctx, { skin, settings: { ghost: false } });
  assert.equal(calls.length, 4, '준비 중에는 첫 쌍과 다음 쌍만 표시하고 진입할 세 번째 쌍은 숨긴다');
  assert.ok(calls.some(call => call.x === SIDES[0].next1.x && call.y === SIDES[0].next1.y));
  assert.ok(calls.some(call => call.x === SIDES[0].next1.x && call.y === SIDES[0].next1.y - CELL));
});
