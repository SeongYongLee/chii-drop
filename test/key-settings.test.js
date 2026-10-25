import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultKeyBindings, validateKeyBindings, loadKeyBindings, KEY_SETTINGS_KEY } from '../src/input/key-settings.js';
import { createKeyboard, readInput, wasPressed, setTouchKeys, KEYMAPS, MENU_KEYS, attachKeyboard } from '../src/input/keyboard.js';
import { INPUT } from '../src/engine/input.js';

test('커스텀 키는 실제 키보드에 적용하고 터치의 기존 프레임 입력은 유지한다', () => {
  const keyboard = createKeyboard(); keyboard.bindings = defaultKeyBindings();
  keyboard.bindings.solo.LEFT = ['KeyJ']; keyboard.bindings.pause = ['Escape', 'KeyH'];
  keyboard.held.add('ArrowLeft'); assert.equal(readInput(keyboard, KEYMAPS.solo), 0);
  keyboard.held.add('KeyJ'); assert.equal(readInput(keyboard, KEYMAPS.solo), INPUT.LEFT);
  keyboard.held.clear(); setTouchKeys(keyboard, ['ArrowLeft', 'KeyX']);
  assert.equal(readInput(keyboard, KEYMAPS.solo), INPUT.LEFT | INPUT.ROTATE_CW);
  keyboard.pressed.add('KeyP'); assert.equal(wasPressed(keyboard, MENU_KEYS.pause), false);
  keyboard.pressed.add('KeyH'); assert.equal(wasPressed(keyboard, MENU_KEYS.pause), true);
  keyboard.pressed.clear(); keyboard.pressed.add('Escape'); assert.equal(wasPressed(keyboard, MENU_KEYS.pause), true);
});

test('같은 조작의 중복, 로컬 플레이어 간 충돌, 일시정지 충돌과 예약 키를 거른다', () => {
  const valid = defaultKeyBindings(); assert.equal(validateKeyBindings(valid), null);
  let b = defaultKeyBindings(); b.solo.LEFT = ['KeyX']; assert.match(validateKeyBindings(b), /중복/);
  b = defaultKeyBindings(); b.p1.LEFT = ['ArrowLeft']; assert.match(validateKeyBindings(b), /1P와 2P/);
  b = defaultKeyBindings(); b.solo.LEFT = ['KeyP']; assert.match(validateKeyBindings(b), /경기 조작/);
  b = defaultKeyBindings(); b.solo.LEFT = ['Escape']; assert.match(validateKeyBindings(b), /없는 경기 키/);
  b = defaultKeyBindings(); b.solo.LEFT = ['F5']; assert.match(validateKeyBindings(b), /없는 경기 키/);
  b = defaultKeyBindings(); b.p1.LEFT = ['KeyJ']; b.p2.RIGHT = ['Numpad6']; assert.equal(validateKeyBindings(b), null);
});

test('저장한 1인·로컬·일시정지 키를 복원하고 손상되거나 차단된 저장소는 기본값을 쓴다', () => {
  const saved = defaultKeyBindings(); saved.solo.ROTATE_CW = ['KeyK']; saved.p2.DOWN = ['Numpad2']; saved.pause = ['Escape', 'KeyH'];
  const loaded = loadKeyBindings({ getItem(key) { assert.equal(key, KEY_SETTINGS_KEY); return JSON.stringify(saved); } });
  assert.deepEqual(loaded, saved);
  loaded.solo.LEFT[0] = 'KeyJ'; assert.equal(defaultKeyBindings().solo.LEFT[0], 'ArrowLeft');
  for (const raw of ['{', 'null', '{}', JSON.stringify({ ...saved, pause: ['KeyK'] })]) assert.deepEqual(loadKeyBindings({ getItem: () => raw }), defaultKeyBindings());
  assert.deepEqual(loadKeyBindings({ getItem() { throw Error('blocked'); } }), defaultKeyBindings());
});

test('새로 배정한 키의 브라우저 기본 동작을 막고 키 해제·창 이탈 시 입력을 비운다', () => {
  const keyboard = createKeyboard(), target = new EventTarget(); keyboard.bindings = defaultKeyBindings();
  keyboard.bindings.solo.LEFT = ['KeyJ']; attachKeyboard(keyboard, target);
  const event = new Event('keydown', { cancelable: true }); Object.assign(event, { code: 'KeyJ', repeat: false }); target.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true); assert.equal(readInput(keyboard, KEYMAPS.solo), INPUT.LEFT);
  const up = new Event('keyup'); Object.assign(up, { code: 'KeyJ' }); target.dispatchEvent(up); assert.equal(readInput(keyboard, KEYMAPS.solo), 0);
  target.dispatchEvent(event); target.dispatchEvent(new Event('blur')); assert.equal(readInput(keyboard, KEYMAPS.solo), 0);
});

test('온라인 화면에서는 메인 키보드를 멈추고 돌아온 뒤 다시 입력받는다', () => {
  const keyboard = createKeyboard(), target = new EventTarget(); attachKeyboard(keyboard, target);
  const key = () => Object.assign(new Event('keydown', { cancelable: true }), { code: 'ArrowLeft', repeat: false });
  keyboard.enabled = false;
  const paused = key(); target.dispatchEvent(paused);
  assert.equal(paused.defaultPrevented, false);
  assert.equal(keyboard.held.size, 0); assert.equal(keyboard.pressed.size, 0);
  keyboard.enabled = true; const resumed = key(); target.dispatchEvent(resumed);
  assert.equal(resumed.defaultPrevented, true); assert.equal(readInput(keyboard, KEYMAPS.solo), INPUT.LEFT);
});
