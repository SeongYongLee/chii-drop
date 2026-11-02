import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultGamepadBindings, validGamepadBindings, loadGamepadBindings, assignGamepadButton, createGamepadSettings, GAMEPAD_SETTINGS_KEY } from '../src/input/gamepad-settings.js';
import { readGamepad } from '../src/input/gamepad.js';
import { INPUT } from '../src/engine/input.js';
const pad = (index, buttons = []) => ({ index, axes: [0, 0], buttons: Array.from({ length: 20 }, (_, i) => ({ pressed: buttons.includes(i) })) });

test('배치 저장 복원·손상 데이터·중복·범위 검사와 플레이어별 독립성', () => {
  const data = defaultGamepadBindings(); data[1].cw = [7];
  assert.ok(validGamepadBindings(data));
  assert.deepEqual(loadGamepadBindings({ getItem: () => JSON.stringify(data) }), data);
  for (const raw of ['{', '{}', 'null', JSON.stringify([data[0]]), JSON.stringify([{ ...data[0], cw: [0] }, data[1]])])
    assert.deepEqual(loadGamepadBindings({ getItem: () => raw }), defaultGamepadBindings());
  assert.deepEqual(loadGamepadBindings({ getItem() { throw Error('blocked'); } }), defaultGamepadBindings());
  assert.equal(validGamepadBindings([{ ...data[0], cw: [32] }, data[1]]), false);
  assert.deepEqual(defaultGamepadBindings()[0].cw, [1, 3, 5]);
});

test('중복 배치를 교환하고 기존 조작을 보존하며 커스텀 입력을 공통 프레임으로 변환한다', () => {
  const initial = defaultGamepadBindings()[0];
  const changed = assignGamepadButton(initial, 'ccw', 1);
  assert.deepEqual(changed.ccw, [1]); assert.deepEqual(changed.cw, [0, 2, 4]);
  assert.ok(validGamepadBindings([changed, initial]));
  assert.equal(readGamepad(pad(0, [1]), {}, changed).input, INPUT.ROTATE_CCW);
  assert.equal(readGamepad(pad(0, [0]), {}, changed).input, INPUT.ROTATE_CW);
  const move = assignGamepadButton(changed, 'left', 7);
  assert.equal(readGamepad(pad(0, [7]), {}, move).input, INPUT.LEFT);
  assert.equal(readGamepad(pad(0, [14]), {}, move).input, 0);
  assert.equal(readGamepad({ ...pad(0), axes: [-1, 0] }, {}, move).input, INPUT.LEFT);
  assert.equal(readGamepad(pad(0, [0]), {}, changed).actions.has('confirm'), true, '메뉴 결정은 유지한다');
});

function editorHarness() {
  class Element extends EventTarget {
    constructor() { super(); this.children = []; this.attributes = {}; }
    append(...children) { this.children.push(...children); }
    setAttribute(key, value) { this.attributes[key] = value; }
    querySelector(selector) { return this.parts[selector]; }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatchEvent(new Event('close')); }
    remove() {}
    focus() {}
    click() { this.dispatchEvent(new Event('click')); }
    get innerHTML() { return this.markup; }
    set innerHTML(value) { this.markup = value; this.parts = Object.fromEntries(['[data-gamepad-diagram]', '[data-gamepad-action]', '[data-gamepad-assignment]', '[role=status]', '.key-settings-rows', '.key-settings-tabs', '[data-reset]', '[data-cancel]', '[data-save]'].map(key => [key, new Element()])); }
  }
  let saved = null, last, resets = 0;
  const storage = { getItem: () => saved, setItem(key, value) { assert.equal(key, GAMEPAD_SETTINGS_KEY); saved = value; } };
  const view = { localStorage: storage, document: { body: new Element(), createElement(tag) { const el = new Element(); if (tag === 'dialog') last = el; return el; } } };
  const editor = createGamepadSettings({ view, onReset() { resets++; } });
  return { editor, get dialog() { return last; }, get saved() { return saved; }, get resets() { return resets; } };
}

test('선택한 패드만 캡처하고 버튼 해제를 기다리며 저장·취소·초기화를 처리한다', () => {
  const h = editorHarness(); h.editor.open();
  const rows = h.dialog.querySelector('.key-settings-rows').children;
  rows[3].click();
  assert.ok(h.editor.capture([pad(3, [0])], [3, 7]));
  assert.ok(h.editor.capture([pad(3), pad(7, [1])], [3, 7]));
  assert.ok(h.editor.capture([pad(3, [7])], [3, 7]));
  assert.equal(h.editor.capture([pad(3)], [3, 7]), false);
  assert.equal(h.saved, null);
  h.dialog.querySelector('[data-save]').click();
  assert.deepEqual(JSON.parse(h.saved)[0].ccw, [7]);
  assert.deepEqual(h.editor.bindings[1], defaultGamepadBindings()[1]);
  assert.ok(h.resets >= 2);
  h.editor.open(); h.dialog.querySelector('[data-reset]').click(); h.dialog.querySelector('[data-cancel]').click();
  assert.deepEqual(h.editor.bindings[0].ccw, [7], '취소하면 저장된 배치를 유지한다');
  h.editor.open(); h.dialog.querySelector('.key-settings-rows').children[0].click();
  const cancel = new Event('cancel', { cancelable: true }); h.dialog.dispatchEvent(cancel);
  assert.equal(cancel.defaultPrevented, true); assert.equal(h.editor.capture([], []), false);
  h.dialog.querySelector('[data-reset]').click(); h.dialog.querySelector('[data-save]').click();
  assert.deepEqual(h.editor.bindings, defaultGamepadBindings());
});


test('선택한 조작·플레이어와 배정 변경을 게임패드 그림에 즉시 반영한다', () => {
  const h = editorHarness(); h.editor.open();
  const diagram = () => h.dialog.querySelector('[data-gamepad-diagram]').innerHTML;
  const highlighted = () => [...diagram().matchAll(/data-button="(\d+)" data-assigned="true"/g)].map(match => Number(match[1]));
  assert.deepEqual(highlighted(), [0, 2, 4]);
  const rows = h.dialog.querySelector('.key-settings-rows').children;
  rows[4].dispatchEvent(new Event('focus'));
  assert.deepEqual(highlighted(), [1, 3, 5]);
  rows[4].click(); h.editor.capture([pad(3)], [3, 7]); h.editor.capture([pad(3, [7])], [3, 7]);
  assert.deepEqual(highlighted(), [7]);
  assert.match(h.dialog.querySelector('[data-gamepad-assignment]').textContent, /RT/);
  h.dialog.querySelector('.key-settings-tabs').children[1].click();
  assert.deepEqual(highlighted(), [1, 3, 5]);
  assert.match(h.dialog.querySelector('[data-gamepad-action]').textContent, /2P/);
  h.dialog.querySelector('[data-reset]').click();
  assert.deepEqual(highlighted(), [1, 3, 5]);
});
