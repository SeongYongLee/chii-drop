import { MOCK_SKIN, MOCK_SCRIPT } from './fixtures/presentation.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMainMenu, createSinglePlayerMenu, createMultiplayerMenu, createCpuLevelMenu, createCharacterSelect } from '../src/app/menu-scenes.js';
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

test('모바일의 큰 항목 버튼과 화면 터치로 메뉴·캐릭터 선택·일시정지까지 이동한다', () => {
  const h = harness();
  h.app.main.touchItems(h.app)[0].activate();
  h.app.scene.touchItems(h.app).find((item) => item.label === '연습').activate();
  const selection = h.app.scene;
  selection.touchItems(h.app)[1].activate();
  assert.ok(selection.touchLabel(h.app).includes('참가자 2'));
  h.press('Enter'); h.wait(36);
  assert.equal(h.app.scene.touchMode(), 'game');
  h.press('Escape');
  assert.equal(h.app.scene.touchMode(), 'menu');
  assert.ok(h.app.scene.touchLabel().includes('일시정지'));
  h.app.scene.tap(h.app, { x: 480, y: 221 });
  assert.equal(h.app.scene.touchMode(), 'game');
});

test('공개 메뉴에서 스토리·멀티플레이를 잠그고 CPU·연습은 유지한다', () => {
  const h = harness();
  const main = h.app.main.touchItems(h.app);
  assert.deepEqual(main.slice(0, 2).map(item => item.label), ['싱글플레이', '멀티플레이 · 준비 중']);
  assert.equal(main[1].disabled, true);
  main[1].activate(); assert.equal(h.app.scene, h.app.main);
  h.app.onlineAvailable = true;
  assert.ok(h.app.multi.touchItems(h.app).every(item => item.disabled), '서버 연결 설정이 켜져도 공개 제한을 우회하지 않는다');
  main[0].activate();
  const items = h.app.single.touchItems(h.app);
  assert.equal(items[0].disabled, true);
  assert.equal(items[0].label, '스토리 · 준비 중');
  assert.ok(items.slice(1).every(item => !item.disabled));
  items[0].activate(); assert.equal(h.app.scene, h.app.single);
  items[1].activate(); assert.ok(h.labels().includes('CPU 대전 · 난이도 선택'));
  h.press('Escape'); assert.equal(h.app.scene, h.app.single);
  items[2].activate(); assert.ok(h.labels().includes('캐릭터 선택'));
  h.press('Escape'); assert.equal(h.app.scene, h.app.single);
});

test('설정에서 목소리 미리듣기는 제거하고 목소리·착지 위치 설정은 유지한다', () => {
  const h = harness();
  h.press('ArrowDown'); h.press('Enter');
  assert.ok(h.labels().includes('설정'));
  assert.ok(!h.labels().some(label => label.includes('미리듣기') || label.includes('스킨')));
  assert.ok(h.labels().some(label => label.includes('목소리')));
  assert.ok(h.labels().some(label => label.includes('착지 위치 표시') && label.includes('켬')));
});

test('결과에서 난이도만 변경할 때 현재 난이도를 표시하고 같은 캐릭터로 바로 시작한다',()=>{
  const h=harness(),characters=MOCK_SKIN.characters.slice(1,3);let cancelled=0;
  const menu=createCpuLevelMenu({characters,cpuLevel:'hard',onBack:()=>cancelled++});
  h.app.scene=menu;
  assert.equal(menu.touchItems(h.app).find(item=>item.selected).label,'보통');
  h.press('Escape');assert.equal(cancelled,1);
  menu.touchItems(h.app).find(item=>item.label==='쉬움').activate();
  assert.equal(h.app.scene.touchGame(),true);
  h.figures.length=0;h.labels();
  assert.deepEqual([...new Set(h.figures.map(figure=>figure.id))].sort(),characters.map(character=>character.id).sort());
});

test('CPU 난이도·캐릭터 선택과 로컬·연습 선택의 취소 경로를 유지한다', () => {
  const h = harness();
  h.press('Enter');
  h.press('Enter');
  assert.ok(h.labels().includes('CPU 대전 · 난이도 선택'));
  for (const label of ['입문','아주 쉬움','쉬움','보통','어려움','아주 어려움','달인']) assert.ok(h.labels().includes(label));
  assert.equal(h.app.scene.touchColumns, 2);
  const difficulty = h.app.scene;
  assert.deepEqual(difficulty.touchItems(h.app).map(item => item.label), ['입문','아주 쉬움','쉬움','보통','어려움','아주 어려움','달인']);
  difficulty.touchItems(h.app).at(-1).activate();
  assert.ok(h.labels().includes('캐릭터 선택'));
  h.press('Escape');
  h.press('Enter');
  assert.ok(h.labels().includes('캐릭터 선택'));
  h.press('Escape');
  assert.ok(h.labels().includes('CPU 대전 · 난이도 선택'));
  h.press('Escape');
  assert.equal(h.app.scene, h.app.single);
  h.press('ArrowDown'); h.press('Enter');
  h.press('Escape'); assert.equal(h.app.scene, h.app.single);
  h.press('Escape');
  h.app.setScene(createCharacterSelect({ mode: 'versus' }));
  h.press('KeyF');
  assert.equal(h.app.scene, h.app.multi);
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


test('세로 캐릭터 선택은 두 열을 따라 이동하며 회전하면 네 열 기준으로 바뀐다', () => {
  const h = harness(); h.app.portraitScreen = true;
  h.app.skin.characters = Array.from({ length: 8 }, (_, i) => ({ id: `guest${i}`, name: `참가자 ${i}` }));
  h.app.single.touchItems(h.app).find(item => item.label === '연습').activate();
  const selected = () => h.app.scene.touchItems(h.app).findIndex(item => item.selected);
  h.press('ArrowDown'); assert.equal(selected(), 2);
  h.press('ArrowRight'); assert.equal(selected(), 3);
  h.press('ArrowRight'); assert.equal(selected(), 2); // 같은 줄 안에서 순환
  h.press('ArrowUp'); assert.equal(selected(), 0);
  h.press('ArrowUp'); assert.equal(selected(), 6);
  h.app.portraitScreen = false;
  h.press('ArrowUp'); assert.equal(selected(), 2);
  h.app.portraitScreen = true;
  h.press('ArrowDown'); assert.equal(selected(), 4);
});

test('세로 CPU 상대 선택의 마지막 랜덤 행에서도 방향키가 유효한 항목을 고른다', () => {
  const h = harness(); h.app.portraitScreen = true;
  h.app.skin.characters = Array.from({ length: 4 }, (_, i) => ({ id: `guest${i}`, name: `참가자 ${i}` }));
  h.press('Enter'); h.press('Enter'); h.press('Enter');
  h.press('Enter'); h.wait(36);
  const items = () => h.app.scene.touchItems(h.app);
  assert.equal(items().find(item => item.selected).label, '랜덤');
  h.press('ArrowRight'); assert.equal(items().find(item => item.selected).label, '랜덤');
  h.press('ArrowUp'); assert.equal(items().findIndex(item => item.selected), 2);
  h.press('ArrowDown'); assert.equal(items().find(item => item.selected).label, '랜덤');
});

test('1P 결정 연출을 0.6초 보여준 뒤 CPU 상대를 선택한다', () => {
  const h = harness();
  h.press('Enter'); h.press('Enter'); h.press('Enter');
  const selection = h.app.scene;
  h.press('Enter');
  assert.equal(h.app.scene, selection);
  assert.ok(h.labels().includes('결정!'));
  assert.ok(selection.touchItems(h.app).every(item => item.disabled));
  selection.touchItems(h.app)[1].activate();
  selection.tap(h.app, { x: 220, y: 150 });
  h.press('ArrowRight'); h.press('Escape'); h.wait(33);
  assert.equal(h.app.scene, selection);
  assert.ok(h.labels().includes('결정!'));
  assert.ok(selection.touchLabel(h.app).includes('결정 완료'));
  h.wait(1);
  assert.ok(h.labels().includes('CPU 상대 선택'));
  assert.equal(h.app.scene.touchItems(h.app).at(-1).label, '랜덤');
  h.press('Enter'); h.wait(36);
  assert.ok(h.labels().includes('준비'));
  assert.deepEqual(h.app.lastUi.stamps, []); // 결정 도장을 전환 때 다시 재생하지 않는다.
  assert.equal(h.figures.filter(figure => figure.size === 180).at(-1).id, MOCK_SKIN.characters[0].id);
});

test('로컬 대전의 결정 도장은 플레이어별로 표시되고 취소하면 사라진다', () => {
  const h = harness();
  h.app.setScene(createCharacterSelect({ mode: 'versus' }));
  const selection = h.app.scene;
  h.press('KeyG');
  assert.equal(h.app.scene, selection);
  assert.equal(h.labels().filter((s) => s === '결정!').length, 1);
  h.press('KeyF');
  assert.ok(!h.labels().includes('결정!'));
  h.press('Period');
  assert.equal(h.labels().filter((s) => s === '결정!').length, 1);
  h.press('KeyG');
  assert.equal(h.app.scene, selection);
  assert.equal(h.labels().filter(s => s === '결정!').length, 2);
  h.press('KeyF'); h.wait(34);
  assert.equal(h.app.scene, selection);
  h.wait(1);
  assert.ok(h.labels().includes('준비'));
  assert.deepEqual(h.app.lastUi.stamps, []);
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
  h.press('ArrowLeft'); h.press('Enter'); h.wait(36);
  assert.deepEqual(h.app.scene.touchItems(h.app).map(item=>item.label), [...selected.filter(c=>c.selectable).map(c=>c.name), '랜덤']);
  h.press('Enter'); h.wait(36);
  h.figures.length=0; assert.ok(h.labels().includes('준비'));
  assert.ok(h.figures.some(figure=>figure.id==='guest4'));
  assert.ok(h.figures.every(figure=>roster.filter(character=>character.selectable).some(character=>character.id===figure.id)));
});


test('CPU를 직접 선택하고 취소하면 1P 선택을 보존한다', () => {
  const h = harness();
  h.press('Enter'); h.press('Enter'); h.press('Enter');
  const selection = h.app.scene;
  h.press('ArrowRight'); h.press('Enter'); h.wait(36);
  h.press('Escape');
  assert.equal(h.app.scene,selection);
  assert.ok(selection.touchLabel(h.app).includes(MOCK_SKIN.characters[1].name));
  h.press('Enter'); h.wait(36);
  h.app.scene.touchItems(h.app).find(item=>item.label===MOCK_SKIN.characters[0].name).activate();
  h.press('Enter'); h.wait(36);
  h.figures.length=0; h.labels();
  assert.deepEqual(h.figures.map(figure=>figure.id), [MOCK_SKIN.characters[1].id,MOCK_SKIN.characters[0].id]);
});

test('CPU 랜덤은 활성 캐릭터 모두에서 고르고 1P·준비 중·숨김 캐릭터를 제외한다', t => {
  const random = t.mock.method(crypto,'getRandomValues', array => { array[0]=0; return array; });
  const opponents = [];
  for (let sample=0; sample<3; sample++) {
    random.mock.mockImplementation(array => { array[0]=sample; return array; });
    const h=harness();
    const roster=Array.from({length:6},(_,i)=>({id:`actor${i}`,name:`캐릭터 ${i}`,selectable:i<5,selectionVisible:i!==4}));
    h.app.skin.characterRoster=roster;
    h.press('Enter'); h.press('Enter'); h.press('Enter'); h.press('Enter'); h.wait(36);
    h.press('Enter'); h.wait(36);
    h.figures.length=0; h.labels();
    opponents.push(h.figures.at(-1).id);
  }
  assert.deepEqual(opponents,['actor1','actor2','actor3']);
});


test('PC CPU 상대도 1P와 같은 카드 크기·위치·확대 미리보기·결정 도장을 쓴다', () => {
  const h=harness();
  h.press('Enter'); h.press('Enter'); h.press('Enter');
  h.figures.length=0; h.labels();
  const playerCards=h.figures.filter(figure=>figure.size===98).map(({x,y,size})=>({x,y,size}));
  h.press('Enter'); h.wait(36);
  const cpu=h.app.scene;
  h.figures.length=0; const labels=h.labels();
  assert.ok(labels.includes('CPU 상대 선택'));
  assert.deepEqual(h.figures.filter(figure=>figure.size===98).map(({x,y,size})=>({x,y,size})),playerCards);
  assert.ok(labels.includes('?'));
  cpu.touchItems(h.app)[1].activate();
  h.figures.length=0; h.labels();
  assert.equal(h.figures.find(figure=>figure.size===180).id,MOCK_SKIN.characters[1].id);
  h.press('Enter'); h.wait(35);
  assert.equal(h.app.scene,cpu);
  assert.ok(h.labels().includes('결정!'));
  h.wait(1); assert.notEqual(h.app.scene,cpu);
});
