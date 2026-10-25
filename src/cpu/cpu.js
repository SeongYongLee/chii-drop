import { createPiece, fits, rowOf } from '../engine/control.js';
import { INPUT } from '../engine/input.js';
import { nextPairs, warningCount } from '../engine/player.js';
import { createRng, randomInt } from '../engine/rng.js';
import { COLS, SPAWN_HEIGHT, UNIT } from '../engine/rules.js';
import { evaluatePlacements } from './evaluate.js';
import { createBuildSearch, advanceBuildSearch, buildSearchResults } from './planner.js';

const CPU_LEVELS = [
  { id: 'beginner', label: '입문' },
  { id: 'easy', label: '아주 쉬움' },
  { id: 'normal', label: '쉬움' },
  { id: 'hard', label: '보통' },
  { id: 'expert', label: '어려움' },
  { id: 'master', label: '아주 어려움' },
  { id: 'grandmaster', label: '달인' },
];

// 이동·회전을 마친 뒤 한 번 기다리고 아래 입력을 유지한다. 낙하 중 입력을 끊지 않는다.
// mistakePercent: 최선 대신 안전한 후보 중 하나를 고를 확률, mistakePool: 그때 고르는 후보 수
const LEVEL_PARAMS = {
  beginner: { thinkDelay: 12, dropDelayFrames: 208, mistakePercent: 40, mistakePool: 8, targetChain: 2, depth: 1, beamWidth: 2, buildWeight: 8 },
  easy: { thinkDelay: 10, dropDelayFrames: 156, mistakePercent: 40, mistakePool: 14, targetChain: 2, depth: 1, beamWidth: 3, buildWeight: 14 },
  normal: { thinkDelay: 8, dropDelayFrames: 108, mistakePercent: 45, mistakePool: 14, targetChain: 3, depth: 1, beamWidth: 4, buildWeight: 25 },
  hard: { thinkDelay: 7, dropDelayFrames: 100, mistakePercent: 42, mistakePool: 14, targetChain: 3, depth: 1, beamWidth: 5, buildWeight: 26 },
  expert: { thinkDelay: 5, dropDelayFrames: 84, mistakePercent: 35, mistakePool: 12, targetChain: 4, depth: 2, beamWidth: 7, buildWeight: 30, watchOpponent: true },
  master: { thinkDelay: 3, dropDelayFrames: 60, mistakePercent: 25, mistakePool: 10, targetChain: 5, depth: 2, beamWidth: 9, buildWeight: 34, watchOpponent: true },
  // 달인은 기존 최상위 성능을 유지하며 이동·회전 직후 대기 없이 내린다.
  grandmaster: { thinkDelay: 0, dropDelayFrames: 0, mistakePercent: 0, mistakePool: 1, targetChain: 6, depth: 2, beamWidth: 12, buildWeight: 45, watchOpponent: true, attackCrowdedOpponent: true },
};

const MAX_STALL = 3;
const GIVE_UP_FRAMES = 90;
const STEER_BITS = INPUT.LEFT | INPUT.RIGHT | INPUT.ROTATE_CW | INPUT.ROTATE_CCW;

function createCpu({ level = 'normal', seed = 1 } = {}) {
  return {
    level: LEVEL_PARAMS[level] ? level : 'normal',
    rng: createRng(seed),
    planned: false,
    thinking: null,
    target: null,
    dropWait: null,
    dropJitter: 0,
    wait: 0,
    frames: 0,
    stall: 0,
    lastX: -1,
    lastOrient: -1,
    giveUp: false,
  };
}

function rollPercent(rng, percent) {
  const roll = randomInt(rng, 100);
  return { hit: roll.value < percent, rng: roll.state };
}

function bestNextChains(field, pair, incoming) {
  const options = evaluatePlacements(field, createPiece(pair), incoming).filter((option) => !option.lethal);
  return options.length > 0 ? Math.max(...options.map((option) => option.chains)) : -1;
}

// 피버 중에는 목표 연쇄 이상을 낼 수 있으면 터뜨리고, 아니면 배치를 아끼며
// 다음 쌍으로 낼 수 있는 연쇄가 가장 큰 자리를 고른다.
function rankFeverPlacements(player, table) {
  const incoming = warningCount(player);
  const options = evaluatePlacements(player.board.cells, player.piece, incoming).filter((option) => !option.lethal);
  const firing = options.filter((option) => option.chains >= player.fever.target);
  if (firing.length > 0) {
    return firing.sort((a, b) => b.chains - a.chains || b.value - a.value);
  }
  const keeping = options.filter((option) => option.chains === 0);
  const [nextPair] = table ? nextPairs(player, table) : [];
  if (keeping.length === 0 || !nextPair) {
    return options.sort((a, b) => b.chains - a.chains || b.value - a.value);
  }
  return keeping
    .map((option) => ({ ...option, nextChains: bestNextChains(option.field, nextPair, incoming) }))
    .sort((a, b) => b.nextChains - a.nextChains || b.value - a.value);
}

function plan(cpu, player, table, ranked = rankFeverPlacements(player, table), incoming = warningCount(player)) {
  const params = LEVEL_PARAMS[cpu.level];
  const safe = ranked.filter((option) => !option.lethal);
  let { rng } = cpu;
  let choice = safe[0] ?? ranked[0];

  const mistake = rollPercent(rng, params.mistakePercent);
  rng = mistake.rng;
  if (mistake.hit && safe.length > 0) {
    // 선행 탐색이 후보를 하나로 줄여도 실수 설정이 무효가 되지 않도록 한다.
    // 추가 후보도 현재 높이에서 도달 가능하고 즉시 패배하지 않는 배치만 쓴다.
    const known = new Set(safe.map(option => `${option.x}:${option.orient}`));
    const mustClear = incoming >= COLS && safe.every(option => option.chains > 0);
    const alternatives = params.mistakePool > safe.length
      ? evaluatePlacements(player.board.cells, player.piece, warningCount(player))
        .filter(option => !option.lethal && (!mustClear || option.chains > 0) && !known.has(`${option.x}:${option.orient}`)) : [];
    const candidates = [...safe, ...alternatives];
    const pick = randomInt(rng, Math.min(params.mistakePool, candidates.length));
    rng = pick.state;
    choice = candidates[pick.value];
  }
  const drop = randomInt(rng, 5);

  return {
    ...cpu,
    rng: drop.state,
    planned: true,
    thinking: null,
    target: choice ? { x: choice.x, orient: choice.orient } : { x: player.piece.x, orient: player.piece.orient },
    dropWait: null,
    dropJitter: drop.value - 2,
    wait: params.thinkDelay,
    frames: 0,
    stall: 0,
    lastX: -1,
    lastOrient: -1,
    giveUp: false,
  };
}

function steerInput(piece, target) {
  let input = 0;
  if (piece.orient !== target.orient) {
    input |= (target.orient - piece.orient + 4) % 4 === 3 ? INPUT.ROTATE_CCW : INPUT.ROTATE_CW;
  }
  if (piece.x !== target.x) {
    input |= piece.x < target.x ? INPUT.RIGHT : INPUT.LEFT;
  }
  return input;
}

// 기다리는 동안에도 엔진의 자연 낙하는 계속된다. 높은 필드에서는 대기를 줄인다.
function descend(cpu, player, frames) {
  let wait = cpu.dropWait;
  if (wait === null) {
    const { piece, board } = player;
    let landing = rowOf(piece.h);
    while (fits(board.cells, piece.x, landing - 1, piece.orient)) landing--;
    const distance = Math.max(0, piece.h / UNIT - landing);
    const ratio = Math.min(1, distance / (SPAWN_HEIGHT / UNIT));
    const delay = LEVEL_PARAMS[cpu.level].dropDelayFrames;
    wait = distance > 0 && delay > 0 ? Math.max(0, Math.round(delay * ratio) + cpu.dropJitter) : 0;
  }
  return { cpu: { ...cpu, frames, dropWait: Math.max(0, wait - 1) },
    input: wait > 0 ? 0 : INPUT.DOWN };
}

// 매 프레임 호출한다. 쌍이 나오면('next' 단계부터) 한 번만 계획하고, 조작 단계에서 계획을 입력으로 옮긴다.
// table은 다음 쌍 미리 보기에 쓴다(경기의 match.table). 없으면 다음 쌍을 보지 않는다.
function stepCpu(cpu, player, table, opponent) {
  const { piece } = player;
  const steering = (player.phase === 'next' || player.phase === 'control') && piece && !piece.locked;
  if (!steering) {
    return { cpu: cpu.planned || cpu.thinking ? { ...cpu, planned: false, thinking: null } : cpu, input: 0 };
  }
  let current = cpu;
  if (!current.planned) {
    if (player.fever) current = plan(current, player, table);
    else {
      const thinking = current.thinking ? advanceBuildSearch(current.thinking)
        : createBuildSearch(player, table, LEVEL_PARAMS[current.level], opponent);
      if (!thinking.done) return { cpu: { ...current, thinking }, input: 0 };
      current = plan(current, player, table, buildSearchResults(thinking), thinking.incoming);
    }
  }
  if (player.phase === 'next') {
    return { cpu: current, input: 0 };
  }
  if (current.wait > 0) {
    return { cpu: { ...current, wait: current.wait - 1 }, input: 0 };
  }

  const frames = current.frames + 1;
  const aligned = piece.x === current.target.x && piece.orient === current.target.orient;
  if (aligned) {
    if (piece.moveFrames > 0 || piece.rotateFrames > 0) return { cpu: { ...current, frames }, input: 0 };
    return descend(current, player, frames);
  }
  if (current.giveUp || frames > GIVE_UP_FRAMES) {
    return descend({ ...current, giveUp: true }, player, frames);
  }
  // 회전과 이동은 새로 누를 때만 확실히 일어나므로 한 프레임씩 떼었다 누른다.
  if (player.prevInput & STEER_BITS) {
    return { cpu: { ...current, frames }, input: 0 };
  }
  const stuck = piece.x === current.lastX && piece.orient === current.lastOrient;
  const stall = stuck ? current.stall + 1 : 0;
  if (stall >= MAX_STALL) {
    return descend({ ...current, stall, giveUp: true }, player, frames);
  }
  return {
    cpu: { ...current, frames, stall, lastX: piece.x, lastOrient: piece.orient },
    input: steerInput(piece, current.target),
  };
}

export { CPU_LEVELS, createCpu, stepCpu };
