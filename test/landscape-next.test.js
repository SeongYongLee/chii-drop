import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSession, stepSession } from '../src/app/session.js';
import { INPUT } from '../src/engine/input.js';
import { createEffects, tickEffect } from '../src/view/effects.js';
import { drawGame } from '../src/view/renderer.js';
import { NEXT_BOX, SOLO_NEXT_BOX } from '../src/view/layout.js';
import { MOCK_SKIN } from './fixtures/presentation.js';

function previewCanvas() {
  let state = { x: 0, y: 0, sx: 1, sy: 1, clip: null }, rect;
  const stack = [], counts = [];
  const ctx = new Proxy({ globalAlpha: 1,
    save() { stack.push({ ...state, alpha: ctx.globalAlpha }); },
    restore() { state = stack.pop(); ctx.globalAlpha = state.alpha; },
    translate(x, y) { state.x += x * state.sx; state.y += y * state.sy; },
    scale(x, y) { state.sx *= x; state.sy *= y; },
    rect(x, y, w, h) { rect = { x: state.x + x * state.sx, y: state.y + y * state.sy, w: w * state.sx, h: h * state.sy,
      next: [NEXT_BOX, SOLO_NEXT_BOX].some(box => x === box.x && y === box.y && w === box.width && h === box.height + 8) }; },
    clip() {
      if (rect?.next) { state.clip = { ...rect, index: counts.length }; counts.push(0); }
      else state.clip = null;
    },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  const skin = { ...MOCK_SKIN, drawBlob(ctx, color, x, y, size) {
    const clip = state.clip;
    if (!clip || ctx.globalAlpha < 1) return;
    x = state.x + x * state.sx; y = state.y + y * state.sy;
    if (x < clip.x + clip.w && x + size * state.sx > clip.x && y < clip.y + clip.h && y + size * state.sy > clip.y) counts[clip.index]++;
  } };
  return { ctx, skin, counts };
}

for (const mode of ['solo', 'cpu', 'versus', 'watch']) test(`${mode}: 가로 NEXT 교체 중 각 플레이어는 최대 두 쌍만 표시한다`, () => {
  let session = createSession({ mode, seed: 7, cpuSeed: 8, cpuLevel: 'normal' });
  const effects = createEffects(session.match.players.length), view = previewCanvas();
  let transitions = 0;
  for (let frame = 0; frame < 450; frame++) {
    session.match.players.forEach((player, i) => tickEffect(effects[i], player, { table: session.match.table }));
    view.counts.length = 0;
    drawGame(view.ctx, { skin: view.skin, match: session.match, effects, characters: MOCK_SKIN.characters, showGhost: false });
    assert.equal(view.counts.length, session.match.players.length);
    for (const count of view.counts) assert.ok(count <= 4, `frame ${frame}: NEXT에 ${count}개 표시`);
    if (effects.some(effect => effect.next.frame > 0 && effect.next.frame < 25)) transitions++;
    session = stepSession(session, [INPUT.DOWN, INPUT.DOWN]);
  }
  assert.ok(transitions > 0);
});
