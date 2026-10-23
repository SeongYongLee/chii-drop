import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dropPair, generateFeverSeed, simulateChain } from '../src/engine/fever-seeds.js';
import { EMPTY, fieldFromRows, findGroups, getCell } from '../src/engine/field.js';
import { createRng } from '../src/engine/rng.js';
import { COLS, DEATH_X, DEATH_Y, ROWS } from '../src/engine/rules.js';

const SEEDS = [1, 42, 777, 2024, 65535];

function columnHeight(cells, x) {
  let height = 0;
  for (let y = ROWS - 1; y >= 0 && getCell(cells, x, y) !== EMPTY; y--) {
    height += 1;
  }
  return height;
}

function isSettled(cells) {
  for (let x = 0; x < COLS; x++) {
    let seenEmpty = false;
    for (let y = ROWS - 1; y >= 0; y--) {
      const empty = getCell(cells, x, y) === EMPTY;
      if (!empty && seenEmpty) {
        return false;
      }
      seenEmpty ||= empty;
    }
  }
  return true;
}

test('simulateChain: 바로 터지는 계단 2연쇄를 센다', () => {
  assert.equal(simulateChain(fieldFromRows(['2.....', '12....', '12....', '12....'])), 0);
  assert.equal(simulateChain(fieldFromRows(['2.....', '12....', '12....', '12....', '1.....'])), 2);
});

test('dropPair: 세로 쌍은 축이 아래, 가로 쌍은 각 열 꼭대기에 따로 내려앉는다', () => {
  const cells = fieldFromRows(['1.....', '1.....']);
  const vertical = dropPair(cells, 0, 0, [2, 3]);
  assert.equal(getCell(vertical, 0, 11), 2);
  assert.equal(getCell(vertical, 0, 10), 3);
  const horizontal = dropPair(cells, 0, 1, [2, 3]);
  assert.equal(getCell(horizontal, 0, 11), 2);
  assert.equal(getCell(horizontal, 1, 13), 3);
  const left = dropPair(cells, 1, 3, [4, 2]);
  assert.equal(getCell(left, 1, 13), 4);
  assert.equal(getCell(left, 0, 11), 2);
});

for (let chain = 3; chain <= 15; chain++) {
  test(`generateFeverSeed: ${chain}연쇄 씨앗이 조건을 지키고 정확히 ${chain}연쇄를 낸다`, () => {
    for (const seed of SEEDS) {
      const result = generateFeverSeed(createRng(seed * 31 + chain), chain);
      const { cells, trigger } = result;
      assert.equal(cells.length, COLS * ROWS);
      assert.equal(result.chain, chain);
      assert.ok(isSettled(cells), 'seed is settled');
      assert.equal(findGroups(cells).length, 0, 'seed is stable before the trigger');
      assert.equal(simulateChain(cells), 0);
      assert.equal(getCell(cells, DEATH_X, DEATH_Y), EMPTY);
      assert.equal(getCell(cells, DEATH_X, DEATH_Y - 1), EMPTY);
      for (let x = 0; x < COLS; x++) {
        assert.ok(columnHeight(cells, x) <= 11, `column ${x} fits in 11 rows`);
      }
      assert.ok(columnHeight(cells, DEATH_X) <= 10, 'spawn column leaves room');
      assert.ok(cells.every((color) => color >= EMPTY && color <= 4));
      assert.ok(trigger.color >= 1 && trigger.color <= 4);
      assert.equal(trigger.pair[0], trigger.color);
      const example = dropPair(cells, trigger.x, trigger.orient, trigger.pair);
      assert.ok(example, 'example pair can be placed');
      assert.equal(simulateChain(example), chain);
      assert.ok(result.triggerColumns.includes(trigger.x));
      // 트리거 열 꼭대기에 떨어진 칸이 기다리던 같은 색 3칸과 바로 묶여야 한다.
      const landedY = ROWS - 1 - columnHeight(cells, trigger.x);
      const firstClear = findGroups(example);
      assert.equal(firstClear.length, 1);
      assert.equal(firstClear[0].color, trigger.color);
      assert.equal(firstClear[0].cells.length, 4);
      assert.ok(firstClear[0].cells.some(({ x, y }) => x === trigger.x && y === landedY));
      // 트리거 색을 아래로 둔 세로 쌍이면 위 칸 색과 상관없이 같은 연쇄가 나와야 한다.
      for (const x of result.triggerColumns) {
        for (let top = 1; top <= 4; top++) {
          const dropped = dropPair(cells, x, 0, [trigger.color, top]);
          assert.ok(dropped, `pair fits in column ${x}`);
          assert.equal(simulateChain(dropped), chain, `column ${x}, top color ${top}`);
        }
      }
    }
  });
}

test('generateFeverSeed: 같은 rng면 같은 결과, 다른 rng면 다른 배치', () => {
  const a = generateFeverSeed(createRng(99), 12);
  const b = generateFeverSeed(createRng(99), 12);
  assert.deepEqual(a, b);
  const others = SEEDS.map((seed) => generateFeverSeed(createRng(seed), 12).cells.join(''));
  assert.ok(new Set(others).size > 1);
  assert.notEqual(a.rng, createRng(99));
});

test('generateFeverSeed: 색 수를 3으로 줄여도 만든다', () => {
  for (const seed of SEEDS) {
    const { cells, trigger } = generateFeverSeed(createRng(seed), 8, 3);
    assert.ok(cells.every((color) => color <= 3));
    for (let top = 1; top <= 3; top++) {
      assert.equal(simulateChain(dropPair(cells, trigger.x, 0, [trigger.color, top])), 8);
    }
  }
});

test('generateFeverSeed: 15연쇄도 충분히 빠르다', () => {
  const runs = 20;
  const start = performance.now();
  for (let seed = 0; seed < runs; seed++) {
    generateFeverSeed(createRng(seed + 1000), 15);
  }
  const average = (performance.now() - start) / runs;
  assert.ok(average < 60, `average ${average.toFixed(1)}ms`);
});

test('generateFeverSeed: 범위 밖 연쇄 수는 거부한다', () => {
  assert.throws(() => generateFeverSeed(1, 0), RangeError);
  assert.throws(() => generateFeverSeed(1, 16), RangeError);
});
