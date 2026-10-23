import { createPiece } from '../engine/control.js';
import { INPUT } from '../engine/input.js';
import { nextPairs, warningCount } from '../engine/player.js';
import { createRng, randomInt } from '../engine/rng.js';
import { evaluatePlacements } from './evaluate.js';
import { createBuildSearch, advanceBuildSearch, buildSearchResults } from './planner.js';

const CPU_LEVELS = [
  { id: 'easy', label: '아주 쉬움' },
  { id: 'normal', label: '쉬움' },
  { id: 'hard', label: '보통' },
  { id: 'expert', label: '어려움' },
  { id: 'master', label: '아주 어려움' },
];

// mistakePercent: 최선 대신 상위 후보 중 하나를 고를 확률, mistakePool: 그때 고르는 후보 수
const LEVEL_PARAMS = {
  easy: { thinkDelay: 30, softDropPercent: 30, mistakePercent: 30, mistakePool: 6, targetChain: 2, depth: 0, beamWidth: 6, buildWeight: 10 },
  normal: { thinkDelay: 15, softDropPercent: 50, mistakePercent: 8, mistakePool: 3, targetChain: 3, depth: 0, beamWidth: 6, buildWeight: 20 },
  hard: { thinkDelay: 4, softDropPercent: 100, mistakePercent: 0, mistakePool: 1, targetChain: 4, depth: 1, beamWidth: 5, buildWeight: 30 },
  expert: { thinkDelay: 2, softDropPercent: 100, mistakePercent: 0, mistakePool: 1, targetChain: 5, depth: 2, beamWidth: 6, buildWeight: 40, watchOpponent: true },
  master: { thinkDelay: 2, softDropPercent: 100, mistakePercent: 0, mistakePool: 1, targetChain: 6, depth: 2, beamWidth: 12, buildWeight: 45, watchOpponent: true, attackCrowdedOpponent: true },
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
    softDrop: false,
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

function plan(cpu, player, table, ranked = rankFeverPlacements(player, table)) {
  const params = LEVEL_PARAMS[cpu.level];
  const safe = ranked.filter((option) => !option.lethal);
  let { rng } = cpu;
  let choice = safe[0] ?? ranked[0];

  const mistake = rollPercent(rng, params.mistakePercent);
  rng = mistake.rng;
  if (mistake.hit && safe.length > 1) {
    const pick = randomInt(rng, Math.min(params.mistakePool, safe.length));
    rng = pick.state;
    choice = safe[pick.value];
  }
  const drop = rollPercent(rng, params.softDropPercent);

  return {
    ...cpu,
    rng: drop.rng,
    planned: true,
    thinking: null,
    target: choice ? { x: choice.x, orient: choice.orient } : { x: player.piece.x, orient: player.piece.orient },
    softDrop: drop.hit,
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
      current = plan(current, player, table, buildSearchResults(thinking));
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
    return { cpu: { ...current, frames }, input: current.softDrop ? INPUT.DOWN : 0 };
  }
  if (current.giveUp || frames > GIVE_UP_FRAMES) {
    return { cpu: { ...current, frames, giveUp: true }, input: INPUT.DOWN };
  }
  // 회전과 이동은 새로 누를 때만 확실히 일어나므로 한 프레임씩 떼었다 누른다.
  if (player.prevInput & STEER_BITS) {
    return { cpu: { ...current, frames }, input: 0 };
  }
  const stuck = piece.x === current.lastX && piece.orient === current.lastOrient;
  const stall = stuck ? current.stall + 1 : 0;
  if (stall >= MAX_STALL) {
    return { cpu: { ...current, frames, stall, giveUp: true }, input: INPUT.DOWN };
  }
  return {
    cpu: { ...current, frames, stall, lastX: piece.x, lastOrient: piece.orient },
    input: steerInput(piece, current.target),
  };
}

export { CPU_LEVELS, createCpu, stepCpu };
