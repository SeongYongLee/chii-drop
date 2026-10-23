import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { loadImageSkin } from '../src/view/skins/image-skin.js';

test('공개 캐릭터는 장면·표정과 무관하게 같은 보정과 고정 중심·바닥을 사용한다', async t => {
  const root = new URL('../skins/chiikawa/pages-runtime/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root)));
  const originalImage = globalThis.Image;
  globalThis.Image = class {
    set src(file) {
      const bytes = readFileSync(file);
      this.width = bytes.readUInt32BE(16); this.height = bytes.readUInt32BE(20);
      queueMicrotask(() => this.onload());
    }
  };
  t.after(() => { globalThis.Image = originalImage; });
  let data = manifest;
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => data }));
  const normalized = await loadImageSkin(root.pathname);
  data = structuredClone(manifest);
  for (const character of data.characters) delete character.portraitSizing;
  const original = await loadImageSkin(root.pathname);
  let call;
  const ctx = { drawImage: (...args) => { call = args.slice(5); } };
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
  for (const character of manifest.characters) {
    const { scale, baseline } = character.portraitSizing;
    assert.ok(Number.isFinite(scale) && scale > 0);
    assert.ok(baseline >= 0 && baseline <= 1);
    for (const mood of Object.keys(character.moods)) for (const frame of [0, 12, 60, 300]) {
      const motion = { frame, seed: 42, instance: 'comparison' };
      original.drawCharacter(ctx, character.id, mood, 10, 20, 100, motion);
      const [x, y, w, h] = call;
      for (const presentation of [undefined, 'selection', 'battle']) {
        normalized.drawCharacter(ctx, character.id, mood, 10, 20, 100, { ...motion, presentation });
        const [nx, ny, nw, nh] = call;
        close(nx, 60 + (x - 60) * scale);
        close(ny, 20 + 100 * baseline + (y - 20 - 100 * baseline) * scale);
        close(nw, w * scale); close(nh, h * scale);
      }
    }
  }
});
