import test from 'node:test';
import assert from 'node:assert/strict';
import { createCpu, stepCpu } from '../src/cpu/cpu.js';
import { chainPotential, evaluatePlacements } from '../src/cpu/evaluate.js';
import { createMatch, stepMatch } from '../src/engine/match.js';
import { columnHeight, fieldFromRows } from '../src/engine/field.js';
import { COLS } from '../src/engine/rules.js';
import { advanceBuildSearch, buildSearchResults } from '../src/cpu/planner.js';

function fixture(incoming = 0) {
  const match = createMatch({ seed: 4, playerCount: 1,
    fields: [fieldFromRows(['..2...', '422...', '441...', '21444.', '211333'])] });
  const player = match.players[0];
  player.piece = { ...player.piece, pivot: 1, child: 4 };
  player.stocks.a = incoming;
  match.table[1] = [2, 4]; match.table[2] = [4, 4];
  return match;
}
function planned(match, opponent, level = 'expert') {
  // 정확한 탐색 결과는 의도적인 실수가 발생하지 않는 시드로 검사한다.
  let cpu = createCpu({ level, seed: 30 }), steps = 0;
  do { cpu = stepCpu(cpu, match.players[0], match.table, opponent).cpu; steps++; }
  while (!cpu.planned && steps < 14);
  assert.ok(cpu.planned, '출현 대기 중에 계획을 완료해야 한다');
  return { cpu, steps };
}
function chosen(match, cpu) {
  return evaluatePlacements(match.players[0].board.cells, match.players[0].piece, 0)
    .find((p) => p.x === cpu.target.x && p.orient === cpu.target.orient);
}

test('쉬움은 NEXT 첫 쌍에 맞춰 배치를 바꾸고 그 이후 쌍과 경기 상태는 건드리지 않는다', () => {
  const match = createMatch({ seed: 4, playerCount: 1,
    fields: [fieldFromRows(['214321', '432143', '214321'])] });
  match.table[1] = [1, 2];
  const before = structuredClone(match);
  const first = planned(match, undefined, 'normal');
  assert.deepEqual(match, before);
  assert.ok(first.steps > 1 && first.steps < match.players[0].phaseTimer);
  const next = structuredClone(match);
  next.table[1] = [2, 3];
  assert.notDeepEqual(planned(next, undefined, 'normal').cpu.target, first.cpu.target);
  const hidden = structuredClone(match);
  for (let i = 2; i < hidden.table.length; i++) hidden.table[i] = [4, 4];
  assert.deepEqual(planned(hidden, undefined, 'normal').cpu, first.cpu);
});

test('어려움은 안전할 때 즉시 1연쇄를 내는 대신 연쇄 기반을 쌓는다', () => {
  const match = fixture();
  const before = structuredClone(match);
  const { cpu, steps } = planned(match);
  assert.ok(steps > 1, '추가 탐색은 여러 프레임에 나눠야 한다');
  assert.deepEqual(match, before, '계산으로 엔진 상태와 경기 난수를 바꾸면 안 된다');
  const options = evaluatePlacements(match.players[0].board.cells, match.players[0].piece, 0);
  assert.ok(options.some((p) => p.chains === 1));
  const selected = chosen(match, cpu);
  assert.equal(selected.chains, 0);
  assert.ok(chainPotential(selected.field, Array.from({ length: COLS }, (_, x) => columnHeight(selected.field, x))) >= 9);
});

test('방해 예고와 이미 시작한 상대 공격에는 연쇄 쌓기보다 상쇄를 우선한다', () => {
  const match = fixture(30);
  assert.ok(chosen(match, planned(match).cpu).chains >= 1);
  const safe = fixture();
  const enemy = createMatch({ seed: 8, fields: [fieldFromRows(['111111', '111111'])] }).players[0];
  enemy.phase = 'flash';
  assert.ok(chosen(safe, planned(safe, enemy).cpu).chains >= 1);
  assert.equal(safe.players[0].stocks.a, 0, '실제 공격 도착 전의 판단이어야 한다');
});

test('탐색 후보가 하나여도 실수는 다양한 안전 배치로 반영하고 큰 방해에는 상쇄를 지킨다', () => {
  const match = fixture(), before = structuredClone(match);
  let search = stepCpu(createCpu({ level: 'normal', seed: 30 }), match.players[0], match.table).cpu.thinking;
  while (!search.done) search = advanceBuildSearch(search);
  assert.equal(buildSearchResults(search).length, 1);
  const choices = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    for (const incoming of [0, 30]) {
      const current = incoming ? fixture(incoming) : match;
      let cpu = createCpu({ level: 'normal', seed });
      while (!cpu.planned) cpu = stepCpu(cpu, current.players[0], current.table).cpu;
      const option = chosen(current, cpu);
      assert.ok(option && !option.lethal);
      if (incoming) assert.ok(option.chains >= 1, `seed ${seed}: 상쇄를 포기했다`);
      else choices.add(`${cpu.target.x}:${cpu.target.orient}`);
    }
  }
  assert.ok(choices.size >= 3);
  assert.deepEqual(match, before);
});

test('화면에 보이지 않는 세 번째 이후 NEXT를 바꿔도 결정은 같다', () => {
  const a = fixture(), b = structuredClone(a);
  for (let i = 3; i < b.table.length; i++) b.table[i] = [4, 4];
  for (const level of ['expert', 'master']) assert.deepEqual(planned(a, undefined, level).cpu, planned(b, undefined, level).cpu);
});

test('어려움은 실제 프레임 조작으로 5연쇄 이상을 반복해서 만들고 120쌍 동안 살아남는다', () => {
  let match = createMatch({ seed: 1, playerCount: 1 }), cpu = createCpu({ level: 'expert', seed: 31 });
  let locks = 0, largeChains = 0;
  for (let frame = 0; frame < 30000 && locks < 120 && match.phase !== 'over'; frame++) {
    const result = stepCpu(cpu, match.players[0], match.table); cpu = result.cpu;
    match = stepMatch(match, [result.input]);
    for (const event of match.players[0].events) {
      if (event.type === 'lock') locks++;
      if (event.type === 'chainEnd' && event.chain >= 5) largeChains++;
    }
  }
  assert.equal(locks, 120); assert.equal(match.players[0].lost, false);
  assert.ok(largeChains >= 2, `큰 연쇄 ${largeChains}회`);
});

test('아주 어려움도 계산을 나눠서 엔진을 보존하고 NEXT가 없을 때 상쇄 수를 찾는다', () => {
  const safe = fixture(), before = structuredClone(safe);
  const {cpu,steps} = planned(safe, undefined, 'master');
  assert.ok(steps > 1 && steps <= 13);
  assert.deepEqual(safe, before);
  assert.equal(chosen(safe,cpu).chains,0);
  const danger = fixture(30);
  danger.table = null;
  assert.ok(chosen(danger,planned(danger,undefined,'master').cpu).chains >= 1);
});

test('아주 어려움은 실제 조작으로 6연쇄 이상을 반복해 쌓는다', () => {
 let match = createMatch({seed:1,playerCount:1}),cpu=createCpu({level:'master',seed:31});
 let locks=0,largeChains=0;
 while(match.phase !== 'over' && match.frame < 30000 && locks < 120){
   const result=stepCpu(cpu,match.players[0],match.table);cpu=result.cpu;
   match=stepMatch(match,[result.input]);
   for(const event of match.players[0].events){if(event.type==='lock')locks++;if(event.type==='chainEnd'&&event.chain>=6)largeChains++;}
 }
 assert.equal(locks,120);assert.equal(match.players[0].lost,false);
 assert.ok(largeChains>=2,`6연쇄 이상 ${largeChains}회`);
});
