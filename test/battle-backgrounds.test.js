import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chooseBattleScenery, applyPageBackdrop } from '../src/view/battle-backgrounds.js';
import { createGameScene } from '../src/app/game-scene.js';

test('대전 배경 후보는 스포일러를 제외한 명시 목록이며 실행 팩과 같다', async () => {
  const runtime = JSON.parse(await readFile('skins/chiikawa/pages-runtime/manifest.json', 'utf8'));
  assert.deepEqual(runtime.battleSceneries, ['meadow', 'market', 'grove', 'hill', 'summit']);
  for (const scenery of runtime.battleSceneries) assert.ok(runtime.backgrounds[`game:${scenery}`]);
  // 로컬 제작 매니페스트는 공개 저장소에 포함하지 않는다.
  let local;
  try { local = await readFile('skins/chiikawa/manifest.json', 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (local) assert.deepEqual(runtime.battleSceneries, JSON.parse(local).battleSceneries);
});

test('선택은 허용 목록만 사용하고 직전 배경을 피하며 후보 없는 스킨도 동작한다', () => {
  const skin = { battleSceneries: ['a', 'b', 'c', 'a'] };
  assert.deepEqual([0, .4, .9].map(random => chooseBattleScenery(skin, undefined, () => random)), ['a', 'b', 'c']);
  assert.equal(chooseBattleScenery(skin, 'a', () => 0), 'b');
  assert.equal(chooseBattleScenery({ battleSceneries: ['a'] }, 'a'), 'a');
  assert.equal(chooseBattleScenery({}), undefined);
});

test('대전·관전은 한 판 동안 배경을 유지하고 재시작 시 다시 선택하며 스토리는 지정 배경을 유지한다', () => {
  const skin = { battleSceneries: ['a', 'b'] }, app = { sfx: { enabled: false } };
  for (const mode of ['cpu', 'versus', 'watch']) {
    const scene = createGameScene({ mode });
    const first = scene.backgroundScene(skin);
    assert.ok(['game:a', 'game:b'].includes(first));
    assert.equal(scene.backgroundScene(skin), first);
    scene.openPause(); scene.touchItems(app)[1].activate();
    assert.notEqual(scene.backgroundScene(skin), first);
  }
  assert.equal(createGameScene({ mode: 'story', scenery: 'inside' }).backgroundScene(skin), 'game:inside');
  assert.equal(createGameScene({ mode: 'solo' }).backgroundScene(skin), 'game');
});

test('가로·세로 배경 동기화는 재시작과 다른 캔버스에서 복귀할 때에도 적용된다', () => {
  let value, writes = 0;
  const document = { body: { dataset: {}, style: {
    getPropertyValue() { return value; }, setProperty(key, next) { value = next; writes++; },
  } } };
  const skin = { backgroundUrl: scene => scene === 'missing' ? null : `${scene}.png` };
  const main = {}, online = {};
  applyPageBackdrop(main, skin, 'a', document);
  applyPageBackdrop(main, skin, 'a', document);
  assert.equal(writes, 1);
  applyPageBackdrop(online, skin, 'b', document);
  applyPageBackdrop(main, skin, 'a', document);
  assert.equal(value, 'url("a.png")');
  applyPageBackdrop(main, skin, 'missing', document);
  assert.equal(main.pageBackdrop, false);
  assert.equal(value, 'none');
});
