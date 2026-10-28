import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { menuSkinManifest, skinImageFiles } from '../../src/view/skins/image-skin.js';

const manifest = JSON.parse(readFileSync(new URL('../../skins/chiikawa/pages-runtime/manifest.json', import.meta.url)));
const menuFiles = new Set(skinImageFiles(menuSkinManifest(manifest)));
const deferredImage = skinImageFiles(manifest).find(file => !menuFiles.has(file));
const seedBrowser = () => {
  localStorage.setItem('chii-drop:settings', JSON.stringify({ audioScaleVersion: 2, voice: false, music: false }));
  Object.defineProperty(crypto, 'getRandomValues', { value: array => { array.fill(12345); return array; } });
};
let errors;
test.beforeEach(async ({ page }) => {
  errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(seedBrowser);
});
test.afterEach(() => { expect(errors).toEqual([]); });

async function title(page) {
  await expect(page.getByRole('button', { name: '시작', exact: true })).toBeVisible();
  await expect(page.locator('#loading-screen')).toBeHidden();
}
async function controls(page) {
  await expect(page.getByRole('heading', { name: '게임 방법', exact: true })).toBeVisible();
  const next = page.getByRole('button', { name: '조작 방법 보기', exact: true });
  if (await next.isVisible()) await next.click();
  await page.getByRole('button', { name: '확인하고 시작', exact: true }).click();
}

test('첫 로딩 실패·재시도와 메뉴를 막지 않는 백그라운드 진행·복구', async ({ page }, info) => {
  let failManifest = true, release;
  await page.route('**/pages-runtime/manifest.json', route => {
    if (failManifest) { failManifest = false; return route.fulfill({ status: 503, body: 'retry test' }); }
    return route.continue();
  });
  let failImage = true;
  const blocked = new Promise(resolve => { release = resolve; });
  await page.route(`**/pages-runtime/${deferredImage}`, async route => {
    if (failImage) { failImage = false; await blocked; return route.fulfill({ status: 503, body: 'retry test' }); }
    return route.continue();
  });
  await page.goto('/');
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await title(page);
  await expect(page.locator('#background-download')).toBeVisible();
  await page.getByRole('button', { name: '시작', exact: true }).click();
  await expect(page.getByRole('button', { name: '싱글플레이', exact: true })).toBeEnabled();
  const companion = page.getByRole('button', { name: /반응 보기/ }).first();
  await expect(companion).toBeVisible();
  await companion.click();
  await page.screenshot({ path: info.outputPath('background-progress.png') });
  release();
  await page.getByRole('button', { name: '재시도', exact: true }).click();
  await expect(page.locator('[data-download-label]')).toHaveText('준비 완료');
  await expect(page.locator('#background-download')).toBeHidden();
});

test('손상 기록 복구와 CPU 경기·일시정지·화면 회전·결과 복귀', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('chii-drop:records', JSON.stringify({ cpu: { normal: null } })));
  await page.goto('/'); await title(page);
  await page.getByRole('button', { name: '시작', exact: true }).click();
  await page.getByRole('button', { name: '기록', exact: true }).click();
  const normalRecord = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: '쉬움', exact: true }) });
  await expect(normalRecord.getByRole('cell').nth(0)).toHaveText('0');
  await expect(normalRecord.getByRole('cell').nth(1)).toHaveText('0');
  await page.getByRole('button', { name: '뒤로', exact: true }).click();
  await page.getByRole('button', { name: '싱글플레이', exact: true }).click();
  await page.getByRole('button', { name: 'CPU 대전', exact: true }).click();
  await expect(page.getByRole('button', { name: '대전 시작', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '대전 시작', exact: true }).click();
  await expect(page.getByRole('heading', { name: '게임 방법', exact: true })).toBeVisible();
  await controls(page);
  await page.getByRole('button', { name: '대전 메뉴', exact: true }).click();
  await expect(page.getByRole('heading', { name: '일시정지', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '계속하기', exact: true }).click();
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const canvas = page.locator('#screen');
    await expect(canvas).toBeInViewport({ ratio: 1 });
    await expect.poll(async () => {
      return canvas.evaluate((element, portrait) => {
        const box = element.getBoundingClientRect();
        return box.width >= 250 && box.height >= 140 && element.portraitScreen === portrait &&
          (portrait ? box.height > box.width : Math.abs(box.width / box.height - 16 / 9) < 0.02);
      }, viewport.height > viewport.width);
    }, { message: '회전 후 경기장은 충분한 크기로 세로·가로 전용 배치를 적용해야 한다' }).toBe(true);
    const buttons = page.locator('[data-mobile-game] button');
    await expect(buttons).toHaveCount(6);
    for (const button of await buttons.all()) {
      await expect(button).toBeInViewport({ ratio: 1 });
      await expect(button).toBeEnabled();
      const box = await button.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath('battle-landscape.png') });
  await page.keyboard.down('ArrowDown');
  await expect(page.getByRole('button', { name: '메인메뉴', exact: true })).toBeVisible({ timeout: 45000 });
  await page.keyboard.up('ArrowDown');
  await page.getByRole('button', { name: '메인메뉴', exact: true }).click();
  await expect(page.getByRole('heading', { name: '메인 메뉴', exact: true })).toBeVisible();
});

test('두 브라우저의 실제 온라인 대전은 접속이 끊겨도 같은 경기를 복구한다', async ({ page, browser, request }, info) => {
  const guestContext = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 720 } });
  await guestContext.addInitScript(seedBrowser);
  const guest = await guestContext.newPage(); guest.on('pageerror', error => errors.push(error.message));
  const connections = [page, guest].map(client => {
    const counts = { created: 0, closed: 0 };
    client.on('websocket', socket => {
      if (new URL(socket.url()).pathname !== '/socket') return;
      counts.created++;
      socket.on('close', () => counts.closed++);
    });
    return counts;
  });
  try {
    await Promise.all([page.goto('/#online'), guest.goto('/#online')]);
    await expect(page.locator('.online-shell')).toHaveAttribute('data-connected', 'true');
    await expect(guest.locator('.online-shell')).toHaveAttribute('data-connected', 'true');
    await page.getByRole('link', { name: /방 만들기/ }).click();
    const name = `회귀 ${info.project.name}`;
    await page.locator('#room-name').fill(name);
    await page.locator('#create').click();
    await guest.getByRole('button', { name: `${name} 참가`, exact: true }).click();
    await expect(page.locator('#player-count')).toHaveText('2');
    const code = await page.locator('#room-code').textContent();
    await page.locator('#ready').click(); await guest.locator('#ready').click();
    await page.locator('#confirm-character').click(); await controls(page);
    await guest.locator('#confirm-character').click(); await controls(guest);
    await expect(page.locator('.online-shell')).toHaveAttribute('data-playing', 'true');
    await expect(guest.locator('.online-shell')).toHaveAttribute('data-playing', 'true');
    const room = async () => (await (await request.get('/__test/rooms')).json()).find(entry => entry.code === code);
    await expect.poll(async () => (await room()).frame).toBeGreaterThan(30);
    const before = await room();
    const previousConnections = connections.map(counts => ({ ...counts }));
    expect((await request.post('/__test/disconnect')).status()).toBe(204);
    for (let index = 0; index < connections.length; index++) {
      await expect.poll(() => connections[index].closed,
        { message: `${index + 1}P의 기존 소켓이 실제로 종료되어야 한다` }).toBeGreaterThan(previousConnections[index].closed);
      await expect.poll(() => connections[index].created,
        { message: `${index + 1}P가 새 소켓으로 재접속해야 한다` }).toBeGreaterThan(previousConnections[index].created);
    }
    await expect.poll(async () => (await room()).frame, { timeout: 30000 }).toBeGreaterThan(before.frame + 60);
    const after = await room();
    expect(after.matchId).toBe(before.matchId); expect(after.paused).toBe(false); expect(after.players).toBe(2);
    await expect(page.locator('.online-shell')).toHaveAttribute('data-connected', 'true');
    await expect(guest.locator('.online-shell')).toHaveAttribute('data-connected', 'true');
    await page.screenshot({ path: info.outputPath('online-reconnected.png') });
  } finally { await guestContext.close(); }
});
