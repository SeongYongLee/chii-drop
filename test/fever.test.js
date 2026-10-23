import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fieldFromRows, findGroups } from '../src/engine/field.js';
import { finishFeverChain } from '../src/engine/fever.js';
import { createMatch, stepMatch } from '../src/engine/match.js';
import { createRng } from '../src/engine/rng.js';
import { FEVER_START_FRAMES, REVIVE_FRAMES } from '../src/engine/rules.js';

const BLOCKED = fieldFromRows(new Array(12).fill('..1...'));

function bossMatch() {
  const match = createMatch({ seed: 7, boss: 1, fields: [undefined, BLOCKED] });
  const players = match.players.slice();
  players[1] = { ...players[1], phase: 'turn-start', stocks: { a: 4, b: 0, c: 0 } };
  return { ...match, players };
}

function run(match, frames) {
  let current = match;
  for (let i = 0; i < frames; i++) {
    current = stepMatch(current, [0, 0]);
  }
  return current;
}

function feverPlayer(target, extra = {}) {
  return {
    events: [],
    feverRng: createRng(3),
    fever: { timer: 600, target, seed: null, held: { a: 0, b: 0, c: 0 }, allClear: false, ...extra },
  };
}

test('보스는 첫 패배 조건에서 지지 않고 부활한 뒤 5연쇄 배치로 피버에 들어간다', () => {
  let match = run(bossMatch(), 1);
  const boss = match.players[1];
  assert.equal(boss.phase, 'revive');
  assert.equal(boss.lost, false);
  assert.equal(match.phase, 'playing');
  assert.equal(boss.fever.target, 5);
  assert.deepEqual(boss.fever.held, { a: 4, b: 0, c: 0 });
  assert.deepEqual(boss.stocks, { a: 0, b: 0, c: 0 });

  match = run(match, REVIVE_FRAMES);
  const fevered = match.players[1];
  assert.ok(fevered.board.cells.some((c) => c !== 0));
  assert.equal(findGroups(fevered.board.cells).length, 0);
  assert.ok(fevered.fever.timer <= FEVER_START_FRAMES && fevered.fever.timer > FEVER_START_FRAMES - 30);
});

test('연쇄 결과에 따라 다음 배치 크기가 정해진다 (15.1절)', () => {
  assert.equal(finishFeverChain(feverPlayer(5), 5).fever.target, 6);
  assert.equal(finishFeverChain(feverPlayer(5), 7).fever.target, 8);
  assert.equal(finishFeverChain(feverPlayer(5), 4).fever.target, 5);
  assert.equal(finishFeverChain(feverPlayer(5), 3).fever.target, 4);
  assert.equal(finishFeverChain(feverPlayer(5), 1).fever.target, 3);
  assert.equal(finishFeverChain(feverPlayer(15), 15).fever.target, 15);
  assert.equal(finishFeverChain(feverPlayer(5, { allClear: true }), 5).fever.target, 8);
});

test('피버 중 연쇄가 끝나면 3연쇄부터 0.5초씩 시간이 늘어난다', () => {
  assert.equal(finishFeverChain(feverPlayer(5), 2).fever.timer, 600);
  assert.equal(finishFeverChain(feverPlayer(5), 3).fever.timer, 630);
  assert.equal(finishFeverChain(feverPlayer(5), 6).fever.timer, 720);
  assert.equal(finishFeverChain(feverPlayer(5, { timer: 0 }), 6).fever.timer, 0);
});

test('피버 시간이 끝나면 빈 필드로 돌아가고 피버 예고를 일반 예고에 더한다', () => {
  let match = run(bossMatch(), 1 + REVIVE_FRAMES);
  const players = match.players.slice();
  players[1] = {
    ...players[1],
    phase: 'turn-start',
    fever: { ...players[1].fever, timer: 1 },
    stocks: { a: 2, b: 1, c: 0 },
  };
  match = run({ ...match, players }, 1);
  const boss = match.players[1];
  assert.equal(boss.fever, null);
  assert.ok(boss.board.cells.every((c) => c === 0));
  assert.deepEqual(boss.stocks, { a: 6, b: 1, c: 0 });
});

test('부활은 한 번뿐이고 두 번째 패배 조건에서는 진다', () => {
  let match = run(bossMatch(), 1 + REVIVE_FRAMES);
  const players = match.players.slice();
  players[1] = { ...players[1], phase: 'turn-start', board: { ...players[1].board, cells: BLOCKED.slice() } };
  match = run({ ...match, players }, 5);
  assert.equal(match.phase, 'over');
  assert.equal(match.winner, 0);
});
