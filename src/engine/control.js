import { isFree } from './field.js';
import { INPUT } from './input.js';
import {
  DAS_DELAY,
  DAS_REPEAT,
  FALL_SPEED_SCALE,
  LOCK_FRAMES,
  LOCK_RESTARTS,
  PLACE_DELAY,
  ROTATE_FRAMES,
  ROTATE_GROUND_ALLOWANCE,
  ROWS,
  SOFT_DROP_SPEED,
  SPAWN_HEIGHT,
  SPAWN_X,
  UNIT,
} from './rules.js';

// 축 기준 자식 위치(아래부터 센 단 기준): 위, 오른쪽, 아래, 왼쪽
const CHILD_OFFSETS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

const ORIENT_UP = 0;
const ORIENT_DOWN = 2;

function createPiece(pair) {
  return {
    x: SPAWN_X,
    h: SPAWN_HEIGHT,
    acc: 0,
    orient: ORIENT_UP,
    pivot: pair[0],
    child: pair[1],
    moveDir: 0,
    moveFrames: 0,
    rotateFrames: 0,
    rotateFrom: ORIENT_UP,
    groundCount: 0,
    restartsLeft: LOCK_RESTARTS,
    rotateGroundLeft: ROTATE_GROUND_ALLOWANCE,
    groundedAfterMove: false,
    quickToggle: false,
    locked: false,
    placeTimer: 0,
  };
}

function rowOf(h) {
  return Math.floor(h / UNIT);
}

// 아래부터 센 단(0부터)을 위부터 센 행으로 바꾼다.
function toY(row) {
  return ROWS - 1 - row;
}

function pieceCellsAt(x, row, orient, pivot, child) {
  const [dx, dy] = CHILD_OFFSETS[orient];
  return [
    { x, y: toY(row), color: pivot },
    { x: x + dx, y: toY(row + dy), color: child },
  ];
}

function pieceCells(piece) {
  return pieceCellsAt(piece.x, rowOf(piece.h), piece.orient, piece.pivot, piece.child);
}

function fits(cells, x, row, orient) {
  return pieceCellsAt(x, row, orient, 1, 1).every((cell) => isFree(cells, cell.x, cell.y));
}

// 4.1절. 처음 누른 프레임을 1로 셀 때 1, 9, 11, 13…번째에 발동한다.
function horizontalFires(heldFrames) {
  if (heldFrames === 1) {
    return true;
  }
  return heldFrames > DAS_DELAY && (heldFrames - DAS_DELAY - 1) % DAS_REPEAT === 0;
}

function horizontalDir(input) {
  if (input & INPUT.LEFT) {
    return -1;
  }
  return input & INPUT.RIGHT ? 1 : 0;
}

function startRotation(piece, orient) {
  return { ...piece, orient, rotateFrames: ROTATE_FRAMES, rotateFrom: piece.orient, groundedAfterMove: false };
}

// 5.1절의 벽차기·바닥차기. 실패하면 null.
function kick(cells, piece, orient) {
  const [dx, dy] = CHILD_OFFSETS[orient];
  const row = rowOf(piece.h);
  if (!isFree(cells, piece.x - dx, toY(row - dy))) {
    return null;
  }
  if (dx !== 0) {
    return { ...startRotation(piece, orient), x: piece.x - dx };
  }
  if (orient === ORIENT_DOWN) {
    // 13단·14단에서는 바닥차기를 하지 않는다.
    if (row >= ROWS - 2) {
      return null;
    }
    const lifted = startRotation(piece, orient);
    return {
      ...lifted,
      h: Math.floor(piece.h / 16) * 16 + 40,
      rotateGroundLeft: piece.rotateGroundLeft - 1,
      locked: piece.rotateGroundLeft - 1 <= 0,
      placeTimer: piece.rotateGroundLeft - 1 <= 0 ? PLACE_DELAY : 0,
    };
  }
  return { ...startRotation(piece, orient), h: piece.h - UNIT };
}

function quickTurn(cells, piece) {
  const orient = (piece.orient + 2) % 4;
  const row = rowOf(piece.h);
  if (fits(cells, piece.x, row, orient)) {
    // 세로 쌍을 뒤집으면 쌍의 아래 끝을 바로 위 칸 경계로 올린다.
    const vertical = orient === ORIENT_UP || orient === ORIENT_DOWN;
    let h = piece.h;
    if (vertical) {
      const bottom = orient === ORIENT_UP ? piece.h - UNIT : piece.h;
      const raised = (Math.floor(bottom / UNIT) + 1) * UNIT;
      h = orient === ORIENT_UP ? raised : raised + UNIT;
    }
    if (fits(cells, piece.x, rowOf(h), orient)) {
      return { ...startRotation(piece, orient), h, acc: 0 };
    }
  }
  return kick(cells, piece, orient);
}

function rotate(cells, piece, turns) {
  const orient = (piece.orient + turns) % 4;
  if (fits(cells, piece.x, rowOf(piece.h), orient)) {
    return startRotation(piece, orient);
  }
  const kicked = kick(cells, piece, orient);
  if (kicked) {
    return kicked;
  }
  // 5.1절 3. 양쪽이 막혔을 때 첫 시도는 토글만 바꾸고, 두 번째 시도에 180도 돈다.
  const toggled = { ...piece, quickToggle: !piece.quickToggle };
  if (toggled.quickToggle) {
    return toggled;
  }
  return quickTurn(cells, toggled) ?? toggled;
}

function lock(piece) {
  return { ...piece, locked: true, placeTimer: PLACE_DELAY };
}

// 6.2절. 접지한 프레임마다 실행한다.
function ground(piece, softDrop, result) {
  let next = piece;
  if (!next.groundedAfterMove && next.rotateGroundLeft > 0 && next.moveFrames === 0) {
    next = { ...next, groundedAfterMove: true, rotateGroundLeft: next.rotateGroundLeft - 1 };
  }
  if (next.rotateGroundLeft === 0) {
    return lock(next);
  }
  if (next.groundCount === 0) {
    if (next.restartsLeft > 0) {
      return { ...next, restartsLeft: next.restartsLeft - 1, groundCount: LOCK_FRAMES };
    }
    return lock(next);
  }
  let groundCount = next.groundCount;
  if (softDrop) {
    groundCount = next.moveFrames > 0 ? 2 : 1;
    result.points += 1;
  }
  groundCount -= 1;
  next = { ...next, groundCount };
  return groundCount === 0 ? lock(next) : next;
}

// 조작 중인 쌍의 한 프레임. 4.2절 순서대로 좌우 이동 → 회전 → 낙하.
// ctx: { cells, input, pressed, heldFrames, fallSpeed(레벨의 속도 값 v), softCounter }
function stepPiece(piece, ctx) {
  const { cells, input, pressed, heldFrames, fallSpeed } = ctx;
  const result = { piece, softCounter: ctx.softCounter, points: 0, events: [] };
  let current = { ...piece };

  if (current.rotateFrames > 0) {
    current.rotateFrames -= 1;
  }

  if (current.locked) {
    if (pressed & (INPUT.ROTATE_CW | INPUT.ROTATE_CCW)) {
      current.rotateFrames = 0;
    }
    current.placeTimer -= 1;
    result.piece = current;
    return result;
  }

  if (current.moveFrames > 0) {
    current.moveFrames -= 1;
  } else {
    const dir = horizontalDir(input);
    if (dir !== 0 && horizontalFires(heldFrames)) {
      const row = rowOf(current.h);
      if (fits(cells, current.x + dir, row, current.orient)) {
        current = { ...current, x: current.x + dir, moveDir: dir, moveFrames: 1, groundCount: 0, groundedAfterMove: false };
        result.events.push({ type: 'move' });
      }
    }
  }

  const turns = pressed & INPUT.ROTATE_CCW ? 3 : pressed & INPUT.ROTATE_CW ? 1 : 0;
  if (turns) {
    const before = current;
    current = rotate(cells, { ...current, rotateFrames: 0 }, turns);
    if (current.orient !== before.orient) {
      result.events.push({ type: 'rotate' });
    }
    if (current.locked) {
      result.piece = current;
      return result;
    }
  }

  const softDrop = (input & INPUT.DOWN) !== 0;
  let speed = fallSpeed * FALL_SPEED_SCALE;
  if (softDrop) {
    speed = Math.max(speed, SOFT_DROP_SPEED);
    result.softCounter += 1;
    if (result.softCounter === 1) {
      result.points += 1;
      result.softCounter = -1;
    }
  }

  const acc = current.acc + speed;
  const units = Math.floor(acc / 65536);
  current.acc = acc % 65536;
  const row = rowOf(current.h);
  const nextH = current.h - units;
  if (rowOf(nextH) < row && !fits(cells, current.x, row - 1, current.orient)) {
    current = ground({ ...current, h: row * UNIT, acc: 0 }, softDrop, result);
  } else {
    current.h = nextH;
  }

  result.piece = current;
  return result;
}

export { CHILD_OFFSETS, createPiece, fits, pieceCells, pieceCellsAt, rowOf, stepPiece, toY };
