import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { musicTracks } from '../../src/audio/music-config.js';

const manifest = JSON.parse(readFileSync(new URL('../../skins/chiikawa/pages-runtime/manifest.json', import.meta.url)));
const base = '/skins/chiikawa/pages-runtime/';
const battleMusic = musicTracks(manifest.music.scenes.battle).map(track => `${base}${track.file}`);
test.use({ serviceWorkers: 'allow' });

// 실제 디코딩·재생은 유지하고 성공한 동작만 관찰한다.
function observeAudio() {
  Object.defineProperty(crypto, 'getRandomValues', { value: array => { array.fill(12345); return array; } });
  const probe = window.__runtimeAudio = { contexts: [], elements: [], decoded: 0, voices: 0, errors: [] };
  const decoded = new WeakSet();
  const prototype = (window.AudioContext || window.webkitAudioContext).prototype;
  const decode = prototype.decodeAudioData;
  prototype.decodeAudioData = function (...args) {
    return decode.apply(this, args).then(buffer => { decoded.add(buffer); probe.decoded++; return buffer; });
  };
  const create = prototype.createBufferSource;
  prototype.createBufferSource = function (...args) {
    if (!probe.contexts.includes(this)) probe.contexts.push(this);
    const source = create.apply(this, args), start = source.start;
    source.start = function (...values) {
      const result = start.apply(this, values);
      if (decoded.has(this.buffer)) probe.voices++;
      return result;
    };
    return source;
  };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    if (!probe.elements.includes(this)) {
      probe.elements.push(this);
      this.addEventListener('error', () => probe.errors.push({ src: this.src, code: this.error?.code }));
    }
    return play.apply(this, args);
  };
}

const audioState = page => page.evaluate(() => ({
  running: window.__runtimeAudio.contexts.some(context => context.state === 'running'),
  decoded: window.__runtimeAudio.decoded, voices: window.__runtimeAudio.voices,
  elements: window.__runtimeAudio.elements.map(audio => ({ src: new URL(audio.src).pathname,
    paused: audio.paused, time: audio.currentTime, muted: audio.muted })),
  errors: window.__runtimeAudio.errors,
}));

async function cacheEntries(page) {
  return page.evaluate(async () => {
    const cache = await caches.open(`chii-drop-media-v1:${new URL(navigator.serviceWorker.controller.scriptURL).pathname.replace(/asset-worker.js$/, '')}`);
    return (await cache.keys()).map(request => new URL(request.url).pathname);
  });
}

test('기본 음성·음악과 실제 서비스 워커: 지연 로딩·경기 전환·캐시 재접속·세대 갱신', async ({ page, request }, info) => {
  test.setTimeout(240000);
  const errors = [], revisions = [];
  page.on('response', response => {
    if (new URL(response.url()).pathname === `${base}manifest.json`) {
      void response.json().then(body => revisions.push(body.browserTestRevision)).catch(() => {});
    }
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(observeAudio);
  await request.post('/__test/media', { data: { delayMs: 80, reset: true, revision: 'generation-a' } });
  try {
    await page.goto('/');
    await expect(page.getByRole('button', { name: '시작', exact: true })).toBeVisible({ timeout: 60000 });
    await expect.poll(() => revisions.at(-1)).toBe('generation-a');
    const titleMs = await page.evaluate(() => performance.now());
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await expect(page.locator('#background-download')).toBeVisible();
    const clickedAt = Date.now();
    await page.getByRole('button', { name: '시작', exact: true }).click();
    await expect(page.getByRole('button', { name: '싱글플레이', exact: true })).toBeVisible();
    const menuMs = Date.now() - clickedAt;
    await expect(page.locator('#background-download')).toBeVisible();
    await expect.poll(async () => (await audioState(page)).running).toBe(true);
    await expect.poll(async () => (await audioState(page)).elements.some(audio => !audio.paused && audio.time > .05)).toBe(true);
    await expect(page.locator('[data-download-label]')).toHaveText('준비 완료', { timeout: 120000 });
    const downloadsMs = await page.evaluate(() => performance.now());
    expect((await audioState(page)).decoded).toBeGreaterThan(0);
    const voices = (await audioState(page)).voices;
    await page.getByRole('button', { name: /반응 보기/ }).first().click();
    await expect.poll(async () => (await audioState(page)).voices).toBeGreaterThan(voices);
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await page.getByRole('button', { name: /배경음악.*켬/ }).click();
    await expect.poll(async () => (await audioState(page)).elements.every(audio => audio.paused)).toBe(true);
    await page.getByRole('button', { name: /배경음악.*끔/ }).click();
    await expect.poll(async () => (await audioState(page)).elements.some(audio => !audio.paused && !audio.muted)).toBe(true);
    await page.getByRole('button', { name: /목소리.*켬/ }).click();
    await page.getByRole('button', { name: '뒤로', exact: true }).click();
    const mutedVoices = (await audioState(page)).voices;
    // 아직 반응하지 않은 캐릭터를 눌러 연속 반응 제한이 음소거 검사를 대신하지 않게 한다.
    await page.getByRole('button', { name: /반응 보기/ }).nth(1).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect((await audioState(page)).voices).toBe(mutedVoices);
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await page.getByRole('button', { name: /목소리.*끔/ }).click();
    await page.getByRole('button', { name: '뒤로', exact: true }).click();
    await page.getByRole('button', { name: /반응 보기/ }).nth(2).click();
    await expect.poll(async () => (await audioState(page)).voices).toBeGreaterThan(mutedVoices);
    await page.getByRole('button', { name: '싱글플레이', exact: true }).click();
    await page.getByRole('button', { name: 'CPU 대전', exact: true }).click();
    await page.getByRole('button', { name: '대전 시작', exact: true }).click();
    const next = page.getByRole('button', { name: '조작 방법 보기', exact: true });
    await expect(page.getByRole('heading', { name: '게임 방법', exact: true })).toBeVisible();
    if (await next.isVisible()) await next.click();
    await page.getByRole('button', { name: '확인하고 시작', exact: true }).click();
    await expect.poll(async () => (await audioState(page)).elements.some(audio =>
      battleMusic.includes(audio.src) && !audio.paused && audio.time > .05)).toBe(true);
    expect((await audioState(page)).errors).toEqual([]);

    // 전체 다운로드 후 미디어 원본 서버를 막아, 재접속이 실제 캐시에 의존하는지 확인한다.
    const entries = await cacheEntries(page);
    const image = entries.find(path => /\.(png|webp)$/.test(path));
    const music = (await audioState(page)).elements.find(audio => battleMusic.includes(audio.src)).src;
    expect(image).toBeTruthy();
    expect(entries).toContain(music);
    expect(entries.every(path => path.includes('/pages-runtime/assets/') || path === '/__media-generations__')).toBe(true);
    await request.post('/__test/media', { data: { offline: true, reset: true, revision: 'generation-b' } });
    const range = await page.evaluate(async url => {
      const response = await fetch(url, { headers: { Range: 'bytes=0-31' } });
      return { status: response.status, range: response.headers.get('Content-Range'), bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
    }, music);
    expect(range.status).toBe(206);
    expect(range.bytes).toEqual([...readFileSync(new URL(`../../${music.slice(1)}`, import.meta.url)).subarray(0, 32)]);
    expect(range.range).toMatch(/^bytes 0-31\/\d+$/);
    await page.reload();
    await expect(page.getByRole('button', { name: '시작', exact: true })).toBeVisible({ timeout: 60000 });
    await expect.poll(() => revisions.at(-1)).toBe('generation-b');
    const warmTitleMs = await page.evaluate(() => performance.now());
    await expect(page.locator('[data-download-label]')).toHaveText('준비 완료', { timeout: 120000 });
    const requests = await (await request.get('/__test/requests')).json();
    expect(Object.keys(requests).filter(path => path.startsWith(`${base}assets/`))).toEqual([]);
    expect(requests[`${base}manifest.json`]).toBeGreaterThan(0);
    expect(Object.keys(requests).some(path => new URL(path, 'http://localhost').pathname === '/src/app/main.js')).toBe(true);

    // 실제 캐시 저장소에서 3세대를 보내 현재·직전 보존 및 이전 세대 정리를 확인한다.
    const generations = (await cacheEntries(page)).filter(path => /\.(png|webp)$/.test(path)).slice(0, 3);
    expect(generations).toHaveLength(3);
    await request.post('/__test/media', { data: { offline: false } });
    for (const path of generations) {
      await page.evaluate(path => fetch(path).then(response => response.arrayBuffer()), path);
      await page.evaluate(path => navigator.serviceWorker.controller.postMessage({ type: 'retain-media', urls: [new URL(path, location.href).href] }), path);
      await expect.poll(async () => page.evaluate(async path => {
        const cache = await caches.open('chii-drop-media-v1:/');
        const list = await (await cache.match(new URL('__media-generations__', location.href).href)).json();
        return list[0]?.[0] === new URL(path, location.href).href;
      }, path)).toBe(true);
    }
    await expect.poll(() => cacheEntries(page)).not.toContain(generations[0]);
    expect(await cacheEntries(page)).toEqual(expect.arrayContaining(generations.slice(1)));
    const metricsPath = info.outputPath('runtime-metrics.json');
    await writeFile(metricsPath, JSON.stringify({ mediaRequestDelayMs: 80, titleMs, menuMs, downloadsMs, warmTitleMs }, null, 2));
    await info.attach('runtime-metrics.json', { path: metricsPath, contentType: 'application/json' });
    console.log(JSON.stringify({ project: info.project.name, titleMs, menuMs, downloadsMs, warmTitleMs }));
    expect(errors).toEqual([]);
  } finally { await request.post('/__test/media', { data: { reset: true } }); }
});
