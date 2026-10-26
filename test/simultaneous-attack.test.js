import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMatch, stepMatch } from '../src/engine/match.js';
import { fieldFromRows, findGroups } from '../src/engine/field.js';

function readyAttacks(amounts, delay = 0) {
  const cells = fieldFromRows(['1111..']);
  const match = createMatch({ seed: 3, fields: [cells, cells] });
  match.players = match.players.map((player, i) => ({ ...player,
    phase: 'flash', phaseTimer: 1 + (i === 1 ? delay : 0), chain: 2,
    garbagePool: amounts[i] * 70 - 320,
    eraseCount: 4, groups: findGroups(player.board.cells),
  }));
  return match;
}

test('동일 프레임의 같은 공격은 2P가 날아오는 재고를 상쇄하며 재도착하지 않는다', () => {
  const before = readyAttacks([8, 8]);
  const snapshot = structuredClone(before);
  let match = stepMatch(before, [0, 0]);
  assert.deepEqual(before, snapshot, '입력 상태는 변경하지 않는다');
  assert.deepEqual(match.players.map(p => p.stocks), [{ a: 0, b: 0, c: 0 }, { a: 0, b: 0, c: 0 }]);
  assert.ok(match.players[1].events.some(e => e.type === 'offset' && e.amount === 8));
  assert.ok(!match.players[1].events.some(e => e.type === 'attack'));
  match.players = match.players.map(p => ({ ...p, phase: 'next', phaseTimer: 1000, eraseCount: 0 }));
  for (let i = 0; i < 70; i++) match = stepMatch(match, [0, 0]);
  assert.deepEqual(match.players.map(p => p.stocks), [{ a: 0, b: 0, c: 0 }, { a: 0, b: 0, c: 0 }]);
});

test('동시 공격량이 다르면 더 큰 공격의 차이만 남는다', () => {
  for (const amounts of [[8, 12], [12, 8]]) {
    let match = stepMatch(readyAttacks(amounts), [0, 0]);
    const expected = amounts[0] > amounts[1] ? [0, 4] : [4, 0];
    assert.deepEqual(match.players.map(p => p.stocks.c), expected);
    match.players = match.players.map(p => ({ ...p, phase: 'next', phaseTimer: 1000, eraseCount: 0 }));
    for (let i = 0; i < 70; i++) match = stepMatch(match, [0, 0]);
    assert.deepEqual(match.players.map(p => p.stocks.a), expected);
  }
});

test('1프레임 차이의 공격도 같은 양이면 상쇄한다', () => {
  let match = readyAttacks([8, 8], 1);
  match = stepMatch(stepMatch(match, [0, 0]), [0, 0]);
  assert.deepEqual(match.players.map(p => p.stocks.c), [0, 0]);
});
