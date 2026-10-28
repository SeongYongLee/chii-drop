import test from 'node:test';
import assert from 'node:assert/strict';
import { loadImageSkin, menuSkinManifest, skinImageFiles } from '../src/view/skins/image-skin.js';
import { withGameAssets } from '../src/app/game-assets.js';
import { createKeyboard } from '../src/input/keyboard.js';

test('메뉴 자료를 먼저 준비하고 선택한 캐릭터는 다른 캐릭터 다운로드와 무관하게 경기 준비를 마친다', async t => {
  const manifest = { titleArt: 'title.png', backgrounds: { menu: 'menu.png', game: 'game.png' },
    characters: [
      { id: 'a', moods: { idle: 'a.png', happy: { file: 'a.png', fieldAction: { file: 'field.png' } }, chain1: 'chain.png' } },
      { id: 'b', moods: { idle: 'b.png', chain1: 'other.png' } },
      { id: 'hidden', selectable: false, selectionVisible: false, moods: { idle: 'hidden.png' } },
    ], mascot: { moods: { idle: 'mascot.png' } },
  };
  const requests = [], delayed = [];
  const previous = globalThis.Image;
  globalThis.Image = class {
    width = 100; height = 100;
    set src(file) {
      this.url = file; requests.push(file);
      if (file.endsWith('other.png') || file.endsWith('hidden.png')) delayed.push(() => this.onload?.());
      else queueMicrotask(() => this.onload?.());
    }
  };
  t.after(() => { globalThis.Image = previous; });
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => manifest }));
  const initial = skinImageFiles(menuSkinManifest(manifest));
  assert.ok(initial.includes('mascot.png'));
  for (const file of ['game.png', 'chain.png', 'field.png', 'hidden.png']) assert.ok(!initial.includes(file));
  const skin = await loadImageSkin('skin', { progressive: true });
  assert.deepEqual(new Set(requests), new Set(initial.map(file => `skin/${file}`)));
  const all = skin.preloadAll();
  await skin.preloadCharacters(['a']);
  const progress = skin.gameAssetProgress(['a']);
  assert.equal(progress.completed, progress.total);
  const draws = [];
  skin.drawCharacter({ drawImage: image => draws.push(image.url) }, 'a', 'happy', 0, 0, 100, { presentation: 'field' });
  assert.deepEqual(draws, ['skin/field.png'], '이미 열린 스킨에서 새 경기 동작을 사용한다');
  assert.equal(requests.filter(file => file.endsWith('a.png')).length, 1, '메뉴 시트를 중복 요청하지 않는다');
  // 다른 캐릭터는 아직 기다리고 있어도 선택한 캐릭터의 준비는 끝났다.
  await new Promise(resolve => setTimeout(resolve, 5));
  delayed.forEach(finish => finish());
  await all;
});

test('경기 자료 실패는 재시도할 수 있고 취소한 준비가 뒤늦게 경기를 시작하지 않는다', async () => {
  const background = { draw() {} }, pending = [];
  let launches = 0;
  const app = { keyboard: createKeyboard(), scene: background,
    setScene(scene) { this.scene = scene; },
    skin: { gameAssetProgress: () => ({ completed: 1, total: 2 }),
      preloadCharacters: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    },
  };
  const options = { characters: [{ id: 'a' }], background, next: () => launches++ };
  const waiting = withGameAssets(app, options);
  assert.equal(launches, 0);
  pending.shift().reject(new Error('offline'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(waiting.touchItems()[0].label, '다시 시도');
  waiting.touchItems()[0].activate();
  waiting.back();
  pending.shift().resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.scene, background); assert.equal(launches, 0);
  withGameAssets(app, options);
  pending.shift().resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(launches, 1);
});
