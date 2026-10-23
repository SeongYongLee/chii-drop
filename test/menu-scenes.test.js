import { MOCK_SKIN, MOCK_SCRIPT } from './fixtures/presentation.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMainMenu, createSinglePlayerMenu } from '../src/app/menu-scenes.js';
import { DEFAULT_SETTINGS } from '../src/app/storage.js';
import { createKeyboard } from '../src/input/keyboard.js';

function harness() {
  globalThis.window = { localStorage: { getItem: () => null } };
  const text = [];
  const figures = [];
  const ctx = new Proxy({ fillText: (s) => text.push(s) }, { get: (o, k) => o[k] ?? (() => {}) });
  const app = {
    keyboard: createKeyboard(), sfx: { enabled: false }, skin: { ...MOCK_SKIN, drawBackground() {}, drawCharacter: (_, id, mood, x, y, size, motion) => figures.push({ id, x, y, size, motion }) },
    settings: { ...DEFAULT_SETTINGS }, applySettings() {}, storyScript: MOCK_SCRIPT,
    single: createSinglePlayerMenu(), main: createMainMenu(),
    setScene(scene, ui) { this.scene = scene; this.lastUi = ui; },
    goToSinglePlayer() { this.scene = this.single; },
    goToMenu() { this.scene = this.main; },
  };
  app.scene = app.main;
  const press = (code) => { app.keyboard.pressed = new Set([code]); app.scene.update(app); };
  const labels = () => { text.length = 0; app.scene.draw(ctx, app); return [...text]; };
  return { app, press, labels, figures };
}

test('모바일의 큰 항목 버튼과 화면 터치로 메뉴·캐릭터 선택·일시정지까지 이동한다', () => {
  const h = harness();
  h.app.main.touchItems(h.app)[0].activate();
  h.app.scene.touchItems(h.app).find((item) => item.label === '연습').activate();
  const selection = h.app.scene;
  selection.touchItems(h.app)[1].activate();
  assert.ok(selection.touchLabel(h.app).includes('참가자 2'));
  h.press('Enter');
  assert.equal(h.app.scene.touchMode(), 'game');
  h.press('Escape');
  assert.equal(h.app.scene.touchMode(), 'menu');
  assert.ok(h.app.scene.touchLabel().includes('일시정지'));
  h.app.scene.tap(h.app, { x: 480, y: 221 });
  assert.equal(h.app.scene.touchMode(), 'game');
});

test('스토리·온라인은 준비 중으로 표시하고 커서는 실행 가능한 모드만 고른다', () => {
  const h = harness();
  assert.ok(h.labels().includes('온라인 모드 · 준비 중'));
  h.press('ArrowDown'); h.press('Enter');
  assert.ok(h.labels().includes('설정')); // 비활성 온라인 항목을 건너뛴다.
  h.press('Escape'); h.press('ArrowUp'); h.press('Enter');
  assert.ok(h.labels().includes('스토리 · 준비 중'));
  const single = h.app.scene;
  h.press('ArrowUp'); h.press('Enter');
  assert.ok(h.labels().includes('캐릭터 선택')); // 위로 돌면 연습을 선택한다.
  h.press('Escape'); assert.equal(h.app.scene, single);
  h.press('ArrowDown'); h.press('Enter'); // 스토리를 건너뛰어 CPU로 돌아온다.
  assert.ok(h.labels().includes('CPU 대전 · 난이도 선택'));
  h.press('Escape'); h.press('Escape'); assert.equal(h.app.scene, h.app.main);
});

test('설정에서 목소리 미리듣기는 제거하고 목소리·착지 위치 설정은 유지한다', () => {
  const h = harness();
  h.press('ArrowDown'); h.press('Enter');
  assert.ok(h.labels().includes('설정'));
  assert.ok(!h.labels().some(label => label.includes('미리듣기') || label.includes('스킨')));
  assert.ok(h.labels().some(label => label.includes('목소리')));
  assert.ok(h.labels().some(label => label.includes('착지 위치 표시') && label.includes('켬')));
});

test('CPU 난이도·캐릭터 선택과 로컬·연습 선택의 취소 경로를 유지한다', () => {
  const h = harness();
  h.press('Enter');
  h.press('Enter');
  assert.ok(h.labels().includes('CPU 대전 · 난이도 선택'));
  for (const label of ['아주 쉬움','쉬움','보통','어려움','아주 어려움']) assert.ok(h.labels().includes(label));
  h.press('Enter');
  assert.ok(h.labels().includes('캐릭터 선택'));
  h.press('Escape');
  assert.ok(h.labels().includes('CPU 대전 · 난이도 선택'));
  h.press('Escape');
  assert.equal(h.app.scene, h.app.single);
  h.press('ArrowDown');
  h.press('Enter');
  h.press('KeyF');
  assert.equal(h.app.scene, h.app.single);
  h.press('ArrowDown');
  h.press('Enter');
  h.press('Escape');
  assert.equal(h.app.scene, h.app.single);
});


test('캐릭터 여덟 명이 화면 안의 4×2 카드에 들어가고 아래 키로 다음 줄을 고른다', () => {
  const h = harness();
  h.app.skin.characters = Array.from({ length: 8 }, (_, i) => ({ id: `guest${i}`, name: `참가자 ${i}` }));
  h.press('Enter'); h.press('Enter'); h.press('Enter');
  h.figures.length = 0; h.labels();
  const cards = h.figures.filter((figure) => figure.size === 98);
  assert.equal(cards.length, 8);
  assert.equal(new Set(cards.map((figure) => figure.y)).size, 2);
  for (const figure of cards) {
    assert.ok(figure.x >= 0 && figure.x + figure.size <= 960);
    assert.ok(figure.y >= 0 && figure.y + figure.size <= 465);
  }
  h.press('ArrowDown'); h.figures.length = 0; h.labels();
  assert.equal(h.figures.find((figure) => figure.size === 180).id, 'guest4');
  h.press('ArrowUp'); h.figures.length = 0; h.labels();
  assert.equal(h.figures.find((figure) => figure.size === 180).id, 'guest0');
});


test('CPU 캐릭터 결정 도장을 전환에 넘기고 경기 준비는 지연 없이 시작한다', () => {
  const h = harness();
  h.press('Enter'); h.press('Enter'); h.press('Enter');
  h.press('Enter');
  assert.ok(h.labels().includes('준비'));
  assert.deepEqual(h.app.lastUi.stamps, [{ x: 128, y: 219, player: 0 }]);
});

test('로컬 대전의 결정 도장은 플레이어별로 표시되고 취소하면 사라진다', () => {
  const h = harness();
  h.press('Enter'); h.press('ArrowDown'); h.press('Enter');
  const selection = h.app.scene;
  h.press('KeyG');
  assert.equal(h.app.scene, selection);
  assert.equal(h.labels().filter((s) => s === '결정!').length, 1);
  h.press('KeyF');
  assert.ok(!h.labels().includes('결정!'));
  h.press('Period');
  assert.equal(h.labels().filter((s) => s === '결정!').length, 1);
  h.press('KeyG');
  assert.ok(h.labels().includes('준비'));
  assert.equal(h.app.lastUi.stamps[0].player, 0);
});


test('주요 여덟 명만 표시하되 준비 중 네 명과 스토리 전용 인물은 선택하거나 CPU로 고르지 않는다', () => {
  const h = harness();
  const selected=Array.from({length:8},(_,i)=>({id:'guest'+i,name:'참가자 '+i,selectionVisible:true,selectable:i<3||i===4,voiceAvailable:i===4?false:undefined}));
  const hidden=Array.from({length:26},(_,i)=>({id:'story'+i,name:'스토리 '+i,selectionVisible:false,selectable:false}));
  const roster=[hidden[0],...selected.slice(0,3),...hidden.slice(1),...selected.slice(3)];
  h.app.skin.characterRoster = roster;
  h.app.skin.characters = roster.filter(character=>character.selectable);
  h.press('Enter'); h.press('Enter'); h.press('Enter');
  const selection=h.app.scene;
  const labels = h.labels();
  assert.equal(labels.filter(label=>label==='준비 중').length,4);
  const cards=h.figures.filter(figure=>figure.size===98);
  assert.deepEqual(cards.map(figure=>figure.id),selected.map(character=>character.id));
  assert.deepEqual(h.app.scene.touchItems(h.app).map(item=>item.label),selected.map(character=>character.selectable?character.name:'준비 중'));
  assert.equal(h.app.scene.touchItems(h.app).filter(item=>item.disabled).length,4);
  assert.ok(cards.filter(figure=>!selected.find(c=>c.id===figure.id).selectable).every(figure=>figure.motion.silhouette));
  h.press('ArrowDown'); // 두 번째 줄 첫 캐릭터도 선택 가능하다.
  h.figures.length=0; h.labels();
  assert.equal(h.figures.find(figure=>figure.size===180).id,'guest4');
  assert.equal(h.labels().filter(label=>label==='보이스 없음').length,0);
  h.app.scene.tap(h.app,{x:62+3*145+30,y:127+157+30});
  assert.ok(h.app.scene.touchLabel(h.app).includes('참가자 4'));
  h.press('ArrowRight'); h.press('Enter');
  assert.equal(h.app.scene,selection);
  assert.ok(!h.labels().includes('결정!'));
  h.press('ArrowLeft'); h.press('Enter');
  h.figures.length=0; assert.ok(h.labels().includes('준비'));
  assert.ok(h.figures.some(figure=>figure.id==='guest4'));
  assert.ok(h.figures.every(figure=>roster.filter(character=>character.selectable).some(character=>character.id===figure.id)));
});
