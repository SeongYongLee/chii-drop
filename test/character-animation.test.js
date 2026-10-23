import { MOCK_SKIN, MOCK_SCRIPT } from './fixtures/presentation.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEffects, setMood, tickCharacters, tickEffect } from '../src/view/effects.js';
import { createMatch } from '../src/engine/match.js';
import { createDialogueScene } from '../src/app/dialogue-scene.js';
import { createKeyboard } from '../src/input/keyboard.js';
import { createGameScene } from '../src/app/game-scene.js';

test('연쇄 소거마다 반응을 다시 시작하고 피격·결과·대기에서는 연쇄를 해제한다', () => {
  const match = createMatch({ seed: 123, playerCount: 1 });
  const player = match.players[0], [effect] = createEffects(1);
  const options = { table: match.table, opponentSide: null };
  for (const chain of [1, 2, 3, 5, 7, 12]) {
    player.events = [{ type: 'clear', chain, points: 40,
      groups: [{ cells: [{ x: 0, y: 12 }, { x: 1, y: 12 }, { x: 2, y: 12 }, { x: 3, y: 12 }] }] }];
    const before = structuredClone(match);
    tickEffect(effect, player, options);
    assert.equal(effect.mood, 'happy');
    assert.equal(effect.characterChain, chain);
    assert.equal(effect.characterFrame, 0);
    assert.deepEqual(match, before, '엔진 상태와 난수는 표시 반응이 바꾸지 않는다');
    tickCharacters([effect]);
  }
  for (const type of ['garbage', 'over']) {
    effect.characterChain = 7;
    player.events = [{ type }]; tickEffect(effect, player, options);
    assert.equal(effect.characterChain, 0);
    assert.equal(effect.mood, type === 'over' ? 'lose' : 'sad');
  }
  setMood(effect, 'happy', 1); effect.characterChain = 5;
  player.events = []; tickEffect(effect, player, options);
  assert.equal(effect.mood, 'idle');
  assert.equal(effect.characterChain, 0);
});

test('캐릭터별 재생 시간은 독립적이며 같은 표정의 새 반응도 처음부터 재생한다', () => {
  const effects = createEffects(2);
  for (let i = 0; i < 12; i++) tickCharacters(effects);
  setMood(effects[0], 'happy');
  assert.deepEqual(effects.map((e) => e.characterFrame), [0, 12]);
  assert.deepEqual(effects.map((e) => e.blinkFrame), [12, 12]);
  tickCharacters(effects);
  setMood(effects[0], 'happy');
  assert.deepEqual(effects.map((e) => e.characterFrame), [0, 13]);
  assert.deepEqual(effects.map((e) => e.blinkFrame), [13, 13]);
  setMood(effects[1], 'win', Infinity);
  for (let i = 0; i < 80; i++) tickCharacters(effects);
  assert.equal(effects[1].characterFrame, 80);
  assert.equal(effects[1].mood, 'win');
});

test('대화의 같은 표정도 새 대사가 시작하면 다시 재생하고 그리기는 시간을 바꾸지 않는다', () => {
  const portraits = [];
  const app = { keyboard: createKeyboard(), sfx: { enabled: false }, settings: { voice: false },
    skin: { drawBackground() {}, drawCharacter: (_, id, mood, x, y, size, motion) => portraits.push({ id, mood, ...motion }) } };
  const ctx = new Proxy({ measureText: () => ({ width: 10 }) }, { get: (o, key) => o[key] ?? (() => {}) });
  const scene = createDialogueScene({ script: MOCK_SCRIPT, onDone() {},
    lines: [{ who: 'player', text: 'a', mood: 'happy' }, { who: 'player', text: 'b', mood: 'happy' }] });
  scene.update(app); scene.update(app); scene.draw(ctx, app);
  const current = () => portraits.findLast((p) => p.mood === 'happy');
  const firstAge = current().frame;
  assert.ok(firstAge > 0);
  scene.draw(ctx, app); assert.equal(current().frame, firstAge);
  app.keyboard.pressed.add('Enter'); scene.update(app); // 다음 대사로 넘김
  app.keyboard.pressed.clear(); scene.update(app); scene.draw(ctx, app);
  assert.ok(current().frame < firstAge);
});

test('실제 경기 화면에서 일시정지에는 멈추고 결과 화면에서는 계속 재생한다', (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: { setItem() {} } };
  t.after(() => { globalThis.window = previousWindow; });
  let portrait;
  const text = [];
  const app = { keyboard: createKeyboard(), sfx: { enabled: false }, settings: { ghost: false },
    records: { soloBest: 0, soloMaxChain: 0 },
    skin: { ...MOCK_SKIN, drawCharacter: (...args) => { portrait = args.at(-1); } } };
  const ctx = new Proxy({ fillText: (value) => text.push(value), measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop() {} }) },
    { get: (o, key) => o[key] ?? (() => {}) });
  const scene = createGameScene({ mode: 'solo', characters: [{ id: 'char-1', name: 'Character' }] });
  const drawFrame = () => { text.length = 0; scene.draw(ctx, app); return portrait.frame; };
  scene.update(app);
  app.keyboard.pressed.add('Escape'); scene.update(app);
  const pausedAt = drawFrame();
  app.keyboard.pressed.clear();
  for (let i = 0; i < 10; i++) scene.update(app);
  assert.equal(drawFrame(), pausedAt);
  app.keyboard.pressed.add('Escape'); scene.update(app); app.keyboard.pressed.clear();
  app.keyboard.held.add('ArrowDown');
  let ended = false;
  for (let i = 0; i < 5000; i++) {
    scene.update(app); drawFrame();
    if (text.includes('게임 오버')) { ended = true; break; }
  }
  assert.ok(ended, '실제 엔진에서 게임 오버까지 진행한다');
  const resultAt = drawFrame();
  for (let i = 0; i < 10; i++) scene.update(app);
  assert.equal(drawFrame(), resultAt + 10);
});
