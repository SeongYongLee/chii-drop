import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMatch } from '../src/engine/match.js';
import { createEffects } from '../src/view/effects.js';
import { drawGame } from '../src/view/renderer.js';
import { drawFeverField } from '../src/view/fever-field.js';
import { FIELD_HEIGHT, FIELD_TOP, FIELD_WIDTH, SIDES } from '../src/view/layout.js';

function canvas(height = 540) {
  const calls = [];
  const ctx = new Proxy({ canvas: { width: 960, height }, screenHeight: height, portraitScreen: height > 540, globalAlpha: 1,
    measureText: () => ({ width: 20 }),
    fillRect(...args) { calls.push(['fillRect', this.fillStyle, ...args]); },
  }, { get: (o, key) => key in o ? o[key] : (...args) => calls.push([key, ...args]) });
  return { ctx, calls };
}

test('가로·세로 화면에서 피버 중인 한쪽 필드만 블록 뒤에 전용 배경을 그리고 상태를 바꾸지 않는다', () => {
  for (const height of [540, 1600]) {
    const h = canvas(height), match = createMatch({ seed: 42 }), effects = createEffects(2);
    match.players[1].fever = { timer: 900, target: 5 };
    match.players[1].board.cells[13 * 6] = 1;
    const before = structuredClone(match);
    const skin = { drawBackground() {}, drawCharacter() {},
      drawBlob() { h.calls.push(['blob']); }, blobColor: () => '#fff' };
    drawGame(h.ctx, { skin, match, effects, characters: [], showGhost: false });
    const backgrounds = h.calls.filter(c => c[0] === 'fillRect' && c[1] === '#30264c');
    assert.deepEqual(backgrounds, [['fillRect', '#30264c', SIDES[1].fieldX, FIELD_TOP, FIELD_WIDTH, FIELD_HEIGHT]]);
    assert.ok(h.calls.findIndex(c => c === backgrounds[0]) < h.calls.findIndex(c => c[0] === 'blob'));
    assert.deepEqual(match, before);
    match.players[1].fever = null;
    h.calls.length = 0;
    drawGame(h.ctx, { skin, match, effects, characters: [], showGhost: false });
    assert.equal(h.calls.some(c => c[1] === '#30264c'), false);
  }
});

test('변신 대기 중에는 배경을 바꾸지 않고 피버 무늬는 필드 안으로 제한한다', () => {
  const h = canvas(), player = { fever: { timer: 900 }, phase: 'revive' };
  drawFeverField(h.ctx, 32, player, 0); assert.equal(h.calls.length, 0);
  player.phase = 'turn-start';
  drawFeverField(h.ctx, 32, player, 120);
  assert.deepEqual(h.calls[2], ['rect', 32, FIELD_TOP, FIELD_WIDTH, FIELD_HEIGHT]);
  assert.ok(h.calls.findIndex(c => c[0] === 'clip') < h.calls.findIndex(c => c[0] === 'fillRect'));
  assert.equal(h.calls.at(-1)[0], 'restore');
});
