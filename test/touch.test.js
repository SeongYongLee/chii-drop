import test from 'node:test';
import assert from 'node:assert/strict';
import { attachTouchControls } from '../src/net/touch.js';

class Button extends EventTarget {
  constructor(bit) { super(); this.dataset = { input: String(bit) }; this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = value; }
  setPointerCapture(id) { this.captured = id; }
}
function harness() {
  const buttons = [1, 2, 4, 8, 16].map((bit) => new Button(bit));
  const moveGroup = {}, rotateGroup = {};
  for (const button of buttons) {
    const bit = Number(button.dataset.input);
    button.parentElement = [1, 2, 4].includes(bit) ? moveGroup : rotateGroup;
    const left = ({ 1: 0, 4: 70, 2: 140, 8: 260, 16: 330 })[bit];
    button.getBoundingClientRect = () => ({ left, right: left + 60, top: 100, bottom: 160, width: 60, height: 60 });
  }
  const doc = new EventTarget(); doc.defaultView = new EventTarget(); doc.hidden = false;
  const touch = attachTouchControls({ ownerDocument: doc, querySelectorAll: () => buttons });
  function fire(bit, type, properties = {}) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerType: 'touch', pointerId: bit, button: 0, ...properties });
    buttons.find((b) => Number(b.dataset.input) === bit).dispatchEvent(event);
    return event;
  }
  return { buttons, doc, touch, fire };
}
test('동시 이동·회전 터치는 공통 입력 비트로 합치고 각 손가락을 따로 놓는다', () => {
  const { touch, fire, buttons } = harness(); touch.setEnabled(true);
  fire(1, 'pointerdown', { pointerId: 10 }); fire(8, 'pointerdown', { pointerId: 11 });
  assert.equal(touch.read(), 9); assert.equal(touch.read(), 9);
  fire(1, 'pointerup', { pointerId: 10 }); assert.equal(touch.read(), 8);
  fire(8, 'pointerup', { pointerId: 11 }); assert.equal(touch.read(), 0);
  assert.ok(buttons.every((b) => b.attributes['aria-pressed'] === 'false'));
});

test('방향 패드를 누른 채 드래그하면 새 방향만 남고 다른 손가락의 회전은 유지한다', () => {
  const { touch, fire } = harness(); touch.setEnabled(true);
  fire(1, 'pointerdown', { pointerId: 10 }); fire(8, 'pointerdown', { pointerId: 11 });
  fire(1, 'pointermove', { pointerId: 10, clientX: 170, clientY: 130 });
  assert.equal(touch.read(), 2 | 8, '한 프레임 사이에 전환해도 이전 왼쪽 입력이 섞이지 않는다');
  fire(1, 'pointermove', { pointerId: 10, clientX: 100, clientY: 130 }); assert.equal(touch.read(), 4 | 8);
  fire(1, 'pointermove', { pointerId: 10, clientX: 280, clientY: 130 }); assert.equal(touch.read(), 8, '패드 밖 회전 버튼으로 밀어도 회전이 추가되지 않는다');
  fire(1, 'pointermove', { pointerId: 10, clientX: 30, clientY: 130 }); assert.equal(touch.read(), 1 | 8, '같은 손가락으로 패드에 다시 들어올 수 있다');
  fire(1, 'pointercancel', { pointerId: 10 }); assert.equal(touch.read(), 8);
  fire(8, 'pointerup', { pointerId: 11 }); assert.equal(touch.read(), 0);
});

test('버튼 사이 빈틈에서도 방향을 유지하며 경계의 작은 손 떨림은 무시한다', () => {
  const { touch, fire } = harness(); touch.setEnabled(true);
  fire(1, 'pointerdown'); touch.read();
  fire(1, 'pointermove', { clientX: 65, clientY: 130 }); assert.equal(touch.read(), 1);
  fire(1, 'pointermove', { clientX: 69, clientY: 130 }); assert.equal(touch.read(), 4);
  fire(1, 'pointermove', { clientX: 65, clientY: 130 }); assert.equal(touch.read(), 4);
  fire(1, 'pointermove', { clientX: 61, clientY: 130 }); assert.equal(touch.read(), 1);
  fire(1, 'pointermove', { clientX: -50, clientY: 130 }); assert.equal(touch.read(), 0);
  fire(1, 'pointerup'); assert.equal(touch.read(), 0);
});

test('십자 배치나 편집한 위치에서도 좌우 드래그가 아래 방향을 거치지 않는다', () => {
  const { touch, fire, buttons } = harness(); touch.setEnabled(true);
  buttons.find((button) => button.dataset.input === '4').getBoundingClientRect = () =>
    ({ left: 70, right: 130, top: 180, bottom: 240, width: 60, height: 60 });
  fire(1, 'pointerdown'); touch.read();
  for (const x of [60, 80, 100, 120, 140, 170]) {
    fire(1, 'pointermove', { clientX: x, clientY: 130 });
    assert.ok([1, 2].includes(touch.read()), '실제 버튼 위치를 따라 좌우만 전환한다');
  }
  fire(1, 'pointermove', { clientX: 100, clientY: 210 }); assert.equal(touch.read(), 4);
});

test('취소한 새 방향은 유령 입력으로 남지 않고 다른 포인터의 짧은 탭은 보존한다', () => {
  const { touch, fire } = harness(); touch.setEnabled(true);
  fire(1, 'pointerdown', { pointerId: 10 }); fire(1, 'pointerup', { pointerId: 10 });
  fire(1, 'pointerdown', { pointerId: 11 }); fire(1, 'pointercancel', { pointerId: 11 });
  assert.equal(touch.read(), 1); assert.equal(touch.read(), 0);
  fire(1, 'pointerdown'); fire(1, 'pointermove', { clientX: 170, clientY: 130 }); fire(1, 'pointercancel');
  assert.equal(touch.read(), 0);
});

test('긴 누름의 컨텍스트 메뉴와 Safari 터치 기본 동작을 취소한다', () => {
  const { touch, fire } = harness(); touch.setEnabled(true);
  for (const type of ['contextmenu', 'touchstart', 'touchmove']) assert.equal(fire(1, type).defaultPrevented, true);
});

test('회전 버튼을 누른 손가락은 이동 패드로 밀어도 방향 입력으로 전환되지 않는다', () => {
  const { touch, fire } = harness(); touch.setEnabled(true);
  fire(8, 'pointerdown'); fire(8, 'pointermove', { clientX: 30, clientY: 130 });
  assert.equal(touch.read(), 8); fire(8, 'pointercancel'); assert.equal(touch.read(), 0);
});
test('프레임 사이에 끝난 짧은 탭도 최소 한 프레임 전달하며 반복하지 않는다', () => {
  const { touch, fire } = harness(); touch.setEnabled(true);
  fire(16, 'pointerdown'); fire(16, 'pointerup'); fire(16, 'lostpointercapture');
  assert.equal(touch.read(), 16); assert.equal(touch.read(), 0);
});
test('포인터 취소·포커스 이탈·화면 숨김·경기 종료 후 입력이 눌린 채 남지 않는다', () => {
  const { touch, fire, doc, buttons } = harness(); touch.setEnabled(true);
  fire(4, 'pointerdown'); touch.read(); fire(4, 'pointercancel'); assert.equal(touch.read(), 0);
  fire(1, 'pointerdown'); doc.defaultView.dispatchEvent(new Event('blur')); assert.equal(touch.read(), 0);
  fire(2, 'pointerdown'); doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); assert.equal(touch.read(), 0);
  fire(8, 'pointerdown'); touch.setEnabled(false); assert.equal(touch.read(), 0);
  fire(1, 'pointerdown'); assert.equal(touch.read(), 0); assert.ok(buttons.every((b) => b.disabled));
});
test('터치 버튼은 키보드와 보조 기술로도 작동하고 우클릭은 입력하지 않는다', () => {
  const { touch, fire } = harness(); touch.setEnabled(true);
  fire(8, 'keydown', { code: 'Space' }); assert.equal(touch.read(), 8);
  fire(8, 'keyup', { code: 'Space' }); assert.equal(touch.read(), 0);
  fire(16, 'click', { detail: 0 }); assert.equal(touch.read(), 16); assert.equal(touch.read(), 0);
  fire(1, 'pointerdown', { pointerType: 'mouse', button: 2 }); assert.equal(touch.read(), 0);
});

test('읽기 전에 취소된 터치는 다음 프레임의 유령 입력으로 남지 않는다', () => {
  const { touch, fire } = harness(); touch.setEnabled(true);
  fire(1, 'pointerdown'); fire(1, 'pointercancel'); assert.equal(touch.read(), 0);
  fire(8, 'pointerdown'); fire(8, 'lostpointercapture'); assert.equal(touch.read(), 0);
  fire(4, 'pointerdown', { pointerId: 10 }); fire(4, 'pointerdown', { pointerId: 11 });
  fire(4, 'pointercancel', { pointerId: 10 }); assert.equal(touch.read(), 4);
  fire(4, 'pointerup', { pointerId: 11 }); assert.equal(touch.read(), 0);
});
