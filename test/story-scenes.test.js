import { MOCK_SCRIPT } from './fixtures/presentation.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDialogueScene } from '../src/app/dialogue-scene.js';
import { createStoryFlow } from '../src/app/story-mode.js';
import { createKeyboard } from '../src/input/keyboard.js';
import { HIDDEN_IDS, SECRET_FINAL } from '../src/story/campaign.js';
import { createRecords, createRun } from '../src/story/progress.js';

function harness(saved) {
  let value = JSON.stringify(saved);
  const text = [];
  const figures = [];
  const alphas = [];
  const ctx = new Proxy({
    globalAlpha: 1,
    save() { alphas.push(this.globalAlpha); },
    restore() { this.globalAlpha = alphas.pop(); },
    fillText: (s) => text.push(s),
    measureText: (s) => ({ width: s.length * 12 }),
  }, { get: (object, key) => object[key] ?? (() => {}) });
  const app = {
    keyboard: createKeyboard(), sfx: { enabled: false }, storyScript: MOCK_SCRIPT,
    skin: { drawBackground() {}, drawCharacter: (_, id) => { if (ctx.globalAlpha > 0) figures.push(id); } },
    setScene(scene) { this.scene = scene; },
    goToSinglePlayer() { this.menu = true; },
  };
  globalThis.window = { localStorage: { getItem: () => value, setItem: (_, next) => { value = next; } } };
  const press = (code) => {
    app.keyboard.pressed = new Set(code ? [code] : []);
    app.scene.update(app);
  };
  return { app, ctx, text, figures, press, saved: () => JSON.parse(value) };
}

test('사진에는 일곱 인물이 보이고 기억 장면에는 다섯 자리가 비어 있다', () => {
  const h = harness(null);
  const guests = [...HIDDEN_IDS, SECRET_FINAL];
  for (const visual of ['tower', 'photo', 'memory', 'oldPhoto', 'table', 'inside', 'register', 'invitation']) {
    h.figures.length = 0;
    const scene = createDialogueScene({ lines: [{ text: '장면', visual }], script: MOCK_SCRIPT, guests, onDone() {} });
    scene.draw(h.ctx, h.app);
    if (visual === 'photo') assert.equal(h.figures.length, 7);
    if (visual === 'memory') assert.equal(h.figures.length, 2);
    if (visual === 'oldPhoto') assert.equal(h.figures.length, 0); // 모르는 옛 참가자들의 윤곽
    if (visual === 'inside') assert.equal(h.figures.length, 5);
  }
});

test('히든은 탑 선정 뒤 소개·만담 순서로 이어진다', () => {
  const run = { ...createRun(), stage: 'hidden' };
  const h = harness({ run, records: createRecords() });
  const flow = createStoryFlow(h.app);
  flow.resume();
  h.app.scene.draw(h.ctx, h.app);
  assert.ok(h.text.includes('등장! 낯선 손님 1'));
  h.press('Enter');
  for (let i = 0; i < 41; i++) h.press();
  h.press('Enter');
  h.text.length = 0;
  h.app.scene.draw(h.ctx, h.app);
  assert.ok(h.text.includes('어? 대진표에 없던 손님이 있어.'));
  h.press('Escape');
  h.press('Enter');
  h.text.length = 0;
  h.app.scene.draw(h.ctx, h.app);
  assert.ok(h.text.includes('잘 부탁해!'));
});

test('만남 네 번만으로는 최종 보스 재도전을 열지 않는다', () => {
  const h = harness({ run: null, records: { ...createRecords(), mainCleared: true, hiddenMet: HIDDEN_IDS } });
  const flow = createStoryFlow(h.app);
  assert.equal(flow.canChallenge(), false);
  flow.challenge();
  assert.equal(h.app.scene, undefined);
});

test('해금 후 보스 재도전을 나가도 진행 중이던 본편과 승리 기록이 유지된다', () => {
  const run = { ...createRun(), floorIndex: 2, score: 90000 };
  const records = { ...createRecords(), mainCleared: true, hiddenWon: HIDDEN_IDS };
  const h = harness({ run, records });
  const flow = createStoryFlow(h.app);
  assert.equal(flow.canChallenge(), true);
  assert.equal(flow.hiddenWins(), 4);
  flow.challenge();
  h.press('Escape'); // 초대 → 탑
  h.press('Escape'); // 탑 → 메뉴
  assert.ok(h.app.menu);
  assert.deepEqual(h.saved(), { run, records });
});

test('정상 엔딩 도중 다시 열어도 빈 상대 목록 대신 엔딩을 이어서 본다', () => {
  const records = { ...createRecords(), mainCleared: true };
  const h = harness({ run: { ...createRun(), stage: 'done', floorIndex: 4 }, records });
  createStoryFlow(h.app).resume();
  h.press('Enter');
  h.app.scene.draw(h.ctx, h.app);
  assert.ok(h.text.includes('대회는 끝났다. 언젠가 또 열릴지도 모른다.'));
  h.press('Escape');
  assert.ok(h.app.menu);
  assert.equal(h.saved().run, null);
});
