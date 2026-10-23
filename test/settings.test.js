import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRecords, loadSettings, saveSettings } from '../src/app/storage.js';

test('이전 스킨 선택값만 제거하고 음량·음악·경기 기록은 유지한다', (t) => {
  const previous = globalThis.window;
  const values = new Map([
    ['chii-drop:settings', JSON.stringify({ skin: 'basic', volume: 3, music: false, ghost: true })],
    ['chii-drop:records', 'keep records'], ['chii-drop:story', 'keep story'],
  ]);
  globalThis.window = { localStorage: { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) } };
  t.after(() => { globalThis.window = previous; });
  const settings = loadSettings();
  assert.equal('skin' in settings, false);
  assert.equal(settings.volume, 3); assert.equal(settings.music, false); assert.equal(settings.ghost, true);
  assert.equal('skin' in JSON.parse(values.get('chii-drop:settings')), false);
  saveSettings({ ...settings, skin: 'old-selection' });
  assert.equal('skin' in JSON.parse(values.get('chii-drop:settings')), false);
  assert.equal(values.get('chii-drop:records'), 'keep records');
  assert.equal(values.get('chii-drop:story'), 'keep story');
});

test('이전 CPU 승패는 유지하고 아주 어려움 기록만 새로 준비한다', (t) => {
  const previous = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => JSON.stringify({ soloBest: 100,
    cpu: { easy: { win: 3, lose: 2 }, hard: { win: 1, lose: 4 }, expert: { win: 5, lose: 6 } } }) } };
  t.after(() => { globalThis.window = previous; });
  const records = loadRecords();
  assert.equal(records.soloBest, 100); assert.deepEqual(records.cpu.hard, { win: 1, lose: 4 });
  assert.deepEqual(records.cpu.easy, { win: 3, lose: 2 }); assert.deepEqual(records.cpu.expert, { win: 5, lose: 6 });
  assert.deepEqual(records.cpu.master, { win: 0, lose: 0 });
});

test('착지 위치는 새 설정·저장소 차단 시 기본 켜짐이며 저장한 꺼짐은 유지한다', (t) => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  globalThis.window = { localStorage: { getItem: () => null } };
  assert.equal(loadSettings().ghost, true);
  globalThis.window.localStorage.getItem = () => JSON.stringify({ ghost: false });
  assert.equal(loadSettings().ghost, false);
  globalThis.window.localStorage.getItem = () => { throw new Error('blocked'); };
  assert.equal(loadSettings().ghost, true);
});
