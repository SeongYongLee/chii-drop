import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPiece, pieceCells, stepPiece } from '../src/engine/control.js';
import { GARBAGE, createBoard, fieldFromRows, findGroups, getCell, stepBoardFall } from '../src/engine/field.js';
import { INPUT } from '../src/engine/input.js';
import { createMatch, stepMatch } from '../src/engine/match.js';
import { buildNextTable } from '../src/engine/next-table.js';
import { createRng } from '../src/engine/rng.js';
import { ROWS, SPAWN_HEIGHT } from '../src/engine/rules.js';
import { garbageTarget, scoreStep } from '../src/engine/scoring.js';

const EMPTY_CELLS = fieldFromRows([]);

function controlFrames(piece, cells, inputs, { fallSpeed = 16 } = {}) {
  let current = piece;
  let softCounter = -2;
  let points = 0;
  let prev = 0;
  let heldFrames = 0;
  let heldDir = 0;
  const trace = [];
  for (const input of inputs) {
    const dir = input & INPUT.LEFT ? -1 : input & INPUT.RIGHT ? 1 : 0;
    heldFrames = dir !== 0 && dir === heldDir ? heldFrames + 1 : dir !== 0 ? 1 : 0;
    heldDir = dir;
    const result = stepPiece(current, { cells, input, pressed: input & ~prev, heldFrames, fallSpeed, softCounter });
    prev = input;
    current = result.piece;
    softCounter = result.softCounter;
    points += result.points;
    trace.push(current);
  }
  return { piece: current, points, trace };
}

function firstIndex(trace, predicate) {
  return trace.findIndex(predicate) + 1;
}

test('다음 쌍 테이블: 첫 세 쌍은 3색, 같은 시드면 같은 순서', () => {
  const a = buildNextTable(createRng(1234), 4);
  const b = buildNextTable(createRng(1234), 4);
  assert.deepEqual(a.pairs, b.pairs);
  assert.equal(a.pairs.length, 256);
  assert.ok(a.pairs.slice(0, 3).flat().every((c) => c >= 1 && c <= 3));
  assert.ok(new Set(a.pairs.flat()).size === 4);
});

test('대전에서 두 플레이어는 같은 쌍 순서를 받는다', () => {
  const match = createMatch({ seed: 7 });
  assert.deepEqual(match.players[0].piece.pivot, match.players[1].piece.pivot);
  assert.equal(match.players[0].nextIndex, 1);
});

test('레벨 0 무입력: 189번째 프레임에 접지, 221번째 프레임에 고정 (4.4절)', () => {
  const { trace } = controlFrames(createPiece([1, 2]), EMPTY_CELLS, new Array(240).fill(0));
  assert.equal(firstIndex(trace, (p) => p.groundCount > 0), 189);
  assert.equal(firstIndex(trace, (p) => p.locked), 221);
});

test('소프트 드롭: 24번째 프레임 접지, 25번째 고정, 13점 (4.5절)', () => {
  const { trace, points } = controlFrames(createPiece([1, 2]), EMPTY_CELLS, new Array(25).fill(INPUT.DOWN));
  assert.equal(firstIndex(trace, (p) => p.groundCount > 0), 24);
  assert.equal(firstIndex(trace, (p) => p.locked), 25);
  assert.equal(points, 13);
});

test('좌우를 누르고 있으면 1, 9, 11번째 프레임에 반 칸씩 2프레임 이동한다 (4.1·4.3절)', () => {
  const { trace } = controlFrames(createPiece([1, 2]), EMPTY_CELLS, new Array(11).fill(INPUT.LEFT));
  assert.deepEqual(
    trace.map((p) => p.x),
    [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
  );
  assert.equal(trace[0].moveFrames, 1);
  assert.equal(trace[1].moveFrames, 0);
});

test('벽에 붙어 회전하면 축이 반대쪽으로 밀린다 (5.1절)', () => {
  const piece = { ...createPiece([1, 2]), x: 5 };
  const { piece: rotated } = controlFrames(piece, EMPTY_CELLS, [INPUT.ROTATE_CW]);
  assert.equal(rotated.orient, 1);
  assert.equal(rotated.x, 4);
  assert.equal(rotated.rotateFrames, 7);
});

test('바닥에서 아래로 회전하면 한 칸 + 8단위 올라가고 허용 횟수를 쓴다 (5.1절)', () => {
  const piece = { ...createPiece([1, 2]), h: 0 };
  const { piece: rotated } = controlFrames(piece, EMPTY_CELLS, [INPUT.ROTATE_CW, 0, INPUT.ROTATE_CW]);
  assert.equal(rotated.orient, 2);
  assert.ok(rotated.h >= 32 && rotated.h < 48);
  assert.ok(rotated.rotateGroundLeft < 8);
});

test('양옆이 막히면 첫 회전은 무시되고 두 번째 회전에 뒤집힌다 (5.1절 퀵 턴)', () => {
  const well = fieldFromRows(new Array(12).fill('.1.1..'));
  const piece = { ...createPiece([1, 2]), h: 32 * 4 };
  const once = controlFrames(piece, well, [INPUT.ROTATE_CW]).piece;
  assert.equal(once.orient, 0);
  const twice = controlFrames(once, well, [0, INPUT.ROTATE_CW]).piece;
  assert.equal(twice.orient, 2);
});

test('접지 중 좌우 이동은 고정 지연을 다시 시작한다 (6.2절)', () => {
  const piece = { ...createPiece([1, 2]), h: 0 };
  const grounded = controlFrames(piece, EMPTY_CELLS, new Array(20).fill(0)).piece;
  assert.ok(grounded.groundCount > 0 && grounded.groundCount < 32);
  const moved = controlFrames(grounded, EMPTY_CELLS, [INPUT.LEFT, 0, 0]).piece;
  assert.equal(moved.restartsLeft, 14);
  assert.ok(moved.groundCount >= 30);
});

test('점수 공식과 표 (8절)', () => {
  const group = (color, size) => ({ color, cells: new Array(size).fill({ x: 0, y: 0 }) });
  assert.equal(scoreStep([group(1, 4)], 1), 40);
  assert.equal(scoreStep([group(1, 4)], 2), 10 * 4 * 8);
  assert.equal(scoreStep([group(1, 4), group(2, 4)], 1), 80 * 3);
  assert.equal(scoreStep([group(1, 5)], 1), 50 * 2);
  assert.equal(scoreStep([group(1, 4)], 15), 40 * 364);
  assert.equal(scoreStep([group(1, 11)], 30), 110 * 682);
});

test('마진 타임 환산율 (9.2절)', () => {
  assert.equal(garbageTarget(39 * 60), 70);
  assert.equal(garbageTarget(40 * 60), 52);
  assert.equal(garbageTarget(72 * 60), 35);
  assert.equal(garbageTarget(232 * 60), 6);
  assert.equal(garbageTarget(500 * 60), 1);
});

test('연결 판정은 보이는 12단까지만 (1·10절)', () => {
  const rows = new Array(ROWS).fill('......');
  rows[1] = '1.....';
  rows[2] = '1.....';
  rows[3] = '11....';
  assert.equal(findGroups(fieldFromRows(rows)).length, 0);
  assert.equal(findGroups(fieldFromRows(['1.....', '111...'])).length, 1);
});

test('연쇄 뒤 떠 있는 블록은 프레임당 한 칸씩 내려가고 16프레임 착지 대기한다 (7.1절)', () => {
  const cells = fieldFromRows(['1.....', '......', '......', '......']);
  const board = createBoard(cells);
  let frames = 0;
  while (stepBoardFall(board, { clearTempRow: true })) {
    frames += 1;
  }
  assert.equal(getCell(board.cells, 0, ROWS - 1), 1);
  assert.ok(frames >= 19 && frames <= 22, `frames ${frames}`);
});

function runMatch(match, inputsFor, frames) {
  let current = match;
  const events = [[], []];
  for (let f = 0; f < frames; f++) {
    current = stepMatch(current, inputsFor(f, current));
    current.players.forEach((p, i) => events[i].push(...p.events.map((e) => ({ ...e, frame: f }))));
  }
  return { match: current, events };
}

const TWO_CHAIN_ROWS = ['12....', '12....', '12....'];

function setPair(match, index, pivot, child) {
  const players = match.players.slice();
  players[index] = { ...players[index], piece: { ...players[index].piece, pivot, child } };
  return { ...match, players };
}

test('2연쇄는 연쇄마다 25번째 깜박임 프레임에 점수를 내고 전부 지우기 보너스를 준다', () => {
  let match = createMatch({ seed: 3, playerCount: 1, fields: [fieldFromRows(TWO_CHAIN_ROWS)] });
  match = setPair(match, 0, 1, 2);
  const { match: done, events } = runMatch(
    match,
    (f) => [f < 20 ? (f % 2 === 0 ? INPUT.LEFT : 0) : INPUT.DOWN],
    400,
  );
  const clears = events[0].filter((e) => e.type === 'clear');
  assert.deepEqual(
    clears.map((e) => [e.chain, e.points]),
    [
      [1, 40],
      [2, 320],
    ],
  );
  assert.ok(events[0].some((e) => e.type === 'allClear'));
  assert.equal(done.players[0].maxChain, 2);
  const gap = clears[1].frame - clears[0].frame;
  assert.ok(gap >= 70 && gap <= 80, `gap ${gap}`);
});

test('공격은 41프레임 뒤 도착하고 공격자 연쇄가 끝나면 확정되어 다음 턴에 떨어진다 (9.3·9.4절)', () => {
  let match = createMatch({ seed: 3, fields: [fieldFromRows(['11....', '11....', '22....', '22....'])] });
  match = setPair(match, 0, 1, 1);
  match = { ...match, players: [{ ...match.players[0], garbagePool: 69 * 70 }, match.players[1]] };
  const { match: done, events } = runMatch(
    match,
    (f) => [f < 20 ? (f % 2 === 0 ? INPUT.LEFT : 0) : INPUT.DOWN, INPUT.DOWN],
    900,
  );
  const attack = events[0].find((e) => e.type === 'attack');
  assert.ok(attack, 'attack event');
  assert.ok(events[1].some((e) => e.type === 'garbage'));
  const garbageCells = done.players[1].board.cells.filter((c) => c === GARBAGE).length;
  assert.ok(garbageCells > 0);
});

test('방해 블록은 한 번에 최대 30개, 가득 찬 열 몫은 사라진다 (9.5절)', () => {
  let match = createMatch({ seed: 5, playerCount: 1 });
  match = { ...match, players: [{ ...match.players[0], stocks: { a: 40, b: 0, c: 0 } }] };
  const { match: done, events } = runMatch(match, () => [INPUT.DOWN], 400);
  const drops = events[0].filter((e) => e.type === 'garbage');
  assert.equal(drops[0].amount, 30);
  assert.equal(done.players[0].stocks.a, 0);
});

test('3열 12단이 막히면 진다', () => {
  const blocked = fieldFromRows(new Array(12).fill('..1...'));
  const match = createMatch({ seed: 1, fields: [undefined, blocked] });
  const { match: done } = runMatch({ ...match, players: [match.players[0], { ...match.players[1], phase: 'turn-start' }] }, () => [0, 0], 5);
  assert.equal(done.phase, 'over');
  assert.equal(done.winner, 0);
});

test('같은 시드와 입력이면 대전 결과가 같다', () => {
  const inputs = (f) => [f % 7 === 0 ? INPUT.ROTATE_CW : INPUT.DOWN, f % 5 === 0 ? INPUT.LEFT : INPUT.DOWN];
  const a = runMatch(createMatch({ seed: 11 }), inputs, 3000).match;
  const b = runMatch(createMatch({ seed: 11 }), inputs, 3000).match;
  assert.deepEqual(a, b);
});

test('출현 위치는 3열 12단, 자식은 13단', () => {
  const cells = pieceCells(createPiece([1, 2]));
  assert.deepEqual(cells, [
    { x: 2, y: 2, color: 1 },
    { x: 2, y: 1, color: 2 },
  ]);
  assert.equal(SPAWN_HEIGHT, 376);
});

test('스토리는 일반 대전 점수와 별도 시작 레벨·출현 대기를 쓴다 (16.3절)', () => {
  let match = createMatch({
    seed: 3,
    ruleset: 'story',
    startLevel: 5,
    playerCount: 1,
    fields: [fieldFromRows(['1.....', '1.....', '1.....'])],
  });
  assert.equal(match.ruleset, 'story');
  assert.equal(match.players[0].level, 5);
  assert.equal(match.players[0].rules.nextWait, 17);
  match = setPair(match, 0, 1, 2);
  // 다음 쌍 대기 17 + 4프레임 뒤에 조작이 시작된다.
  const inputs = (f) => [f < 22 ? 0 : f < 30 ? (f % 2 === 0 ? INPUT.LEFT : 0) : INPUT.DOWN];
  const { events } = runMatch(match, inputs, 400);
  const clear = events[0].find((e) => e.type === 'clear');
  // 1연쇄 4개: 일반 대전과 같은 10 × 4 × 1 = 40
  assert.equal(clear.points, 40);
});

test('스토리와 일반 대전의 실제 소거 점수·마진·잔여·싹쓸이 환산이 같다', () => {
  for (const [seconds, chain, carry, points, generated, remainder] of [
    [0, 1, 69, 40, 1, 39],
    [39, 2, 0, 320, 4, 40],
    [40, 2, 0, 320, 6, 8],
    [72, 5, 0, 2560, 73, 5],
    [128, 2, 0, 320, 12, 8],
    [0, 1, 2100, 40, 30, 40],
    [500, 15, 0, 14560, 14560, 0],
  ]) {
    const results = ['versus', 'story'].map((ruleset) => {
      let match = createMatch({ seed: 3, ruleset, fields: [fieldFromRows(['1111..'])] });
      match.timer = seconds * 60;
      const player = match.players[0];
      Object.assign(player, { phase: 'flash', phaseTimer: 1, chain, garbagePool: carry,
        eraseCount: 4, groups: findGroups(player.board.cells) });
      match = stepMatch(match, [0, 0]);
      const own = match.players[0];
      assert.equal(own.score, points, `${ruleset}/${seconds}/${chain} score`);
      assert.equal(own.garbagePool, remainder, `${ruleset}/${seconds}/${chain} remainder`);
      assert.equal(match.players[1].stocks.c, generated, `${ruleset}/${seconds}/${chain} attack`);
      return own.events;
    });
    assert.deepEqual(results[0], results[1]);
  }
  for (const ruleset of ['versus', 'story']) {
    let match = createMatch({ seed: 3, ruleset, playerCount: 1,
      fields: [fieldFromRows(['1111..'])] });
    Object.assign(match.players[0], { phase: 'check', piece: null });
    let cleared = false;
    for (let frame = 0; frame < 200 && !cleared; frame++) {
      const before = match.players[0].score;
      match = stepMatch(match, [0]);
      if (match.players[0].events.some((event) => event.type === 'allClear')) {
        assert.equal(match.players[0].score - before, 2100, `${ruleset} all clear`);
        cleared = true;
      }
    }
    assert.ok(cleared, `${ruleset} all clear event`);
  }
});
