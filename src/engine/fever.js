import { createBoard } from './field.js';
import { generateFeverSeed } from './fever-seeds.js';
import {
  COLOR_COUNT,
  FEVER_ALL_CLEAR_CHAIN,
  FEVER_ALL_CLEAR_FRAMES,
  FEVER_CHAIN_BONUS_FRAMES,
  FEVER_CHAIN_BONUS_MAX,
  FEVER_FIRST_CHAIN,
  FEVER_MAX_CHAIN,
  FEVER_MAX_FRAMES,
  FEVER_MIN_CHAIN,
  FEVER_START_FRAMES,
  REVIVE_FRAMES,
} from './rules.js';

const EMPTY_STOCKS = { a: 0, b: 0, c: 0 };

// 놓인 배치는 착지 대기 상태로 둔다(착지 눌림 연출).
function seededBoard(cells) {
  const board = createBoard(cells.slice());
  board.cells.forEach((color, i) => {
    if (color !== 0) {
      board.land[i] = 0;
    }
  });
  return board;
}

function canRevive(player) {
  return player.boss !== null && !player.boss.revived;
}

// 15.2절. 보스의 첫 패배 조건에서 한 번 부활하고 피버에 들어간다.
// 일반 예고는 보류(held)하고, 피버 중 받은 공격은 피버 예고(stocks)에 쌓인다.
function startRevive(player) {
  const seed = generateFeverSeed(player.feverRng, FEVER_FIRST_CHAIN, COLOR_COUNT);
  return {
    ...player,
    phase: 'revive',
    phaseTimer: REVIVE_FRAMES,
    boss: { ...player.boss, revived: true },
    feverRng: seed.rng,
    fever: { timer: FEVER_START_FRAMES, target: FEVER_FIRST_CHAIN, seed, held: player.stocks, allClear: false },
    stocks: { ...EMPTY_STOCKS },
    events: [...player.events, { type: 'revive' }],
  };
}

function finishRevive(player) {
  return {
    ...player,
    phase: 'turn-start',
    board: seededBoard(player.fever.seed.cells),
    events: [...player.events, { type: 'feverStart', target: player.fever.target }],
  };
}

function nextTarget(fever, chain) {
  let target;
  const short = fever.target - chain;
  if (short <= 0) {
    target = chain + 1;
  } else if (short === 1) {
    target = fever.target;
  } else if (short === 2) {
    target = fever.target - 1;
  } else {
    target = fever.target - 2;
  }
  if (fever.allClear) {
    target += FEVER_ALL_CLEAR_CHAIN;
  }
  return Math.min(FEVER_MAX_CHAIN, Math.max(FEVER_MIN_CHAIN, target));
}

// 15.1절. 연쇄가 끝나면 시간 보너스를 더하고 성공·실패에 따라 다음 배치로 필드를 바꾼다.
function finishFeverChain(player, chain) {
  const { fever } = player;
  let { timer } = fever;
  if (timer > 0 && chain >= 3) {
    timer = Math.min(FEVER_MAX_FRAMES, timer + Math.min(FEVER_CHAIN_BONUS_MAX, (chain - 2) * FEVER_CHAIN_BONUS_FRAMES));
  }
  const target = nextTarget(fever, chain);
  const seed = generateFeverSeed(player.feverRng, target, COLOR_COUNT);
  return {
    ...player,
    board: seededBoard(seed.cells),
    feverRng: seed.rng,
    fever: { ...fever, timer, target, seed, allClear: false },
    events: [...player.events, { type: 'feverSeed', target, success: chain >= fever.target }],
  };
}

function noteFeverAllClear(player) {
  const { fever } = player;
  return {
    ...player,
    fever: { ...fever, allClear: true, timer: Math.min(FEVER_MAX_FRAMES, fever.timer + FEVER_ALL_CLEAR_FRAMES) },
  };
}

function tickFeverTimer(player) {
  if (!player.fever || player.phase === 'revive') {
    return player;
  }
  return { ...player, fever: { ...player.fever, timer: Math.max(0, player.fever.timer - 1) } };
}

// 시간이 다 되면 빈 필드로 돌아가고 피버 예고를 일반 예고에 더한다.
function endFever(player) {
  const { held } = player.fever;
  return {
    ...player,
    fever: null,
    board: createBoard(),
    stocks: { a: held.a + player.stocks.a, b: held.b + player.stocks.b, c: held.c + player.stocks.c },
    events: [...player.events, { type: 'feverEnd' }],
  };
}

export { canRevive, endFever, finishFeverChain, finishRevive, noteFeverAllClear, startRevive, tickFeverTimer };
