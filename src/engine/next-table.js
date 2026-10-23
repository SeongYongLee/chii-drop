import { randomInt } from './rng.js';

const TABLE_PAIRS = 256;
const TABLE_CELLS = TABLE_PAIRS * 2;
const WORK_PAIRS = 1024;
const START_COLORS = 3;
const START_CELLS = 6;
const REGEN_SWAPS = 1012;

function draw(ctx, max) {
  const result = randomInt(ctx.rng, max);
  ctx.rng = result.state;
  return result.value;
}

// 3.2절. 교환 위치 작업표(1,024쌍)를 만든다.
function buildWorkTable(ctx) {
  const pairs = [];
  for (let i = 0; i < WORK_PAIRS; i++) {
    pairs.push([draw(ctx, TABLE_CELLS), draw(ctx, TABLE_CELLS)]);
  }
  return pairs;
}

// 3.4절. 첫 세 쌍이 3색만 갖는 시작용 테이블.
function buildStartTable(ctx, work) {
  const cells = new Array(TABLE_CELLS);
  for (let i = 0; i < TABLE_PAIRS; i++) {
    const color = (i % START_COLORS) + 1;
    cells[2 * i] = color;
    cells[2 * ((i + 1) % TABLE_PAIRS) + 1] = color;
  }
  for (const [first, second] of work) {
    let a = first;
    let b = second;
    if (a < START_CELLS) {
      b = draw(ctx, START_CELLS);
    } else if (b < START_CELLS) {
      a = draw(ctx, START_CELLS);
    }
    [cells[a], cells[b]] = [cells[b], cells[a]];
  }
  return cells;
}

// 3.5절. 첫 세 쌍을 남기고 나머지를 같은 색 쌍으로 채운 뒤 색 칸을 1,012번 맞바꾼다.
function regenerateForVersus(ctx, startCells, colorCount) {
  const cells = startCells.slice();
  for (let pair = START_CELLS / 2; pair < TABLE_PAIRS; pair++) {
    const color = ((pair - START_CELLS / 2) % colorCount) + 1;
    cells[2 * pair] = color;
    cells[2 * pair + 1] = color;
  }
  const span = TABLE_CELLS - START_CELLS;
  for (let i = 0; i < REGEN_SWAPS; i++) {
    const a = draw(ctx, span) + START_CELLS;
    const b = draw(ctx, span) + START_CELLS;
    [cells[a], cells[b]] = [cells[b], cells[a]];
  }
  return cells;
}

// 원작의 색 패턴 선택(상한 5)은 난수 소비만 맞추고, 색 번호는 1부터 차례로 쓴다.
function buildNextTable(rng, colorCount) {
  const ctx = { rng };
  const work = buildWorkTable(ctx);
  draw(ctx, 5);
  const start = buildStartTable(ctx, work);
  const cells = regenerateForVersus(ctx, start, colorCount);
  const pairs = [];
  for (let i = 0; i < TABLE_PAIRS; i++) {
    pairs.push([cells[2 * i], cells[2 * i + 1]]);
  }
  return { pairs, rng: ctx.rng };
}

function pairAt(table, index) {
  return table[index % TABLE_PAIRS];
}

export { TABLE_PAIRS, buildNextTable, pairAt };
