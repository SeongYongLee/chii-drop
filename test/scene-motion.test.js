import { MOCK_SKIN, MOCK_SCRIPT } from './fixtures/presentation.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDialogueScene } from '../src/app/dialogue-scene.js';
import { createTowerScene } from '../src/app/tower-scene.js';
import { createGameScene } from '../src/app/game-scene.js';
import { createKeyboard } from '../src/input/keyboard.js';
import { createRun, createRecords } from '../src/story/progress.js';
import { drawResultPanel } from '../src/view/scene-motion.js';

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
