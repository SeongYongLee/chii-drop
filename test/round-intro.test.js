import test from 'node:test';
import assert from 'node:assert/strict';
import { drawRoundIntro, roundIntroCue, roundIntroLayout } from '../src/view/round-intro.js';
import { NEXT_BOX, SIDES, gameTransform } from '../src/view/layout.js';
import { createSession, stepSession, READY_FRAMES, GO_FRAMES } from '../src/app/session.js';

function canvas(portrait = false, height = 540) {
  const text = [], scales = [];
  const ctx = new Proxy({ globalAlpha: 1, portraitScreen: portrait, screenHeight: height,
    fillText: value => text.push(value), scale: (...args) => scales.push(args) },
    { get: (object, key) => object[key] ?? ((...args) => {
      for (const number of args) if (typeof number === 'number') assert.ok(Number.isFinite(number));
    }) });
  return { ctx, text, scales };
}

test('준비·시작 문구는 기존 프레임 경계에 맞추고 부가 문구를 표시하지 않는다', () => {
  assert.deepEqual(roundIntroCue(90), { starting: false, title: '준비' });
  assert.deepEqual(roundIntroCue(60), { starting: false, title: '준비' });
  assert.equal(roundIntroCue(GO_FRAMES + 1).title, '준비');
  assert.deepEqual(roundIntroCue(GO_FRAMES), { starting: true, title: '시작!' });
  assert.equal(roundIntroCue(1).title, '시작!');
  const h = canvas(); drawRoundIntro(h.ctx, 0); assert.deepEqual(h.text, []);
});

test('준비 팻말을 여러 번 그려도 경기·CPU·난수와 90프레임 시작 시간은 변하지 않는다', () => {
  let session = createSession({ mode: 'cpu', seed: 13, cpuSeed: 19, cpuLevel: 'normal' });
  const original = structuredClone(session.match), cpu = structuredClone(session.cpu), h = canvas();
  for (let frame = 0; frame < READY_FRAMES; frame++) {
    assert.equal(session.phase, 'ready');
    const before = structuredClone(session);
    drawRoundIntro(h.ctx, session.readyTimer); drawRoundIntro(h.ctx, session.readyTimer);
    assert.deepEqual(session, before);
    session = stepSession(session, [0, 0]);
  }
  assert.equal(session.phase, 'playing');
  assert.deepEqual(session.match, original); assert.deepEqual(session.cpu, cpu);
});

test('중간 크기 팻말은 가로·세로에서 Next를 가리지 않고 같은 비율로 나타난다', () => {
  for (const [portrait, height] of [[false,540],[true,900],[true,1400],[true,1900]]) {
    for (const playerCount of [1,2]) {
      const layout = roundIntroLayout(height, portrait, playerCount), h = canvas(portrait, height);
      assert.ok(layout.x-160*layout.scale>0 && layout.x+160*layout.scale<960);
      assert.ok(layout.y-48*layout.scale>0 && layout.y+53*layout.scale<height);
      for (const remaining of [90,60,30,24,1]) drawRoundIntro(h.ctx, remaining, { playerCount });
      assert.ok(h.scales.every(([x,y])=>x===y));
      assert.ok(h.text.includes('준비') && h.text.includes('시작!'));
      assert.ok(h.text.every(text => ['준비','시작!'].includes(text)));
      if (portrait) assert.ok(layout.y - 48 * layout.scale > 320);
      else {
        const scale = gameTransform().scale;
        assert.ok(layout.y - 48 > (NEXT_BOX.y + NEXT_BOX.height + 8) * scale);
        assert.ok(layout.y + 53 < Math.min(...SIDES.map(side => side.score.y - 3)) * scale);
      }
    }
  }
});

test('움직임 줄이기는 확대와 사라지는 움직임을 생략하고 안내는 유지한다', t => {
  const previous = globalThis.window;
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  t.after(() => { globalThis.window = previous; });
  const h = canvas(); drawRoundIntro(h.ctx, 30); drawRoundIntro(h.ctx, 1);
  assert.deepEqual(h.scales, [[1,1],[1,1]]); assert.equal(h.ctx.globalAlpha,1);
  assert.ok(h.text.includes('시작!'));
});
