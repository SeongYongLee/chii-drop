import assert from 'node:assert/strict';
import test from 'node:test';
import { CPU_LEVELS, createCpu, stepCpu } from '../src/cpu/cpu.js';
import { createMatch, stepMatch } from '../src/engine/match.js';
import { INPUT } from '../src/engine/input.js';
import { COLS, ROWS } from '../src/engine/rules.js';

function ready(level, scenario = 'aligned') {
  const match = createMatch({ seed: 12, playerCount: 1 });
  match.players[0].phase = 'control';
  const cpu = { ...createCpu({ level, seed: 7 }), planned: true, wait: 0,
    target: { x: scenario === 'aligned' ? 2 : -1, orient: 0 },
    giveUp: scenario === 'blocked', frames: scenario === 'timeout' ? 100 : 0 };
  return { match, cpu };
}

function fall(level, scenario = 'aligned') {
  let { match, cpu } = ready(level, scenario);
  const inputs = [], heights = [];
  for (let frame = 0; frame < 600 && !match.players[0].piece.locked && match.players[0].phase === 'control'; frame++) {
    const result = stepCpu(cpu, match.players[0], match.table);
    cpu = result.cpu;
    inputs.push(result.input);
    match = stepMatch(match, [result.input]);
    heights.push(match.players[0].piece.h);
  }
  assert.ok(match.players[0].piece.locked, `${level}: 블록이 고정되지 않았다`);
  return { inputs, heights };
}

test('조작 후 한 번 기다렸다가 고정될 때까지 아래 입력을 연속으로 유지한다', () => {
  const waits = CPU_LEVELS.map(({ id }) => {
    const { inputs, heights } = fall(id);
    const firstDrop = inputs.indexOf(INPUT.DOWN);
    if (id === 'master') assert.equal(firstDrop, 0, '아주 어려움은 조작 후 즉시 내려야 한다');
    else assert.ok(firstDrop > 0, `${id}: 조작 후 대기가 있어야 한다`);
    assert.ok(inputs.slice(0, firstDrop).every(input => input === 0));
    assert.ok(inputs.slice(firstDrop).every(input => input === INPUT.DOWN), `${id}: 낙하 중 입력을 끊었다`);
    assert.ok(heights[10] < heights[0], '대기 중에도 자연 낙하가 계속되어야 한다');
    return firstDrop;
  });
  waits.forEach((wait, i) => { if (i) assert.ok(wait < waits[i - 1], '상위 난이도는 조작 후 더 짧게 기다려야 한다'); });
});

test('이동 포기·시간 초과에도 같은 대기 후 연속 낙하를 사용한다', () => {
  for (const { id } of CPU_LEVELS) {
    assert.deepEqual(fall(id, 'blocked'), fall(id));
    assert.deepEqual(fall(id, 'timeout'), fall(id));
  }
});

test('이동·회전 애니메이션이 끝나기 전에는 낙하 대기를 시작하지 않는다', () => {
  const { match, cpu } = ready('normal');
  const p = match.players[0];
  p.piece.moveFrames = 1; p.piece.rotateFrames = 3;
  const before = structuredClone(match);
  const result = stepCpu(cpu, p, match.table);
  assert.equal(result.input, 0); assert.equal(result.cpu.dropWait, null);
  assert.deepEqual(match, before);
  p.piece.moveFrames = 0; p.piece.rotateFrames = 0;
  assert.ok(stepCpu(result.cpu, p, match.table).cpu.dropWait > 0);
});

test('필드가 높으면 대기를 줄이고 이미 바닥에 닿았으면 즉시 아래를 누른다', () => {
  for (const { id } of CPU_LEVELS) {
    const { match, cpu } = ready(id), p = match.players[0];
    const empty = stepCpu(cpu, p, match.table).cpu.dropWait;
    for (let y = ROWS - 6; y < ROWS; y++) p.board.cells[y * COLS + 2] = 1 + y % 2;
    const high = stepCpu(cpu, p, match.table).cpu.dropWait;
    if (id === 'master') assert.equal(high, 0);
    else assert.ok(high < empty);
    p.board.cells.fill(0); p.piece.h = 0;
    const grounded = stepCpu(cpu, p, match.table);
    assert.equal(grounded.input, INPUT.DOWN); assert.equal(grounded.cpu.dropWait, 0);
  }
});

test('아주 어려움은 대기 편차와 무관하게 즉시 연속 낙하한다', () => {
  for (const jitter of [-2, -1, 0, 1, 2]) {
    const { match, cpu } = ready('master');
    cpu.dropJitter = jitter;
    const result = stepCpu(cpu, match.players[0], match.table);
    assert.equal(result.input, INPUT.DOWN);
    assert.equal(result.cpu.dropWait, 0);
  }
});

test('같은 시드는 대기 편차도 같고 새 쌍을 계획할 때 이전 낙하 상태를 초기화한다', () => {
  const match = createMatch({ seed: 12 }), before = structuredClone(match);
  for (const { id } of CPU_LEVELS) {
    const plan = () => {
      let cpu = { ...createCpu({ level: id, seed: 7 }), dropWait: 0 };
      for (let frame = 0; frame < 30 && !cpu.planned; frame++) cpu = stepCpu(cpu, match.players[0], match.table).cpu;
      assert.ok(cpu.planned && Number.isInteger(cpu.rng));
      assert.equal(cpu.dropWait, null);
      return cpu;
    };
    assert.deepEqual(plan(), plan());
  }
  assert.deepEqual(match, before);
});
