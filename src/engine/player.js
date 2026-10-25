import { createPiece, pieceCells, stepPiece } from './control.js';
import {
  canRevive,
  endFever,
  finishFeverChain,
  finishRevive,
  noteFeverAllClear,
  startRevive,
  tickFeverTimer,
} from './fever.js';
import {
  EMPTY,
  clearTargets,
  cloneBoard,
  columnHeight,
  createBoard,
  findGroups,
  getCell,
  isBottomRowEmpty,
  placeBlob,
  removeCells,
  spawnGarbageRow,
  stepBoardFall,
} from './field.js';
import { INPUT } from './input.js';
import { pairAt } from './next-table.js';
import { randomInt } from './rng.js';
import {
  COLS,
  DEATH_X,
  DEATH_Y,
  FLASH_FRAMES,
  GARBAGE_CAP,
  GARBAGE_MAX_ROWS,
  LOSE_FRAMES,
  NEXT_COUNT,
  POP_FRAMES,
  ROWS,
  SCORE_CAP,
  SOFT_DROP_COUNTER_START,
  VERSUS_RULES,
} from './rules.js';
import { garbageTarget, scoreStep } from './scoring.js';

// 연쇄가 진행 중인 단계. 상대가 졌을 때 이 단계면 연쇄를 끝까지 진행한 뒤 이긴다.
const CHAIN_PHASES = new Set(['decide', 'erase-start', 'flash', 'pop-start', 'pop', 'chain-fall', 'check']);

// boss가 있으면 첫 패배 조건에서 한 번 부활해 피버에 들어간다.
function createPlayer({ table, cells, boss = false, feverRng = 0, rules = VERSUS_RULES, level = 0 }) {
  return {
    rules,
    boss: boss ? { revived: false } : null,
    fever: null,
    feverRng,
    phase: 'next',
    phaseTimer: rules.nextWait + 4,
    frame: 0,
    board: createBoard(cells),
    piece: createPiece(pairAt(table, 0)),
    nextIndex: 1,
    level,
    levelCount: 0,
    chain: 0,
    maxChain: 0,
    score: 0,
    garbagePool: 0,
    stocks: { a: 0, b: 0, c: 0 },
    eraseCount: 0,
    groups: [],
    clearing: [],
    softCounter: SOFT_DROP_COUNTER_START,
    heldDir: 0,
    heldFrames: 0,
    prevInput: 0,
    dropCounter: 0,
    garbagePending: new Array(COLS).fill(0),
    lost: false,
    loseFrames: 0,
    events: [],
  };
}

function nextPairs(player, table) {
  return Array.from({ length: NEXT_COUNT }, (_, i) => pairAt(table, player.nextIndex + i));
}

function addScore(player, points) {
  return {
    ...player,
    score: Math.min(SCORE_CAP, player.score + points),
    garbagePool: player.garbagePool + points,
  };
}

// 9.3절. 발생한 방해로 자기 재고를 A → B → C 순서로 상쇄하고 남은 만큼을 돌려준다.
function offsetStocks(stocks, amount) {
  let rest = amount;
  const next = { ...stocks };
  for (const key of ['a', 'b', 'c']) {
    const used = Math.min(next[key], rest);
    next[key] -= used;
    rest -= used;
  }
  return { stocks: next, rest, offset: amount - rest };
}

function placePiece(player) {
  const board = cloneBoard(player.board);
  const cells = pieceCells(player.piece);
  // 6.3절. 아래 방향이면 자식부터, 나머지는 축부터 놓는다.
  const order = player.piece.orient === 2 ? [cells[1], cells[0]] : cells;
  for (const { x, y, color } of order) {
    placeBlob(board, x, y, color);
  }
  stepBoardFall(board, { clearTempRow: true });
  return { ...player, board, piece: null, phase: 'fall', events: [...player.events, { type: 'lock' }] };
}

function stepControl(player, input, pressed) {
  const result = stepPiece(player.piece, {
    cells: player.board.cells,
    input,
    pressed,
    heldFrames: player.heldFrames,
    fallSpeed: player.rules.fallTable[player.level],
    softCounter: player.softCounter,
  });
  let next = {
    ...player,
    piece: result.piece,
    softCounter: result.softCounter,
    events: [...player.events, ...result.events],
  };
  if (result.points > 0) {
    next = addScore(next, result.points);
  }
  if (result.piece.locked && result.piece.placeTimer <= 0 && result.piece.rotateFrames === 0) {
    return placePiece(next);
  }
  return next;
}

function stepFall(player, chainFall) {
  const board = cloneBoard(player.board);
  const busy = stepBoardFall(board, { clearTempRow: true });
  let next = { ...player, board };
  if (busy) {
    return next;
  }
  // 9.7절. 연쇄 뒤 낙하가 끝났을 때 맨 아래 줄이 비어 있으면 전부 지우기.
  if (chainFall && isBottomRowEmpty(board.cells)) {
    next = addScore(next, next.rules.allClearBonus);
    next.events = [...next.events, { type: 'allClear' }];
    if (next.fever) {
      next = noteFeverAllClear(next);
    }
  }
  return { ...next, phase: 'check' };
}

function startFlash(player) {
  const clearing = clearTargets(player.board.cells, player.groups);
  return { ...player, phase: 'flash', phaseTimer: FLASH_FRAMES, clearing };
}

function decideErase(player) {
  const chain = player.chain + 1;
  let { level, levelCount } = player;
  const needed = player.rules.levelUp[level] ?? 0;
  if (needed > 0) {
    levelCount += player.eraseCount;
    if (levelCount >= needed) {
      level += 1;
      levelCount = 0;
    }
  } else {
    levelCount = 0;
  }
  return { ...player, phase: 'erase-start', chain, maxChain: Math.max(player.maxChain, chain), level, levelCount };
}

// 7.2절. 깜박임 25번째 프레임에 점수와 방해를 계산한다.
function scoreFlash(player, world) {
  const { rules } = player;
  const points = scoreStep(player.groups, player.chain, rules.chainBonus);
  let next = addScore(player, points);
  const target = garbageTarget(world.timer, rules.garbageRate, rules.marginStartSeconds);
  const generated = Math.min(GARBAGE_CAP, Math.floor(next.garbagePool / target));
  next.garbagePool %= target;
  const events = [...next.events, { type: 'clear', chain: player.chain, points, groups: player.groups }];
  if (generated > 0) {
    const fever = offsetStocks(next.stocks, generated);
    // 15.1절. 피버 중에는 피버 예고 → 보류된 일반 예고 순서로 상쇄한다.
    const held = next.fever ? offsetStocks(next.fever.held, fever.rest) : { stocks: null, rest: fever.rest, offset: 0 };
    const { stocks } = fever;
    const rest = held.rest;
    const offset = fever.offset + held.offset;
    next.stocks = stocks;
    if (held.stocks) {
      next.fever = { ...next.fever, held: held.stocks };
    }
    if (offset > 0) {
      events.push({ type: 'offset', amount: offset,
        visibleAmount: warningCount(player) - (stocks.a + stocks.b) });
    }
    if (rest > 0) {
      events.push({ type: 'attack', amount: rest, afterOffset: offset > 0 });
    }
  }
  return { ...next, events, phase: 'pop-start' };
}

// 9.5절. 열 순서를 공유 난수 6번으로 정하고, 시작 자리를 배분 횟수로 돌린다.
function distributeGarbage(player, world) {
  const slots = new Array(COLS).fill(-1);
  let { rng } = world;
  for (let column = 0; column < COLS; column++) {
    const pick = randomInt(rng, COLS);
    rng = pick.state;
    let slot = pick.value;
    while (slots[slot] !== -1) {
      slot = (slot + 1) % COLS;
    }
    slots[slot] = column;
  }
  const capacity = Array.from({ length: COLS }, (_, x) => ROWS - 1 - columnHeight(player.board.cells, x));
  const assigned = new Array(COLS).fill(0);
  const start = player.dropCounter % COLS;
  let remaining = player.stocks.a;
  for (let row = 0; row < GARBAGE_MAX_ROWS && remaining > 0; row++) {
    for (let k = 0; k < COLS && remaining > 0; k++) {
      const column = slots[(start + k) % COLS];
      remaining -= 1;
      // 가득 찬 열에 돌아간 몫도 재고에서 빠진다.
      if (assigned[column] < capacity[column]) {
        assigned[column] += 1;
      }
    }
  }
  const total = assigned.reduce((sum, n) => sum + n, 0);
  const next = {
    ...player,
    stocks: { ...player.stocks, a: remaining },
    dropCounter: player.dropCounter + 1,
    garbagePending: assigned,
    phase: total > 0 ? 'garbage-fall' : 'turn-start',
    events: total > 0 ? [...player.events, { type: 'garbage', amount: total }] : player.events,
  };
  return { player: next, world: { ...world, rng } };
}

function stepGarbageFall(player) {
  const board = cloneBoard(player.board);
  const { remaining, spawned } = spawnGarbageRow(board, player.garbagePending);
  const busy = stepBoardFall(board, { clearTempRow: false });
  const pending = remaining.some((n) => n > 0);
  const done = !(busy || spawned || pending);
  if (done) {
    board.hiddenSpeed = board.hiddenSpeed.map(() => 0);
  }
  return {
    ...player,
    board,
    garbagePending: remaining,
    phase: done ? 'turn-start' : 'garbage-fall',
  };
}

function startTurn(state, table) {
  let player = state;
  if (player.fever && player.fever.timer === 0) {
    player = endFever(player);
  }
  if (getCell(player.board.cells, DEATH_X, DEATH_Y) !== EMPTY) {
    return canRevive(player) ? startRevive(player) : { ...player, phase: 'lose-prep' };
  }
  return {
    ...player,
    phase: 'next',
    phaseTimer: player.rules.nextWait + 4,
    chain: 0,
    piece: createPiece(pairAt(table, player.nextIndex)),
    nextIndex: player.nextIndex + 1,
  };
}

function trackInput(player, input) {
  const dir = input & INPUT.LEFT ? -1 : input & INPUT.RIGHT ? 1 : 0;
  return {
    ...player,
    frame: player.frame + 1,
    prevInput: input,
    heldDir: dir,
    heldFrames: dir !== 0 && dir === player.heldDir ? player.heldFrames + 1 : dir !== 0 ? 1 : 0,
    events: [],
  };
}

// 한 프레임 진행. world: { table, rng, timer }는 두 플레이어가 공유한다.
function stepPlayer(state, input, world) {
  const pressed = input & ~state.prevInput;
  const player = tickFeverTimer(trackInput(state, input));

  switch (player.phase) {
    case 'next': {
      const phaseTimer = player.phaseTimer - 1;
      return { player: { ...player, phaseTimer, phase: phaseTimer > 0 ? 'next' : 'control' }, world };
    }
    case 'control':
      return { player: stepControl(player, input, pressed), world };
    case 'fall':
      return { player: stepFall(player, false), world };
    case 'chain-fall':
      return { player: stepFall(player, true), world };
    case 'check': {
      const groups = findGroups(player.board.cells);
      const eraseCount = groups.reduce((sum, g) => sum + g.cells.length, 0);
      return {
        player: { ...player, groups, eraseCount, phase: groups.length > 0 ? 'decide' : 'end-decide' },
        world,
      };
    }
    case 'decide':
      return { player: decideErase(player), world };
    case 'erase-start':
      return { player: startFlash(player), world };
    case 'flash': {
      const phaseTimer = player.phaseTimer - 1;
      return { player: phaseTimer > 0 ? { ...player, phaseTimer } : scoreFlash(player, world), world };
    }
    case 'pop-start':
      return { player: { ...player, phase: 'pop', phaseTimer: POP_FRAMES }, world };
    case 'pop': {
      const phaseTimer = player.phaseTimer - 1;
      if (phaseTimer > 0) {
        return { player: { ...player, phaseTimer }, world };
      }
      const board = removeCells(player.board, player.clearing);
      return { player: { ...player, board, clearing: [], phase: 'chain-fall' }, world };
    }
    case 'end-decide': {
      const events = player.chain > 0 ? [...player.events, { type: 'chainEnd', chain: player.chain }] : player.events;
      const ended = { ...player, events, phase: 'tally' };
      return { player: ended.fever && player.chain > 0 ? finishFeverChain(ended, player.chain) : ended, world };
    }
    case 'tally':
      return { player: { ...player, phase: 'garbage-decide' }, world };
    case 'garbage-decide':
      if (player.stocks.a > 0) {
        return distributeGarbage(player, world);
      }
      return { player: { ...player, phase: 'turn-start' }, world };
    case 'garbage-fall':
      return { player: stepGarbageFall(player), world };
    case 'turn-start':
      return { player: startTurn(player, world.table), world };
    case 'revive': {
      const phaseTimer = player.phaseTimer - 1;
      return { player: phaseTimer > 0 ? { ...player, phaseTimer } : finishRevive(player), world };
    }
    case 'lose-prep':
      return {
        player: { ...player, phase: 'lost', lost: true, events: [...player.events, { type: 'over' }] },
        world,
      };
    case 'lost':
      return { player: { ...player, loseFrames: Math.min(LOSE_FRAMES, player.loseFrames + 1) }, world };
    default:
      return { player, world };
  }
}

function isInChain(player) {
  return player.chain > 0 && CHAIN_PHASES.has(player.phase);
}

function warningCount(player) {
  return player.stocks.a + player.stocks.b;
}

export { createPlayer, isInChain, nextPairs, stepPlayer, warningCount };
