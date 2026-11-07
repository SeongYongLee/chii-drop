import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { test, expect } from '@playwright/test';
import { createOnlineServer } from '../../server/index.js';
import { createFeedbackStore } from '../../server/feedback.js';

const password = 'browser-test-only-inbox-password';

test.use({ httpCredentials: { username: 'operator', password } });

test('의견 삭제 확인창에서 취소하면 유지하고 확인하면 선택한 의견만 삭제한다', async ({ page }) => {
  const db = new DatabaseSync(':memory:');
  const feedback = createFeedbackStore((query, ...params) => db.prepare(query).all(...params));
  const { server, wss } = createOnlineServer({ feedback, feedbackPassword: password });
  try {
    feedback.save({ id: '1'.repeat(32), category: 'idea', message: '삭제할 검증용 의견' });
    feedback.save({ id: '2'.repeat(32), category: 'idea', message: '남겨 둘 검증용 의견' });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    await page.goto(`http://127.0.0.1:${server.address().port}/feedback/inbox`);
    const target = page.locator('article').filter({ hasText: '삭제할 검증용 의견' });
    const button = target.getByRole('button', { name: '의견 삭제' });
    const dismissed = page.waitForEvent('dialog').then(async dialog => {
      expect(dialog.message()).toContain('이 의견을 삭제할까요?');
      await dialog.dismiss();
    });
    await Promise.all([dismissed, button.click()]);
    await page.reload();
    await expect(target).toBeVisible();

    const accepted = page.waitForEvent('dialog').then(dialog => dialog.accept());
    await Promise.all([accepted, button.click()]);
    await expect(target).toHaveCount(0);
    await expect(page.getByText('남겨 둘 검증용 의견')).toBeVisible();
  } finally {
    wss.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    db.close();
  }
});
