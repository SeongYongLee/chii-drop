import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTROLS_GUIDE_KEY, guideContext, hasSeenGuide, rememberGuide, guideRows } from '../src/app/controls-guide.js';
import { defaultKeyBindings } from '../src/input/key-settings.js';

test('첫 대전 안내는 싱글·로컬 2인·입력 기기별로 확인을 기억한다', () => {
  const data = new Map(), storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  const solo = guideContext('cpu', false);
  assert.equal(hasSeenGuide(storage, solo), false);
  rememberGuide(storage, solo);
  assert.equal(hasSeenGuide(storage, guideContext('practice', false)), true);
  assert.equal(hasSeenGuide(storage, guideContext('versus', false)), false);
  assert.equal(hasSeenGuide(storage, guideContext('cpu', true)), false);
  rememberGuide(storage, guideContext('versus', false));
  assert.equal(hasSeenGuide(storage, solo), true);
  data.set(CONTROLS_GUIDE_KEY, '{');
  assert.equal(hasSeenGuide(storage, solo), false);
  rememberGuide(storage, solo);
  assert.equal(hasSeenGuide(storage, solo), true);
  assert.doesNotThrow(() => rememberGuide(undefined, solo));
  assert.equal(hasSeenGuide({ getItem() { throw Error('blocked'); } }, solo), false);
});

test('조작 안내에는 해당 플레이어가 설정한 실제 키를 표시한다', () => {
  const bindings = defaultKeyBindings();
  bindings.solo.LEFT = ['KeyJ']; bindings.p2.ROTATE_CW = ['Numpad2'];
  assert.deepEqual(guideRows(bindings)[0], ['J  →', '이동']);
  assert.deepEqual(guideRows(bindings, 'p2')[3], ['숫자패드 2', '오른쪽 회전']);
  assert.deepEqual(guideRows(bindings, 'p1')[0], ['A  D', '이동']);
});

test('안내는 자동으로 닫히지 않고 선택 키 해제 후 새 확인 입력으로만 시작한다', async () => {
  const { withControlsGuide } = await import('../src/app/controls-guide.js');
  const { createKeyboard } = await import('../src/input/keyboard.js');
  class Element extends EventTarget {
    children = []; open = false;
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
    remove() {}
    focus() {}
  }
  const previous = globalThis.window, view = new EventTarget(), body = new Element();
  const values = new Map();
  view.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  view.document = { body, createElement: () => new Element() };
  globalThis.window = view;
  try {
    let started = 0;
    const app = { keyboard: createKeyboard(), setScene(scene) { this.scene = scene; } };
    app.keyboard.held.add('Space');
    const key = (type, code, repeat = false) => {
      const event = new Event(type, { cancelable: true }); Object.assign(event, { code, repeat }); view.dispatchEvent(event); return event;
    };
    withControlsGuide(app, { background: { draw() {} }, next: () => { started++; return { game: true }; } });
    const guide = app.scene; guide.update(); const dialog = body.children[0];
    for (let i = 0; i < 600; i++) guide.update();
    assert.equal(dialog.open, true); assert.equal(started, 0);
    assert.equal(hasSeenGuide(view.localStorage, 'solo:keyboard'), false);
    key('keydown', 'Enter'); assert.equal(started, 0); // 이전 선택 키를 아직 누른 상태
    assert.equal(key('keyup', 'Space').defaultPrevented, true);
    key('keydown', 'KeyX'); key('keydown', 'Enter', true);
    assert.equal(started, 0);
    key('keydown', 'Enter');
    assert.equal(started, 0); // 게임 설명에서 조작 방법으로 이동해도 경기는 시작하지 않는다.
    assert.equal(dialog.children[1].hidden, true);
    assert.equal(dialog.children[3].hidden, false);
    assert.equal(hasSeenGuide(view.localStorage, 'solo:keyboard'), false);
    key('keyup', 'Enter'); key('keydown', 'Enter');
    assert.equal(started, 1); assert.equal(dialog.open, false);
    assert.equal(hasSeenGuide(view.localStorage, 'solo:keyboard'), true);
    assert.equal(key('keydown', 'Enter', true).defaultPrevented, true);
    key('keyup', 'Enter'); assert.equal(key('keydown', 'Enter').defaultPrevented, false);
    assert.equal(app.keyboard.held.size, 0);
    withControlsGuide(app, { background: { draw() {} }, next: () => { started++; return { game: true }; } });
    assert.equal(started, 2); // 같은 조작 방식의 다음 대전은 바로 시작
    withControlsGuide(app, { force: true, background: { draw() {} }, next: () => { started++; return { menu: true }; } });
    app.scene.update();
    const reopened = body.children.at(-1);
    assert.equal(reopened.children[0].children[0].textContent, '게임 방법');
    assert.equal(reopened.children[1].hidden, false); // 다시 열 때도 같은 게임 설명에서 시작한다.
    assert.equal(reopened.children[1].children.length, 3);
    key('keydown', 'Enter');
    const actions = reopened.children.at(-1), groups = actions.children[1];
    assert.equal(groups.hidden, false);
    groups.dispatchEvent(new Event('click'));
    assert.equal(reopened.children[3].children.length, 2); // 메인 메뉴에서는 로컬 2인 키도 확인한다.
    key('keydown', 'Escape');
    assert.equal(started, 3); assert.equal(reopened.open, false);
  } finally { globalThis.window = previous; }
});
