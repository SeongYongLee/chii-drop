import assert from 'node:assert/strict';
import { test } from 'node:test';

// 느린 이미지 요청 중에는 캐릭터를 그리지 않고 준비가 끝난 뒤 첫 타이틀을 그린다.
test('스프라이트 로딩 전에는 안내만 표시하고 첫 타이틀부터 이미지 스킨을 쓴다', async () => {
  const previous = Object.fromEntries(['window', 'document', 'fetch', 'Image', 'requestAnimationFrame'].map((key) => [key, globalThis[key]]));
  const texts = [], images = [], frames = [];
  const ctx = new Proxy({
    fillText: (text) => texts.push(text),
    drawImage: (...args) => images.push(args),
    createLinearGradient: () => ({ addColorStop() {} }),
  }, { get: (o, k) => o[k] ?? (() => {}) });
  let finishImage, imageRequested;
  const requested = new Promise((resolve) => { imageRequested = resolve; });
  const ready = new Promise((resolve) => { finishImage = resolve; });
  globalThis.window = {
    devicePixelRatio: 1, addEventListener() {},
    localStorage: { getItem: (key) => key.endsWith(':settings') ? JSON.stringify({ skin: 'chiikawa' }) : null },
  };
  globalThis.document = { addEventListener() {}, getElementById: () => ({ getContext: () => ctx }) };
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    return url.endsWith('characters.json') ? { ok: true, json: async () => ({ characters: {} }) } : {
    ok: true, json: async () => ({ id: 'chiikawa', branding: { title: '테스트 게임', subtitle: '시작 검증' }, characters: [
      { id: 'sample', moods: { happy: 'current.png' } },
    ] }),
    };
  };
  globalThis.Image = class {
    width = 512; height = 512;
    set src(value) { this.url = value; imageRequested(); ready.then(() => this.onload()); }
  };
  globalThis.requestAnimationFrame = (frame) => frames.push(frame);
  try {
    const boot = import('../src/app/main.js?startup-test');
    await requested;
    assert.ok(texts.includes('불러오는 중…'));
    assert.equal(images.length, 0);
    assert.equal(frames.length, 0);
    finishImage();
    await boot;
    assert.equal(frames.length, 1);
    frames.shift()(performance.now());
    assert.ok(texts.includes('테스트 게임'));
    assert.equal(document.title, '테스트 게임 — 시작 검증');
    assert.equal(images.length, 1);
    assert.ok(requests.some(url => url.endsWith('characters.json')));
    assert.ok(!requests.some(url => url.endsWith('story.json')));
    assert.ok(images[0][0].url.endsWith('/current.png'));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
