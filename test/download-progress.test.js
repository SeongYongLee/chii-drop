import test from 'node:test';
import assert from 'node:assert/strict';
import { createDownloadIndicator, createDownloadProgress } from '../src/app/download-progress.js';

test('이미지·음성의 중복 완료와 실패를 구분하고 재시도 후 실제 성공만 100%로 센다', () => {
  const progress = createDownloadProgress();
  progress.complete('image:menu');
  progress.plan(['image:menu', 'image:game', 'voice:line', 'voice:line']);
  assert.equal(progress.state().phase, 'idle');
  progress.start();
  assert.equal(progress.state().percent, 33);
  progress.complete('image:game', false);
  assert.equal(progress.state().phase, 'loading');
  progress.complete('voice:line'); progress.complete('voice:line');
  assert.deepEqual(progress.state(), { started: true, total: 3, completed: 2, failed: 1,
    remaining: 0, phase: 'failed', percent: 66 });
  progress.retry();
  assert.equal(progress.state().phase, 'loading');
  progress.complete('image:game');
  assert.equal(progress.state().phase, 'complete');
  assert.equal(progress.state().percent, 100);
  progress.plan(['image:menu', 'image:game', 'voice:new']);
  progress.settle();
  assert.equal(progress.state().failed, 1, '요청되지 못한 자식 자료도 무한 대기로 남기지 않는다');
  progress.plan(['image:menu', 'image:game']);
  assert.equal(progress.state().phase, 'complete', '목소리 끄기는 해당 음성 항목을 제외한다');
});

test('작은 표시는 경기 중 숨고 완료 후 사라지며 실패 시 재시도를 제공한다', () => {
  const parts = new Map(['label', 'percent', 'bar', 'retry', 'announcement'].map(name => [
    `[data-download-${name}]`, { textContent: '', hidden: false, events: {}, addEventListener(type, callback) { this.events[type] = callback; } },
  ]));
  const root = { dataset: {}, hidden: true, querySelector: selector => parts.get(selector) };
  const timers = new Set(); let retries = 0;
  const ui = createDownloadIndicator({ getElementById: () => root }, {
    onRetry: () => retries++, schedule: callback => { timers.add(callback); return callback; }, cancel: callback => timers.delete(callback),
  });
  const progress = createDownloadProgress(state => ui.update(state));
  progress.plan(['image:a', 'voice:b']);
  assert.equal(root.hidden, true);
  progress.start(); progress.complete('image:a');
  assert.equal(root.hidden, false);
  assert.equal(parts.get('[data-download-percent]').textContent, '50%');
  assert.equal(parts.get('[data-download-bar]').value, 50);
  ui.setVisible(false); assert.equal(root.hidden, true);
  progress.complete('voice:b', false);
  ui.setVisible(true);
  assert.equal(root.hidden, false);
  const retry = parts.get('[data-download-retry]');
  assert.equal(retry.hidden, false); retry.events.click(); assert.equal(retries, 1);
  let stopped = false; retry.events.keydown({ stopPropagation() { stopped = true; } }); assert.equal(stopped, true);
  progress.retry(); assert.equal(retry.hidden, true);
  progress.complete('voice:b');
  assert.equal(parts.get('[data-download-label]').textContent, '준비 완료');
  assert.equal(root.hidden, false);
  assert.equal(timers.size, 1);
  [...timers][0]();
  assert.equal(root.hidden, true);
  ui.setVisible(false); ui.setVisible(true); assert.equal(root.hidden, true, '메뉴 복귀 시 완료 알림이 되살아나지 않는다');
});
