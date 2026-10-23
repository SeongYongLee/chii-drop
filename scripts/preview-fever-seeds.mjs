// 피버 연쇄 씨앗을 몇 개 만들어 ASCII로 보여 준다.
// 사용: node scripts/preview-fever-seeds.mjs [연쇄 수...] [--seed N] [--count N]
import { dropPair, generateFeverSeed, simulateChain } from '../src/engine/fever-seeds.js';
import { EMPTY, getCell } from '../src/engine/field.js';
import { createRng } from '../src/engine/rng.js';
import { COLS, DEATH_X, DEATH_Y, ROWS } from '../src/engine/rules.js';

const ORIENT_NAMES = ['up', 'right', 'down', 'left'];
const SYMBOLS = ['.', 'R', 'G', 'B', 'Y', 'P'];

function parseArgs(argv) {
  const options = { chains: [], seed: 1, count: 2 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seed') {
      options.seed = Number(argv[++i]);
    } else if (argv[i] === '--count') {
      options.count = Number(argv[++i]);
    } else {
      options.chains.push(Number(argv[i]));
    }
  }
  if (options.chains.length === 0) {
    options.chains = [3, 7, 11, 15];
  }
  return options;
}

function rowsOf(cells) {
  const rows = [];
  for (let y = 1; y < ROWS; y++) {
    let row = '';
    for (let x = 0; x < COLS; x++) {
      const color = getCell(cells, x, y);
      row += color === EMPTY && x === DEATH_X && y === DEATH_Y ? 'x' : SYMBOLS[color] ?? '?';
    }
    rows.push(`${String(ROWS - y).padStart(2)} |${row}|`);
  }
  return rows;
}

const { chains, seed, count } = parseArgs(process.argv.slice(2));
let rng = createRng(seed);
for (const chain of chains) {
  for (let n = 0; n < count; n++) {
    const start = performance.now();
    const result = generateFeverSeed(rng, chain);
    const elapsed = performance.now() - start;
    rng = result.rng;
    const { cells, trigger } = result;
    const dropped = dropPair(cells, trigger.x, trigger.orient, trigger.pair);
    const pair = trigger.pair.map((color) => SYMBOLS[color]).join('');
    const columns = result.triggerColumns.map((x) => x + 1).join(',');
    console.log(
      `chain ${chain} #${n + 1}  trigger color=${SYMBOLS[trigger.color]} x=${trigger.x + 1} (columns ${columns}) ` +
        `example ${ORIENT_NAMES[trigger.orient]} pair=${pair}  verified=${simulateChain(dropped)}  ${elapsed.toFixed(1)}ms`,
    );
    const before = rowsOf(cells);
    const after = rowsOf(dropped);
    console.log('    seed       after trigger');
    before.forEach((row, i) => console.log(`${row}   ${after[i]}`));
    console.log('');
  }
}
