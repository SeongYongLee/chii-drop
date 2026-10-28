import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRecords, loadSettings, saveSettings, saveRecords } from '../src/app/storage.js';

test('새 기본 음량은 모두 5이며 이전 설정은 한 번만 절반 눈금으로 변환한다', t => {
  const previous = globalThis.window;
  let raw = null;
  globalThis.window = { localStorage: { getItem: () => raw, setItem: (_, value) => { raw = value; } } };
  t.after(() => { globalThis.window = previous; });
  const keys = ['volume', 'effectsVolume', 'musicVolume', 'voiceVolume'];
  assert.deepEqual(keys.map(key => loadSettings()[key]), [5, 5, 5, 5]);
  raw = JSON.stringify({ volume: 10, effectsVolume: 7, musicVolume: 0, voiceVolume: 10, ghost: false });
  const migrated = loadSettings();
  assert.deepEqual(keys.map(key => migrated[key]), [5, 3.5, 0, 5]);
  assert.equal(migrated.ghost, false);
  assert.equal(migrated.audioScaleVersion, 2);
  assert.deepEqual(loadSettings(), migrated, '재접속 때 다시 절반으로 줄이지 않는다');
  saveSettings({ ...migrated, effectsVolume: 9 });
  assert.equal(loadSettings().effectsVolume, 9, '새 눈금에서 5 초과 조절도 유지한다');
});

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
  assert.equal(settings.volume, 1.5); assert.equal(settings.music, false); assert.equal(settings.ghost, true);
  assert.equal('skin' in JSON.parse(values.get('chii-drop:settings')), false);
  saveSettings({ ...settings, skin: 'old-selection' });
  assert.equal('skin' in JSON.parse(values.get('chii-drop:settings')), false);
  assert.equal(values.get('chii-drop:records'), 'keep records');
  assert.equal(values.get('chii-drop:story'), 'keep story');
});

test('이전 CPU 승패를 유지하고 새 난이도의 기록은 독립적으로 저장·복원한다', (t) => {
  const previous = globalThis.window;
  const values = new Map([['chii-drop:records', JSON.stringify({ soloBest: 100,
    cpu: { easy: { win: 3, lose: 2 }, hard: { win: 1, lose: 4 }, expert: { win: 5, lose: 6 }, master: { win: 7, lose: 8 } } })]]);
  globalThis.window = { localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } };
  t.after(() => { globalThis.window = previous; });
  const records = loadRecords();
  assert.equal(records.soloBest, 100); assert.deepEqual(records.cpu.hard, { win: 1, lose: 4 });
  assert.deepEqual(records.cpu.easy, { win: 3, lose: 2 }); assert.deepEqual(records.cpu.expert, { win: 5, lose: 6 });
  assert.deepEqual(records.cpu.master, { win: 7, lose: 8 });
  assert.deepEqual(records.cpu.grandmaster, { win: 0, lose: 0 });
  assert.deepEqual(records.cpu.beginner, { win: 0, lose: 0 });
  records.cpu.beginner.win++;
  records.cpu.grandmaster.lose++;
  saveRecords(records);
  const loaded = loadRecords();
  assert.deepEqual(loaded.cpu.beginner, { win: 1, lose: 0 });
  assert.deepEqual(loaded.cpu.easy, { win: 3, lose: 2 });
  assert.deepEqual(loaded.cpu.master, { win: 7, lose: 8 });
  assert.deepEqual(loaded.cpu.grandmaster, { win: 0, lose: 1 });
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

test('손상된 JSON 구조·개별 값은 복구하면서 정상 난이도와 소수 음량은 보존한다', t => {
  const previous = globalThis.window;
  t.after(() => { globalThis.window = previous; });
  let raw;
  globalThis.window = { localStorage: { getItem: () => raw, setItem() {} } };
  for (const value of ['{broken', 'null', '[]', '42', '"invalid"']) {
    raw = value; assert.equal(loadRecords().cpu.normal.win, 0); assert.equal(loadSettings().volume, 5);
  }
  raw = JSON.stringify({ soloBest: 'bad', soloMaxChain: 3, cpu: { normal: null, hard: { win: -2, lose: 4 }, easy: { win: 2.5, lose: 8 } } });
  const records = loadRecords();
  assert.equal(records.soloBest, 0); assert.equal(records.soloMaxChain, 3);
  assert.deepEqual(records.cpu.normal, { win: 0, lose: 0 });
  assert.deepEqual(records.cpu.hard, { win: 0, lose: 4 }); assert.deepEqual(records.cpu.easy, { win: 0, lose: 8 });
  raw = JSON.stringify({ audioScaleVersion: 2, volume: -4, voiceVolume: 50, musicVolume: 3.5, music: 'false', ghost: false });
  const settings = loadSettings();
  assert.equal(settings.volume, 0); assert.equal(settings.voiceVolume, 10); assert.equal(settings.musicVolume, 3.5);
  assert.equal(settings.music, true); assert.equal(settings.ghost, false);
});
