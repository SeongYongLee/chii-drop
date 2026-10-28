import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAssetJson } from '../src/app/asset-request.js';
import { loadAudioBuffer } from '../src/audio/buffer-loader.js';
import { createImageLoader } from '../src/view/skins/image-loader.js';

test('요청·본문 시간 초과를 중단하고 다음 요청은 정상적으로 재시도한다', async t => {
  let signal;
  t.mock.method(globalThis, 'fetch', async (_, options) => { signal = options.signal; return new Promise(() => {}); });
  await assert.rejects(fetchAssetJson('manifest', {}, 5), { name: 'TimeoutError' });
  assert.equal(signal.aborted, true);
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: () => new Promise(() => {}) }));
  await assert.rejects(fetchAssetJson('manifest', {}, 5), { name: 'TimeoutError' });
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ ready: true }) }));
  assert.deepEqual(await fetchAssetJson('manifest', {}, 50), { ready: true });
});

test('음성 디코딩·이미지 응답이 멈춰도 대기열이 풀리고 실패 이미지는 다시 준비할 수 있다', async t => {
  t.mock.method(globalThis, 'fetch', async file => ({ ok: true, arrayBuffer: async () => file }));
  const context = { decodeAudioData: file => file === 'stalled' ? new Promise(() => {}) : Promise.resolve(file) };
  await Promise.all([
    assert.rejects(loadAudioBuffer(context, 'stalled', { timeoutMs: 5 }), { name: 'TimeoutError' }),
    loadAudioBuffer(context, 'a'), loadAudioBuffer(context, 'b'),
  ]);
  assert.equal(await loadAudioBuffer(context, 'after'), 'after');
  const original = globalThis.Image;
  let stalled = true;
  globalThis.Image = class { set src(file) { if (!file.endsWith('/stalled') || !stalled) queueMicrotask(() => this.onload?.()); } };
  t.after(() => { globalThis.Image = original; });
  const load = createImageLoader('skin', undefined, { timeoutMs: 5 });
  const images = await Promise.all([load('stalled'), load('a'), load('b')]);
  assert.equal(images[0], null); assert.ok(images[1]); assert.ok(images[2]);
  stalled = false; load.retryFailures(); assert.ok(await load('stalled'));
});
