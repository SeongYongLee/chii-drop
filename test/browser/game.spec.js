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
  const step = page.getByRole('button', { name: '다음 설명', exact: true });
  for (let i = 0; i < 2 && await step.isVisible(); i++) await step.click();
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

const shortViewport = { top: 24, height: 260 };

async function setShortLandscape(page) {
  await page.setViewportSize({ width: 667, height: 320 });
  await page.addInitScript(({ top, height }) => {
    const viewport = window.visualViewport;
    const getHeight = Object.getOwnPropertyDescriptor(VisualViewport.prototype, 'height').get;
    Object.defineProperties(viewport, {
      height: { get: () => innerWidth > innerHeight ? height : getHeight.call(viewport) },
      offsetTop: { get: () => innerWidth > innerHeight ? top : 0 },
    });
  }, shortViewport);
}

async function shortLandscape(page) {
  await setShortLandscape(page);
  await page.goto('/');
  await title(page);
  await expect.poll(() => page.locator('body').evaluate(element => {
    const { top, height } = element.getBoundingClientRect();
    return { top, height };
  })).toEqual(shortViewport);
  await landscapeClick(menuButton(page, '시작'));
}

const menuButton = (page, name) => page.getByRole('button', { name, exact: typeof name === 'string' });
async function landscapeVisible(locator) {
  await expect(async () => {
    await locator.scrollIntoViewIfNeeded({ timeout: 1000 });
    await expect(locator).toBeInViewport({ ratio: .98, timeout: 1000 });
    const box = await locator.boundingBox();
    expect(box.y, 'top of visible viewport').toBeGreaterThanOrEqual(shortViewport.top - 1);
    expect(box.y + box.height, 'bottom of visible viewport').toBeLessThanOrEqual(shortViewport.top + shortViewport.height + 1);
  }).toPass({ timeout: 6000 });
}
async function landscapeClick(locator) {
  await landscapeVisible(locator);
  await locator.click({ timeout: 5000 });
}

test.describe('상태바가 있는 가로 메뉴', () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== 'webkit-mobile');
    await shortLandscape(page);
  });

  test('설정, 음량, 터치 편집, 키 설정', async ({ page }) => {
    await landscapeClick(menuButton(page, '설정'));
    for (const name of [/효과음/, /배경음악/, /목소리/, /착지 위치 표시/]) {
      await landscapeClick(menuButton(page, name));
    }
    await landscapeClick(menuButton(page, '음량 조절'));
    for (const name of ['전체', '효과음', '배경음악', '목소리']) {
      await landscapeVisible(menuButton(page, new RegExp(`^${name} ·`)));
      await landscapeClick(menuButton(page, `${name} 늘리기`));
    }
    await landscapeClick(menuButton(page, '뒤로'));
    await landscapeClick(menuButton(page, '조작 설정'));
    for (const name of ['터치 영역 편집', '키보드 키 설정', '게임패드 버튼 설정']) {
      await landscapeClick(menuButton(page, name));
      const dialog = page.getByRole('dialog', { name });
      await landscapeVisible(dialog.getByRole('heading', { name }));
      await landscapeVisible(menuButton(dialog, '저장'));
      await landscapeClick(menuButton(dialog, '취소'));
    }
    await landscapeClick(menuButton(page, '뒤로'));
    await landscapeClick(menuButton(page, '뒤로'));
    await landscapeClick(menuButton(page, '의견 보내기'));
    const feedback = page.getByRole('dialog', { name: '의견 보내기' });
    await landscapeVisible(feedback.getByRole('textbox'));
    await landscapeClick(menuButton(feedback, '닫기'));
  });

  test('기록과 게임 방법', async ({ page }) => {
    await landscapeClick(menuButton(page, '기록'));
    await landscapeVisible(page.locator('.records-practice').getByText(/최고 점수/));
    await landscapeVisible(page.getByRole('rowheader', { name: '쉬움', exact: true }));
    await landscapeVisible(page.locator('.records-table tbody th').last());
    await landscapeClick(menuButton(page, '뒤로'));
    await landscapeClick(menuButton(page, '게임 방법'));
    const guide = page.getByRole('dialog', { name: '게임 방법' });
    for (const label of ['연결', '연쇄', '공격·상쇄', '조작 방법 보기']) {
      await landscapeClick(menuButton(guide, label));
    }
    await landscapeVisible(guide.getByText('일시정지 버튼', { exact: true }));
    await landscapeClick(menuButton(guide, '닫기'));
  });

  test('싱글 모드와 로컬 2인 설정', async ({ page }) => {
    await landscapeClick(menuButton(page, '싱글플레이'));
    const story = menuButton(page, '스토리 · 준비 중');
    await landscapeVisible(story);
    await expect(story).toBeDisabled();
    for (const mode of ['CPU 대전', 'CPU 관전', '연습']) {
      await landscapeClick(menuButton(page, mode));
      await landscapeVisible(page.locator('.setup-start-button'));
      await landscapeClick(menuButton(page, '뒤로'));
    }
    await landscapeClick(menuButton(page, '뒤로'));
    await landscapeClick(menuButton(page, '멀티플레이'));
    await landscapeClick(menuButton(page, '로컬 대전'));
    const players = page.locator('.setup-player-card');
    await expect(players).toHaveCount(2);
    for (const player of await players.all()) {
      await landscapeClick(player.locator('[data-setup-choice]').first());
      const dialog = page.locator('.setup-choice-dialog[open]');
      await landscapeVisible(dialog.locator('.setup-choice-list button').first());
      await landscapeClick(menuButton(dialog, '닫기'));
    }
    await landscapeClick(page.locator('.setup-start-button'));
    await landscapeClick(menuButton(page, '조작 방법'));
    await landscapeClick(menuButton(page, '확인하고 시작'));
    await landscapeClick(menuButton(page, '대전 메뉴'));
    await landscapeClick(menuButton(page, '계속하기'));
  });

  test('온라인 로비, 프로필, 랭킹, 참가, 대기실과 대전 메뉴', async ({ page, browser }) => {
    await landscapeClick(menuButton(page, '멀티플레이'));
    await landscapeClick(menuButton(page, '온라인 대전'));
    await expect(page.locator('.online-shell')).toHaveAttribute('data-connected', 'true');
    await landscapeVisible(page.locator('#online-menu-title'));
    await page.setViewportSize({ width: 568, height: 320 });
    await landscapeClick(page.locator('.profile-edit summary'));
    await landscapeVisible(page.locator('#nickname'));
    await landscapeVisible(page.locator('#rename'));
    await landscapeClick(page.locator('#close-profile'));
    await landscapeClick(page.locator('#tab-rankings'));
    await landscapeVisible(page.locator('#rankings .empty strong'));
    await landscapeClick(page.locator('#tab-play'));
    await landscapeClick(page.locator('#open-code'));
    await landscapeVisible(page.locator('#code'));
    await landscapeVisible(page.locator('#join'));
    await landscapeClick(page.locator('#close-code'));
    await landscapeClick(page.locator('#touch-options'));
    await landscapeVisible(page.locator('#touch-lift'));
    await landscapeClick(page.locator('#close-touch-options'));
    await landscapeClick(page.getByRole('link', { name: /방 만들기/ }));
    await landscapeVisible(page.locator('#room-password'));
    await landscapeClick(page.locator('#create'));
    await landscapeVisible(page.locator('#room-code'));
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined }));
    await landscapeClick(page.locator('#copy-room-link'));
    await landscapeVisible(page.locator('#share-value'));
    await landscapeClick(page.locator('#close-share'));
    await landscapeVisible(page.locator('#ready'));
    await landscapeClick(page.locator('#watch-instead'));
    await landscapeVisible(page.locator('#take-seat'));
    await landscapeClick(page.locator('#take-seat'));
    await landscapeVisible(page.locator('#chat-input'));
    await landscapeVisible(page.locator('#chat-send'));
    await landscapeClick(page.locator('#room-game-guide'));
    const guide = page.getByRole('dialog', { name: '게임 방법' });
    await landscapeClick(menuButton(guide, '조작 방법'));
    await landscapeClick(menuButton(guide, '닫기'));
    await landscapeClick(page.locator('#online-back'));

    const guest = await browser.newPage({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
    try {
      await guest.addInitScript(seedBrowser);
      await guest.goto('/#online');
      await guest.getByRole('link', { name: /방 만들기/ }).click();
      await guest.locator('#room-name').fill('가로 모드 검증');
      await guest.locator('#room-password').fill('layout');
      await guest.locator('#create').click();
      await landscapeClick(menuButton(page, '가로 모드 검증 비밀번호로 참가'));
      await landscapeVisible(page.locator('#password-value'));
      await page.locator('#password-value').fill('layout');
      await landscapeClick(page.locator('#password-join'));
      await guest.locator('#ready').click();
      await landscapeClick(page.locator('#ready'));
      await landscapeVisible(page.locator('#character-options button').first());
      await landscapeVisible(page.locator('#cancel-character'));
      const invitee = await browser.newPage({ isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      try {
        await setShortLandscape(invitee);
        await invitee.addInitScript(seedBrowser);
        const code = await page.locator('#room-code').textContent();
        await invitee.goto(`/index.html?room=${code}#play`);
        await expect(invitee.locator('#invite-choice-dialog')).toBeVisible();
        await landscapeVisible(invitee.locator('#invite-watch'));
        await landscapeClick(invitee.locator('#invite-cancel'));
      } finally {
        await invitee.close();
      }
      await landscapeClick(page.locator('#confirm-character'));
      await guest.locator('#confirm-character').click();
      await expect(page.locator('.online-shell')).toHaveAttribute('data-playing', 'true');
      await landscapeClick(page.locator('#battle-menu summary[aria-label="대전 메뉴"]'));
      await landscapeClick(page.locator('#battle-options'));
      await landscapeVisible(page.locator('#touch-lift'));
      await landscapeClick(page.locator('#close-touch-options'));
    } finally {
      await guest.close();
    }
  });
});

test('좁은 가로 화면에서도 메뉴를 열고 세로 조작 안내를 읽을 수 있다', async ({ page }, info) => {
  test.skip(info.project.name !== 'webkit-mobile');
  await shortLandscape(page);
  await page.getByRole('button', { name: '싱글플레이', exact: true }).click();
  await page.getByRole('button', { name: 'CPU 대전', exact: true }).click();
  await page.getByRole('button', { name: '대전 시작', exact: true }).click();

  await page.setViewportSize({ width: 320, height: 480 });
  const guide = page.getByRole('dialog', { name: '게임 방법' });
  await guide.getByRole('button', { name: '공격·상쇄', exact: true }).click();
  await guide.getByRole('button', { name: '조작 방법 보기', exact: true }).click();
  await expect(guide).toBeInViewport({ ratio: 1 });
  await expect(guide.getByRole('heading', { name: '양손으로 터치하세요' })).toBeInViewport({ ratio: 1 });
  await expect(guide.getByRole('button', { name: '확인하고 시작' })).toBeInViewport({ ratio: 1 });
  const content = guide.locator('.game-guide-content');
  expect(await content.evaluate(element => element.scrollWidth)).toBe(await content.evaluate(element => element.clientWidth));
  await guide.getByText('일시정지 버튼', { exact: true }).scrollIntoViewIfNeeded();
  await expect(guide.getByText('일시정지 버튼', { exact: true })).toBeInViewport({ ratio: 1 });
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
    await page.locator('#confirm-character').click();
    await guest.locator('#confirm-character').click();
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
