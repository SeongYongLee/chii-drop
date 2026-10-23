import { INPUT } from '../engine/input.js';

const KEYMAPS = {
  solo: {
    LEFT: ['ArrowLeft', 'KeyA'],
    RIGHT: ['ArrowRight', 'KeyD'],
    DOWN: ['ArrowDown', 'KeyS'],
    ROTATE_CCW: ['KeyZ', 'KeyF'],
    ROTATE_CW: ['KeyX', 'KeyG', 'ArrowUp', 'KeyW'],
  },
  p1: {
    LEFT: ['KeyA'],
    RIGHT: ['KeyD'],
    DOWN: ['KeyS'],
    ROTATE_CCW: ['KeyF'],
    ROTATE_CW: ['KeyG', 'KeyW'],
  },
  p2: {
    LEFT: ['ArrowLeft'],
    RIGHT: ['ArrowRight'],
    DOWN: ['ArrowDown'],
    ROTATE_CCW: ['Comma'],
    ROTATE_CW: ['Period', 'ArrowUp'],
  },
};

const MENU_KEYS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  confirm: ['Enter', 'Space', 'KeyX', 'KeyG', 'Period'],
  back: ['Escape', 'Backspace', 'KeyZ', 'KeyF', 'Comma'],
  pause: ['Escape', 'KeyP'],
};

// 2P 캐릭터 선택처럼 플레이어별로 메뉴를 조작할 때 쓴다.
const PLAYER_MENU_KEYS = [
  { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], confirm: ['KeyG', 'KeyX'], back: ['KeyF', 'KeyZ'] },
  { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], confirm: ['Period', 'Enter'], back: ['Comma', 'Backspace'] },
];

const GAME_CODES = new Set(
  [...Object.values(KEYMAPS).flatMap(Object.values), ...Object.values(MENU_KEYS)].flat(),
);

function createKeyboard() {
  return { held: new Set(), pressed: new Set(), touchHeld: new Set(), touchPressed: new Set() };
}

// 터치와 실제 키보드의 누름 상태를 분리해 한쪽의 해제가 다른 쪽을 끊지 않게 한다.
function setTouchKeys(keyboard, codes) {
  const next = new Set(codes);
  keyboard.touchPressed ??= new Set();
  for (const code of next) if (!keyboard.touchHeld?.has(code)) keyboard.touchPressed.add(code);
  keyboard.touchHeld = next;
}

function attachKeyboard(keyboard, target) {
  target.addEventListener('keydown', (event) => {
    if (GAME_CODES.has(event.code) || Object.values(keyboard.bindings ?? {}).some((map) =>
      (Array.isArray(map) ? map : Object.values(map).flat()).includes(event.code))) {
      event.preventDefault();
    }
    if (!event.repeat) {
      keyboard.pressed.add(event.code);
    }
    keyboard.held.add(event.code);
  });
  target.addEventListener('keyup', (event) => {
    keyboard.held.delete(event.code);
  });
  target.addEventListener('blur', () => {
    keyboard.held.clear();
    keyboard.pressed.clear();
    keyboard.touchHeld?.clear();
    keyboard.touchPressed?.clear();
  });
}

function readInput(keyboard, keymap) {
  let input = 0;
  const group = Object.keys(KEYMAPS).find((id) => KEYMAPS[id] === keymap);
  const physical = keyboard.bindings?.[group] ?? keymap;
  for (const [name, codes] of Object.entries(keymap)) {
    if (physical[name].some((code) => keyboard.held.has(code)) || codes.some((code) => keyboard.touchHeld?.has(code))) {
      input |= INPUT[name];
    }
  }
  return input;
}

function wasPressed(keyboard, codes) {
  const physical = codes === MENU_KEYS.pause && keyboard.bindings?.pause ? ['Escape', ...keyboard.bindings.pause] : codes;
  return physical.some((code) => keyboard.pressed.has(code)) || codes.some((code) => keyboard.touchPressed?.has(code));
}

function clearPressed(keyboard) {
  keyboard.pressed.clear();
  keyboard.touchPressed?.clear();
}

export {
  KEYMAPS,
  MENU_KEYS,
  PLAYER_MENU_KEYS,
  attachKeyboard,
  clearPressed,
  createKeyboard,
  readInput,
  setTouchKeys,
  wasPressed,
};
