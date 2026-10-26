import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderSetupCards } from '../src/input/setup-cards.js';
import { createSinglePlayerMenu } from '../src/app/menu-scenes.js';
import { MOCK_SKIN } from './fixtures/presentation.js';

test('선수 카드 안의 그림·이름·난이도 선택은 해당 CPU만 바꾸고 관전을 시작한다', () => {
  class Element {
    children = []; dataset = {}; events = {}; attributes = {};
    constructor(tag) { this.tag = tag; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { this.events[name] = callback; }
    getContext() { return {}; }
    querySelector() { return null; }
  }
  const document = { createElement: tag => new Element(tag), activeElement: null };
  const root = new Element('div');
  const app = { skin: MOCK_SKIN, sfx: { enabled: false }, setScene(scene) { this.scene = scene; } };
  createSinglePlayerMenu().touchItems(app).find(item => item.label === 'CPU 관전').activate();
  const setup = app.scene;
  assert.equal(setup.touchLayout, 'match-setup');
  const previews = [];
  const items = setup.touchItems(app).map((item, index) => index < 2 ? { ...item,
    drawPreview: (_, size) => previews.push([index, size]) } : item);
  renderSetupCards(document, root, items, setup.touchSetup, (index, delta) => setup.touchItems(app)[index].activate(delta));
  const cards = root.children.filter(child => child.className === 'setup-player-card');
  assert.equal(cards.length, 2);
  assert.deepEqual(previews, [[0, 320], [1, 320]]);
  const left = cards[0].children.filter(child => child.tag === 'select');
  const right = cards[1].children.filter(child => child.tag === 'select');
  assert.equal(left.length, 2); assert.equal(right.length, 2);
  assert.equal(left[0].children.length, MOCK_SKIN.characters.length);
  assert.equal(left[1].children.length, 7);
  assert.equal(left[0].attributes['aria-label'], 'CPU 1 캐릭터');
  assert.equal(right[1].attributes['aria-label'], 'CPU 2 난이도');
  left[0].value = '2'; left[0].events.change();
  left[1].value = '5'; left[1].events.change();
  const after = setup.touchItems(app);
  assert.equal(after[0].value, MOCK_SKIN.characters[2].name);
  assert.equal(after[1].value, MOCK_SKIN.characters[1].name);
  assert.equal(after[2].value, '아주 어려움');
  assert.equal(after[3].value, '보통');
  root.children.find(child => child.className === 'setup-start-button').events.click();
  assert.ok(app.scene.touchLabel().includes('CPU 관전'));
  assert.equal(app.scene.touchMode(), 'menu');
});

test('키보드 선택 표시는 기존 select를 보존하면서 포커스와 관전 시작 버튼에 동기화된다', async () => {
  const { updateSetupSelection } = await import('../src/input/setup-cards.js');
  const fields = [0, 1, 2, 3, 4].map(index => ({ dataset: { setupField: String(index) },
    attributes: {}, setAttribute(key, value) { this.attributes[key] = value; },
    focus() { focused = index; } }));
  let focused;
  const container = { querySelectorAll: () => fields };
  updateSetupSelection(container, fields.map((_, index) => ({ selected: index === 3 })), true);
  assert.equal(focused, 3);
  assert.deepEqual(fields.map(field => field.attributes['aria-current']), ['false','false','false','true','false']);
  updateSetupSelection(container, fields.map((_, index) => ({ selected: index === 4 })), true);
  assert.equal(focused, 4);
  assert.equal(fields[4].attributes['aria-current'], 'true');
});

for (const mode of ['cpu', 'versus', 'solo', 'watch']) test(`${mode}: 공통 DOM 카드는 사람에게 난이도를 붙이지 않고 시작 버튼을 올바른 항목에 연결한다`, async () => {
  const { createMatchSetup } = await import('../src/app/menu-scenes.js');
  class Element {
    children = []; dataset = {}; attributes = {}; events = {};
    constructor(tag) { this.tag = tag; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { this.events[name] = callback; }
    getContext() { return { fillText() {} }; }
  }
  const document = { createElement: tag => new Element(tag) }, root = new Element('div');
  const app = { skin: MOCK_SKIN }, setup = createMatchSetup({ mode }), picked = [];
  renderSetupCards(document, root, setup.touchItems(app), setup.touchSetup, (index, delta) => picked.push([index, delta]));
  const cards = root.children.filter(child => child.className === 'setup-player-card');
  assert.equal(cards.length, mode === 'solo' ? 1 : 2);
  cards.forEach((card, side) => {
    const selects = card.children.filter(child => child.tag === 'select');
    assert.equal(selects.length, mode === 'watch' || mode === 'cpu' && side === 1 ? 2 : 1);
    assert.equal(selects[0].attributes['aria-label'], `${setup.touchSetup.players[side].label} 캐릭터`);
  });
  const start = root.children.find(child => child.className === 'setup-start-button');
  start.events.click(); assert.deepEqual(picked, [[setup.touchSetup.startIndex, 1]]);
});

test('선수 카드의 대기 애니메이션은 매 표시 프레임을 전달하고 이전 그림을 지운다', async () => {
  const { animateSetupCards } = await import('../src/input/setup-cards.js');
  const calls = [], ctx = { clearRect: (...args) => calls.push(['clear', ...args]) };
  const canvas = { width: 320, height: 320, dataset: { setupPreview: '0' }, getContext: () => ctx };
  const container = { querySelectorAll: () => [canvas] };
  const items = [{ drawPreview: (_ctx, size, frame) => calls.push(['draw', size, frame]) }];
  animateSetupCards(container, items, 10); animateSetupCards(container, items, 11);
  assert.deepEqual(calls, [['clear',0,0,320,320],['draw',320,10],['clear',0,0,320,320],['draw',320,11]]);
});

test('펼친 선택 목록은 준비 중 항목을 표시하고 키보드 이동·선택·닫기를 처리한다', async () => {
  const { createSetupPicker } = await import('../src/input/setup-cards.js');
  let document;
  class Element {
    children = []; dataset = {}; attributes = {}; events = {}; open = false;
    constructor(tag) { this.tag = tag; }
    append(...children) { this.children.push(...children); children.forEach(child => { child.isConnected = true; }); }
    replaceChildren() { this.children = []; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { this.events[name] = callback; }
    showModal() { this.open = true; }
    close() { this.open = false; this.events.close?.(); }
    focus() { document.activeElement = this; }
    querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]).filter(child => child.tag === 'button' && child.dataset.choiceIndex !== undefined && !child.disabled); }
    querySelector(selector) { const buttons = this.querySelectorAll(); return selector.includes('aria-current') ? buttons.find(button => button.attributes['aria-current'] === 'true') : buttons[0]; }
  }
  document = { body: new Element('body'), createElement: tag => new Element(tag) };
  const chosen = [], closed = []; let opened = 0;
  const picker = createSetupPicker({ document }, { opened: () => opened++, choose: (...args) => chosen.push(args), closed: index => closed.push(index) });
  picker.open(1, { label: 'CPU 캐릭터', choiceLabels: ['첫째','준비 중','셋째'], choiceDisabled: [false,true,false], choiceIndex: 0 });
  const dialog = document.body.children[0], list = dialog.children[1];
  assert.equal(picker.isOpen, true); assert.equal(opened, 1);
  assert.equal(list.children[1].disabled, true);
  dialog.events.keydown({ key: 'ArrowDown', preventDefault() {}, stopPropagation() {} });
  assert.equal(document.activeElement, list.children[2]);
  list.children[2].events.click();
  assert.equal(picker.isOpen, false); assert.deepEqual(chosen, [[1,2]]); assert.deepEqual(closed, [1]);
});
