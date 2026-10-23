import test from 'node:test';
import assert from 'node:assert/strict';
import { attachMobileViewport, isTextEntry } from '../src/net/mobile-viewport.js';

function harness({ withViewport = true } = {}) {
  const properties = new Map(), frames = new Map(); let nextFrame = 0;
  const view = new EventTarget(), doc = new EventTarget(), viewport = new EventTarget();
  Object.assign(viewport, { height: 844, offsetTop: 0, scale: 1 });
  Object.assign(doc, { documentElement: { style: {
    setProperty: (name, value) => properties.set(name, value), removeProperty: (name) => properties.delete(name),
  } }, body: { dataset: {} }, activeElement: null });
  Object.assign(view, { document: doc, innerHeight: 844, visualViewport: withViewport ? viewport : undefined,
    requestAnimationFrame: (cb) => { frames.set(++nextFrame, cb); return nextFrame; },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  let scrolled = 0, blurred = 0;
  const input = { tagName: 'INPUT', type: 'text', disabled: false, readOnly: false,
    getBoundingClientRect: () => ({ top: 600, bottom: 648 }),
    scrollIntoView() { scrolled++; }, blur() { blurred++; doc.activeElement = null; },
  };
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((cb) => cb()); };
  const mobile = attachMobileViewport(view); flush();
  return { view, doc, viewport, properties, frames, input, mobile, flush, scrolled: () => scrolled, blurred: () => blurred };
}

test('레이아웃 높이가 그대로인 Safari 키보드 상황에서 실제 가시 영역과 편집 상태를 반영한다', () => {
  const h = harness(); h.doc.activeElement = h.input;
  h.doc.dispatchEvent(new Event('focusin'));
  h.viewport.height = 416; h.viewport.offsetTop = 90;
  h.viewport.dispatchEvent(new Event('resize')); h.flush();
  assert.equal(h.properties.get('--visible-height'), '416px');
  assert.equal(h.properties.get('--visible-top'), '90px');
  assert.equal(h.doc.body.dataset.editing, 'true'); assert.equal(h.doc.body.dataset.keyboardOpen, 'true');
  assert.equal(h.scrolled(), 1);
  h.viewport.dispatchEvent(new Event('scroll')); h.flush();
  assert.equal(h.scrolled(), 1, '사용자의 스크롤을 자동 중앙 정렬로 되돌리지 않는다');
  h.doc.activeElement = null; h.doc.dispatchEvent(new Event('focusout')); h.flush();
  assert.equal(h.doc.body.dataset.editing, 'false'); assert.equal(h.doc.body.dataset.keyboardOpen, 'false');
});
test('보이는 입력창은 움직이지 않고 핀치 줌·브라우저 UI 크기 변화는 키보드로 오인하지 않는다', () => {
  const h = harness(); h.input.getBoundingClientRect = () => ({ top: 100, bottom: 148 });
  h.doc.activeElement = h.input; h.viewport.height = 800;
  h.doc.dispatchEvent(new Event('focusin')); h.flush();
  assert.equal(h.scrolled(), 0); assert.equal(h.doc.body.dataset.keyboardOpen, 'false');
  h.viewport.height = 400; h.viewport.scale = 2; h.viewport.dispatchEvent(new Event('resize')); h.flush();
  assert.equal(h.doc.body.dataset.keyboardOpen, 'false');
  h.mobile.dismissKeyboard(); assert.equal(h.blurred(), 1);
});
test('VisualViewport가 없는 브라우저의 fallback, 이벤트 병합과 해제를 지원한다', () => {
  const h = harness({ withViewport: false }); h.view.innerHeight = 375;
  h.view.dispatchEvent(new Event('resize')); h.view.dispatchEvent(new Event('resize'));
  assert.equal(h.frames.size, 1); h.flush();
  assert.equal(h.properties.get('--visible-height'), '375px'); assert.equal(h.properties.get('--visible-top'), '0px');
  h.mobile.dispose(); assert.equal(h.properties.size, 0);
  h.view.dispatchEvent(new Event('resize')); assert.equal(h.frames.size, 0);
});
test('선택 메뉴·버튼·읽기 전용 입력은 소프트 키보드용 텍스트 입력으로 분류하지 않는다', () => {
  for (const element of [null, { tagName: 'SELECT' }, { tagName: 'BUTTON' }, { tagName: 'INPUT', type: 'checkbox' }, { tagName: 'INPUT', type: 'text', readOnly: true }]) assert.equal(isTextEntry(element), false);
  for (const element of [{ tagName: 'INPUT', type: 'password' }, { tagName: 'INPUT', type: 'search' }, { tagName: 'TEXTAREA' }, { isContentEditable: true }]) assert.equal(isTextEntry(element), true);
});

test('작은 가시 영역과 고정 제출 버튼을 피해서 포커스된 입력을 스크롤한다', () => {
  const h = harness(); h.doc.activeElement = h.input;
  h.input.getBoundingClientRect = () => ({ top: 180, bottom: 230 });
  h.input.closest = () => ({ querySelector: () => ({ getBoundingClientRect: () => ({ top: 227 }) }) });
  h.viewport.height = 300; h.viewport.dispatchEvent(new Event('resize')); h.flush();
  assert.equal(h.doc.body.dataset.compactViewport, 'true'); assert.equal(h.scrolled(), 1);
  h.viewport.height = 844; h.viewport.dispatchEvent(new Event('resize')); h.flush();
  assert.equal(h.doc.body.dataset.compactViewport, 'false');
});
