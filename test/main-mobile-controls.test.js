import test from 'node:test';
import assert from 'node:assert/strict';
import { attachMobileControls, mobileKeyCodes, MOBILE_INPUT as M } from '../src/input/mobile-controls.js';
import { createKeyboard, clearPressed, readInput, wasPressed, KEYMAPS, MENU_KEYS } from '../src/input/keyboard.js';

class Button extends EventTarget {
  constructor(input) { super(); this.dataset = { input: String(input) }; }
  setAttribute() {}
  setPointerCapture() {}
}
function harness() {
  const doc = new EventTarget(), view = new EventTarget(), media = new EventTarget();
  media.matches = true; view.matchMedia = () => media; view.document = doc; doc.defaultView = view;
  const buttons = Object.values(M).map((bit) => new Button(bit));
  const parts = Object.fromEntries(['menu', 'game', 'label', 'player', 'items', 'confirm'].map((name) => [name, new EventTarget()]));
  for (const part of Object.values(parts)) { part.dataset = {}; part.replaceChildren = () => {}; }
  const root = new EventTarget(); root.ownerDocument = doc; root.dataset = {};
  root.querySelectorAll = () => buttons;
  root.querySelector = (selector) => parts[selector.match(/mobile-(\w+)/)[1]];
  const canvas = new EventTarget(); canvas.setPointerCapture = () => {};
  canvas.getBoundingClientRect = () => ({ left: 100, top: 10, width: 480, height: 270 });
  let context = { enabled: true, mode: 'menu' }; const taps = [];
  const keyboard = createKeyboard();
  const controller = attachMobileControls({ view, canvas, container: root, keyboard,
    getContext: () => context, onUnlock() {}, onTap(point) { taps.push(point); return false; } });
  function fire(target, type, values = {}) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 200, clientY: 50, ...values });
    target.dispatchEvent(event);
    return event;
  }
  const button = (bit) => buttons.find((b) => Number(b.dataset.input) === bit);
  return { controller, keyboard, canvas, taps, fire, button, parts, view,
    context(value) { context = value; controller.sync(); } };
}

test('타이틀의 짧은 화면 탭을 한 프레임 결정 입력으로 바꾸고 스와이프·취소는 무시한다', () => {
  const h = harness();
  h.fire(h.canvas, 'pointerdown'); h.fire(h.canvas, 'pointerup'); h.controller.read();
  assert.deepEqual(h.taps, [{ x: 200, y: 80 }]);
  assert.ok(wasPressed(h.keyboard, MENU_KEYS.confirm));
  clearPressed(h.keyboard); h.controller.read();
  assert.equal(wasPressed(h.keyboard, MENU_KEYS.confirm), false);
  h.fire(h.canvas, 'pointerdown'); h.fire(h.canvas, 'pointerup', { clientX: 230 });
  h.fire(h.canvas, 'pointerdown'); h.fire(h.canvas, 'pointercancel'); h.fire(h.canvas, 'pointerup');
  h.controller.read(); assert.equal(h.taps.length, 1);
});

test('터치 결정 상태는 화면 전환 때 비우고 경기에서 이동·회전을 동시에 전달한다', () => {
  const h = harness();
  h.fire(h.button(M.confirm), 'pointerdown'); h.controller.read();
  assert.ok(wasPressed(h.keyboard, MENU_KEYS.confirm));
  h.controller.clear(); h.context({ enabled: true, mode: 'game' }); h.controller.read();
  assert.equal(wasPressed(h.keyboard, MENU_KEYS.confirm), false);
  assert.equal(h.parts.menu.hidden, true); assert.equal(h.parts.game.hidden, false);
  h.fire(h.button(M.left), 'pointerdown', { pointerId: 10 });
  h.fire(h.button(M.cw), 'pointerdown', { pointerId: 11 }); h.controller.read();
  assert.equal(readInput(h.keyboard, KEYMAPS.solo), 9);
  h.keyboard.held.add('ArrowLeft');
  h.fire(h.button(M.left), 'pointerup', { pointerId: 10 }); h.controller.read();
  assert.equal(readInput(h.keyboard, KEYMAPS.solo), 9, '터치를 놓아도 실제 키보드 왼쪽은 유지한다');
  h.keyboard.held.clear(); h.controller.read(); assert.equal(readInput(h.keyboard, KEYMAPS.solo), 8);
  h.view.dispatchEvent(new Event('resize')); h.controller.read();
  assert.equal(readInput(h.keyboard, KEYMAPS.solo), 0, '화면을 돌릴 때 누르던 터치 입력이 남지 않는다');
  h.context({ enabled: true, mode: 'menu' }); h.controller.read();
  assert.equal(readInput(h.keyboard, KEYMAPS.solo), 0, '일시정지 메뉴에 게임 누름이 남지 않는다');
});

test('로컬 선택은 1P·2P 키를 구분하고 뒤로는 먼저 결정한 1P를 취소할 수 있다', () => {
  assert.deepEqual(mobileKeyCodes(M.confirm, { player: 0 }), ['KeyG']);
  assert.deepEqual(mobileKeyCodes(M.confirm, { player: 1 }), ['Period']);
  assert.deepEqual(mobileKeyCodes(M.back, { player: 1, backPlayer: 0 }), ['KeyF']);
  assert.deepEqual(mobileKeyCodes(M.ccw | M.cw, { mode: 'game', player: 1 }), ['Period', 'Comma']);
});

test('캔버스의 길게 누르기 메뉴·선택·드래그와 Safari 터치 기본 동작을 막는다', () => {
  const h = harness();
  for (const type of ['contextmenu', 'selectstart', 'dragstart', 'touchstart']) assert.equal(h.fire(h.canvas, type).defaultPrevented, true);
});
