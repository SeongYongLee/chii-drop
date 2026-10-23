import { STORY_SCORE_CAP } from '../engine/rules.js';

import { FINAL, FLOORS, HIDDEN_IDS, SECRET_FINAL } from './campaign.js';

// stage: 'ordinary' | 'hidden' | 'fixed' | 'final' | 'ceremony' | 'secretFinal' | 'secretEnding'
function createRun() {
  return {
    floorIndex: 0,
    stage: 'ordinary',
    score: 0,
    defeated: [],
    hiddenMet: [],
    hiddenWonThisRun: [],
    continues: 0,
    matches: 0,
  };
}

// 회차를 넘어 유지하는 기록. 히든 네 명의 승리 기록이 모두 있으면 추가 경기가 열린다.
function createRecords() {
  return { hiddenMet: [], hiddenWon: [], mainCleared: false, secretCleared: false };
}

function currentFloor(run) {
  return FLOORS[run.floorIndex] ?? null;
}

function remainingOrdinary(run) {
  const floor = currentFloor(run);
  return floor ? floor.ordinary.filter((id) => !run.defeated.includes(id)) : [];
}

function nextOpponents(run) {
  const floor = currentFloor(run);
  switch (run.stage) {
    case 'ordinary':
      return remainingOrdinary(run);
    case 'hidden':
      return [floor.hidden];
    case 'fixed':
      return [floor.fixed];
    case 'final':
      return [FINAL];
    case 'secretFinal':
      return [SECRET_FINAL];
    default:
      return [];
  }
}

function secretUnlocked(records) {
  return HIDDEN_IDS.every((id) => records.hiddenWon.includes(id));
}

function addUnique(list, id) {
  return list.includes(id) ? list : [...list, id];
}

// 14.2절. 승리 시간 보너스. 빨리 이길수록 크다(최대 29,500).
function timeBonus(seconds) {
  const r = 140 - Math.floor(seconds);
  if (r <= 0) {
    return 0;
  }
  if (r < 50) {
    return 10 * r;
  }
  if (r < 80) {
    return 500 + 100 * (r - 50);
  }
  if (r < 100) {
    return 3500 + 300 * (r - 80);
  }
  return Math.min(29500, 9500 + 500 * (r - 100));
}

function addScore(score, gained) {
  return Math.min(STORY_SCORE_CAP, score + gained);
}

// 일반 상대 결과로 다음 단계를 정한다. 누적 점수가 기준에 닿거나 일반 상대가 남지 않으면
// 고정 상대가 나온다(이 게임의 변형 규칙). 그 순간 원작 히든 조건(컨티뉴 0, 히든 기준 점수 이상)을
// 만족하면 히든 상대가 먼저 나온다.
function afterOrdinaryWin(run, floor) {
  if (run.score < floor.threshold && remainingOrdinary(run).length > 0) {
    return run;
  }
  const hidden =
    !run.hiddenWonThisRun.includes(floor.hidden) && run.continues === 0 && run.score >= floor.hiddenThreshold;
  if (hidden) {
    return { ...run, stage: 'hidden', hiddenMet: addUnique(run.hiddenMet, floor.hidden) };
  }
  return { ...run, stage: 'fixed' };
}

// result: { opponent, won, score, seconds }
// 지면 그 경기 점수만 누적에 더하고 컨티뉴 횟수를 올린다. 이기면 시간 보너스도 더한다.
function applyMatchResult(run, records, result) {
  if (!result.won) {
    return {
      run: { ...run, score: addScore(run.score, result.score), continues: run.continues + 1, matches: run.matches + 1 },
      records,
    };
  }
  const floor = currentFloor(run);
  let next = {
    ...run,
    score: addScore(run.score, result.score + timeBonus(result.seconds ?? Infinity)),
    defeated: addUnique(run.defeated, result.opponent),
    matches: run.matches + 1,
  };
  let nextRecords = records;

  switch (run.stage) {
    case 'ordinary':
      next = afterOrdinaryWin(next, floor);
      if (next.stage === 'hidden') {
        nextRecords = { ...nextRecords, hiddenMet: addUnique(nextRecords.hiddenMet, floor.hidden) };
      }
      break;
    case 'hidden':
      next = { ...next, stage: 'fixed', hiddenWonThisRun: addUnique(next.hiddenWonThisRun, floor.hidden) };
      nextRecords = { ...nextRecords, hiddenWon: addUnique(nextRecords.hiddenWon, floor.hidden) };
      break;
    case 'fixed': {
      const floorIndex = run.floorIndex + 1;
      next = { ...next, floorIndex, stage: floorIndex < FLOORS.length ? 'ordinary' : 'final' };
      break;
    }
    case 'final':
      next = { ...next, stage: 'ceremony' };
      nextRecords = { ...nextRecords, mainCleared: true };
      break;
    case 'secretFinal':
      next = { ...next, stage: 'secretEnding' };
      nextRecords = { ...nextRecords, secretCleared: true };
      break;
    default:
      break;
  }
  return { run: next, records: nextRecords };
}

// 시상식 뒤: 히든 네 명을 모두 이긴 기록이 있으면 추가 경기로 간다.
function afterCeremony(run, records) {
  return secretUnlocked(records) ? { ...run, stage: 'secretFinal' } : { ...run, stage: 'done' };
}

export {
  afterCeremony,
  applyMatchResult,
  createRecords,
  createRun,
  currentFloor,
  nextOpponents,
  remainingOrdinary,
  secretUnlocked,
  timeBonus,
};
