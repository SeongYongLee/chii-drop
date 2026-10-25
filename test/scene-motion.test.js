import { MOCK_SKIN, MOCK_SCRIPT } from './fixtures/presentation.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDialogueScene } from '../src/app/dialogue-scene.js';
import { createTowerScene } from '../src/app/tower-scene.js';
import { createGameScene } from '../src/app/game-scene.js';
import { createKeyboard } from '../src/input/keyboard.js';
import { createRun, createRecords } from '../src/story/progress.js';
import { drawResultPanel, resultCardLayout } from '../src/view/scene-motion.js';
import { drawFieldResults, resultFieldBoxes, resultMenuLayout } from '../src/view/field-results.js';

function harness(t) {
  const previous = globalThis.window;
  globalThis.window = { localStorage: { setItem() {} }, matchMedia: () => ({ matches: false }) };
  t.after(() => { globalThis.window = previous; });
  const calls = [], text = [];
  const ctx = new Proxy({ globalAlpha: 1, fillText: (s) => text.push(s),
    measureText: (s) => ({ width: s.length * 10 }),
  }, { get: (o, k) => o[k] ?? ((...args) => calls.push([k, ...args])) });
  const app = { keyboard: createKeyboard(), sfx: { enabled: false }, settings: { voice: false, ghost: false },
    records: { soloBest: 0, soloMaxChain: 0 },
    skin: { ...MOCK_SKIN, drawBackground() {}, drawCharacter() {} },
  };
  return { app, ctx, calls, text };
}

test('대화창 그리기는 등장 시간을 진행하지 않고 등장 중에도 다음·건너뛰기를 받는다', (t) => {
  const h = harness(t); let finished = 0;
  const scene = createDialogueScene({ script: MOCK_SCRIPT,
    lines: [{ who: 'player', text: '첫 대사' }, { who: 'companion', text: '다음 대사' }], onDone: () => finished++ });
  scene.draw(h.ctx, h.app); const first = [...h.calls];
  h.calls.length = 0; scene.draw(h.ctx, h.app);
  assert.deepEqual(h.calls, first);
  h.app.keyboard.pressed.add('Enter'); scene.update(h.app); // 즉시 전체 표시
  h.text.length = 0; scene.draw(h.ctx, h.app); assert.ok(h.text.includes('첫 대사'));
  scene.update(h.app); // 등장 완료를 기다리지 않고 다음 대사
  h.app.keyboard.pressed = new Set(['Escape']); scene.update(h.app);
  assert.equal(finished, 1);
});

test('탑의 표시만 이전 층에서 이동하고 상대 결정 후 41프레임 대기는 변하지 않는다', (t) => {
  const h = harness(t); let picked = 0;
  const scene = createTowerScene({ run: { ...createRun(), floorIndex: 1 }, records: createRecords(),
    script: MOCK_SCRIPT, fromFloor: 0, onPick: () => picked++ });
  const marker = () => { h.calls.length = 0; scene.draw(h.ctx, h.app); return h.calls.find((c) => c[0] === 'roundRect' && c[3] === 26 && c[4] === 26); };
  const start = marker(); assert.deepEqual(marker(), start);
  for (let i = 0; i < 22; i++) scene.update(h.app);
  const end = marker(); assert.ok(end[2] < start[2]); // 올라간 층으로 이동
  assert.ok(h.text.includes('완료'));
  h.app.keyboard.pressed.add('Enter'); scene.update(h.app); h.app.keyboard.pressed.clear();
  for (let i = 0; i < 40; i++) { scene.draw(h.ctx, h.app); scene.update(h.app); }
  assert.equal(picked, 0);
  scene.update(h.app); assert.equal(picked, 1);
});

test('꽃가루는 승리에만 잠깐 표시하며 히든·움직임 줄이기에서는 즉시 정적인 결과를 표시한다', (t) => {
  const h = harness(t);
  const render = (options) => { h.calls.length = 0; drawResultPanel(h.ctx, '결과', '다음', options); return [...h.calls]; };
  assert.ok(render({ age: 5, won: true }).some((c) => c[0] === 'ellipse'));
  assert.ok(!render({ age: 5, won: false }).some((c) => c[0] === 'ellipse'));
  assert.ok(!render({ age: 84, won: true }).some((c) => c[0] === 'ellipse'));
  const quiet = render({ age: 0, won: true, quiet: true });
  assert.ok(quiet.some((c) => c[0] === 'scale' && c[1] === 1 && c[2] === 1));
  assert.ok(!quiet.some((c) => c[0] === 'ellipse'));
  globalThis.window.matchMedia = () => ({ matches: true });
  const reduced = render({ age: 0, won: true });
  assert.ok(reduced.some((c) => c[0] === 'scale' && c[1] === 1 && c[2] === 1));
  assert.ok(!reduced.some((c) => c[0] === 'ellipse'));
});

test('결과 팻말 애니메이션은 기존 40프레임 입력 대기를 늘리지 않는다', (t) => {
  const h = harness(t);
  const scene = createGameScene({ mode: 'solo', characters: [{ id: 'actor-0', name: '참가자' }] });
  h.app.keyboard.held.add('ArrowDown');
  const title = () => { h.text.length = 0; scene.draw(h.ctx, h.app); return [...h.text]; };
  let ended = false;
  for (let i = 0; i < 5000; i++) { scene.update(h.app); if (title().includes('게임 오버')) { ended = true; break; } }
  assert.ok(ended);
  h.app.keyboard.pressed.add('Enter');
  for (let i = 0; i < 40; i++) scene.update(h.app);
  assert.ok(title().includes('게임 오버'));
  scene.update(h.app); assert.ok(title().includes('준비'));
});

test('모바일 일시정지 항목은 직접 눌러 재개·재시작·나가기를 실행한다',t=>{
  const h=harness(t);let quit=0;
  h.app.goToSinglePlayer=()=>quit++;
  const scene=createGameScene({mode:'solo',characters:[{id:'actor-0',name:'참가자'}]});
  for(const index of [0,1,2]){
    h.app.keyboard.pressed=new Set(['Escape']);scene.update(h.app);h.app.keyboard.pressed.clear();
    assert.equal(scene.touchMode(),'menu');assert.equal(scene.touchDirect(),true);
    const items=scene.touchItems(h.app);assert.equal(items.length,3);items[index].activate();
    if(index<2){assert.equal(scene.touchMode(),'game');assert.equal(scene.touchDirect(),false);}
  }
  assert.equal(quit,1);
});

test('터치 결과 버튼도 40프레임 입력 대기를 지키며 재시작과 메뉴 복귀를 실행한다',t=>{
  const h=harness(t);let exits=0;h.app.goToMenu=()=>exits++;
  const scene=createGameScene({mode:'solo',characters:MOCK_SKIN.characters.slice(0,1)});
  h.app.keyboard.held.add('ArrowDown');
  for(let frame=0;frame<5000;frame++) {
    scene.update(h.app);
    if(scene.touchItems(h.app).length)break;
  }
  const actions=scene.touchItems(h.app);
  assert.deepEqual(actions.map(item=>item.label),['다시하기','메인메뉴']);
  assert.ok(actions.every(item=>item.disabled));
  actions[1].activate();assert.equal(exits,0);
  for(let frame=0;frame<40;frame++)scene.update(h.app);
  assert.ok(scene.touchItems(h.app).every(item=>!item.disabled));
  scene.touchItems(h.app)[1].activate();assert.equal(exits,1);
  scene.touchItems(h.app)[0].activate();assert.equal(scene.touchItems(h.app).length,0);
});

test('결과 카드는 가로·세로에서 원래 비율을 유지하고 화면 안에 들어간다',()=>{
  for(const [height,portrait] of [[540,false],[700,true],[1200,true],[1700,true]]) {
    const card=resultCardLayout(height,portrait);
    assert.ok(card.x>=0&&card.y>=0);
    assert.ok(card.x+552*card.scale<=960&&card.y+414*card.scale<=height);
  }
});

test('로컬 대전의 일시정지 나가기는 멀티플레이로 돌아간다',t=>{
  const h=harness(t);let quit=0;
  h.app.goToMultiplayer=()=>quit++;
  h.app.goToSinglePlayer=()=>assert.fail('로컬 대전은 싱글 메뉴로 돌아가지 않는다');
  const scene=createGameScene({mode:'versus',characters:[{id:'actor-0',name:'1P'},{id:'actor-1',name:'2P'}]});
  h.app.keyboard.pressed=new Set(['Escape']);scene.update(h.app);h.app.keyboard.pressed.clear();
  const exit=scene.touchItems(h.app)[2];
  assert.equal(exit.label,'멀티플레이로');exit.activate();assert.equal(quit,1);
});

test('승리·패배는 각 필드 안에 표시하고 공용 메뉴는 필드 사이에 둔다',t=>{
  const h=harness(t),characters=MOCK_SKIN.characters.slice(0,2),figures=[];
  h.app.skin.drawCharacter=(_ctx,id,mood)=>figures.push({id,mood});
  const match={winner:0,players:[{score:9026,maxChain:3},{score:1124,maxChain:2}]};
  drawFieldResults(h.ctx,{skin:h.app.skin,match,characters,tally:[2,0],age:80});
  assert.ok(h.text.includes('세트 승리!')&&h.text.includes('패배'));
  assert.deepEqual(figures.map(figure=>figure.mood),['win','lose']);
  assert.ok(h.text.includes('2승')&&h.text.includes('9,026점'));
  const boxes=resultFieldBoxes(540,false,2);
  for(const menu of resultMenuLayout(540,4)) {
    assert.ok(menu.x>=boxes[0].x+boxes[0].width);
    assert.ok(menu.x+menu.width<=boxes[1].x);
    assert.ok(menu.y+menu.height<=540);
  }
  for(const height of [900,1500,1900]) {
    const portrait=resultFieldBoxes(height,true,2);
    assert.ok(portrait[0].x+portrait[0].width<portrait[1].x);
    for(const box of portrait) assert.ok(box.y+box.height<=height);
  }
});

test('CPU 결과에서 현재 난이도로 캐릭터를 바꾸거나 현재 캐릭터로 난이도를 바꿀 수 있다',t=>{
  const h=harness(t),characters=MOCK_SKIN.characters.slice(0,2),picked=[];
  h.app.records.cpu={normal:{win:0,lose:0}};
  h.app.mobile={visible:true};
  h.app.goToCharacterSelect=options=>picked.push(['character',options]);
  h.app.goToCpuLevelMenu=options=>picked.push(['difficulty',options]);
  const scene=createGameScene({mode:'cpu',cpuLevel:'normal',characters});
  h.app.setScene=next=>assert.equal(next,scene);
  h.app.keyboard.held.add('ArrowDown');
  for(let frame=0;frame<10000&&!scene.touchItems(h.app).length;frame++)scene.update(h.app);
  assert.deepEqual(scene.touchItems(h.app).map(item=>item.label),['다시하기','메인메뉴','캐릭터 선택','난이도 선택']);
  assert.equal(scene.touchColumns,2);
  for(let frame=0;frame<40;frame++)scene.update(h.app);
  scene.touchItems(h.app)[2].activate();
  assert.equal(picked[0][1].cpuLevel,'normal');picked[0][1].onBack();
  scene.touchItems(h.app)[3].activate();
  assert.equal(picked[1][1].characters,characters);picked[1][1].onBack();
  h.app.keyboard.pressed=new Set(['ArrowDown']);scene.update(h.app);
  assert.equal(scene.touchItems(h.app).findIndex(item=>item.selected),2);
  h.app.keyboard.pressed=new Set(['Enter']);scene.update(h.app);
  assert.equal(picked.at(-1)[0],'character');
});

test('대전 메뉴 버튼을 열면 낙하가 멈추고 계속하기로 같은 경기를 재개한다', t => {
  const h = harness(t), blobs = [];
  h.app.skin.drawBlob = (_ctx, color, x, y) => blobs.push([color, x, y]);
  const scene = createGameScene({ mode: 'solo', characters: [{ id: 'actor-0', name: '참가자' }] });
  for (let i = 0; i < 240; i++) scene.update(h.app);
  const snapshot = () => { blobs.length = 0; scene.draw(h.ctx, h.app); return structuredClone(blobs); };
  const before = snapshot();
  scene.openPause(); assert.equal(scene.touchPaused(), true);
  for (let i = 0; i < 120; i++) scene.update(h.app);
  assert.deepEqual(snapshot(), before, '메뉴를 보고 있는 동안 블록 위치가 바뀌지 않는다');
  scene.touchItems(h.app)[0].activate(); assert.equal(scene.touchPaused(), false);
  for (let i = 0; i < 120; i++) scene.update(h.app);
  assert.notDeepEqual(snapshot(), before, '계속하기를 누르면 낙하가 다시 진행된다');
});
