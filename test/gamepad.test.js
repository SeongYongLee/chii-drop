import assert from 'node:assert/strict';
import test from 'node:test';
import { attachGamepads, readGamepad, adjustGamepadValue } from '../src/input/gamepad.js';
import { createKeyboard, clearPressed, readInput, wasPressed, KEYMAPS, MENU_KEYS } from '../src/input/keyboard.js';
import { INPUT } from '../src/engine/input.js';
import { createMatch, stepMatch } from '../src/engine/match.js';

function pad(index = 0, buttons = [], axes = [0, 0]) {
  return { index, connected: true, mapping: 'standard', axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: buttons.includes(i), value: buttons.includes(i) ? 1 : 0 })) };
}
function harness(mode = 'game') {
  const view = new EventTarget(), document = new EventTarget(), keyboard = createKeyboard();
  let pads = [], focused = true, disconnects = 0, activities = 0;
  const context = { enabled: true, mode, key: {} };
  document.querySelector = () => null; document.querySelectorAll = () => [];
  document.hasFocus = () => focused; document.hidden = false;
  Object.assign(view, { document, navigator: { getGamepads: () => pads }, performance: { now: () => 0 }, Event });
  const controller = attachGamepads({ view, keyboard, getContext: () => context,
    onActivity: () => activities++, onDisconnect: () => disconnects++ });
  return { view, document, keyboard, context, controller, pads(value) { pads = value; }, focus(value) { focused = value; },
    get disconnects() { return disconnects; }, get activities() { return activities; } };
}

test('스틱 데드존·히스테리시스·방향키와 회전 버튼을 표준 프레임 입력으로 변환한다', () => {
  assert.equal(readGamepad(pad(0, [], [.49, -.49])).input, 0);
  const held = readGamepad(pad(0, [], [-.8, .8]));
  assert.equal(held.input, INPUT.LEFT | INPUT.DOWN);
  assert.equal(readGamepad(pad(0, [], [-.4, .4]), held).input, INPUT.LEFT | INPUT.DOWN);
  assert.equal(readGamepad(pad(0, [], [-.2, .2]), held).input, 0);
  assert.equal(readGamepad(pad(0, [15, 0])).input, INPUT.RIGHT | INPUT.ROTATE_CCW);
  for (const button of [0, 2]) assert.equal(readGamepad(pad(0, [button])).input, INPUT.ROTATE_CCW);
  for (const button of [1, 3]) assert.equal(readGamepad(pad(0, [button])).input, INPUT.ROTATE_CW);
  assert.equal(readGamepad(pad(0, [4])).input, INPUT.ROTATE_CCW);
  assert.equal(readGamepad(pad(0, [12])).input, 0, '스틱 위는 실수로 회전시키지 않는다');
});

test('로컬 패드 둘은 독립적이고 키 설정·키보드·터치와 함께 사용할 수 있다', () => {
  const h = harness(); h.pads([null, pad(4, [14, 0]), pad(9, [15, 1])]); h.controller.poll();
  h.keyboard.bindings = { p1: { ...KEYMAPS.p1, LEFT: ['KeyJ'] } };
  assert.equal(readInput(h.keyboard, KEYMAPS.p1), INPUT.LEFT | INPUT.ROTATE_CCW);
  assert.equal(readInput(h.keyboard, KEYMAPS.p2), INPUT.RIGHT | INPUT.ROTATE_CW);
  h.keyboard.held.add('KeyS'); h.keyboard.touchHeld.add('KeyG');
  assert.equal(readInput(h.keyboard, KEYMAPS.p1), INPUT.LEFT | INPUT.DOWN | INPUT.ROTATE_CW | INPUT.ROTATE_CCW);
});

test('2P 패드는 1P 연결 해제로 자리가 바뀌지 않으며 싱글에서는 남은 패드로 조작한다', () => {
  const h = harness(); h.pads([pad(4), pad(9, [15])]); h.controller.poll();
  h.pads([pad(9, [15])]); h.controller.poll();
  assert.equal(h.disconnects, 1);
  assert.equal(readInput(h.keyboard, KEYMAPS.p1), 0);
  assert.equal(readInput(h.keyboard, KEYMAPS.p2), INPUT.RIGHT);
  assert.equal(readInput(h.keyboard, KEYMAPS.solo), INPUT.RIGHT);
});

test('메뉴 결정은 누를 때 한 번만 발생하고 방향은 지연 후 반복한다', () => {
  const h = harness('menu'); h.pads([pad(0, [0])]); h.controller.poll(0);
  assert.ok(wasPressed(h.keyboard, MENU_KEYS.confirm)); clearPressed(h.keyboard);
  h.controller.poll(1000); assert.equal(wasPressed(h.keyboard, MENU_KEYS.confirm), false);
  h.pads([pad(0, [13])]); h.controller.poll(1100);
  assert.ok(wasPressed(h.keyboard, MENU_KEYS.down)); clearPressed(h.keyboard);
  h.controller.poll(1200); assert.equal(wasPressed(h.keyboard, MENU_KEYS.down), false);
  h.controller.poll(1450); assert.ok(wasPressed(h.keyboard, MENU_KEYS.down));
});

test('메뉴에서 경기로 넘어갈 때 결정 버튼이 회전으로 새지 않으며 Start는 일시정지한다', () => {
  const h = harness('menu'); h.pads([pad(0, [0])]); h.controller.poll(); clearPressed(h.keyboard);
  h.context.mode = 'game'; h.controller.poll();
  assert.equal(readInput(h.keyboard, KEYMAPS.solo), 0);
  h.pads([pad()]); h.controller.poll();
  h.pads([pad(0, [0, 9])]); h.controller.poll();
  assert.equal(readInput(h.keyboard, KEYMAPS.solo), INPUT.ROTATE_CCW);
  assert.ok(wasPressed(h.keyboard, MENU_KEYS.pause));
});

test('포커스 상실·숨김·연결 해제 시 입력을 해제하고 중립을 거쳐야 다시 조작한다', () => {
  const h = harness(); h.pads([pad(0, [14])]); h.controller.poll();
  assert.equal(readInput(h.keyboard, KEYMAPS.solo), INPUT.LEFT);
  h.view.dispatchEvent(new Event('blur'));
  assert.equal(readInput(h.keyboard, KEYMAPS.solo), 0);
  h.controller.poll(); assert.equal(readInput(h.keyboard, KEYMAPS.solo), 0);
  h.pads([pad()]); h.controller.poll(); h.pads([pad(0, [15])]); h.controller.poll();
  assert.equal(readInput(h.keyboard, KEYMAPS.solo), INPUT.RIGHT);
  h.document.hidden = true; h.controller.poll(); assert.equal(readInput(h.keyboard, KEYMAPS.solo), 0);
  h.document.hidden = false; h.pads([]); h.controller.poll(); assert.equal(readInput(h.keyboard, KEYMAPS.solo), 0);
});

test('프레임 사이의 짧은 회전도 한 번만 전달하고 API 미지원·예외를 안전하게 처리한다', () => {
  const h = harness(); h.pads([pad(0, [0])]); h.controller.poll();
  h.pads([pad()]); h.controller.poll();
  assert.equal(readInput(h.keyboard, KEYMAPS.solo), INPUT.ROTATE_CCW);
  clearPressed(h.keyboard);
  assert.equal(readInput(h.keyboard, KEYMAPS.solo), 0);
  h.view.navigator.getGamepads = () => { throw Error('denied'); };
  assert.doesNotThrow(() => h.controller.poll());
  h.view.navigator.getGamepads = undefined; h.view.isSecureContext = false;
  assert.doesNotThrow(() => h.controller.poll());
  assert.match(h.controller.status(), /HTTPS/);
});

test('가상 패드의 실제 이동·회전 결과는 같은 키보드 프레임 입력과 일치한다', () => {
  const h = harness(); h.pads([pad(0, [15, 0])]);
  let actual = createMatch({ seed: 12, playerCount: 1 }); actual.players[0].phase = 'control';
  let expected = structuredClone(actual);
  const startX = actual.players[0].piece.x;
  for (let frame = 0; frame < 16; frame++) {
    h.controller.poll(frame * 1000 / 60);
    actual = stepMatch(actual, [readInput(h.keyboard, KEYMAPS.solo)]);
    expected = stepMatch(expected, [INPUT.RIGHT | INPUT.ROTATE_CCW]);
    clearPressed(h.keyboard);
  }
  assert.deepEqual(actual, expected, '엔진 상태와 경기 난수도 같아야 한다');
  assert.ok(actual.players[0].piece.x > startX);
  assert.equal(actual.players[0].piece.orient, 3);
});

test('게임패드로 네이티브 선택창과 음량 슬라이더를 조절하고 비활성 옵션을 건너뛴다', () => {
  const view = { Event }, select = new EventTarget();
  Object.assign(select, { tagName: 'SELECT', value: 'a', options: [{ value: 'a' }, { value: 'b', disabled: true }, { value: 'c' }] });
  let changes = 0; select.addEventListener('change', () => changes++);
  assert.ok(adjustGamepadValue(view, select, 'right')); assert.equal(select.value, 'c');
  adjustGamepadValue(view, select, 'left'); assert.equal(select.value, 'a');
  assert.equal(changes, 2);
  const slider = new EventTarget();
  Object.assign(slider, { tagName: 'INPUT', type: 'range', valueAsNumber: 50,
    stepUp() { this.valueAsNumber += 5; }, stepDown() { this.valueAsNumber -= 5; } });
  adjustGamepadValue(view, slider, 'left'); assert.equal(slider.valueAsNumber, 45);
  assert.equal(adjustGamepadValue(view, slider, 'up'), false);
});

test('저장된 1P·2P 배치를 폴링에서 읽으며 별도 온라인 입력 인스턴스에도 반영한다', async () => {
  const { defaultGamepadBindings } = await import('../src/input/gamepad-settings.js');
  const profiles = defaultGamepadBindings(); profiles[0].ccw = [7]; profiles[1].cw = [6];
  const h = harness(); h.view.localStorage = { getItem: () => JSON.stringify(profiles) };
  // 실제 앱처럼 저장소가 있는 상태에서 입력 인스턴스를 만든다.
  h.controller.destroy();
  const controller = attachGamepads({ view: h.view, keyboard: h.keyboard, getContext: () => h.context });
  h.pads([pad(0, [7]), pad(1, [6])]); controller.poll();
  assert.equal(readInput(h.keyboard, KEYMAPS.p1), INPUT.ROTATE_CCW);
  assert.equal(readInput(h.keyboard, KEYMAPS.p2), INPUT.ROTATE_CW);
  controller.destroy();
  const online = attachGamepads({ view: h.view, keyboard: h.keyboard, getContext: () => h.context });
  online.poll();
  assert.equal(readInput(h.keyboard, KEYMAPS.p1), INPUT.ROTATE_CCW);
  assert.equal(readInput(h.keyboard, KEYMAPS.p2), INPUT.ROTATE_CW);
  online.destroy();
});
