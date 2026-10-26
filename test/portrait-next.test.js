import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, stepSession } from '../src/app/session.js';
import { createEffects, tickEffect } from '../src/view/effects.js';
import { drawGame } from '../src/view/renderer.js';
import { MOCK_SKIN } from './fixtures/presentation.js';

// 실제 그리기 변환과 Next 클립에 걸치는 블록만 센다.
function previewCanvas(height) {
  let state = { x: 0, y: 0, sx: 1, sy: 1, clip: null }, rect;
  const stack = [], visible = new Map();
  const ctx = new Proxy({ portraitScreen: true, screenHeight: height, globalAlpha: 1,
    save() { stack.push({ ...state }); }, restore() { state = stack.pop(); },
    translate(x, y) { state.x += x * state.sx; state.y += y * state.sy; },
    scale(x, y) { state.sx *= x; state.sy *= y; },
    rect(x, y, w, h) { rect = { x: state.x + x * state.sx, y: state.y + y * state.sy, w: w * state.sx, h: h * state.sy }; },
    clip() { state.clip = rect?.w === 192 && rect.h === 234 ? rect : null; },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  const skin = { ...MOCK_SKIN, drawBlob(ctx, color, x, y, size) {
    const c = state.clip;
    if (!c) return;
    x = state.x + x * state.sx; y = state.y + y * state.sy;
    if (x < c.x + c.w && x + size * state.sx > c.x && y < c.y + c.h && y + size * state.sy > c.y)
      visible.set(c.x, (visible.get(c.x) ?? 0) + 1);
  } };
  return { ctx, skin, visible };
}

for (const mode of ['solo', 'cpu']) test(`${mode}: 세로 Next 교체 중 각 영역에는 최대 두 쌍만 보인다`, () => {
  for (const height of [900, 1400, 1900]) {
    let session = createSession({ mode, seed: 7, cpuSeed: 8, cpuLevel: 'normal' });
    const effects = createEffects(session.match.players.length), h = previewCanvas(height);
    let sawTransition = false;
    for (let frame = 0; frame < 220; frame++) {
      session.match.players.forEach((player, i) => tickEffect(effects[i], player, { table: session.match.table }));
      h.visible.clear();
      drawGame(h.ctx, { skin: h.skin, match: session.match, effects, characters: MOCK_SKIN.characters, showGhost: false });
      for (const count of h.visible.values()) assert.ok(count <= 4, `frame ${frame}: Next에 ${count}개 표시`);
      sawTransition ||= effects.some(effect => effect.next.frame > 0 && effect.next.frame < 25);
      session = stepSession(session, [0, 0]);
    }
    assert.ok(sawTransition);
  }
});
