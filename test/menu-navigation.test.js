import test from 'node:test';
import assert from 'node:assert/strict';
import { menuActionForKey, directionalMenuIndex, attachMenuNavigation } from '../src/input/menu-navigation.js';

const box = (x, y, width = 100, height = 44) => ({ x, y, width, height });
test('메뉴 입력은 키보드와 분리된 이동·결정·뒤로 액션을 사용한다', () => {
  assert.equal(menuActionForKey('ArrowDown'), 'down');
  assert.equal(menuActionForKey('Enter'), 'confirm');
  assert.equal(menuActionForKey('Escape'), 'back');
  assert.equal(menuActionForKey('KeyQ'), null);
});
test('화면 배치에 따라 같은 행·열의 가까운 버튼으로 이동한다', () => {
  const rects = [box(0, 0), box(140, 0), box(0, 70), box(140, 70), box(350, 20)];
  assert.equal(directionalMenuIndex(rects, 0, 'right'), 1);
  assert.equal(directionalMenuIndex(rects, 0, 'down'), 2);
  assert.equal(directionalMenuIndex(rects, 3, 'up'), 1);
  assert.equal(directionalMenuIndex(rects, 3, 'left'), 2);
  assert.equal(directionalMenuIndex(rects, 0, 'up'), 0);
  assert.equal(directionalMenuIndex([box(0, 100), box(400, 100), box(100, 30)], 0, 'right'), 1);
  assert.equal(directionalMenuIndex([], 0, 'right'), -1);
  assert.equal(directionalMenuIndex(rects, -1, 'down'), 0);
});

function harness() {
  const view = new EventTarget(), root = new EventTarget();
  root.activeElement = null;
  let dialog = null, details = null, external = false, gameplay = false, back = 0;
  const elements = [];
  view.document = { querySelector: () => external ? {} : null };
  view.getComputedStyle = () => ({ visibility: 'visible' });
  view.queueMicrotask = queueMicrotask;
  view.MutationObserver = class { observe() {} disconnect() {} };
  root.querySelector = selector => selector === 'dialog[open]' ? dialog : selector.includes('[open]') ? details : null;
  root.querySelectorAll = selector => selector === 'dialog[open]' ? dialog ? [dialog] : [] : elements;
  root.getElementById = id => elements.find(element => element.id === id);
  function element(id, x, y, tagName = 'BUTTON') {
    const result = { id, tagName, dataset: {}, disabled: false, clicks: 0,
      getAttribute() { return null; }, hasAttribute() { return false; }, closest(selector) { return result.hidden && selector.includes('[hidden]') ? result : null; },
      getClientRects() { return [box(x, y)]; }, getBoundingClientRect() { return box(x, y); },
      focus() { root.activeElement = result; }, blur() { root.activeElement = null; },
      scrollIntoView() {}, click() { result.clicks++; }, contains(node) { return node === result; },
    };
    elements.push(result); return result;
  }
  const a = element('a', 0, 0), b = element('b', 0, 80), c = element('c', 0, 160);
  const nav = attachMenuNavigation({ view, root, getContext: () => ({ enabled: true, gameplay }), onBack: () => back++ });
  function key(code, target = root.activeElement, extra = {}) {
    const e = new Event('keydown', { cancelable: true });
    Object.assign(e, { code, composedPath: () => [target], ...extra });
    view.dispatchEvent(e); return e;
  }
  return { nav, root, a, b, c, element, key, back: () => back, gameplay: value => gameplay = value,
    dialog: value => dialog = value, external: value => external = value, details: value => details = value };
}
test('방향키·확정·뒤로를 공통 dispatch로 수행하고 비활성 항목은 건너뛴다', () => {
  const h = harness(); h.nav.sync(); assert.equal(h.root.activeElement, h.a);
  h.b.disabled = true;
  h.key('ArrowDown'); assert.equal(h.root.activeElement, h.c);
  h.key('Enter'); assert.equal(h.c.clicks, 1);
  h.nav.dispatch('back'); assert.equal(h.back(), 1);
});
test('문자·방향키·Enter는 입력창에 남기고 Escape로 뒤로 이동한다', () => {
  const h = harness(); h.a.tagName = 'INPUT'; h.a.focus();
  assert.equal(h.key('ArrowDown').defaultPrevented, false);
  assert.equal(h.key('Enter').defaultPrevented, false);
  assert.equal(h.key('Backspace').defaultPrevented, false);
  assert.equal(h.key('Escape').defaultPrevented, true);
  assert.equal(h.back(), 1);
  h.key('Escape'); assert.equal(h.back(), 2);
});
test('경기 방향키는 가로채지 않고 Esc만 메뉴로 전달하며 연속 확정은 막는다', () => {
  const h = harness(); h.gameplay(true);
  assert.equal(h.key('ArrowLeft', {}).defaultPrevented, false);
  h.key('Escape', {}); assert.equal(h.back(), 1);
  h.gameplay(false); h.a.focus();
  h.key('Enter', h.a, { repeat: true }); assert.equal(h.a.clicks, 0);
});
test('모달에서는 내부 항목만 탐색하고 뒤로는 모달을 먼저 닫는다', () => {
  const h = harness();
  const dialog = { id: 'dialog', querySelectorAll: () => [h.b, h.c], close() { h.dialog(null); } };
  h.dialog(dialog); h.nav.sync(); assert.equal(h.root.activeElement, h.b);
  h.key('ArrowDown'); assert.equal(h.root.activeElement, h.c);
  h.key('Tab'); assert.equal(h.root.activeElement, h.b);
  h.key('Tab', h.b, { shiftKey: true }); assert.equal(h.root.activeElement, h.c);
  h.key('Escape'); assert.equal(h.back(), 0);
});


test('외부 게임 방법 모달이 열리면 온라인 포커스 복구와 입력을 중단한다', () => {
  const h = harness(); h.external(true); h.nav.sync();
  assert.equal(h.root.activeElement, null);
  assert.equal(h.nav.dispatch('down'), false);
  assert.equal(h.key('Enter', {}).defaultPrevented, false);
  h.external(false); h.nav.sync();
  assert.equal(h.root.activeElement, h.a);
});


test('경기 결과가 표시되면 게임판에서 결과의 기본 행동으로 포커스를 옮긴다', () => {
  const h = harness();
  const result = h.element('online-result', 0, 200, 'DIV'); result.hidden = true;
  const retry = h.element('retry', 0, 220); retry.hidden = true;
  retry.hasAttribute = name => name === 'data-menu-default';
  result.contains = node => node === retry;
  h.nav.sync(); assert.equal(h.root.activeElement, h.a);
  result.hidden = false; retry.hidden = false; h.nav.sync();
  assert.equal(h.root.activeElement, retry);
});
