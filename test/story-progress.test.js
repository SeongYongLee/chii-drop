import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FINAL, FLOORS, SECRET_FINAL } from '../src/story/campaign.js';
import {
  afterCeremony,
  applyMatchResult,
  createRecords,
  createRun,
  nextOpponents,
  secretUnlocked,
  timeBonus,
} from '../src/story/progress.js';

// seconds를 크게 주면 시간 보너스가 0이라 점수 계산이 단순해진다.
function win(state, opponent, { score = 1000 } = {}) {
  return applyMatchResult(state.run, state.records, { opponent, won: true, score, seconds: 999 });
}

function clearFloor(state, floor, { hidden = false } = {}) {
  const target = hidden ? floor.hiddenThreshold : floor.threshold;
  let next = win(state, floor.ordinary[0], { score: Math.max(0, target - state.run.score) });
  if (hidden) {
    assert.equal(next.run.stage, 'hidden');
    next = win(next, floor.hidden);
  }
  assert.equal(next.run.stage, 'fixed');
  return win(next, floor.fixed);
}

test('첫 층은 일반 상대 후보 전체에서 시작한다', () => {
  const run = createRun();
  assert.deepEqual(nextOpponents(run), FLOORS[0].ordinary);
});

test('누적 점수가 기준에 닿으면 고정 상대가 나오고, 이기면 다음 층으로 간다', () => {
  let state = { run: createRun(), records: createRecords() };
  state = win(state, FLOORS[0].ordinary[0], { score: FLOORS[0].threshold - 1 });
  assert.equal(state.run.stage, 'ordinary');
  assert.ok(!nextOpponents(state.run).includes(FLOORS[0].ordinary[0]));
  state = win(state, FLOORS[0].ordinary[1], { score: 1 });
  assert.deepEqual(nextOpponents(state.run), [FLOORS[0].fixed]);
  state = win(state, FLOORS[0].fixed);
  assert.equal(state.run.floorIndex, 1);
  assert.equal(state.run.stage, 'ordinary');
});

test('고정 상대가 나올 때 컨티뉴 0회이고 히든 기준 이상이면 히든전 뒤에 고정 상대와 싸운다', () => {
  let state = { run: createRun(), records: createRecords() };
  state = win(state, FLOORS[0].ordinary[0], { score: FLOORS[0].hiddenThreshold });
  assert.deepEqual(nextOpponents(state.run), [FLOORS[0].hidden]);
  assert.ok(state.records.hiddenMet.includes(FLOORS[0].hidden));
  state = win(state, FLOORS[0].hidden);
  assert.deepEqual(nextOpponents(state.run), [FLOORS[0].fixed]);
  assert.ok(state.records.hiddenWon.includes(FLOORS[0].hidden));
});

test('패배는 경기 점수만 더하고 컨티뉴를 늘리며, 컨티뉴가 있으면 히든이 나오지 않는다', () => {
  const state = { run: createRun(), records: createRecords() };
  const lost = applyMatchResult(state.run, state.records, { opponent: 'x', won: false, score: 500, seconds: 10 });
  assert.equal(lost.run.stage, 'ordinary');
  assert.equal(lost.run.continues, 1);
  assert.equal(lost.run.score, 500);
  const after = win(lost, FLOORS[0].ordinary[0], { score: FLOORS[0].hiddenThreshold });
  assert.equal(after.run.stage, 'fixed');
});

test('승리 시간 보너스는 빨리 이길수록 크다 (14.2절)', () => {
  assert.equal(timeBonus(200), 0);
  assert.equal(timeBonus(100), 400);
  assert.equal(timeBonus(80), 1500);
  assert.equal(timeBonus(50), 6500);
  assert.equal(timeBonus(30), 14500);
  assert.equal(timeBonus(0), 29500);
});

test('결승 우승 뒤 히든 네 명을 모두 이긴 기록이 있으면 추가 경기가 열린다', () => {
  let state = { run: createRun(), records: createRecords() };
  for (const floor of FLOORS) {
    state = clearFloor(state, floor, { hidden: true });
  }
  assert.deepEqual(nextOpponents(state.run), [FINAL]);
  state = win(state, FINAL);
  assert.equal(state.run.stage, 'ceremony');
  assert.ok(secretUnlocked(state.records));
  const run = afterCeremony(state.run, state.records);
  assert.deepEqual(nextOpponents(run), [SECRET_FINAL]);
  state = win({ run, records: state.records }, SECRET_FINAL);
  assert.equal(state.run.stage, 'secretEnding');
  assert.equal(state.records.secretCleared, true);
});

test('히든 승리 기록은 회차를 넘어 이어진다', () => {
  const first = clearFloor({ run: createRun(), records: createRecords() }, FLOORS[0], { hidden: true });
  let state = { run: createRun(), records: first.records };
  assert.ok(state.records.hiddenWon.includes(FLOORS[0].hidden));
  for (const floor of FLOORS) {
    state = clearFloor(state, floor);
  }
  state = win(state, FINAL);
  assert.equal(afterCeremony(state.run, state.records).stage, 'done');
});
