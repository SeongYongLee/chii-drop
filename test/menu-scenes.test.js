import { MOCK_SKIN, MOCK_SCRIPT } from './fixtures/presentation.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMainMenu, createSinglePlayerMenu, createMultiplayerMenu, createMatchSetup } from '../src/app/menu-scenes.js';
import { DEFAULT_SETTINGS } from '../src/app/storage.js';
import { createKeyboard } from '../src/input/keyboard.js';

function harness() {
  globalThis.window = { localStorage: { getItem: () => null } };
  const text = [];
  const figures = [];
  const ctx = new Proxy({ fillText: (s) => text.push(s) }, { get: (o, k) => o[k] ?? (() => {}) });
  const app = {
    controlsGuidesSeen: new Set(['solo:keyboard', 'versus:keyboard']),
    keyboard: createKeyboard(), sfx: { enabled: false }, skin: { ...MOCK_SKIN, drawBackground() {}, drawCharacter: (_, id, mood, x, y, size, motion) => figures.push({ id, x, y, size, motion }) },
    settings: { ...DEFAULT_SETTINGS }, applySettings() {}, storyScript: MOCK_SCRIPT,
    single: createSinglePlayerMenu(), multi: createMultiplayerMenu(), main: createMainMenu(),
    setScene(scene, ui) { this.scene = scene; this.lastUi = ui; },
    goToSinglePlayer() { this.scene = this.single; },
    goToMultiplayer() { this.scene = this.multi; },
    goToMenu() { this.scene = this.main; },
  };
  app.scene = app.main;
  const press = (code) => { app.keyboard.pressed = new Set([code]); app.scene.update(app); };
  const labels = () => { text.length = 0; app.scene.draw(ctx, app); return [...text]; };
  const wait = (frames) => { for (let i = 0; i < frames; i++) { app.keyboard.pressed.clear(); app.scene.update(app); } };
  return { app, press, labels, figures, wait };
}

test('설정에서 목소리 미리듣기는 제거하고 목소리·착지 위치 설정은 유지한다', () => {
  const h = harness();
  h.app.main.touchItems(h.app).find(item => item.label === '설정').activate();
  assert.ok(h.labels().includes('설정'));
  assert.ok(!h.labels().some(label => label.includes('미리듣기') || label.includes('스킨')));
  assert.ok(h.labels().some(label => label.includes('목소리')));
  assert.ok(h.labels().some(label => label.includes('착지 위치 표시') && label.includes('켬')));
});


test('음량 조절에서 전체·효과음·음악·목소리를 독립적으로 바꾸고 설정으로 돌아간다', () => {
  const h = harness();
  h.app.main.touchItems(h.app).find(item => item.label === '설정').activate();
  const settings = h.app.scene;
  settings.touchItems(h.app).find(item => item.label === '음량 조절').activate();
  const menu = h.app.scene, items = menu.touchItems(h.app);
  assert.deepEqual(items.map(item => [item.label, item.value]), [['전체', 5], ['효과음', 5], ['배경음악', 5], ['목소리', 5]]);
  items[1].activate(-1);
  assert.equal(h.app.settings.effectsVolume, 4);
  assert.equal(h.app.settings.musicVolume, 5);
  assert.equal(h.app.settings.voiceVolume, 5);
  assert.equal(h.app.settings.volume, 5);
  for (let i = 0; i < 15; i++) items[2].activate(-1);
  assert.equal(h.app.settings.musicVolume, 0);
  for (let i = 0; i < 15; i++) items[2].activate(1);
  assert.equal(h.app.settings.musicVolume, 10);
  h.press('Escape');
  assert.equal(h.app.scene, settings);
});


test('싱글플레이 CPU 관전은 양쪽 설정을 선택하고 조작 패드 없이 관전·일시정지·설정 복귀한다', () => {
  const h = harness();
  h.app.single.touchItems(h.app).find(item => item.label === 'CPU 관전').activate();
  const setup = h.app.scene;
  let items = setup.touchItems(h.app);
  assert.deepEqual(items.map(item => item.label), ['CPU 1 캐릭터', 'CPU 2 캐릭터', 'CPU 1 난이도', 'CPU 2 난이도', '관전 시작']);
  assert.ok(items.slice(0, 4).every(item => item.adjustable));
  items[2].activate(1);
  items[3].activate(-1);
  items[0].activate(1);
  items = setup.touchItems(h.app);
  assert.equal(items[2].value, '어려움');
  assert.equal(items[3].value, '쉬움');
  items[4].activate();
  const game = h.app.scene;
  assert.equal(game.touchMode(), 'menu');
  assert.ok(game.touchLabel().includes('CPU 관전'));
  assert.deepEqual(game.touchItems(h.app).map(item => item.label), ['일시정지']);
  h.wait(200);
  game.touchItems(h.app)[0].activate();
  assert.equal(game.touchPaused(), true);
  assert.deepEqual(game.touchItems(h.app).map(item => item.label), ['계속 관전', '다시 시작', '관전 설정으로']);
  game.touchItems(h.app)[2].activate();
  assert.equal(h.app.scene, setup);
  assert.equal(setup.touchItems(h.app)[2].value, '어려움');
});


test('세로 관전 키보드는 선수 카드 순서로 선택하고 각 CPU 설정과 시작·뒤로를 처리한다', () => {
  const h = harness(); h.app.portraitScreen = true;
  h.app.single.touchItems(h.app).find(item => item.label === 'CPU 관전').activate();
  const menu = h.app.scene, items = () => menu.touchItems(h.app);
  const selected = () => items().findIndex(item => item.selected);
  assert.equal(selected(), 0);
  h.press('ArrowRight'); assert.equal(items()[0].value, MOCK_SKIN.characters[1].name);
  h.press('ArrowDown'); assert.equal(selected(), 2);
  h.press('ArrowLeft'); assert.equal(items()[2].value, '쉬움');
  h.press('ArrowDown'); assert.equal(selected(), 1);
  h.press('ArrowRight'); assert.equal(items()[1].value, MOCK_SKIN.characters[2].name);
  h.press('ArrowDown'); assert.equal(selected(), 3);
  h.press('ArrowRight'); assert.equal(items()[3].value, '어려움');
  h.press('ArrowDown'); assert.equal(selected(), 4);
  h.press('ArrowUp'); assert.equal(selected(), 3);
  items()[4].focus(); assert.equal(selected(), 4);
  h.press('Enter'); assert.notEqual(h.app.scene, menu);
  assert.ok(h.app.scene.touchLabel().includes('CPU 관전'));
  h.app.setScene(menu); h.press('Escape'); assert.equal(h.app.scene, h.app.single);
});

for (const mode of ['cpu', 'solo', 'versus', 'watch']) test(`${mode}: 공통 선수 카드에서 설정하고 중간 메뉴 없이 시작한다`, () => {
  const h = harness();
  const setup = createMatchSetup({ mode }); h.app.scene = setup;
  assert.equal(setup.touchLayout, 'match-setup');
  const items = setup.touchItems(h.app), metadata = setup.touchSetup;
  assert.equal(metadata.players.length, mode === 'solo' ? 1 : 2);
  assert.equal(items.filter(item => item.label.includes('난이도')).length, mode === 'watch' ? 2 : mode === 'cpu' ? 1 : 0);
  assert.ok(metadata.players.every(player => typeof items[player.characterIndex].drawPreview === 'function'));
  items[0].activate(1);
  if (mode !== 'solo') items[1].activate(1);
  items[metadata.startIndex].activate();
  assert.notEqual(h.app.scene, setup);
  assert.equal(h.app.scene.touchGame(), true);
  if (mode === 'watch') assert.ok(h.app.scene.touchLabel().includes('CPU 관전'));
  else assert.ok(h.labels().includes('준비'));
});

test('실제 진입 경로는 공통 설정과 온라인 연결 설정을 따르고 스토리는 잠근다', () => {
  const h = harness();
  h.app.main.touchItems(h.app).find(item => item.label === '멀티플레이').activate();
  const multi = h.app.scene;
  h.app.onlineAvailable = false;
  assert.equal(multi.touchItems(h.app)[1].disabled, true);
  h.app.onlineAvailable = true;
  assert.equal(multi.touchItems(h.app)[1].disabled, false);
  let opened = 0;
  h.app.openOnline = () => { opened++; };
  multi.touchItems(h.app)[1].activate();
  assert.equal(opened, 1);
  multi.touchItems(h.app)[0].activate();
  assert.equal(h.app.scene.touchSetup.title, '로컬 대전');
  h.press('Escape'); assert.equal(h.app.scene, h.app.multi);
  for (const title of ['CPU 대전', 'CPU 관전', '연습']) {
    h.app.single.touchItems(h.app).find(item => item.label === title).activate();
    assert.equal(h.app.scene.touchSetup.title, title);
    h.press('Escape'); assert.equal(h.app.scene, h.app.single);
  }
  assert.equal(h.app.single.touchItems(h.app)[0].disabled, true);
});

test('설정을 다시 열면 선택한 두 캐릭터·난이도가 그대로이며 취소할 수 있다', () => {
  const h = harness(), characters = MOCK_SKIN.characters.slice(1, 3); let cancelled = 0;
  const setup = createMatchSetup({ mode: 'cpu', characters, cpuLevel: 'expert', onBack: () => cancelled++ });
  h.app.scene = setup;
  assert.deepEqual(setup.touchItems(h.app).slice(0, 3).map(item => item.value), [characters[0].name, characters[1].name, '어려움']);
  h.press('Escape'); assert.equal(cancelled, 1);
  setup.touchItems(h.app)[2].activate(-1);
  setup.touchItems(h.app)[3].activate();
  h.figures.length = 0; h.labels();
  assert.deepEqual(h.figures.map(figure => figure.id), characters.map(character => character.id));
});

test('공통 설정은 준비 중 인물을 표시하되 선택·랜덤에서는 제외하고 숨김 인물은 감춘다', t => {
  t.mock.method(crypto, 'getRandomValues', array => { array[0] = 0; return array; });
  const h = harness();
  h.app.skin.characterRoster = [...MOCK_SKIN.characters, { id: 'locked', name: '준비 중', selectable: false },
    { id: 'hidden', name: '숨김', selectionVisible: false }];
  const setup = createMatchSetup({ mode: 'cpu' }); h.app.scene = setup;
  assert.deepEqual(setup.touchItems(h.app)[0].choiceLabels.slice(0, 3), MOCK_SKIN.characters.map(character => character.name));
  assert.match(setup.touchItems(h.app)[0].choiceLabels[3], /준비 중/);
  assert.deepEqual(setup.touchItems(h.app)[0].choiceDisabled, [false, false, false, true]);
  setup.touchItems(h.app)[0].activate(3);
  assert.equal(setup.touchItems(h.app)[0].value, MOCK_SKIN.characters[0].name);
  assert.equal(setup.touchItems(h.app)[1].value, '랜덤');
  setup.touchItems(h.app)[3].activate(); h.figures.length = 0; h.labels();
  assert.deepEqual(h.figures.map(figure => figure.id), MOCK_SKIN.characters.slice(0, 2).map(character => character.id));
});

test('캐릭터가 없어도 설정을 그릴 수 있고 시작은 막는다', () => {
  const h = harness(); h.app.skin.characters = [];
  for (const mode of ['solo', 'cpu', 'versus', 'watch']) {
    const setup = createMatchSetup({ mode }); h.app.scene = setup;
    assert.equal(setup.touchItems(h.app).at(-1).disabled, true);
    setup.touchItems(h.app).at(-1).activate(); assert.equal(h.app.scene, setup);
    h.labels();
  }
});

test('가로 선수 카드도 같은 캐릭터·난이도 항목과 좌우 변경 버튼을 사용한다', () => {
  const h = harness(), setup = createMatchSetup({ mode: 'cpu', characters: MOCK_SKIN.characters.slice(0, 2) });
  h.app.scene = setup; h.figures.length = 0; h.labels();
  assert.equal(h.figures.length, 2);
  assert.equal(h.figures[0].size, h.figures[1].size);
  setup.tap(h.app, { x: 420, y: 230 });
  assert.equal(setup.touchItems(h.app)[0].value, MOCK_SKIN.characters[1].name);
  setup.tap(h.app, { x: 530, y: 390 });
  assert.equal(setup.touchItems(h.app)[2].value, '달인');
});

test('CPU 대전의 기본은 입문이며 관전 기본과 명시한 기존 난이도는 보존한다', () => {
  const h = harness();
  assert.equal(createMatchSetup({ mode: 'cpu' }).touchItems(h.app)[2].value, '입문');
  assert.equal(createMatchSetup({ mode: 'watch' }).touchItems(h.app)[2].value, '보통');
  assert.equal(createMatchSetup({ mode: 'cpu', cpuLevel: 'expert' }).touchItems(h.app)[2].value, '어려움');
});
