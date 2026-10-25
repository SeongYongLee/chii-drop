import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKeyboard, readInput, clearPressed, KEYMAPS } from '../src/input/keyboard.js';
import { INPUT } from '../src/engine/input.js';

test('프레임 사이에 누르고 뗀 짧은 키보드 회전을 버리지 않는다', () => {
  const keyboard = createKeyboard();
  keyboard.pressed.add('KeyX');
  assert.equal(readInput(keyboard, KEYMAPS.solo), INPUT.ROTATE_CW);
  clearPressed(keyboard);
  assert.equal(readInput(keyboard, KEYMAPS.solo), 0);
});

test('빠른 재누름은 한 프레임 해제 후 새 회전으로 전달하고 계속 누름은 반복하지 않는다', () => {
  const keyboard = createKeyboard();
  keyboard.held.add('KeyX'); keyboard.pressed.add('KeyX');
  assert.equal(readInput(keyboard, KEYMAPS.solo), INPUT.ROTATE_CW);
  clearPressed(keyboard);
  assert.equal(readInput(keyboard, KEYMAPS.solo), INPUT.ROTATE_CW);
  keyboard.pressed.add('KeyX');
  assert.equal(readInput(keyboard, KEYMAPS.solo), 0);
  clearPressed(keyboard);
  assert.equal(readInput(keyboard, KEYMAPS.solo), INPUT.ROTATE_CW);
  assert.equal(readInput(keyboard, KEYMAPS.solo), INPUT.ROTATE_CW);
  keyboard.held.clear();
  assert.equal(readInput(keyboard, KEYMAPS.solo), 0);
});
