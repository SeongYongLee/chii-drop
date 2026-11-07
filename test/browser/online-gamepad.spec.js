import { test, expect } from '@playwright/test';
import { INPUT } from '../../src/engine/input.js';
import { directionalMenuIndex } from '../../src/input/menu-navigation.js';

const directions = { up: 12, down: 13, left: 14, right: 15 };

async function pressPad(page, button) {
  await page.evaluate(async button => {
    const pad = window.testPad;
    const waitForPolls = async () => {
      const target = pad.polls + 5;
      while (pad.polls < target) await new Promise(requestAnimationFrame);
    };
    pad.button = button;
    await waitForPolls();
    pad.button = null;
    await waitForPolls();
  }, button);
}

async function focusWithPad(page, panel, target) {
  const { rects, from, to } = await panel.evaluate((panel, target) => {
    const root = panel.getRootNode();
    const controls = [...panel.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex="0"]')]
      .filter(element => !element.disabled && !element.matches('.skip-link, [aria-disabled=true]')
        && !element.closest('[hidden], [inert], dialog:not([open]), details:not([open]) > :not(summary)')
        && element.getClientRects().length && getComputedStyle(element).visibility === 'visible');
    return { from: controls.indexOf(root.activeElement), to: controls.indexOf(panel.querySelector(target)),
      rects: controls.map(element => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x: x + width / 2, y: y + height / 2, width, height };
      }) };
  }, target);
  expect(to, `${target} is a navigable control`).toBeGreaterThanOrEqual(0);
  const visited = new Set([from]);
  const queue = [{ index: from, steps: [] }];
  while (queue.length) {
    const { index, steps } = queue.shift();
    if (index === to) {
      for (const step of steps) await pressPad(page, directions[step]);
      await expect(panel.locator(target)).toBeFocused();
      return;
    }
    for (const direction of Object.keys(directions)) {
      const next = directionalMenuIndex(rects, index, direction);
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push({ index: next, steps: [...steps, direction] });
    }
  }
  throw new Error(`No gamepad navigation path to ${target}`);
}

test('온라인 로비와 경기 중 게임패드 설정을 저장하면 다음 경기 입력에 바로 반영된다', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'chromium', 'PC 조작 옵션 검증');
  await page.addInitScript(() => {
    const pad = window.testPad = { button: null, polls: 0 };
    Object.defineProperty(navigator, 'getGamepads', { value: () => {
      pad.polls++;
      return [{ index: 0, connected: true, axes: [0, 0], buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: index === pad.button })) }];
    } });
  });
  const guestContext = await browser.newContext({ serviceWorkers: 'block' });
  const guest = await guestContext.newPage();
  const inputs = [];
  page.on('websocket', socket => socket.on('framesent', ({ payload }) => {
    if (typeof payload !== 'string') return;
    const packet = JSON.parse(payload);
    if (packet.type === 'inputBatch') inputs.push(...packet.inputs);
    if (packet.type === 'input') inputs.push(packet.input);
  }));
  async function remapLeft(button, label) {
    const options = page.getByRole('dialog', { name: '조작 옵션' });
    await expect(options).toBeVisible();
    await focusWithPad(page, options, '[data-gamepad]');
    await pressPad(page, 0);
    const editor = page.getByRole('dialog', { name: '게임패드 버튼 설정' });
    await expect(editor).toBeVisible();
    const left = '.key-settings-rows button:first-child';
    await focusWithPad(page, editor, left);
    await pressPad(page, 0);
    await expect(editor.locator(left)).toContainText('버튼 입력 대기');
    await pressPad(page, button);
    await expect(editor.locator(left)).toContainText(label);
    await focusWithPad(page, editor, '[data-save]');
    await pressPad(page, 0);
    await expect(editor).toBeHidden();
    await expect(options.locator('[data-gamepad]')).toBeFocused();
    await pressPad(page, 1);
    await expect(options).toBeHidden();
  }
  async function expectLeftInput(button, expected) {
    const start = inputs.length;
    await pressPad(page, button);
    await expect.poll(() => inputs.length).toBeGreaterThan(start + 5);
    expect(inputs.slice(start).some(input => input & INPUT.LEFT)).toBe(expected);
  }
  try {
    await Promise.all([page.goto('/#online'), guest.goto('/#online')]);
    await page.getByRole('link', { name: /방 만들기/ }).click();
    await page.locator('#room-name').fill('게임패드 조작 검증');
    await page.locator('#create').click();
    await guest.getByRole('button', { name: '게임패드 조작 검증 참가', exact: true }).click();
    await expect(page.locator('#player-count')).toHaveText('2');
    await page.bringToFront();
    await focusWithPad(page, page.locator('.online-shell'), '#touch-options');
    await pressPad(page, 0);
    await remapLeft(6, 'LT / L2');

    await page.locator('#ready').click();
    await guest.locator('#ready').click();
    await page.locator('#confirm-character').click();
    await guest.locator('#confirm-character').click();
    await page.bringToFront();
    await expect.poll(() => inputs.length).toBeGreaterThan(12);
    await expectLeftInput(6, true);

    await pressPad(page, 9);
    const battle = page.locator('#battle-menu');
    await expect(battle).toHaveAttribute('open', '');
    await focusWithPad(page, battle, '#battle-options');
    await pressPad(page, 0);
    await remapLeft(7, 'RT / R2');
    await expect(page.locator('#online-mode #screen')).toBeFocused();
    await expectLeftInput(6, false);
    await expectLeftInput(7, true);
  } finally {
    await guestContext.close();
  }
});
