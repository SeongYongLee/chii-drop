import {
  CHAIN_FALL_SPEED,
  COLS,
  GARBAGE_ACCEL,
  HIDDEN_ROWS,
  LAND_FRAMES,
  MAX_FALL_SPEED,
  MIN_GROUP,
  ROWS,
  SPLIT_FALL_ACCEL,
  SPLIT_FALL_START,
  TEMP_ROW,
  UNIT,
} from './rules.js';

const EMPTY = 0;
const GARBAGE = 9;
const SIZE = COLS * ROWS;

const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
// 보이는 칸의 이웃 순서는 기존 DFS와 같다. 탐색마다 좌표 배열을 만들지 않는다.
const VISIBLE_NEIGHBORS = Array.from({ length: SIZE }, (_, at) => {
  const x = at % COLS, y = Math.floor(at / COLS);
  if (y < HIDDEN_ROWS) return [];
  const neighbors = [];
  if (x + 1 < COLS) neighbors.push(at + 1);
  if (x > 0) neighbors.push(at - 1);
  if (y + 1 < ROWS) neighbors.push(at + COLS);
  if (y > HIDDEN_ROWS) neighbors.push(at - COLS);
  return neighbors;
});

// 낙하 방식: 0 = 일반(연쇄 뒤), 1 = 분리 낙하, 2 = 방해 블록
const FALL_NORMAL = 0;
const FALL_SPLIT = 1;
const FALL_GARBAGE = 2;

// cells: 색, offset: 목표 칸 위로 떨어진 거리(단위, 0 이하), speed·accel: 16.16,
// land: 착지 대기 카운트(−1이면 대기 아님), mode: 낙하 방식
function createBoard(cells = new Array(SIZE).fill(EMPTY)) {
  return {
    cells,
    offset: new Array(SIZE).fill(0),
    speed: new Array(SIZE).fill(0),
    accel: new Array(SIZE).fill(0),
    land: new Array(SIZE).fill(-1),
    mode: new Array(SIZE).fill(FALL_NORMAL),
    // 9.6절. 14단에서 13단으로 들어오는 방해 블록은 13단 칸에 남은 속도를 이어받는다.
    hiddenSpeed: new Array(COLS).fill(0),
  };
}

function cloneBoard(board) {
  return {
    cells: board.cells.slice(),
    offset: board.offset.slice(),
    speed: board.speed.slice(),
    accel: board.accel.slice(),
    land: board.land.slice(),
    mode: board.mode.slice(),
    hiddenSpeed: board.hiddenSpeed.slice(),
  };
}

// 아래쪽에 맞춰 문자열 행으로 필드를 만든다. '.'은 빈칸, 'G'는 방해 블록.
function fieldFromRows(rows) {
  const cells = new Array(SIZE).fill(EMPTY);
  const offset = ROWS - rows.length;
  rows.forEach((row, i) => {
    [...row].forEach((ch, x) => {
      cells[(offset + i) * COLS + x] = ch === '.' ? EMPTY : ch === 'G' ? GARBAGE : Number(ch);
    });
  });
  return cells;
}

function index(x, y) {
  return y * COLS + x;
}

function getCell(cells, x, y) {
  return cells[index(x, y)];
}

function isFree(cells, x, y) {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS && cells[index(x, y)] === EMPTY;
}

function isColor(color) {
  return color !== EMPTY && color !== GARBAGE;
}

// 10절. 1~12단(보이는 행)만 연결한다.
function findGroups(cells) {
  const seen = new Uint8Array(SIZE);
  const stack = new Uint16Array(SIZE), component = new Uint16Array(SIZE);
  const groups = [];
  for (let start = HIDDEN_ROWS * COLS; start < SIZE; start++) {
    const color = cells[start];
    if (!isColor(color) || seen[start]) continue;
    let pending = 1, count = 0;
    stack[0] = start; seen[start] = 1;
    while (pending > 0) {
      const at = stack[--pending];
      component[count++] = at;
      for (const neighbor of VISIBLE_NEIGHBORS[at]) {
        if (!seen[neighbor] && cells[neighbor] === color) {
          seen[neighbor] = 1;
          stack[pending++] = neighbor;
        }
      }
    }
    if (count >= MIN_GROUP) {
      const positions = new Array(count);
      for (let i = 0; i < count; i++) positions[i] = { x: component[i] % COLS, y: Math.floor(component[i] / COLS) };
      groups.push({ color, cells: positions });
    }
  }
  return groups;
}

// 지울 색 블록과 그 상하좌우의 방해 블록(보이는 행만)을 돌려준다.
function clearTargets(cells, groups) {
  const targets = new Map();
  for (const { cells: groupCells } of groups) {
    for (const { x, y } of groupCells) {
      targets.set(index(x, y), { x, y, color: getCell(cells, x, y) });
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < COLS && ny >= HIDDEN_ROWS && ny < ROWS && getCell(cells, nx, ny) === GARBAGE) {
          targets.set(index(nx, ny), { x: nx, y: ny, color: GARBAGE });
        }
      }
    }
  }
  return [...targets.values()];
}

function removeCells(board, targets) {
  const next = cloneBoard(board);
  for (const { x, y } of targets) {
    const i = index(x, y);
    next.cells[i] = EMPTY;
    next.offset[i] = 0;
    next.speed[i] = 0;
    next.accel[i] = 0;
    next.land[i] = -1;
  }
  return next;
}

// 6.4절. 놓은 블록은 아래가 막혀 있으면 바로 착지 대기, 비어 있으면 분리 낙하한다.
function placeBlob(board, x, y, color) {
  if (y < 0) {
    return;
  }
  const i = index(x, y);
  board.cells[i] = color;
  board.offset[i] = 0;
  board.accel[i] = 0;
  if (y === ROWS - 1 || board.cells[index(x, y + 1)] !== EMPTY) {
    board.speed[i] = 0;
    board.land[i] = 0;
    board.mode[i] = FALL_NORMAL;
  } else {
    board.speed[i] = SPLIT_FALL_START;
    board.land[i] = -1;
    board.mode[i] = FALL_SPLIT;
  }
}

function moveBlob(board, from, to, offset) {
  board.cells[to] = board.cells[from];
  board.offset[to] = offset;
  board.speed[to] = board.speed[from];
  board.accel[to] = board.accel[from];
  board.mode[to] = board.mode[from];
  board.land[to] = -1;
  board.cells[from] = EMPTY;
  board.offset[from] = 0;
  board.speed[from] = 0;
  board.accel[from] = 0;
  board.land[from] = -1;
  board.mode[from] = FALL_NORMAL;
}

// 7.1절의 한 프레임. clearTempRow는 쌍 배치 뒤와 연쇄 뒤의 낙하에서만 켠다.
// 낙하 중이거나 착지 대기 중인 블록이 있으면 true를 돌려준다.
function stepBoardFall(board, { clearTempRow }) {
  let busy = false;

  for (let i = 0; i < SIZE; i++) {
    if (board.cells[i] === EMPTY || board.offset[i] >= 0) {
      continue;
    }
    busy = true;
    board.offset[i] += Math.floor(board.speed[i] / 65536);
    board.speed[i] = Math.min(MAX_FALL_SPEED, board.speed[i] + board.accel[i]);
    if (board.offset[i] >= 0) {
      board.offset[i] = 0;
      const y = Math.floor(i / COLS);
      if (y === ROWS - 1 || board.cells[i + COLS] !== EMPTY) {
        board.land[i] = 0;
      }
    }
  }

  for (let i = 0; i < SIZE; i++) {
    if (board.land[i] >= 0) {
      busy = true;
      board.land[i] += 1;
      if (board.land[i] >= LAND_FRAMES) {
        board.land[i] = -1;
        board.speed[i] = 0;
        board.accel[i] = 0;
        board.mode[i] = FALL_NORMAL;
      }
    }
  }

  if (clearTempRow) {
    for (let x = 0; x < COLS; x++) {
      board.cells[index(x, TEMP_ROW)] = EMPTY;
    }
  }

  // 아래 칸부터 위로 보며, 빈칸 바로 위 블록을 한 칸 내린다. 한 프레임에 더미 전체가 한 칸씩 내려간다.
  for (let x = 0; x < COLS; x++) {
    for (let y = ROWS - 1; y >= 1; y--) {
      const below = index(x, y);
      const above = index(x, y - 1);
      if (board.cells[below] !== EMPTY || board.cells[above] === EMPTY) {
        continue;
      }
      if (board.land[above] >= 0) {
        board.land[above] = -1;
      }
      busy = true;
      if (board.offset[above] + Math.floor(board.speed[above] / 65536) < 0) {
        continue;
      }
      const mode = board.mode[above];
      if (mode === FALL_GARBAGE && y === 2) {
        board.hiddenSpeed[x] = board.speed[above];
      }
      moveBlob(board, above, below, -UNIT);
      if (mode === FALL_GARBAGE && y === 1) {
        board.speed[below] = board.hiddenSpeed[x];
      }
      if (mode === FALL_NORMAL) {
        board.speed[below] = CHAIN_FALL_SPEED;
        board.accel[below] = 0;
      } else if (mode === FALL_SPLIT) {
        board.accel[below] = SPLIT_FALL_ACCEL;
      }
    }
  }

  return busy;
}

function columnHeight(cells, x) {
  for (let y = 0; y < ROWS; y++) {
    if (getCell(cells, x, y) !== EMPTY) {
      return ROWS - y;
    }
  }
  return 0;
}

// 9.6절. 방해 블록은 14단에서 한 열에 프레임당 1개씩 생긴다. 13단이 비어 있을 때만 생긴다.
function spawnGarbageRow(board, pending) {
  const remaining = pending.slice();
  let spawned = false;
  for (let x = 0; x < COLS; x++) {
    if (remaining[x] > 0 && board.cells[index(x, 1)] === EMPTY && board.cells[index(x, 0)] === EMPTY) {
      const i = index(x, 0);
      board.cells[i] = GARBAGE;
      board.offset[i] = 0;
      board.speed[i] = 0;
      board.accel[i] = GARBAGE_ACCEL[x];
      board.land[i] = -1;
      board.mode[i] = FALL_GARBAGE;
      remaining[x] -= 1;
      spawned = true;
    }
  }
  return { remaining, spawned };
}

function isBottomRowEmpty(cells) {
  for (let x = 0; x < COLS; x++) {
    if (getCell(cells, x, ROWS - 1) !== EMPTY) {
      return false;
    }
  }
  return true;
}

// CPU 탐색용: 낙하 연출 없이 바로 정착시킨다. 14단은 비운다.
function settleInstantly(cells) {
  const next = new Array(SIZE).fill(EMPTY);
  for (let x = 0; x < COLS; x++) {
    let target = ROWS - 1;
    for (let y = ROWS - 1; y >= 1; y--) {
      const color = getCell(cells, x, y);
      if (color !== EMPTY) {
        next[index(x, target)] = color;
        target--;
      }
    }
  }
  return next;
}

export {
  EMPTY,
  GARBAGE,
  clearTargets,
  cloneBoard,
  columnHeight,
  createBoard,
  fieldFromRows,
  findGroups,
  getCell,
  index,
  isBottomRowEmpty,
  isColor,
  isFree,
  placeBlob,
  removeCells,
  settleInstantly,
  spawnGarbageRow,
  stepBoardFall,
};
