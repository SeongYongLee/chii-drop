import { createTitleTransition } from './title-transition.js';
import { renderRecordsPanel } from './records-panel.js';
import { attachTouchControls } from '../net/touch.js';
import { setTouchKeys, MENU_KEYS } from './keyboard.js';
import { createTouchLayoutEditor } from './touch-layout.js';
import { createPauseDialog } from './pause-dialog.js';
import { createMenuCompanions } from './menu-companions.js';
import { renderSetupCards, updateSetupSelection, animateSetupCards, createSetupPicker } from './setup-cards.js';

export const MOBILE_INPUT = Object.freeze({ left: 1, right: 2, down: 4, cw: 8, ccw: 16,
  up: 32, confirm: 64, back: 128, pause: 256 });

export function mobileKeyCodes(input, { mode = 'menu', player = null, backPlayer = null } = {}) {
  const first = player === 0;
  const keys = mode === 'game'
    ? { left: first ? 'KeyA' : 'ArrowLeft', right: first ? 'KeyD' : 'ArrowRight',
      down: first ? 'KeyS' : 'ArrowDown', cw: first ? 'KeyG' : 'KeyX', ccw: first ? 'KeyF' : 'KeyZ', pause: 'Escape' }
    : { left: first ? 'KeyA' : 'ArrowLeft', right: first ? 'KeyD' : 'ArrowRight',
      down: first ? 'KeyS' : 'ArrowDown', up: first ? 'KeyW' : 'ArrowUp',
      confirm: first ? 'KeyG' : player === 1 ? 'Period' : 'Enter',
      back: first ? 'KeyF' : player === 1 ? 'Comma' : 'Escape' };
  // 2P 로컬 경기의 회전 키는 일반 1인 조작과 다르다.
  if (mode === 'game' && player === 1) { keys.cw = 'Period'; keys.ccw = 'Comma'; }
  if (mode === 'menu' && backPlayer === 0) keys.back = 'KeyF';
  return Object.entries(keys).filter(([name]) => input & MOBILE_INPUT[name]).map(([, code]) => code);
}

export function attachMobileControls({ view, canvas, container, keyboard, getContext, onTap, onUnlock, menuButton, onPause, backNavigationButton, onBack }) {
  // 초기화 테스트·자료 없는 화면에서는 터치 DOM을 요구하지 않는다.
  if (!container?.querySelectorAll || !canvas.addEventListener) return { read() {}, sync() {}, clear() {}, visible: false };
  const touch = attachTouchControls(container);
  const menu = container.querySelector('[data-mobile-menu]');
  const game = container.querySelector('[data-mobile-game]');
  const label = container.querySelector('[data-mobile-label]');
  const heading = container.querySelector('[data-menu-heading]');
  const fanNotice = view.document.getElementById?.('fan-notice');
  const playerButton = container.querySelector('[data-mobile-player]');
  const nativeItems = container.querySelector('[data-mobile-items]');
  const confirmButton = container.querySelector('[data-mobile-confirm]');
  const notice = container.querySelector('[data-mobile-notice]');
  const backButton = menu.querySelector?.('[data-input="128"]');
  const companions = createMenuCompanions(view.document, container, onUnlock);
  const media = view.matchMedia('(pointer: coarse), (max-width: 760px), (max-height: 500px) and (max-width: 960px)');
  let context = {}, key = '', queued = 0, localPlayer = 0, start = null, enabled = false, itemsKey = '';
  let setupItemsKey = '', noticeKey = '', backWasSelected = false;
  let chromeState = [];
  let renderedLayout, titleSource;
  const titleTransition = createTitleTransition({ document: view.document, canvas, menu: container, onComplete: clearEditorInput });
  const pauseDialog=createPauseDialog(view,{
    opened:()=>clearEditorInput(),
    choose:index=>{onUnlock();context.items?.[index]?.activate();sync()},
  });
  const setupPicker = createSetupPicker(view, {
    opened: () => clearEditorInput(),
    choose: (index, delta) => { onUnlock(); context.items?.[index]?.activate(delta); sync(); },
    closed: index => nativeItems.querySelector?.(`[data-setup-field="${index}"]`)?.focus({ preventScroll: true }),
  });
  function clearEditorInput() { clear(); keyboard.held.clear(); keyboard.pressed.clear(); keyboard.rotationInputs?.clear(); }
  const editor = game.querySelectorAll ? createTouchLayoutEditor({ view, game,
    onOpen: clearEditorInput, onClose: () => { clearEditorInput(); sync(); } }) : null;
  function renderItems() {
    const items = context.items ?? [];
    const signature = JSON.stringify([context.layout, context.records, context.setup, context.columns, items.map(({ label, value, disabled, selected, adjustable, previewKey, compactLabel, sectionLabel }) =>
      [label, value, disabled, selected, adjustable, previewKey, compactLabel, sectionLabel])]);
    if (signature === itemsKey) return;
    itemsKey = signature;
    if (context.records) {
      setupItemsKey = ''; renderRecordsPanel(view.document, nativeItems, context.records); return;
    }
    if (context.layout === 'match-setup') {
      nativeItems.dataset.columns = '2'; nativeItems.dataset.grouped = 'false';
      const contentKey = JSON.stringify([context.setup, items.map(({ selected, ...item }) => item)]);
      if (setupItemsKey === contentKey) {
        updateSetupSelection(nativeItems, items, view.document.activeElement?.dataset?.setupField !== undefined);
        return;
      }
      setupItemsKey = contentKey;
      renderSetupCards(view.document, nativeItems, items, context.setup, (index, delta) => {
        onUnlock(); context.items?.[index]?.activate(delta); sync();
      }, index => { context.items?.[index]?.focus?.(); sync(); }, setupPicker ? index => setupPicker.open(index, context.items?.[index]) : undefined);
      return;
    }
    setupItemsKey = '';
    const focused = nativeItems.contains?.(view.document.activeElement) ? view.document.activeElement : null;
    const focusIndex = focused ? [...nativeItems.querySelectorAll('button')].indexOf(focused) : -1;
    const focusLabel = focused?.dataset?.itemLabel;
    nativeItems.replaceChildren(); nativeItems.hidden = !items.length;
    nativeItems.dataset.columns = String(context.columns ?? 1);
    nativeItems.dataset.grouped = String(items.some(item => item.sectionLabel));
    items.forEach((item, index) => {
      if (item.sectionLabel) {
        const heading = view.document.createElement('div');
        heading.className = 'mobile-item-heading'; heading.textContent = item.sectionLabel;
        heading.setAttribute('role', 'heading'); heading.setAttribute('aria-level', '3');
        nativeItems.append(heading);
      }
      const row = view.document.createElement('div'); row.className = 'mobile-item';
      row.dataset.adjustable = String(Boolean(item.adjustable));
      row.dataset.compact = String(Boolean(item.compactLabel));
      const makeButton = (text, delta, ariaLabel) => {
        const button = view.document.createElement('button'); button.type = 'button';
        button.dataset.itemLabel = item.label;
        button.textContent = text; button.disabled = Boolean(item.disabled);
        if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
        button.addEventListener('click', () => { onUnlock(); context.items?.[index]?.activate(delta); sync(); });
        row.append(button); return button;
      };
      const fullLabel = item.value === undefined ? item.label : `${item.label} · ${item.value}`;
      const button = item.compactLabel ? view.document.createElement('span') : makeButton(fullLabel, 1, fullLabel);
      if (item.compactLabel) {
        button.className = 'mobile-stepper-value'; button.textContent = String(item.value);
        button.setAttribute('aria-live', 'polite'); row.append(button);
      }
      if (item.drawPreview) {
        button.classList.add('mobile-character-card');
        const portrait = view.document.createElement('canvas');
        portrait.width = portrait.height = 160;
        portrait.className = 'mobile-character-preview'; portrait.setAttribute('aria-hidden', 'true');
        const preview = portrait.getContext('2d');
        if (preview) item.drawPreview(preview, 160);
        const name = view.document.createElement('span'); name.textContent = item.label;
        button.replaceChildren(portrait, name);
      }
      if (item.selected) button.setAttribute('aria-current', 'true');
      if (item.adjustable) {
        makeButton('−', -1, `${item.label} 줄이기`); makeButton('+', 1, `${item.label} 늘리기`);
      }
      nativeItems.append(row);
    });
    const focusTarget = focusIndex >= 0 ? nativeItems.querySelectorAll('button')[focusIndex] : null;
    if (focusTarget?.dataset.itemLabel === focusLabel && focusLabel !== undefined) focusTarget.focus({ preventScroll: true });
    if (enabled) nativeItems.querySelector?.('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  function clear() { touch.clear(); queued = 0; keyboard.touchHeld?.clear(); keyboard.touchPressed?.clear(); }
  function sync({ render = true } = {}) {
    context = getContext();
    if (context.local) context = { ...context, player: localPlayer };
    const nextKey = `${context.enabled}:${context.mode}:${context.player}:${context.paused}`;
    if (nextKey !== key) { clear(); key = nextKey; }
    const active = Boolean(context.enabled && (media.matches || ['match-setup', 'list-menu', 'title-menu'].includes(context.layout)) && !editor?.editing);
    if (enabled !== active) { enabled = active; touch.setEnabled(enabled); }
    // 입력을 읽을 때도 최신 모드·플레이어는 반영하되 DOM은 장면 갱신 후 한 번 그린다.
    if (!render) return;
    const departure = renderedLayout === 'title-menu' && context.layout === 'list-menu' && context.enabled
      ? titleTransition.prepare(titleSource) : null;
    if (context.layout !== 'list-menu' || !context.enabled) titleTransition.cancel();
    renderedLayout = context.layout;
    if (context.layout === 'title-menu') titleSource = context.titleSource;
    const modalPause=Boolean(context.enabled && context.paused && pauseDialog);
    const nextChrome = [active, modalPause, media.matches, localPlayer, context.enabled, context.mode,
      context.paused, context.canPause, context.canBack, context.layout, context.gameScreen, context.direct,
      context.title, context.hideBack, context.notice, context.noticeSummary, context.heading,
      context.fanNotice, context.versionLabel, context.onlineActive, context.onlineMenu, context.backSelected,
      context.label, context.local, Boolean(context.items?.length), Boolean(context.records)];
    if (chromeState.length !== nextChrome.length || nextChrome.some((value, index) => value !== chromeState[index])) {
      chromeState = nextChrome;
      if (menuButton) menuButton.hidden = !context.enabled || media.matches || !(context.canPause ?? context.mode === 'game') || Boolean(context.paused);
      if (backNavigationButton) backNavigationButton.hidden = !context.enabled || media.matches || !context.canBack || ['match-setup', 'list-menu', 'title-menu'].includes(context.layout) || Boolean(context.gameScreen);
      container.hidden = (!media.matches && !['match-setup', 'list-menu', 'title-menu'].includes(context.layout)) || modalPause;
      container.dataset.menuLayout = context.layout ?? '';
      container.dataset.records = String(Boolean(context.records));
      if (view.document.body) view.document.body.dataset.menuRecords = String(Boolean(context.records));
      if (view.document.body) view.document.body.dataset.menuLayout = active ? (context.layout ?? '') : '';
      menu.hidden = context.mode === 'game'; game.hidden = context.mode !== 'game';
      if (container.dataset.mode !== context.mode) container.dataset.mode = context.mode;
      if (view.document.body) view.document.body.dataset.touchMode = active ? (modalPause && context.gameScreen ? 'game' : context.mode) : 'none';
      if (view.document.body) view.document.body.dataset.gameScreen = String(Boolean(context.gameScreen));
      menu.dataset.hasItems = String(Boolean(context.items?.length));
      menu.dataset.title = String(Boolean(context.title));
      confirmButton.hidden = Boolean(context.direct);
      confirmButton.textContent = context.title ? '시작' : '결정';
      if(backButton)backButton.hidden=Boolean(context.title||context.hideBack);
      if (notice) {
        notice.hidden = !context.notice;
        const nextNoticeKey = JSON.stringify([context.notice, context.noticeSummary]);
        if (noticeKey !== nextNoticeKey) {
          noticeKey = nextNoticeKey;
          if (context.noticeSummary) {
            const details = view.document.createElement('details');
            const summary = view.document.createElement('summary'); summary.textContent = context.noticeSummary;
            const text = view.document.createElement('p'); text.textContent = context.notice;
            details.append(summary, text); notice.replaceChildren(details);
          } else notice.textContent = context.notice ?? '';
        }
      }
      if (heading) {
        heading.hidden = !context.heading || context.layout === 'match-setup';
        if (heading.textContent !== (context.heading ?? '')) heading.textContent = context.heading ?? '';
      }
      if (fanNotice) {
        fanNotice.hidden = context.onlineActive ? !context.onlineMenu : !['list-menu', 'title-menu', 'match-setup'].includes(context.layout);
        const text = [context.fanNotice, context.versionLabel].filter(Boolean).join('\n');
        if (fanNotice.textContent !== text) fanNotice.textContent = text;
      }
      if (backButton) {
        if (context.backSelected) {
          backButton.setAttribute('aria-current', 'true');
          if (!backWasSelected) backButton.scrollIntoView?.({ block: 'nearest' });
        }
        else backButton.removeAttribute('aria-current');
        backWasSelected = Boolean(context.backSelected);
      }
      const text = context.label ?? (context.enabled ? '메뉴 선택' : '불러오는 중…');
      label.hidden = !text;
      if (label.textContent !== text) label.textContent = text;
      playerButton.hidden = !context.local;
      const playerText = `${localPlayer + 1}P 조작 · 전환`;
      if (playerButton.textContent !== playerText) playerButton.textContent = playerText;
    }
    renderItems();
    companions.sync(context.companions, context.companionAnchor);
    if (departure) { clearEditorInput(); titleTransition.start(departure, context.companions ?? []); }
    if (context.layout === 'match-setup') animateSetupCards(nativeItems, context.items ?? [], context.animationFrame ?? 0);
    pauseDialog?.sync(context.items??[],modalPause);
  }
  view.addEventListener('keydown', event => {
    if (titleTransition.active && Object.values(MENU_KEYS).some(codes => codes.includes(event.code))) {
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    if (event.target?.closest?.('.menu-companion')) return;
    if (enabled && context.records && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.code)) {
      const panel = nativeItems.querySelector?.('.records-panel');
      if (panel) {
        const step = event.code.startsWith('Page') ? panel.clientHeight * .8 : 56;
        const top = event.code === 'Home' ? 0 : event.code === 'End' ? panel.scrollHeight
          : panel.scrollTop + (['ArrowUp', 'PageUp'].includes(event.code) ? -step : step);
        panel.scrollTo({ top, behavior: 'instant' });
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
    }
    if (['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS'].includes(event.code) && event.target === backButton) backButton.blur?.();
    if (setupPicker?.isOpen || !['match-setup', 'list-menu', 'title-menu'].includes(context.layout) || !['Enter', 'Space'].includes(event.code)) return;
    if (event.target === backButton) {
      event.preventDefault(); event.stopImmediatePropagation();
      onUnlock(); queued |= MOBILE_INPUT.back;
      return;
    }
    if (context.backSelected) {
      event.preventDefault(); event.stopImmediatePropagation();
      onUnlock(); queued |= MOBILE_INPUT.back; return;
    }
    if (context.layout !== 'match-setup') return;
    const selected = nativeItems.querySelector?.('[data-setup-choice][aria-current="true"], select[aria-current="true"]');
    if (!selected || selected.disabled) return;
    event.preventDefault(); event.stopImmediatePropagation();
    selected.focus({ preventScroll: true });
    try { if (setupPicker) setupPicker.open(Number(selected.dataset.setupField), context.items?.[Number(selected.dataset.setupField)]); else selected.showPicker?.(); } catch { /* 지원하지 않는 환경에서도 선택 항목의 포커스는 유지한다. */ }
  }, true);
  backNavigationButton?.addEventListener?.('click', () => { onUnlock(); clearEditorInput(); onBack?.(); sync(); });
  for (const type of ['keydown', 'keyup']) backNavigationButton?.addEventListener?.(type, event => event.stopPropagation());
  menuButton?.addEventListener?.('click', () => { onUnlock(); clearEditorInput(); onPause?.(); sync(); });
  for (const type of ['keydown', 'keyup']) menuButton?.addEventListener?.(type, event => event.stopPropagation());
  playerButton.addEventListener('click', () => { localPlayer = 1 - localPlayer; clear(); sync(); });
  // 포커스된 터치 버튼의 Enter가 전역 키보드 입력으로 한 번 더 들어가지 않게 한다.
  for (const event of ['keydown', 'keyup']) container.addEventListener(event, (e) => {
    if (context.layout === 'match-setup' && e.target?.tagName === 'SELECT' && (e.code === 'Enter' || e.code === 'Space')) { e.stopPropagation(); return; }
    if (['match-setup', 'list-menu', 'title-menu'].includes(context.layout) && Object.values(MENU_KEYS).some(codes => codes.includes(e.code))) {
      e.preventDefault(); // select 자체의 값 변경·버튼 클릭과 게임의 프레임 입력이 중복되지 않게 한다.
    } else e.stopPropagation();
  });
  container.addEventListener('pointerdown', () => onUnlock());
  container.addEventListener('click', () => onUnlock());
  for (const type of ['contextmenu', 'selectstart', 'dragstart']) canvas.addEventListener(type, (event) => event.preventDefault());
  canvas.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault(); onUnlock();
    start = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerup', (event) => {
    const tap = start; start = null;
    if (!tap || tap.id !== event.pointerId || Math.hypot(tap.x - event.clientX, tap.y - event.clientY) > 12) return;
    sync();
    if (!context.enabled) return;
    const rect = canvas.getBoundingClientRect();
    const logicalHeight = canvas.width > 0 && canvas.height > 0 ? 960 * canvas.height / canvas.width : 540;
    const point = { x: (event.clientX - rect.left) * 960 / rect.width,
      y: (event.clientY - rect.top) * logicalHeight / rect.height };
    if (!onTap(point,{height:logicalHeight,portrait:canvas.portraitScreen===true}) && context.mode !== 'game') queued |= MOBILE_INPUT.confirm;
  });
  for (const name of ['pointercancel', 'lostpointercapture']) canvas.addEventListener(name, () => { start = null; });
  view.addEventListener('blur', () => { titleTransition.cancel(); start = null; clear(); });
  view.addEventListener('resize', () => { titleTransition.cancel(); start = null; clear(); sync(); });
  view.document.addEventListener('visibilitychange', () => { if (view.document.hidden) { titleTransition.cancel(); start = null; clear(); } });
  media.addEventListener('change', sync);
  sync();
  return {
    clear, sync, editLayout() { editor?.open(); }, get visible() { return media.matches; },
    get pauseDialogOpen(){return Boolean(pauseDialog?.open)},
    get touchInput(){return media.matches},
    get menuVisible(){return enabled && ['list-menu', 'title-menu', 'match-setup'].includes(context.layout)},
    read() {
      sync({ render: false });
      if (titleTransition.active) { clearEditorInput(); return; }
      const input = touch.read() | queued; queued = 0;
      setTouchKeys(keyboard, context.enabled && !editor?.editing ? mobileKeyCodes(input, context) : []);
    },
  };
}
