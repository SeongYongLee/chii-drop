import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMatch, stepMatch } from '../src/engine/match.js';
import { createPiece } from '../src/engine/control.js';
import { fieldFromRows } from '../src/engine/field.js';
import { createEffects, tickEffect } from '../src/view/effects.js';
import { drawGame } from '../src/view/renderer.js';
import { CELL, FIELD_BOTTOM, SIDES } from '../src/view/layout.js';
import { MOCK_SKIN } from './fixtures/presentation.js';

function preview(cells, { x = 2, orient = 1, showGhost = true } = {}) {
  const match = createMatch({ seed: 7, playerCount: 1, fields: [cells] });
  const player = match.players[0];
  player.phase = 'control';
  player.piece = { ...createPiece([1, 2]), h: 192, x, orient, rotateFrom: orient };
  const effects = createEffects(1);
  tickEffect(effects[0], player, { table: match.table, opponentSide: null });
  const ghosts = [];
  const ctx = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) });
  const skin = { ...MOCK_SKIN, drawBlob(context, color, px, py, size) {
    if (context.globalAlpha === .25 && size === CELL) ghosts.push({ color, x: (px - SIDES[0].fieldX) / CELL, row: (FIELD_BOTTOM - CELL - py) / CELL });
  } };
  const before = structuredClone(match);
  drawGame(ctx, { match, effects, skin, characters: skin.characters, showGhost });
  assert.deepEqual(match, before, '표시 계산은 경기 상태를 바꾸지 않는다');
  return { ghosts, match };
}

const ledge = fieldFromRows(['..G...', '..G...', '..GG..']);

test('단차 위 가로 착지 표시는 각 열의 최종 높이로 나뉘고 좌우 색 순서를 유지한다', () => {
  assert.deepEqual(preview(ledge).ghosts, [{ color: 1, x: 2, row: 3 }, { color: 2, x: 3, row: 1 }]);
  assert.deepEqual(preview(ledge, { x: 3, orient: 3 }).ghosts, [{ color: 1, x: 3, row: 1 }, { color: 2, x: 2, row: 3 }]);
});

test('세로 착지 표시는 위아래 색 순서를 유지하고 평평한 바닥의 가로 표시는 붙어 있다', () => {
  assert.deepEqual(preview(ledge, { orient: 0 }).ghosts, [{ color: 1, x: 2, row: 3 }, { color: 2, x: 2, row: 4 }]);
  assert.deepEqual(preview(ledge, { orient: 2 }).ghosts, [{ color: 1, x: 2, row: 4 }, { color: 2, x: 2, row: 3 }]);
  assert.deepEqual(preview(fieldFromRows([])).ghosts, [{ color: 1, x: 2, row: 0 }, { color: 2, x: 3, row: 0 }]);
  assert.deepEqual(preview(ledge, { showGhost: false }).ghosts, []);
});

test('단차 착지 표시는 실제 고정 뒤 분리 낙하가 끝난 위치와 일치한다', () => {
  const { ghosts, match } = preview(ledge);
  const state = structuredClone(match);
  state.players[0].piece = { ...state.players[0].piece, h: 96, locked: true, placeTimer: 1 };
  let settled = state;
  for (let frame = 0; frame < 150; frame++) {
    settled = stepMatch(settled, [0]);
    if (settled.players[0].phase === 'next' || settled.players[0].phase === 'turn-start') break;
  }
  assert.ok(['next', 'turn-start'].includes(settled.players[0].phase));
  for (const ghost of ghosts) {
    assert.equal(settled.players[0].board.cells[(13 - ghost.row) * 6 + ghost.x], ghost.color);
  }
});
