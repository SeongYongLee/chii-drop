import { fits, pieceCellsAt, rowOf } from '../engine/control.js';
import { EMPTY, clearTargets, columnHeight, findGroups, getCell, isColor, settleInstantly } from '../engine/field.js';
import { COLS, DEATH_X, DEATH_Y, GARBAGE_RATE, HIDDEN_ROWS, MIN_GROUP, ROWS } from '../engine/rules.js';
import { scoreStep } from '../engine/scoring.js';

const LETHAL = -1e9;

// 패배 칸(3열 12단)이 차는 높이. 이 높이에 가까워질수록 위험으로 본다.
const DEATH_HEIGHT = ROWS - DEATH_Y;
const SPAWN_DANGER_HEIGHT = DEATH_HEIGHT - 3;
const DANGER_HEIGHT = DEATH_HEIGHT - 3;

const WEIGHTS = {
  height: 0.5,
  spawnColumn: 150,
  spawnSide: 250,
  isolated: -6,
  pair: 8,
  triple: 20,
  potential: 20,
  chainScore: 0.25,
  chainCount: 15,
  offset: 30,
};

function resolveChains(cells) {
  let current = cells;
  let chains = 0;
  let score = 0;
  for (;;) {
    const groups = findGroups(current);
    if (groups.length === 0) {
      break;
    }
    chains++;
    score += scoreStep(groups, chains);
    const removed = current.slice();
    clearTargets(current, groups).forEach(({ x, y }) => {
      removed[y * COLS + x] = EMPTY;
    });
    current = settleInstantly(removed);
  }
  return { field: current, chains, score };
}

function dropPair(cells, x, row, orient, pair) {
  let landed = row;
  while (fits(cells, x, landed - 1, orient)) {
    landed--;
  }
  const placed = cells.slice();
  pieceCellsAt(x, landed, orient, pair[0], pair[1]).forEach((cell) => {
    if (cell.y >= 0) {
      placed[cell.y * COLS + cell.x] = cell.color;
    }
  });
  return settleInstantly(placed);
}

// 아래 방향은 바닥차기로 한 칸 올라가 놓일 수 있다.
function fitsOrKicks(cells, x, row, orient) {
  return fits(cells, x, row, orient) || (orient === 2 && fits(cells, x, row + 1, orient));
}

// 현재 높이에서 좌우 이동과 회전(벽차기 포함)만으로 닿을 수 있는 (x, orient)를 모두 찾는다.
// 퀵 턴은 고려하지 않는다.
function reachablePlacements(cells, piece) {
  const row = rowOf(piece.h);
  const pair = [piece.pivot, piece.child];
  const keyOf = (x, orient) => orient * COLS + x;
  const start = { x: piece.x, orient: piece.orient };
  const seen = new Map([[keyOf(start.x, start.orient), start]]);
  const queue = [start];
  const visit = (x, orient) => {
    if (!seen.has(keyOf(x, orient)) && fitsOrKicks(cells, x, row, orient)) {
      const state = { x, orient };
      seen.set(keyOf(x, orient), state);
      queue.push(state);
      return true;
    }
    return false;
  };
  while (queue.length > 0) {
    const { x, orient } = queue.shift();
    visit(x - 1, orient);
    visit(x + 1, orient);
    for (const turns of [1, 3]) {
      const next = (orient + turns) % 4;
      if (!visit(x, next) && (next === 1 || next === 3)) {
        visit(next === 1 ? x - 1 : x + 1, next);
      }
    }
  }
  return [...seen.values()].map(({ x, orient }) => ({
    x,
    orient,
    field: dropPair(cells, x, fits(cells, x, row, orient) ? row : row + 1, orient, pair),
  }));
}

function isLethal(cells) {
  return getCell(cells, DEATH_X, DEATH_Y) !== EMPTY;
}

function heightsOf(cells) {
  return Array.from({ length: COLS }, (_, x) => columnHeight(cells, x));
}

function floodSize(field, start, seen) {
  const color = field[start];
  let size = 0;
  const stack = [start];
  seen[start] = 1;
  while (stack.length > 0) {
    const index = stack.pop();
    size++;
    const x = index % COLS;
    const neighbors = [index - COLS, index + COLS, x > 0 ? index - 1 : -1, x < COLS - 1 ? index + 1 : -1];
    for (const n of neighbors) {
      if (n >= HIDDEN_ROWS * COLS && n < COLS * ROWS && !seen[n] && field[n] === color) {
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
  return size;
}

function groupSizes(field) {
  const seen = new Uint8Array(COLS * ROWS);
  const sizes = [];
  for (let start = HIDDEN_ROWS * COLS; start < COLS * ROWS; start++) {
    if (isColor(field[start]) && !seen[start]) {
      sizes.push(floodSize(field, start, seen));
    }
  }
  return sizes;
}

function topColor(field, x) {
  for (let y = 0; y < ROWS; y++) {
    const color = getCell(field, x, y);
    if (color !== EMPTY) {
      return isColor(color) ? color : EMPTY;
    }
  }
  return EMPTY;
}

// 계산 중에만 쓰는 임시 버퍼다. 호출 사이에 상태를 남기지 않는다.
const scratchSeen = new Uint8Array(COLS * ROWS);

// 어떤 열에 같은 색 1~2개를 더 떨어뜨렸을 때 터지는 가장 긴 연쇄로 잠재 연쇄를 어림한다.
function chainPotential(field, heights) {
  let best = 0;
  for (let x = 0; x < COLS; x++) {
    if (heights[x] >= DEATH_HEIGHT - 2) {
      continue;
    }
    const colors = new Set();
    for (let nx = Math.max(0, x - 1); nx <= Math.min(COLS - 1, x + 1); nx++) {
      const color = topColor(field, nx);
      if (color !== EMPTY) {
        colors.add(color);
      }
    }
    const top = ROWS - 1 - heights[x];
    for (const color of colors) {
      for (let count = 1; count <= 2; count++) {
        const lastY = top - count + 1;
        if (lastY < HIDDEN_ROWS) {
          break;
        }
        const placed = field.slice();
        for (let i = 0; i < count; i++) {
          placed[(top - i) * COLS + x] = color;
        }
        // 떨어뜨린 블롭이 4개 묶음을 만들지 못하면 연쇄 계산을 건너뛴다.
        scratchSeen.fill(0);
        if (floodSize(placed, lastY * COLS + x, scratchSeen) < MIN_GROUP) {
          continue;
        }
        const { chains } = resolveChains(placed);
        if (chains > 0) {
          best = Math.max(best, (chains * chains) / count);
          break;
        }
      }
    }
  }
  return best;
}

function fieldScore(field, { potential = true } = {}) {
  if (isLethal(field)) {
    return LETHAL;
  }
  const heights = heightsOf(field);
  let value = 0;
  heights.forEach((h) => {
    value -= h * h * WEIGHTS.height;
  });
  const spawnHeight = heights[DEATH_X];
  if (spawnHeight >= SPAWN_DANGER_HEIGHT) {
    value -= (spawnHeight - SPAWN_DANGER_HEIGHT + 1) ** 2 * WEIGHTS.spawnColumn;
  }
  // 생성 열 양옆이 꼭대기까지 차면 쌍을 옮길 수 없게 된다.
  for (const x of [DEATH_X - 1, DEATH_X + 1]) {
    if (heights[x] >= DEATH_HEIGHT - 1) {
      value -= WEIGHTS.spawnSide;
    }
  }
  groupSizes(field).forEach((size) => {
    if (size === 1) {
      value += WEIGHTS.isolated;
    } else if (size === 2) {
      value += WEIGHTS.pair;
    } else if (size === 3) {
      value += WEIGHTS.triple;
    }
  });
  const future = potential ? chainPotential(field, heights) : 0;
  if (future >= 4) {
    value += future * WEIGHTS.potential;
  }
  return value;
}

// ctx: { incoming, danger }. danger는 놓기 전 필드가 높을 때 true
function chainReward(sim, ctx) {
  if (sim.chains === 0) {
    return 0;
  }
  const garbage = Math.floor(sim.score / GARBAGE_RATE);
  let value = sim.score * WEIGHTS.chainScore + sim.chains * sim.chains * WEIGHTS.chainCount;
  value += Math.min(garbage, ctx.incoming) * WEIGHTS.offset;
  return ctx.danger ? value * 2 : value;
}

function contextOf(field, incoming) {
  return { incoming, danger: Math.max(...heightsOf(field)) >= DANGER_HEIGHT || incoming >= COLS };
}

function evaluatePlacements(field, piece, incoming) {
  const ctx = contextOf(field, incoming);
  return reachablePlacements(field, piece).map(({ x, orient, field: placed }) => {
    const sim = resolveChains(placed);
    const lethal = isLethal(sim.field);
    const reward = chainReward(sim, ctx);
    const value = lethal ? LETHAL : reward + fieldScore(sim.field);
    return { x, orient, field: sim.field, chains: sim.chains, reward, value, lethal };
  });
}

export { LETHAL, chainPotential, evaluatePlacements, fieldScore, isLethal, reachablePlacements, resolveChains };
