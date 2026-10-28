import { analytics } from '../analytics/client.js';
import { analyticsMode } from '../analytics/events.js';
import { defaultKeyBindings, keyLabel } from '../input/key-settings.js';

export const CONTROLS_GUIDE_KEY = 'chii-drop:controls-guide:v2';
export function guideContext(mode, touch) { return `${mode === 'online' ? 'online' : mode === 'versus' ? 'versus' : 'solo'}:${touch ? 'touch' : 'keyboard'}`; }
export function hasSeenGuide(storage, context) {
  try { return JSON.parse(storage?.getItem(CONTROLS_GUIDE_KEY) ?? '{}')?.[context] === true; } catch { return false; }
}
export function rememberGuide(storage, context) {
  try {
    let seen;
    try { seen = JSON.parse(storage.getItem(CONTROLS_GUIDE_KEY) ?? '{}'); } catch { seen = {}; }
    storage.setItem(CONTROLS_GUIDE_KEY, JSON.stringify({ ...seen, [context]: true }));
  } catch { /* 저장이 차단되어도 대전은 시작할 수 있다. */ }
}
export function guideRows(bindings = defaultKeyBindings(), group = 'solo') {
  const key = (action) => keyLabel(bindings[group][action][0]);
  return [[`${key('LEFT')}  ${key('RIGHT')}`, '이동'], [key('DOWN'), '빠르게 내리기'],
    [key('ROTATE_CCW'), '왼쪽 회전'], [key('ROTATE_CW'), '오른쪽 회전']];
}

// 다음 장면은 확인 이후에 생성한다. 안내 중에는 경기 시간과 난수가 진행되지 않는다.
export function withControlsGuide(app, { mode = 'solo', next, background, force = false, stamps = [] }) {
  const view = window, touch = app.mobile?.touchInput ?? (app.mobile?.visible === true), context = guideContext(mode, touch);
  let storage;
  try { storage = view.localStorage; } catch { /* 메모리 내에서도 안내를 기억한다. */ }
  app.controlsGuidesSeen ??= new Set();
  if (!force && (app.controlsGuidesSeen.has(context) || hasSeenGuide(storage, context))) {
    app.setScene(next(), { stamps }); return;
  }
  let opened = false;
  app.setScene({
    draw: (ctx) => background.draw(ctx, app),
    update() {
      if (opened) return;
      opened = true;
      analytics.track('controls_guide', { mode: analyticsMode(mode), action: 'shown', input_method: touch ? 'touch' : 'keyboard' });
      const openingKeys = new Set(app.keyboard.held);
      const doc = view.document, dialog = doc.createElement('dialog');
      dialog.className = 'controls-guide'; dialog.setAttribute('aria-labelledby', 'controls-guide-title');
      const heading = doc.createElement('h2'); heading.id = 'controls-guide-title';
      heading.textContent = '게임 방법';
      const header = doc.createElement('header'), tabs = doc.createElement('div');
      tabs.className = 'game-guide-tabs'; tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', '안내 선택');
      const rulesTab = doc.createElement('button'), controlsTab = doc.createElement('button');
      rulesTab.type = controlsTab.type = 'button'; rulesTab.textContent = '1. 게임 설명'; controlsTab.textContent = '2. 조작 방법';
      tabs.append(rulesTab, controlsTab); header.append(heading, tabs);
      const rules = doc.createElement('div'); rules.className = 'game-guide-rules';
      for (const [title, description, picture] of [
        ['같은 색 4개 연결', '같은 색 블록을 가로·세로로 4개 이상 이으면 사라져요.', '● ● ● ●'],
        ['이어서 지우면 연쇄', '사라진 자리에 블록이 떨어져 다시 연결되면 연쇄! 큰 연쇄일수록 공격도 강해져요.', '1연쇄 → 2연쇄!'],
        ['대전에서는 방해 공격', '블록을 지워 상대에게 방해 블록을 보내요. 내 쪽에 올 방해도 지워서 줄일 수 있어요.', '내 연쇄 → 상대'],
      ]) {
        const card = doc.createElement('section'), h = doc.createElement('h3'), image = doc.createElement('div'), text = doc.createElement('p');
        h.textContent = title; image.className = 'game-guide-picture'; image.textContent = picture; image.setAttribute('aria-hidden', 'true');
        text.textContent = description; card.append(image, h, text); rules.append(card);
      }
      const warning = doc.createElement('p'); warning.className = 'game-guide-warning';
      warning.textContent = '위쪽 입구(왼쪽에서 세 번째 칸)가 막히면 패배해요. 연습 모드에서는 혼자 연쇄를 연습할 수 있어요.';
      const cards = doc.createElement('div'); cards.className = 'controls-guide-cards';
      const addCard = (title, rows, pad = false) => {
        const card = doc.createElement('section'), h = doc.createElement('h3'); h.textContent = title; card.append(h);
        if (pad) {
          const diagram = doc.createElement('div'); diagram.className = 'controls-guide-pad'; diagram.setAttribute('aria-hidden', 'true');
          diagram.innerHTML = '<span>←　→<br>↓</span><span>↺　↻</span>'; card.append(diagram);
        }
        const list = doc.createElement('dl');
        for (const [key, action] of rows) { const dt = doc.createElement('dt'), dd = doc.createElement('dd'); dt.textContent = key; dd.textContent = action; list.append(dt, dd); }
        card.append(list); cards.append(card);
      };
      if (touch) {
        addCard('양손으로 터치하세요', [['왼쪽 패드 ← →', '이동'], ['왼쪽 패드 ↓', '빠르게 내리기'],
          ['오른쪽 패드 ↺ / ↻', '왼쪽 / 오른쪽 회전'], mode === 'online' ? ['옵션 버튼', '터치 배치 변경'] : ['일시정지 버튼', '잠시 멈추기']], true);
      } else {
        const bindings = app.keyboard.bindings ?? defaultKeyBindings();
        if (mode === 'versus') { addCard('1P', guideRows(bindings, 'p1')); addCard('2P', guideRows(bindings, 'p2')); }
        else addCard('키보드', guideRows(bindings));
      }
      const note = doc.createElement('p');
      note.textContent = mode === 'online' ? '온라인 경기는 일시정지할 수 없어요. 양쪽 모두 안내를 확인하고 준비하면 시작합니다.' : touch ? (mode === 'versus' ? '1P / 2P 버튼으로 조작할 플레이어를 바꿔요. 설정에서 터치 영역을 바꿀 수 있어요.' : '설정에서 터치 영역을 바꿀 수 있어요.')
        : `${(app.keyboard.bindings ?? defaultKeyBindings()).pause.map(keyLabel).join(' / ')}: 일시정지 · 설정에서 키 변경`;
      const actions = doc.createElement('div'); actions.className = 'game-guide-actions';
      const previous = doc.createElement('button'), button = doc.createElement('button'); previous.type = button.type = 'button'; previous.textContent = '게임 설명';

      let page = 'rules', local = mode === 'versus';
      const groupButton = doc.createElement('button'); groupButton.type = 'button'; groupButton.className = 'game-guide-group';
      groupButton.addEventListener('click', () => {
        local = !local; cards.replaceChildren();
        const bindings = app.keyboard.bindings ?? defaultKeyBindings();
        if (local) { addCard('1P', guideRows(bindings, 'p1')); addCard('2P', guideRows(bindings, 'p2')); }
        else addCard('키보드', guideRows(bindings));
        groupButton.textContent = local ? '1인 조작 보기' : '로컬 2인 조작 보기';
      });
      groupButton.textContent = local ? '1인 조작 보기' : '로컬 2인 조작 보기';
      const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.textContent = '설정으로'; cancel.hidden = force;
      cancel.addEventListener('click', () => finish(undefined, true));
      button.className = 'game-guide-primary';
      actions.append(previous, groupButton, button, cancel);
      function showPage(value) {
        page = value; const controls = page === 'controls';
        rules.hidden = warning.hidden = controls; cards.hidden = note.hidden = !controls;
        groupButton.hidden = !controls || !force || touch; previous.hidden = !controls && !force;
        previous.textContent = controls ? '게임 설명' : '닫기';
        rulesTab.setAttribute('aria-pressed', String(!controls)); controlsTab.setAttribute('aria-pressed', String(controls));
        button.textContent = controls ? (force ? '닫기' : '확인하고 시작') : '조작 방법 보기';
      }
      rulesTab.addEventListener('click', () => showPage('rules')); controlsTab.addEventListener('click', () => showPage('controls'));
      previous.addEventListener('click', () => { if (force && page === 'rules') finish(); else showPage('rules'); });
      function clear() { app.mobile?.clear(); for (const name of ['held', 'pressed', 'touchHeld', 'touchPressed']) app.keyboard[name]?.clear(); }
      function finish(code, cancelled = false) {
        if (!dialog.open || openingKeys.size) return;
        view.removeEventListener('keydown', onKey, { capture: true });
        view.removeEventListener('keyup', onRelease, { capture: true });
        view.removeEventListener('blur', releaseOpeningKeys);
        // 확인 키를 놓을 때까지 반복 입력이 게임으로 넘어가지 않게 한다.
        if (code) {
          const block = (event) => { if (event.code === code) { event.preventDefault(); event.stopImmediatePropagation(); } };
          const release = (event) => { if (event.code === code) cleanup(); };
          const cleanup = () => { view.removeEventListener('keydown', block, { capture: true }); view.removeEventListener('keyup', release, { capture: true }); view.removeEventListener('blur', cleanup); };
          view.addEventListener('keydown', block, { capture: true }); view.addEventListener('keyup', release, { capture: true }); view.addEventListener('blur', cleanup);
        }
        analytics.track('controls_guide', { mode: analyticsMode(mode), action: cancelled ? 'cancelled' : 'completed', input_method: touch ? 'touch' : 'keyboard' });
        dialog.close(); dialog.remove(); clear();
        if (!force && !cancelled) { app.controlsGuidesSeen.add(context); rememberGuide(storage, context); }
        app.setScene(cancelled ? background : next());
      }
      function advance(code) {
        if (openingKeys.size) return;
        if (page === 'rules') showPage('controls'); else finish(code);
      }
      function onKey(event) {
        if (event.code === 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return;
        event.stopImmediatePropagation(); event.preventDefault();
        if (event.repeat || openingKeys.size) return;
        if (event.code === 'ArrowLeft') showPage('rules');
        else if (event.code === 'ArrowRight') showPage('controls');
        else if (event.code === 'Escape') finish(event.code, !force);
        else if (['Enter', 'Space'].includes(event.code)) {
          const target = event.target;
          if ([rulesTab, controlsTab, previous, groupButton, cancel].includes(target)) target.click();
          else advance(event.code);
        }
      }
      function onRelease(event) {
        if (openingKeys.delete(event.code)) { event.preventDefault(); event.stopImmediatePropagation(); }
      }
      const releaseOpeningKeys = () => openingKeys.clear();
      view.addEventListener('blur', releaseOpeningKeys);
      view.addEventListener('keyup', onRelease, { capture: true });
      view.addEventListener('keydown', onKey, { capture: true });
      button.addEventListener('click', () => advance());
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(undefined, !force); });
      showPage('rules');
      dialog.append(header, rules, warning, cards, note, actions); doc.body.append(dialog); clear(); dialog.showModal();
      // 선택에 쓴 Space를 놓을 때 확인 버튼의 기본 클릭이 발생하는 것을 막는다.
      if (openingKeys.size) { dialog.tabIndex = -1; dialog.focus(); } else button.focus();
    },
  }, { stamps });
}


// 온라인은 준비 패킷을 보내기 전에 같은 안내를 확인한다. 엔진 시간은 진행하지 않는다.
export function showOnlineControls({ keyboard, touch = false, force = false }) {
  return new Promise(resolve => {
    const done = {};
    const app = { keyboard, mobile: { visible: touch, clear() {} },
      setScene(scene) { if (scene === done) resolve(); else queueMicrotask(() => scene.update()); } };
    withControlsGuide(app, { mode: 'online', force, background: { draw() {} }, next: () => done });
  });
}
