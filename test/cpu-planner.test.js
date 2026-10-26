import test from 'node:test';
import assert from 'node:assert/strict';
import { CPU_LEVELS, createCpu, stepCpu } from '../src/cpu/cpu.js';
import { randomInt } from '../src/engine/rng.js';
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

test('달인은 최상위 동점만 자체 난수로 선택하며 같은 시드로 재현한다', () => {
  const match = createMatch({ seed: 1 });
  const before = structuredClone(match);
  const targets = new Set();
  function select(seed) {
    let cpu = createCpu({ level: 'grandmaster', seed });
    let ranked;
    for (let frame = 0; frame < 100 && !cpu.planned; frame++) {
      if (cpu.thinking) {
        const search = advanceBuildSearch(cpu.thinking);
        if (search.done) ranked = buildSearchResults(search);
      }
      cpu = stepCpu(cpu, match.players[0], match.table, match.players[1]).cpu;
    }
    assert.ok(cpu.planned);
    const selected = ranked.find(p => p.x === cpu.target.x && p.orient === cpu.target.orient);
    assert.equal(selected.value, ranked[0].value, '평가가 낮은 후보는 선택하지 않는다');
    return cpu;
  }
  for (let seed = 1; seed <= 16; seed++) {
    const cpu = select(seed);
    assert.deepEqual(cpu, select(seed));
    targets.add(JSON.stringify(cpu.target));
  }
  assert.ok(targets.size > 1, '동점 배치는 시드에 따라 달라진다');
  assert.deepEqual(match, before, '경기 상태와 경기 난수는 변경하지 않는다');
});

test('모든 난이도가 실수하지 않는 턴에는 최상위 동점 배치를 다양하게 선택한다', () => {
  const match = createMatch({ seed: 1 });
  const before = structuredClone(match);
  for (const { id } of CPU_LEVELS) {
    const targets = new Set();
    for (let seed = 1; seed <= 32; seed++) {
      // 동점 선택 다음의 확률 추첨이 50 이상이면 모든 난이도에서 실수가 없다.
      if (randomInt(randomInt(seed, 1).state, 100).value < 50) continue;
      let cpu = createCpu({ level: id, seed }), ranked;
      for (let frame = 0; frame < 100 && !cpu.planned; frame++) {
        if (cpu.thinking) {
          const search = advanceBuildSearch(cpu.thinking);
          if (search.done) ranked = buildSearchResults(search);
        }
        cpu = stepCpu(cpu, match.players[0], match.table, match.players[1]).cpu;
      }
      assert.ok(cpu.planned, id);
      assert.ok(ranked.filter(option => option.value === ranked[0].value).length > 1, `${id}: 동점 후보가 있는 판`);
      const selected = ranked.find(option => option.x === cpu.target.x && option.orient === cpu.target.orient);
      assert.equal(selected?.value, ranked[0].value, `${id}: 최고 평가 유지`);
      targets.add(JSON.stringify(cpu.target));
    }
    assert.ok(targets.size > 1, `${id}: 동점 선택이 한 위치에 고정되지 않는다`);
  }
  assert.deepEqual(match, before);
});

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

function recoveryFixture(incoming, child = 2) {
  const match = createMatch({ seed: 4, playerCount: 1, fields: [fieldFromRows([
    '..2...', '422...', '441...', '21444.', '211333', 'GGGGGG', 'GGGGGG', 'GGGGGG',
  ])] });
  match.players[0].piece = { ...match.players[0].piece, pivot: 1, child };
  match.players[0].stocks.a = incoming;
  match.table[1] = [2, 4]; match.table[2] = [4, 4];
  return match;
}

test('한 줄 예고의 즉시 소거 강제는 하위 세 단계만 유지하고 보통 이상은 회복 수를 허용한다', () => {
  for (const { id } of CPU_LEVELS) {
    let preparations = 0;
    for (let seed = 1; seed <= 16; seed++) {
      for (const incoming of [6, 30]) {
        const match = recoveryFixture(incoming);
        let cpu = createCpu({ level: id, seed });
        for (let frame = 0; frame < 100 && !cpu.planned; frame++) {
          cpu = stepCpu(cpu, match.players[0], match.table).cpu;
        }
        assert.ok(cpu.planned);
        const option = chosen(match, cpu);
        assert.ok(option && !option.lethal);
        if (incoming === 30) assert.ok(option.chains > 0, `${id}: 공간 부족 시 즉시 상쇄`);
        else if (option.chains === 0) preparations++;
      }
    }
    if (['beginner', 'easy', 'normal'].includes(id)) assert.equal(preparations, 0, id);
    else assert.ok(preparations > 0, `${id}: 연쇄 준비 선택도 남아야 한다`);
  }
});

test('보통~아주 어려움은 예고를 견딘 뒤 실제로 2연쇄 이상 반격한다', () => {
  for (const level of ['hard', 'expert', 'master']) {
    let match = recoveryFixture(6), cpu = createCpu({ level, seed: 30 });
    let locks = 0, maxChain = 0, received = 0;
    while (match.phase !== 'over' && match.frame < 5000 && locks < 8) {
      const result = stepCpu(cpu, match.players[0], match.table);
      cpu = result.cpu; match = stepMatch(match, [result.input]);
      for (const event of match.players[0].events) {
        if (event.type === 'lock') locks++;
        if (event.type === 'chainEnd') maxChain = Math.max(maxChain, event.chain);
        if (event.type === 'garbage') received += event.amount;
      }
    }
    assert.equal(locks, 8, level);
    assert.equal(match.players[0].lost, false, level);
    assert.equal(received, 6, level);
    assert.ok(maxChain >= 2, `${level}: 반격 ${maxChain}연쇄`);
  }
});

test('달인은 잡초를 맞아 높아진 판에서도 1연쇄 대신 기반을 남기고 실제 3연쇄로 회복한다', () => {
  let match = recoveryFixture(6);
  const options = evaluatePlacements(match.players[0].board.cells, match.players[0].piece, 6);
  assert.equal(Math.max(...options.filter(option => !option.lethal).map(option => option.chains)), 1);
  assert.equal(chosen(match, planned(match, undefined, 'grandmaster').cpu).chains, 0);
  let cpu = createCpu({ level: 'grandmaster', seed: 30 });
  let locks = 0, largest = 0, received = 0;
  while (match.phase !== 'over' && match.frame < 3000 && locks < 8) {
    const result = stepCpu(cpu, match.players[0], match.table);
    cpu = result.cpu; match = stepMatch(match, [result.input]);
    for (const event of match.players[0].events) {
      if (event.type === 'lock') locks++;
      if (event.type === 'chainEnd') largest = Math.max(largest, event.chain);
      if (event.type === 'garbage') received += event.amount;
    }
  }
  assert.equal(received, 6, '실제로 방해를 받은 뒤의 조작까지 검사한다');
  assert.equal(locks, 8);
  assert.equal(match.players[0].lost, false);
  assert.ok(largest >= 3, `회복 연쇄 ${largest}`);
});

test('달인은 받을 공간이 부족하면 즉시 상쇄하고 이미 가능한 큰 반격도 활용한다', () => {
  const emergency = recoveryFixture(30);
  assert.equal(chosen(emergency, planned(emergency, undefined, 'grandmaster').cpu).chains, 1);
  const counter = recoveryFixture(30, 4);
  assert.ok(chosen(counter, planned(counter, undefined, 'grandmaster').cpu).chains >= 3);
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
  for (const level of ['expert', 'master', 'grandmaster']) assert.deepEqual(planned(a, undefined, level).cpu, planned(b, undefined, level).cpu);
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

test('달인은 실제 조작으로 6연쇄 이상을 반복해 쌓는다', () => {
 // 동점 선택을 무작위화했으므로 한 경기의 고정 경로 대신 여러 블록 순서를 검사한다.
 const counts = [];
 for (let seed = 1; seed <= 5; seed++) {
   let match = createMatch({seed,playerCount:1}),cpu=createCpu({level:'grandmaster',seed:31});
   let locks=0,largeChains=0;
   while(match.phase !== 'over' && match.frame < 30000 && locks < 120){
     const result=stepCpu(cpu,match.players[0],match.table);cpu=result.cpu;
     match=stepMatch(match,[result.input]);
     for(const event of match.players[0].events){if(event.type==='lock')locks++;if(event.type==='chainEnd'&&event.chain>=6)largeChains++;}
   }
   assert.equal(locks,120);assert.equal(match.players[0].lost,false);
   counts.push(largeChains);
 }
 assert.ok(counts.reduce((sum, count) => sum + count, 0) >= 10, `6연쇄 횟수: ${counts}`);
 assert.ok(counts.filter(count => count >= 2).length >= 3, `반복 발화 경기 수: ${counts}`);
});
