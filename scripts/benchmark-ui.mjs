// pnpm dev 실행 후 사용한다. 게임 자료가 준비된 메뉴의 DOM 갱신·배치 조회를 계측한다.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5180/';
const output = process.argv[3];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
  await page.addInitScript(() => {
    localStorage.setItem('chii-drop:settings', JSON.stringify({ audioScaleVersion: 2, voice: false, music: false }));
    const bounds = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (...args) {
      if (window.uiBenchmark) window.uiBenchmark.layoutReads++;
      return bounds.apply(this, args);
    };
  });
  await page.goto(url);
  await page.getByRole('button', { name: '시작', exact: true }).click();
  await page.locator('#background-download[data-phase="complete"]').waitFor({ state: 'attached', timeout: 60000 });
  await page.locator('#background-download').waitFor({ state: 'hidden' });
  async function sample() {
    return page.evaluate(async () => {
      const counts = { layoutReads: 0, menuAttributes: 0, companionAttributes: 0, otherAttributes: 0 };
      window.uiBenchmark = counts;
      const observer = new MutationObserver(records => {
        for (const record of records) {
          const node = record.target;
          if (node.closest?.('.menu-companions')) counts.companionAttributes++;
          else if (node === document.body || node.closest?.('#mobile-controls') || node.id === 'screen-back' || node.id === 'game-menu-toggle') counts.menuAttributes++;
          else counts.otherAttributes++;
        }
      });
      observer.observe(document.body, { attributes: true, subtree: true });
      const intervals = [];
      await new Promise(resolve => {
        let previous;
        const frame = now => {
          if (previous !== undefined) intervals.push(now - previous);
          previous = now;
          if (intervals.length < 180) requestAnimationFrame(frame); else resolve();
        };
        requestAnimationFrame(frame);
      });
      observer.disconnect(); window.uiBenchmark = null;
      intervals.sort((a, b) => a - b);
      return { frames: intervals.length, ...counts, frameMs: { median: intervals[90], p95: intervals[171] } };
    });
  }
  const mainMenu = await sample();
  await page.getByRole('button', { name: '싱글플레이', exact: true }).click();
  await page.getByRole('button', { name: 'CPU 대전', exact: true }).click();
  const setup = await sample();
  const result = { viewport: '1280x720', browser: await browser.version(), mainMenu, setup };
  if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2) + '\n'); }
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
