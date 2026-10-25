import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mascotPose, drawMascot } from '../src/view/mascot.js';

test('관전 캐릭터는 걷기와 대기를 반복하며 경계에서 순간이동하거나 범위를 벗어나지 않는다', () => {
  const states = new Set();
  for (let frame = 0; frame < 5400; frame++) {
    const pose = mascotPose(frame), next = mascotPose(frame + 1);
    states.add(pose.mood);
    assert.ok(Math.abs(pose.position) <= 1);
    assert.ok(Math.abs(next.position - pose.position) <= 1 / 180 + 1e-10);
    if (pose.mood === 'idle') assert.equal(next.position, pose.position);
    assert.ok([-1, 1].includes(pose.direction));
    assert.deepEqual(pose, mascotPose(frame));
  }
  assert.deepEqual([...states].sort(), ['idle', 'walk']);
  for (const frame of [0, 200, 700, 1300, 9000]) {
    assert.deepEqual(mascotPose(frame, true), { position: 0, direction: 1, mood: 'idle', frame: 0 });
  }
});

test('가로·세로의 빈 정보 공간에서만 움직이고 경기 상태를 바꾸지 않는다', () => {
  const calls = [];
  const ctx = { save() {}, restore() {}, translate: (...args) => calls.push(['position', ...args]), scale() {} };
  const effect = { blinkFrame: 0, mood: 'idle', characterChain: 0, characterFrame: 0 };
  const view = { effects: [effect], reducedMotion: false,
    skin: { drawMascot: (ctx, mood, x, y, size, motion) => calls.push(['sprite', mood, size, motion]) } };
  for (const portrait of [false, true]) for (const frame of [0, 270, 450, 780, 1100, 1350]) {
    effect.blinkFrame = frame;
    const before = structuredClone(view.effects);
    drawMascot(ctx, view, portrait);
    const [_, center, y] = calls.at(-2), [, mood, size] = calls.at(-1);
    assert.ok(center - size / 2 >= (portrait ? 397 : 270));
    assert.ok(center + size / 2 <= (portrait ? 563 : 370));
    assert.ok(y >= (portrait ? 320 : 304));
    assert.ok(y + size <= (portrait ? 380 : 348));
    assert.equal(mood, mascotPose(frame).mood);
    assert.deepEqual(view.effects, before);
  }
  effect.mood = 'happy'; effect.characterChain = 3; effect.characterFrame = 10;
  effect.blinkFrame = 10; drawMascot(ctx, view); assert.equal(calls.at(-1)[1], 'happy');
  effect.blinkFrame = 250; drawMascot(ctx, view); assert.equal(calls.at(-1)[1], 'walk', '발을 멈춘 채 미끄러지지 않는다');
  view.reducedMotion = true; drawMascot(ctx, view); assert.equal(calls.at(-1)[3].reducedMotion, true);
  const count = calls.length;
  drawMascot(ctx, { ...view, skin: {} }); assert.equal(calls.length, count);
});
