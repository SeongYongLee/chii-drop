import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMatch, stepMatch } from '../src/engine/match.js';
import { createEffects, tickEffect } from '../src/view/effects.js';
import { boardSoundEvents } from '../src/audio/board-sounds.js';
import { createPiece, stepPiece } from '../src/engine/control.js';
import { fieldFromRows } from '../src/engine/field.js';
import { INPUT } from '../src/engine/input.js';
import { drawGame } from '../src/view/renderer.js';
import { CELL, FIELD_BOTTOM, SIDES } from '../src/view/layout.js';
import { MOCK_SKIN } from './fixtures/presentation.js';

function scene(amount = 30) {
  const match = createMatch({ seed: 7 });
  const player = match.players[0], [effect] = createEffects(1);
  player.stocks.a = amount;
  const tick = () => tickEffect(effect, player, { table: match.table, opponentSide: 1 });
  tick();
  return { match, player, effect, tick };
}

test('상쇄 결과와 확인음은 공격 예고처럼 즉시 갱신하고 구슬 연출은 계속한다', () => {
  const { player, effect, tick } = scene();
  player.stocks.a = 0;
  player.events = [{ type: 'offset', amount: 30, visibleAmount: 30 }];
  const original = structuredClone(player);
  tick();
  assert.deepEqual(player, original);
  assert.equal(effect.warning.value, 0);
  assert.deepEqual(effect.warningChange, { type: 'offset', amount: 30, total: 0 });
  assert.deepEqual(boardSoundEvents(player, player, effect.warningChange), [effect.warningChange]);
  assert.ok(effect.orbs.some(orb => orb.kind === 'offset'));
  player.events = [];
  for (let frame = 0; frame < 45; frame++) {
    tick();
    assert.equal(effect.warning.value, 0, '구슬이 도착해도 예고를 재갱신하지 않는다');
    assert.equal(effect.warningChange, null, '확인음은 한 번만 재생한다');
  }
});

test('연속 상쇄와 추가 공격도 각 확정 프레임에 반영하고 낙하에는 상쇄 확인음을 내지 않는다', () => {
  const { player, effect, tick } = scene(60);
  player.stocks.a = 30; player.events = [{ type: 'offset', amount: 30, visibleAmount: 30 }]; tick();
  assert.equal(effect.warning.value, 30);
  assert.deepEqual(effect.warningChange, { type: 'offset', amount: 30, total: 30 });
  player.events = [];
  for (let i = 0; i < 9; i++) tick();
  player.stocks.a = 0; player.events = [{ type: 'offset', amount: 30, visibleAmount: 30 }]; tick();
  assert.equal(effect.warning.value, 0);
  assert.deepEqual(effect.warningChange, { type: 'offset', amount: 30, total: 0 });
  player.events = []; player.stocks.a = 6; tick();
  assert.equal(effect.warning.value, 6);
  assert.deepEqual(effect.warningChange, { type: 'warning', amount: 6, total: 6 });
  player.stocks.a = 0; tick();
  assert.equal(effect.warning.value, 0);
  assert.equal(effect.warningChange, null, '실제 잡초 낙하에는 상쇄 확인음을 내지 않는다');
});

test('엔진 상쇄 이벤트는 화면에 있던 재고만 별도로 알려주고 날아오는 재고는 표시하지 않는다', () => {
  for (const stocks of [{ a: 2, b: 1, c: 10 }, { a: 0, b: 0, c: 10 }]) {
    const match = createMatch({ seed: 7 });
    Object.assign(match.players[0], { phase: 'flash', phaseTimer: 1, chain: 1, garbagePool: 380,
      stocks, groups: [{ color: 1, cells: [0,1,2,3].map(x => ({ x, y: 13 })) }] });
    const result = stepMatch(match, [0,0]);
    const event = result.players[0].events.find(event => event.type === 'offset');
    assert.equal(event.amount, 6);
    assert.equal(event.visibleAmount, stocks.a + stocks.b);
  }
  const { player, effect, tick } = scene(0);
  player.events = [{ type: 'offset', amount: 6, visibleAmount: 0 }]; tick();
  assert.equal(effect.warning.value, 0); assert.equal(effect.warningChange, null);
});

test('벽차기·바닥차기 축은 입력 프레임에 새 위치로 보이고 자식만 8프레임 회전한다', () => {
  for (const [start, cells, bit] of [
    [{ ...createPiece([1,2]), x: 5 }, fieldFromRows([]), INPUT.ROTATE_CW],
    [{ ...createPiece([1,2]), h: 0, orient: 1 }, fieldFromRows([]), INPUT.ROTATE_CW],
  ]) {
    const { match, player, effect, tick } = scene(0);
    player.phase = 'control'; player.piece = start; player.board.cells = cells; tick();
    const result = stepPiece(start, { cells, input: bit, pressed: bit, heldFrames: 0, fallSpeed: 0, softCounter: -2 });
    player.piece = result.piece; player.events = result.events;
    const snapshot = structuredClone(player); tick();
    assert.deepEqual(player, snapshot);
    const calls = [], skin = { ...MOCK_SKIN, drawBlob(ctx, color, x, y, size, options) { calls.push({ color, x, y, options }); } };
    const ctx = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) });
    const draw = () => {
      calls.length = 0;
      drawGame(ctx, { match: { ...match, players: [player] }, effects: [effect], skin, characters: skin.characters, showGhost: false });
      const pivotIndex = calls.findIndex(call => call.options?.axis !== undefined);
      return { pivot: calls[pivotIndex], child: calls[pivotIndex - 1] };
    };
    for (let remaining = 7; remaining >= 0; remaining--) {
      player.piece = { ...player.piece, rotateFrames: remaining };
      const { pivot, child } = draw();
      assert.equal(pivot.x, SIDES[0].fieldX + player.piece.x * CELL);
      assert.equal(pivot.y, FIELD_BOTTOM - CELL - player.piece.h);
      const angle = (player.piece.orient * 90 - remaining * 11.25) * Math.PI / 180;
      assert.ok(Math.abs(child.x - pivot.x - CELL * Math.sin(angle)) < 1e-9);
      assert.ok(Math.abs(child.y - pivot.y + CELL * Math.cos(angle)) < 1e-9);
    }
  }
});

test('180도 퀵 턴은 탈출 높이로 이동한 기준 블록 중심에서 입력 방향대로 회전한다', () => {
  for (const orient of [0, 2]) for (const first of [INPUT.ROTATE_CW, INPUT.ROTATE_CCW]) {
    for (const last of [INPUT.ROTATE_CW, INPUT.ROTATE_CCW]) {
      const { match, player, effect, tick } = scene(0);
      const cells = fieldFromRows(new Array(6).fill('.G.G..'));
      player.phase = 'control'; player.board.cells = cells;
      let piece = { ...createPiece([1, 2]), h: 64, orient };
      for (const bit of [first, 0, last]) {
        const result = stepPiece(piece, { cells, input: bit, pressed: bit, heldFrames: 0, fallSpeed: 0, softCounter: -2 });
        piece = result.piece;
      }
      const direction = last === INPUT.ROTATE_CCW ? -1 : 1;
      assert.equal(piece.orient, (orient + 2) % 4);
      assert.equal(piece.rotateDirection, direction);
      assert.equal(piece.pivot, 1); assert.equal(piece.child, 2);
      assert.equal(piece.x, 2, '깜빡이는 축의 열을 바꾸지 않는다');
      const height = orient === 0 ? 128 : 64;
      assert.equal(piece.h, height, '위→아래 퀵 턴은 좁은 틈 탈출을 위한 높이를 얻는다');
      player.piece = piece; player.events = []; tick();
      const calls = [], skin = { ...MOCK_SKIN, drawBlob(ctx, color, x, y, size, options) { calls.push({ color, x, y, options }); } };
      const ctx = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) });
      for (let remaining = 7; remaining >= 0; remaining--) {
        player.piece = { ...piece, rotateFrames: remaining }; calls.length = 0;
        drawGame(ctx, { match: { ...match, players: [player] }, effects: [effect], skin, characters: skin.characters, showGhost: false });
        const pivotIndex = calls.findIndex(call => call.options?.axis !== undefined);
        const pivot = calls[pivotIndex], child = calls[pivotIndex - 1];
        assert.equal(pivot.color, 1); assert.equal(child.color, 2);
        assert.equal(pivot.x, SIDES[0].fieldX + 2 * CELL);
        assert.equal(pivot.y, FIELD_BOTTOM - CELL - height);
        const angle = (piece.orient * 90 - direction * remaining * 22.5) * Math.PI / 180;
        assert.ok(Math.abs(child.x - pivot.x - CELL * Math.sin(angle)) < 1e-9);
        assert.ok(Math.abs(child.y - pivot.y + CELL * Math.cos(angle)) < 1e-9);
      }
    }
  }
});
