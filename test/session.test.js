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

test('CPU 관전은 양쪽 난이도와 난수를 분리하고 사람 입력 없이 같은 경기로 진행한다', () => {
  const options = { mode: 'watch', seed: 11, cpuSeed: 7, cpuLevels: ['normal', 'hard'] };
  const session = createSession(options);
  assert.equal(session.cpuLeft.level, 'normal');
  assert.equal(session.cpu.level, 'hard');
  assert.notDeepEqual(session.cpuLeft.rng, session.cpu.rng);
  const ready = stepMany(session, [0, 0], READY_FRAMES);
  assert.equal(ready.match.frame, 0);
  assert.deepEqual(ready.cpuLeft, session.cpuLeft);
  assert.deepEqual(ready.cpu, session.cpu);
  const a = stepMany(session, [0, 0], 1000);
  const b = stepMany(createSession(options), [INPUT.DOWN | INPUT.LEFT | INPUT.ROTATE_CW, INPUT.RIGHT], 1000);
  assert.deepEqual(a, b);
  assert.ok(a.match.players.every(player => player.board.cells.some(Boolean)), '양쪽 모두 실제로 블록을 쌓는다');
});

test('CPU 관전도 패배 연출이 끝나면 결과 화면에서 멈춘다', () => {
  const session = createSession({ mode: 'watch', seed: 3, cpuSeed: 5 });
  session.phase = 'playing';
  session.match.players[0].board.cells[2 * 6 + 2] = 9;
  session.match.players[0].phase = 'turn-start';
  const done = stepMany(session, [0, 0], 300);
  assert.equal(done.phase, 'result');
  assert.equal(done.match.winner, 1);
  assert.equal(stepSession(done, [INPUT.DOWN, INPUT.DOWN]), done);
});
