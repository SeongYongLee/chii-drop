// 후보 구현과 기준 모듈의 결과·셀 순서를 비교한 뒤 같은 판으로 계산 시간을 잰다.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { findGroups } from '../src/engine/field.js';
import { COLS, ROWS } from '../src/engine/rules.js';
import { randomInt } from '../src/engine/rng.js';

let rng = 951753;
const fields = Array.from({ length: 2000 }, (_, n) => Object.freeze(Array.from({ length: COLS * ROWS }, () => {
  const roll = randomInt(rng, 12); rng = roll.state;
  return n % 10 === 0 ? 1 : roll.value < 6 ? roll.value : roll.value === 6 ? 9 : 0;
})));
const reference = process.argv[2] ? (await import(pathToFileURL(resolve(process.argv[2])))).findGroups : null;
if (reference) for (const cells of fields) assert.deepEqual(findGroups(cells), reference(cells));
function measure(run) {
  for (const field of fields) run(field);
  const samples = [];
  for (let repeat = 0; repeat < 5; repeat++) {
    const start = performance.now();
    for (let pass = 0; pass < 10; pass++) for (const field of fields) run(field);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { calls: fields.length * 10, medianMs: samples[2], samplesMs: samples };
}
const before = reference ? measure(reference) : null, after = measure(findGroups);
console.log(JSON.stringify({ comparedFields: reference ? fields.length : 0, before, after,
  speedup: before ? before.medianMs / after.medianMs : null }, null, 2));
