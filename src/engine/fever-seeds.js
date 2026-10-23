import { fits } from './control.js';
import { EMPTY, clearTargets, findGroups, getCell, index, settleInstantly } from './field.js';
import { randomInt } from './rng.js';
import { COLS, DEATH_X, ROWS } from './rules.js';

// 피버 연쇄 씨앗은 원작 배치를 옮기지 않고 역방향 시뮬레이션으로 만든다.
// 빈 필드에서 시작해 "마지막에 터질 4개"를 끼워 넣고, 그 아래로 앞 단계의 4개를 끼워 넣어
// 뒤 단계 묶음을 끊는 일을 반복한다. 끼워 넣기는 "지우고 떨어뜨리기"의 정확한 역연산이므로,
// 각 단계에서 묶음이 끼워 넣은 4개 하나뿐이면 정방향 연쇄 수가 그대로 보장된다.

const GROUP_SIZE = 4;
const MAX_HEIGHT = 11;
// 3열은 쌍이 나오고 놓일 수 있도록 다른 열보다 낮게 둔다.
const SPAWN_COLUMN_MAX_HEIGHT = 10;
const COLUMN_LIMITS = Array.from({ length: COLS }, (_, x) => (x === DEATH_X ? SPAWN_COLUMN_MAX_HEIGHT : MAX_HEIGHT));
const MIN_CHAIN = 1;
const MAX_CHAIN = 15;
const NODE_BUDGET = 100;
// 한 단계에서 실패한 하위 탐색을 이만큼 겪으면 더 위 단계에서 다른 배치를 고른다.
const MAX_BRANCHES = 2;
const FINAL_BRANCHES = 8;
const MAX_ATTEMPTS = 256;
// 후보 정렬 때 높이 균형 점수에 더하는 흔들림 폭.
const JITTER = 150;
const PLACEMENT_KEY_SCALE = 1 << 16;
// 트리거 열 후보. 이웃 열이 하나뿐인 양 끝 열이 위 칸을 안전하게 두기 쉬워서,
// 긴 연쇄는 양 끝에서만 고른다.
const TRIGGER_COLUMNS_ANY = [0, 1, 2, 3, 4, 5];
const TRIGGER_COLUMNS_EDGE = [0, 5];
const EDGE_TRIGGER_CHAIN = 13;

const SHAPES = buildShapes();

// 크기 4의 연결 모양(고정 방향 19가지)을 (열, 단) 오프셋 목록으로 만든다.
function buildShapes() {
  const seen = new Map();
  const grow = (cells) => {
    if (cells.length === GROUP_SIZE) {
      const minX = Math.min(...cells.map(([x]) => x));
      const minH = Math.min(...cells.map(([, h]) => h));
      const shape = cells.map(([x, h]) => [x - minX, h - minH]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      seen.set(JSON.stringify(shape), shape);
      return;
    }
    for (const [x, h] of cells) {
      for (const [dx, dh] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const nh = h + dh;
        if (!cells.some(([cx, ch]) => cx === nx && ch === nh)) {
          grow([...cells, [nx, nh]]);
        }
      }
    }
  };
  grow([[0, 0]]);
  return [...seen.values()];
}

function heightsOf(columns) {
  return columns.map((column) => column.length);
}

// 열 배열(아래부터)에 지정한 단으로 색을 끼워 넣는다. 그 위의 블록은 밀려 올라간다.
function insertCells(columns, cells, color) {
  return columns.map((column, x) => {
    const heights = cells.filter((cell) => cell.x === x).map((cell) => cell.h);
    if (heights.length === 0) {
      return column;
    }
    const next = [];
    let source = 0;
    for (let h = 0; h < column.length + heights.length; h++) {
      next.push(heights.includes(h) ? color : column[source++]);
    }
    return next;
  });
}

// 탐색 중에는 field.js보다 가벼운 단 기준 격자(열마다 GRID_H칸)로 묶음을 센다.
const GRID_H = MAX_HEIGHT + 2;
const grid = new Uint8Array(COLS * GRID_H);
const visited = new Uint8Array(COLS * GRID_H);
const inserted = new Uint8Array(COLS * GRID_H);
const stack = new Int16Array(COLS * GRID_H);

function fillGrid(columns) {
  grid.fill(EMPTY);
  for (let x = 0; x < COLS; x++) {
    const column = columns[x];
    for (let h = 0; h < column.length; h++) {
      grid[x * GRID_H + h] = column[h];
    }
  }
}

function componentSize(start) {
  const color = grid[start];
  let top = 0;
  let size = 0;
  stack[top++] = start;
  visited[start] = 1;
  while (top > 0) {
    const id = stack[--top];
    size += 1;
    const x = Math.floor(id / GRID_H);
    const h = id - x * GRID_H;
    const neighbors = [x > 0 ? id - GRID_H : -1, x < COLS - 1 ? id + GRID_H : -1, h > 0 ? id - 1 : -1, h < GRID_H - 1 ? id + 1 : -1];
    for (const n of neighbors) {
      if (n >= 0 && !visited[n] && grid[n] === color) {
        visited[n] = 1;
        stack[top++] = n;
      }
    }
  }
  return size;
}

// 끼워 넣은 4개만 묶음이 되는지 본다.
function onlyInsertedGroup(columns, cells) {
  fillGrid(columns);
  inserted.fill(0);
  for (const { x, h } of cells) {
    inserted[x * GRID_H + h] = 1;
  }
  // 끼운 칸 옆에 같은 색이 더 붙으면 5개 이상이 되므로 먼저 거른다.
  for (const { x, h } of cells) {
    const id = x * GRID_H + h;
    const color = grid[id];
    const neighbors = [x > 0 ? id - GRID_H : -1, x < COLS - 1 ? id + GRID_H : -1, h > 0 ? id - 1 : -1, h < GRID_H - 1 ? id + 1 : -1];
    for (const n of neighbors) {
      if (n >= 0 && !inserted[n] && grid[n] === color) {
        return false;
      }
    }
  }
  visited.fill(0);
  for (let id = 0; id < grid.length; id++) {
    if (grid[id] !== EMPTY && !visited[id] && !inserted[id] && componentSize(id) >= GROUP_SIZE) {
      return false;
    }
  }
  return true;
}

// 끼워 넣을 수 있는 모든 4칸 배치를, 높이가 고르게 낮은 쪽부터 같은 점수대는 난수로 섞어 돌려준다.
// 열마다 끼운 칸은 새 높이 안쪽이어야 하므로 모양과 시작 열이 정해지면 시작 단의 상한이 바로 나온다.
// 칸 목록은 실제로 시도할 때 만든다. topX를 주면 그 열 꼭대기에 칸을 두는 배치만 만든다.
function orderedPlacements(heights, rng, limits, topX = -1) {
  let state = rng;
  const result = [];
  const keys = [];
  for (const shape of SHAPES) {
    const width = shape[shape.length - 1][0] + 1;
    const counts = new Array(width).fill(0);
    for (const [dx] of shape) {
      counts[dx] += 1;
    }
    for (let x0 = 0; x0 + width <= COLS; x0++) {
      let bound = Infinity;
      let cost = 0;
      for (let x = 0; x < COLS; x++) {
        const added = x >= x0 && x < x0 + width ? counts[x - x0] : 0;
        const h = heights[x] + added;
        if (h > limits[x]) {
          bound = 0;
        }
        cost += h * h + (x === DEATH_X ? 2 * h : 0);
      }
      for (const [dx, dh] of shape) {
        bound = Math.min(bound, heights[x0 + dx] + counts[dx] - dh);
      }
      let first = 0;
      if (topX >= 0) {
        if (topX < x0 || topX >= x0 + width) {
          continue;
        }
        const top = heights[topX] + counts[topX - x0] - 1;
        const topDh = Math.max(...shape.filter(([dx]) => dx === topX - x0).map(([, dh]) => dh));
        first = top - topDh;
        bound = Math.min(bound, first + 1);
      }
      for (let h0 = Math.max(0, first); h0 < bound; h0++) {
        const jitter = randomInt(state, JITTER);
        state = jitter.state;
        // 정렬 키 하나에 점수와 순번을 함께 담아 숫자 배열 정렬로 끝낸다.
        keys.push((cost + jitter.value) * PLACEMENT_KEY_SCALE + result.length);
        result.push({ shape, x0, h0 });
      }
    }
  }
  const sorted = Float64Array.from(keys).sort();
  return { ordered: Array.from(sorted, (key) => result[key % PLACEMENT_KEY_SCALE]), rng: state };
}

function pickColor(rng, colorCount) {
  const { value, state } = randomInt(rng, colorCount);
  return { color: value + 1, rng: state };
}

// 첫 단계 묶음 중 트리거 열 꼭대기 칸 하나를 떼어 낸다. 그 열에 트리거 색이 아래인
// 세로 쌍을 놓으면 위 칸이 어떤 색이든 연쇄 수가 그대로여야 한다. 같은 조건을 만족하는
// 다른 열도 triggerColumns에 모은다.
function triggerFromTop(columns, cell, color, ctx) {
  const seed = columns.map((column, x) => (x === cell.x ? column.slice(0, -1) : column));
  const cells = columnsToCells(seed);
  if (!seedIsValid(cells) || !firesFromColumn(cells, cell.x, color, ctx.total, ctx.colorCount)) {
    return null;
  }
  const triggerColumns = [];
  for (let x = 0; x < COLS; x++) {
    if (x === cell.x || firesFromColumn(cells, x, color, ctx.total, ctx.colorCount)) {
      triggerColumns.push(x);
    }
  }
  const partner = randomInt(ctx.rng, ctx.colorCount - 1);
  ctx.rng = partner.state;
  const top = partner.value + 1 >= color ? partner.value + 2 : partner.value + 1;
  return { cells, trigger: { x: cell.x, color, orient: 0, pair: [color, top] }, triggerColumns };
}

// 트리거 쌍의 위 칸은 연쇄 내내 트리거 열 꼭대기에 얹혀 있다. 그 칸이 어떤 색이어도
// 터지지 않는 묶음을 새로 만들거나, 터지는 묶음과 다른 덩어리를 이어 붙이지 않아야 한다.
// onlyInsertedGroup이 채운 grid와 inserted를 그대로 쓴다.
function topBlobIsHarmless(columns, x) {
  const h = columns[x].length;
  const spots = [
    [x - 1, h],
    [x + 1, h],
    [x, h - 1],
  ];
  visited.fill(0);
  const touching = new Map();
  for (const [nx, nh] of spots) {
    if (nx < 0 || nx >= COLS || nh < 0) {
      continue;
    }
    const id = nx * GRID_H + nh;
    const color = grid[id];
    if (color === EMPTY || visited[id]) {
      continue;
    }
    const entry = touching.get(color) ?? { size: 0, popping: false, parts: 0 };
    entry.popping ||= inserted[id] === 1;
    entry.size += componentSize(id);
    entry.parts += 1;
    touching.set(color, entry);
  }
  for (const { size, popping, parts } of touching.values()) {
    if (popping ? parts > 1 : size + 1 >= GROUP_SIZE) {
      return false;
    }
  }
  return true;
}

// 끼운 뒤 뒤 단계 묶음의 칸들이 모두 같은 만큼 밀리면 묶음이 그대로 남으므로 후보에서 뺀다.
function breaksGroup(group, cells) {
  if (!group) {
    return true;
  }
  let first = -1;
  for (const { x, h } of group) {
    const column = cells.filter((cell) => cell.x === x).map((cell) => cell.h).sort((a, b) => a - b);
    let moved = h;
    for (const inserted of column) {
      if (inserted <= moved) {
        moved += 1;
      }
    }
    const shift = moved - h;
    if (first === -1) {
      first = shift;
    } else if (shift !== first) {
      return true;
    }
  }
  return false;
}

// 역방향 깊이 우선 탐색. steps는 앞으로 끼워 넣을 묶음 수, group은 바로 뒤 단계에 터질 칸.
function search(columns, steps, ctx, group) {
  ctx.nodes += 1;
  if (ctx.nodes > NODE_BUDGET) {
    return null;
  }
  const heights = heightsOf(columns);
  const picked = pickColor(ctx.rng, ctx.colorCount);
  ctx.rng = picked.rng;
  // 마지막 단계 전까지는 트리거 열에 트리거 칸 한 자리를 남겨 둔다.
  const limits = steps === 1 ? COLUMN_LIMITS : ctx.reservedLimits;
  const { ordered, rng } = orderedPlacements(heights, ctx.rng, limits, steps === 1 ? ctx.triggerX : -1);
  ctx.rng = rng;

  let branches = 0;
  for (const { shape, x0, h0 } of ordered) {
    const cells = shape.map(([dx, dh]) => ({ x: x0 + dx, h: h0 + dh }));
    if (!breaksGroup(group, cells)) {
      continue;
    }
    for (let shift = 0; shift < ctx.colorCount; shift++) {
      const color = ((picked.color - 1 + shift) % ctx.colorCount) + 1;
      const next = insertCells(columns, cells, color);
      if (!onlyInsertedGroup(next, cells)) {
        continue;
      }
      if (steps === 1) {
        if (!topBlobIsHarmless(next, ctx.triggerX)) {
          continue;
        }
        const cell = cells.find((c) => c.x === ctx.triggerX && c.h === next[c.x].length - 1);
        const found = triggerFromTop(next, cell, color, ctx);
        if (found) {
          return found;
        }
        continue;
      }
      if (!topBlobIsHarmless(next, ctx.triggerX)) {
        continue;
      }
      const found = search(next, steps - 1, ctx, cells);
      if (found || ctx.nodes > NODE_BUDGET) {
        return found;
      }
      branches += 1;
      if (branches >= (steps === 2 ? FINAL_BRANCHES : MAX_BRANCHES)) {
        return null;
      }
    }
  }
  return null;
}

function columnsToCells(columns) {
  const cells = new Array(COLS * ROWS).fill(EMPTY);
  columns.forEach((column, x) => {
    column.forEach((color, h) => {
      cells[index(x, ROWS - 1 - h)] = color;
    });
  });
  return cells;
}

// 하드 드롭 뒤 바로 정착시킨다. 쌍이 들어갈 자리가 없으면 null.
function dropPair(cells, x, orient, pair) {
  let row = ROWS - 2;
  if (!fits(cells, x, row, orient)) {
    return null;
  }
  while (row > 0 && fits(cells, x, row - 1, orient)) {
    row -= 1;
  }
  const next = cells.slice();
  const placed = [
    { x, row, color: pair[0] },
    { x: x + [0, 1, 0, -1][orient], row: row + [1, 0, -1, 0][orient], color: pair[1] },
  ];
  for (const cell of placed) {
    next[index(cell.x, ROWS - 1 - cell.row)] = cell.color;
  }
  return settleInstantly(next);
}

function simulateChain(cells) {
  let current = settleInstantly(cells);
  let chain = 0;
  for (;;) {
    const groups = findGroups(current);
    if (groups.length === 0) {
      return chain;
    }
    chain += 1;
    const next = current.slice();
    for (const { x, y } of clearTargets(current, groups)) {
      next[index(x, y)] = EMPTY;
    }
    current = settleInstantly(next);
  }
}

function columnHeightOf(cells, x) {
  let height = 0;
  for (let y = ROWS - 1; y >= 0 && getCell(cells, x, y) !== EMPTY; y--) {
    height += 1;
  }
  return height;
}

function seedIsValid(cells) {
  if (findGroups(cells).length > 0) {
    return false;
  }
  for (let x = 0; x < COLS; x++) {
    if (columnHeightOf(cells, x) > COLUMN_LIMITS[x]) {
      return false;
    }
  }
  return getCell(cells, DEATH_X, 2) === EMPTY && getCell(cells, DEATH_X, 1) === EMPTY;
}

// 트리거 색이 아래인 세로 쌍을 x열에 놓았을 때, 위 칸의 모든 색에 대해 연쇄 수가 같은지 본다.
function firesFromColumn(cells, x, color, chainLength, colorCount) {
  for (let top = 1; top <= colorCount; top++) {
    const dropped = dropPair(cells, x, 0, [color, top]);
    if (dropped === null || simulateChain(dropped) !== chainLength) {
      return false;
    }
  }
  return true;
}

// rngState는 rng.js 상태값, 반환 rng는 소비 뒤 상태다. 같은 입력이면 항상 같은 씨앗이 나온다.
function generateFeverSeed(rngState, chainLength, colorCount = 4) {
  if (!Number.isInteger(chainLength) || chainLength < MIN_CHAIN || chainLength > MAX_CHAIN) {
    throw new RangeError(`chainLength must be ${MIN_CHAIN}..${MAX_CHAIN}`);
  }
  if (colorCount < 3) {
    throw new RangeError('colorCount must be at least 3');
  }
  const triggerCandidates = chainLength >= EDGE_TRIGGER_CHAIN ? TRIGGER_COLUMNS_EDGE : TRIGGER_COLUMNS_ANY;
  let rng = rngState >>> 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const column = randomInt(rng, triggerCandidates.length);
    const triggerX = triggerCandidates[column.value];
    const reservedLimits = COLUMN_LIMITS.map((limit, x) => (x === triggerX ? limit - 1 : limit));
    const ctx = { rng: column.state, nodes: 0, colorCount, total: chainLength, triggerX, reservedLimits };
    const found = search(new Array(COLS).fill(null).map(() => []), chainLength, ctx);
    rng = ctx.rng;
    if (!found) {
      continue;
    }
    const { cells, trigger, triggerColumns } = found;
    if (seedIsValid(cells) && firesFromColumn(cells, trigger.x, trigger.color, chainLength, colorCount)) {
      return { cells, trigger, triggerColumns, chain: chainLength, rng };
    }
  }
  throw new Error(`fever seed generation failed for chain ${chainLength}`);
}

export { dropPair, generateFeverSeed, simulateChain };
