import assert from 'node:assert/strict';
import { test } from 'node:test';

import { READY_FRAMES, createSession, sessionPlayers, stepSession } from '../src/app/session.js';
import { INPUT } from '../src/engine/input.js';

function stepMany(session, inputs, frames) {
  let current = session;
  for (let i = 0; i < frames; i++) {
    current = stepSession(current, inputs);
  }
  return current;
}

test('준비 시간 동안에는 엔진을 진행하지 않는다', () => {
  const session = createSession({ mode: 'solo', seed: 1 });
  const ready = stepMany(session, [INPUT.DOWN, 0], READY_FRAMES - 1);
  assert.equal(ready.phase, 'ready');
  assert.equal(ready.match.frame, 0);
  const playing = stepSession(ready, [INPUT.DOWN, 0]);
  assert.equal(playing.phase, 'playing');
});

test('혼자하기에서 막히면 결과 화면으로 넘어간다', () => {
  const session = stepMany(createSession({ mode: 'solo', seed: 4 }), [INPUT.DOWN, 0], 5000);
  assert.equal(session.phase, 'result');
  assert.equal(session.match.players[0].lost, true);
});

test('CPU 대전은 두 번째 플레이어를 CPU가 조작해 승패까지 진행한다', () => {
  const session = createSession({ mode: 'cpu', seed: 9, cpuLevel: 'normal', cpuSeed: 2 });
  assert.equal(sessionPlayers(session).length, 2);
  const done = stepMany(session, [INPUT.DOWN, 0], 20000);
  assert.equal(done.phase, 'result');
  assert.equal(done.match.winner, 1);
});

test('같은 시드와 입력이면 둘이서 대전 결과가 같다', () => {
  const inputs = [INPUT.DOWN | INPUT.LEFT, INPUT.DOWN];
  const a = stepMany(createSession({ mode: 'versus', seed: 3 }), inputs, 3000);
  const b = stepMany(createSession({ mode: 'versus', seed: 3 }), inputs, 3000);
  assert.deepEqual(a, b);
});
