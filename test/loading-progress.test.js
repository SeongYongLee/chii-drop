import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoadingProgress, createLoadingScreen } from '../src/app/loading-progress.js';
import { skinImageFiles } from '../src/view/skins/image-skin.js';

test('자료 목록이 확정된 뒤 고유 이미지·소리의 실제 완료 수와 남은 수를 센다', () => {
  const updates = [], progress = createLoadingProgress(state => updates.push(state));
  progress.complete('characters');
  assert.equal(progress.state().planned, false);
  progress.complete('effect:early'); // 로딩 중 사용자가 소리 장치를 먼저 시작한 경우
  progress.plan(['image:sheet', 'image:sheet', 'voice:line', 'effect:early']);
  progress.complete('manifest');
  assert.deepEqual([progress.state().completed, progress.state().total, progress.state().remaining], [3, 5, 2]);
  assert.equal(progress.state().percent, 60);
  progress.complete('image:sheet'); progress.complete('image:sheet');
  assert.equal(progress.state().completed, 4);
  assert.match(progress.state().stage, /음성/);
  progress.finish(); assert.equal(progress.state().ready, false); assert.equal(progress.state().percent, 80);
  progress.complete('voice:line', false);
  assert.equal(progress.state().failed, 1); assert.equal(progress.state().remaining, 0);
  assert.equal(progress.state().percent, 99);
  progress.finish(); assert.equal(updates.at(-1).percent, 100);
});

test('같은 시트·기분 이미지와 별도 프레임 이미지를 한 번만 세고 실패한 부모 이미지의 자식도 정리한다', () => {
  const files = skinImageFiles({ blobs: { 1: 'sheet' }, background: 'background', backgrounds: { title: 'background' },
    characters: [{ moods: { idle: { file: 'sheet', frames: [{ file: 'frame' }, { duration: 3 }] }, happy: 'sheet' } }] });
  assert.deepEqual(files, ['sheet', 'background', 'frame']);
  const progress = createLoadingProgress(); progress.plan(files.map(file => `image:${file}`));
  progress.complete('image:sheet', false); progress.complete('image:background'); progress.settleGroup('image:');
  assert.equal(progress.state().failed, 2);
  progress.complete('manifest'); progress.complete('characters'); progress.finish();
  assert.equal(progress.state().remaining, 0); assert.equal(progress.state().percent, 100);
});

test('화면은 목록 확인 중에는 불확정 진행 막대를 유지하고 실패 문구를 늦은 소리 완료로 덮지 않는다', () => {
  const parts = new Map(['stage', 'bar', 'percent', 'detail'].map(id => [`[data-loading-${id}]`, { textContent: '', removeAttribute() { delete this.value; } }]));
  const root = { querySelector: selector => parts.get(selector) }, ui = createLoadingScreen({ getElementById: () => root });
  const progress = createLoadingProgress(state => ui.update(state));
  assert.equal(parts.get('[data-loading-bar]').value, undefined);
  progress.plan(['voice:one']); progress.complete('manifest');
  assert.match(parts.get('[data-loading-detail]').textContent, /남은 항목 2개/);
  assert.equal(parts.get('[data-loading-bar]').value, 33);
  ui.fail(); const message = parts.get('[data-loading-stage]').textContent;
  progress.complete('voice:one'); assert.equal(parts.get('[data-loading-stage]').textContent, message);
  ui.hide(); assert.equal(root.hidden, true);
});
