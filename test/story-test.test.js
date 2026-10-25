import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storyTestTarget, startStoryTest } from '../src/app/story-test.js';
import { createStoryFlow } from '../src/app/story-mode.js';
import { createKeyboard } from '../src/input/keyboard.js';
import { MOCK_SCRIPT } from './fixtures/presentation.js';

test('스토리 테스트는 명시적인 로컬 URL에서만 켜진다', () => {
  for (const host of ['localhost:5182', '127.0.0.1:5182', '[::1]:5182']) {
    assert.equal(storyTestTarget(`http://${host}/?story-test=secretFinal`), 'secretFinal');
  }
  for (const url of [undefined, 'file:///tmp/index.html?story-test=menu',
    'https://example.com/?story-test=menu', 'http://192.168.0.2/?story-test=opening',
    'http://localhost.example.com/?story-test=secretFinal', 'http://localhost/?story-test=bad', 'http://localhost/']) {
    assert.equal(storyTestTarget(url), null);
  }
});

function harness(t, testMode = true) {
  const previous = globalThis.window;
  const writes = [], reads = [], states = [];
  const saved = JSON.stringify({ run: { score: 12345 }, records: { hiddenWon: ['secret01'] } });
  globalThis.window = { localStorage: { getItem(key) { reads.push(key); return saved; }, setItem(...args) { writes.push(args); } } };
  t.after(() => { globalThis.window = previous; });
  const script = structuredClone(MOCK_SCRIPT);
  for (const [key, text] of Object.entries({ 'secretFinal.fever': '変身', 'secretFinal.win': '一緒に遊んだ',
    'secretFinal.lose': 'もう一回', secretEnding: '空席' })) script.scenes[key] = [{ text }];
  const app = { storyScript: script, sfx: { enabled: false }, keyboard: createKeyboard(),
    setScene(scene) { this.scene = scene; }, goToSinglePlayer() { this.exited = true; } };
  let exits = 0;
  const flow = createStoryFlow(app, { testMode, onExit: () => exits++, onTestState: state => states.push(state) });
  const skip = () => { app.keyboard.pressed = new Set(['Escape']); app.scene.update(app); app.keyboard.pressed.clear(); };
  const read = () => {
    app.keyboard.pressed.clear();
    for (let i = 0; i < 240; i++) app.scene.update(app);
    app.keyboard.pressed.add('Enter'); app.scene.update(app); app.keyboard.pressed.clear();
  };
  return { app, flow, writes, reads, states, skip, read, exits: () => exits };
}

test('테스트 메뉴를 열 때 실제 메뉴의 항목 조회와 입력 처리가 동작한다', t => {
  const h = harness(t);
  const previous = globalThis.document;
  const element = () => ({ style: {}, append() {}, setAttribute() {}, addEventListener() {} });
  globalThis.document = { createElement: element, body: element() };
  t.after(() => { globalThis.document = previous; });
  h.app.setScene = function (scene) {
    this.scene = scene;
    if (scene.touchItems) assert.equal(scene.touchItems(this).length, 4);
  };
  startStoryTest(h.app);
  assert.match(h.app.scene.touchLabel(h.app), /스토리 처음부터/);
  h.app.scene.update(h.app);
  h.app.scene.touchItems(h.app)[1].activate();
  assert.equal(h.app.scene.musicScene, 'story');
  assert.deepEqual(h.writes, []);
});

test('해금 없이 히든 실제 경기에 진입하고 승리 처리 시 변신·승리·결말 순서를 지키며 저장하지 않는다', t => {
  const h = harness(t);
  assert.equal(h.flow.canChallenge(), false);
  assert.equal(h.flow.testStart('secretFinal'), true);
  assert.equal(h.flow.testFinish(true), false); // 초대 대사 중
  h.skip(); h.skip(); // 초대 → 경기 전 → 실제 경기
  assert.equal(h.states.at(-1).phase, 'battle');
  assert.equal(h.app.scene.musicScene(), 'intense');
  assert.equal(h.flow.testFinish(true), true);
  assert.equal(h.flow.testFinish(true), false); // 중복 처리 금지
  h.skip(); // 변신 중 Esc로 빠져나갈 수 없다.
  assert.equal(h.flow.testFinish(true), false);
  h.read(); // 변신 대사를 읽은 뒤 → 승리 대사
  assert.equal(h.states.at(-1).phase, 'dialogue');
  h.skip(); // 승리 → 히든 결말
  assert.equal(h.app.scene.musicScene, 'result');
  h.skip();
  assert.equal(h.exits(), 1);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.reads, []);
});

test('테스트 패배 뒤 재도전할 수 있고 새 테스트를 시작하면 이전 임시 기록을 버린다', t => {
  const h = harness(t);
  h.flow.testStart('secretFinal'); h.skip(); h.skip();
  assert.equal(h.flow.testFinish(false), true);
  h.skip();
  assert.equal(h.states.at(-1).phase, 'battle');
  h.flow.testStart('opening');
  assert.equal(h.flow.canChallenge(), false);
  assert.equal(h.flow.hiddenWins(), 0);
  h.skip();
  assert.equal(h.states.at(-1).phase, 'tower');
  assert.equal(h.flow.testFinish(true), false);
  assert.deepEqual(h.writes, []);
});

test('연출 단독 확인은 경기 없이 끝나고 일반 스토리에서는 테스트 진입점이 작동하지 않는다', t => {
  const h = harness(t);
  for (const target of ['reveal', 'secretEnding']) {
    assert.equal(h.flow.testStart(target), true);
    assert.equal(h.flow.testFinish(true), false);
    if (target === 'reveal') h.read(); else h.skip();
  }
  assert.equal(h.exits(), 2);
  assert.deepEqual(h.writes, []);
  const normal = harness(t, false);
  assert.equal(normal.flow.testStart('secretFinal'), false);
  assert.equal(normal.flow.testFinish(true), false);
  assert.equal(normal.app.scene, undefined);
  assert.equal(normal.reads.length, 1);
});
