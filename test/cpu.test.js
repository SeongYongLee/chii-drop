import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CPU_LEVELS, createCpu, stepCpu } from '../src/cpu/cpu.js';
import { columnHeight, fieldFromRows } from '../src/engine/field.js';
import { createMatch, stepMatch } from '../src/engine/match.js';
import { DEATH_X, DEATH_Y, ROWS } from '../src/engine/rules.js';

function soloMatch(seed, cells, { pair, stocks } = {}) {
  const match = createMatch({ seed, playerCount: 1, fields: [cells] });
  const [player] = match.players;
  const piece = pair ? { ...player.piece, pivot: pair[0], child: pair[1] } : player.piece;
  return { ...match, players: [{ ...player, piece, stocks: stocks ?? player.stocks }] };
}

function playSolo(match, cpu, frames) {
  let current = match;
  let state = cpu;
  const inputs = [];
  const events = [];
  for (let i = 0; i < frames && current.phase !== 'over'; i++) {
    const result = stepCpu(state, current.players[0], current.table);
    state = result.cpu;
    inputs.push(result.input);
    current = stepMatch(current, [result.input]);
    events.push(...current.players[0].events);
  }
  return { match: current, inputs, events };
}

// 첫 쌍이 고정되고 연쇄까지 끝나 다음 쌍이 나올 때까지 진행한다.
function playOnePiece(match, cpu) {
  let current = match;
  let state = cpu;
  const events = [];
  for (let i = 0; i < 2000; i++) {
    const result = stepCpu(state, current.players[0], current.table);
    state = result.cpu;
    current = stepMatch(current, [result.input]);
    const [player] = current.players;
    events.push(...player.events);
    const locked = events.some((e) => e.type === 'lock');
    if ((locked && player.phase === 'next') || player.lost) {
      break;
    }
  }
  return { player: current.players[0], events };
}

function playMatch(seed, levels, limit) {
  let match = createMatch({ seed });
  let cpus = levels.map((level, i) => createCpu({ level, seed: seed * 31 + i }));
  while (match.phase !== 'over' && match.frame < limit) {
    const results = cpus.map((cpu, i) => stepCpu(cpu, match.players[i], match.table, match.players[1 - i]));
    cpus = results.map(({ cpu }) => cpu);
    match = stepMatch(
      match,
      results.map(({ input }) => input),
    );
  }
  return match;
}

test('CPU 난이도 목록은 입문부터 달인까지 일곱 단계다', () => {
  assert.deepEqual(
    CPU_LEVELS.map(({ id, label }) => [id, label]),
    [
      ['beginner', '입문'],
      ['easy', '아주 쉬움'],
      ['normal', '쉬움'],
      ['hard', '보통'],
      ['expert', '어려움'],
      ['master', '아주 어려움'],
      ['grandmaster', '달인'],
    ],
  );
});

test('같은 시드와 같은 플레이어 상태면 같은 입력을 낸다', () => {
  for (const { id } of CPU_LEVELS) {
    const a = playSolo(soloMatch(21), createCpu({ level: id, seed: 5 }), 1500);
    const b = playSolo(soloMatch(21), createCpu({ level: id, seed: 5 }), 1500);
    assert.deepEqual(a.inputs, b.inputs);
    assert.deepEqual(a.match, b.match);
  }
});

test('혼자 수천 프레임을 진행해도 오류 없이 많은 쌍을 놓는다', () => {
  for (const [level, minLocks] of [
    ['easy', 12],
    ['normal', 15],
    ['hard', 30],
  ]) {
    // 자연 낙하가 절반으로 느려졌으므로 같은 수의 쌍을 검증할 관찰 시간을 늘린다.
    const { events } = playSolo(soloMatch(3), createCpu({ level, seed: 9 }), 8000);
    const locks = events.filter((e) => e.type === 'lock').length;
    assert.ok(locks >= minLocks, `${level}: ${locks}개만 놓았다`);
  }
});

test('보통 CPU는 4개 묶음을 완성하는 자리를 고른다', () => {
  // 0열에 1이 세 개 쌓여 있고, 받을 방해 블록이 있어 지우는 편이 낫다.
  const cells = fieldFromRows(['1.....', '1.3.4.', '1.2.4.']);
  const match = soloMatch(1, cells, { pair: [1, 2], stocks: { a: 0, b: 6, c: 0 } });
  const { events } = playOnePiece(match, createCpu({ level: 'hard', seed: 1 }));
  const clear = events.find((e) => e.type === 'clear');
  assert.ok(clear, '지우기가 일어나지 않았다');
  assert.equal(clear.groups[0].color, 1);
});

test('다른 자리가 있으면 패배 칸이 있는 열을 꼭대기까지 쌓지 않는다', () => {
  // 3열이 10단까지 차 있어 세로로 얹으면 패배 칸이 막힌다.
  const column = Array.from({ length: 10 }, (_, i) => `..${(i % 2) + 1}...`);
  for (const { id } of CPU_LEVELS) {
    for (const seed of [1, 2, 3, 4, 5]) {
      const match = soloMatch(seed, fieldFromRows(column), { pair: [3, 4] });
      const { player } = playOnePiece(match, createCpu({ level: id, seed }));
      assert.equal(player.lost, false, `${id}/${seed}`);
      assert.ok(columnHeight(player.board.cells, DEATH_X) < ROWS - DEATH_Y, `${id}/${seed}`);
    }
  }
});

test('CPU끼리 대전해도 오류 없이 진행되고 쉬움이 아주 쉬움보다 많이 이긴다', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const results = seeds.map((seed) => playMatch(seed, ['normal', 'easy'], 30000));
  results.forEach((match) => {
    assert.ok(match.phase === 'over' || match.frame === 30000);
  });
  const normalWins = results.filter((match) => match.winner === 0).length;
  const easyWins = results.filter((match) => match.winner === 1).length;
  assert.ok(normalWins > easyWins, `쉬움 ${normalWins}승, 아주 쉬움 ${easyWins}승`);
});
