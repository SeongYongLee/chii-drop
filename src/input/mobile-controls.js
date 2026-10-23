import { attachTouchControls } from '../net/touch.js';
import { setTouchKeys } from './keyboard.js';
import { createTouchLayoutEditor } from './touch-layout.js';

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

export function attachMobileControls({ view, canvas, container, keyboard, getContext, onTap, onUnlock }) {
  // 초기화 테스트·자료 없는 화면에서는 터치 DOM을 요구하지 않는다.
  if (!container?.querySelectorAll || !canvas.addEventListener) return { read() {}, sync() {}, clear() {}, visible: false };
  const touch = attachTouchControls(container);
  const menu = container.querySelector('[data-mobile-menu]');
  const game = container.querySelector('[data-mobile-game]');
  const label = container.querySelector('[data-mobile-label]');
  const playerButton = container.querySelector('[data-mobile-player]');
  const nativeItems = container.querySelector('[data-mobile-items]');
  const confirmButton = container.querySelector('[data-mobile-confirm]');
  const media = view.matchMedia('(pointer: coarse), (max-width: 760px), (max-height: 500px) and (max-width: 960px)');
  let context = {}, key = '', queued = 0, localPlayer = 0, start = null, enabled = false, itemsKey = '';
  function clearEditorInput() { clear(); keyboard.held.clear(); keyboard.pressed.clear(); }
  const editor = game.querySelectorAll ? createTouchLayoutEditor({ view, game,
    onOpen: clearEditorInput, onClose: () => { clearEditorInput(); sync(); } }) : null;
  function renderItems() {
    const items = context.items ?? [];
    const signature = JSON.stringify([context.columns, items.map(({ label, value, disabled, selected, adjustable }) =>
      [label, value, disabled, selected, adjustable])]);
    if (signature === itemsKey) return;
    itemsKey = signature;
    nativeItems.replaceChildren(); nativeItems.hidden = !items.length;
    nativeItems.dataset.columns = String(context.columns ?? 1);
    items.forEach((item, index) => {
      const row = view.document.createElement('div'); row.className = 'mobile-item';
      const makeButton = (text, delta, ariaLabel) => {
        const button = view.document.createElement('button'); button.type = 'button';
        button.textContent = text; button.disabled = Boolean(item.disabled);
        if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
        button.addEventListener('click', () => { onUnlock(); context.items?.[index]?.activate(delta); sync(); });
        row.append(button); return button;
      };
      const button = makeButton(item.value === undefined ? item.label : `${item.label} · ${item.value}`, 1);
      if (item.selected) button.setAttribute('aria-current', 'true');
      if (item.adjustable) {
        makeButton('−', -1, `${item.label} 줄이기`); makeButton('+', 1, `${item.label} 늘리기`);
      }
      nativeItems.append(row);
    });
  }
  function clear() { touch.clear(); queued = 0; keyboard.touchHeld?.clear(); keyboard.touchPressed?.clear(); }
  function sync() {
    context = getContext();
    if (context.local) context = { ...context, player: localPlayer };
    const nextKey = `${context.enabled}:${context.mode}:${context.player}`;
    if (nextKey !== key) { clear(); key = nextKey; }
    const active = Boolean(context.enabled && media.matches && !editor?.editing);
    if (enabled !== active) { enabled = active; touch.setEnabled(enabled); }
    container.hidden = !media.matches;
    menu.hidden = context.mode === 'game'; game.hidden = context.mode !== 'game';
    if (container.dataset.mode !== context.mode) container.dataset.mode = context.mode;
    if (view.document.body) view.document.body.dataset.touchMode = active ? context.mode : 'none';
    menu.dataset.hasItems = String(Boolean(context.items?.length));
    menu.dataset.title = String(Boolean(context.title));
    confirmButton.hidden = Boolean(context.direct);
    confirmButton.textContent = context.title ? '시작' : '결정';
    renderItems();
    const text = context.label ?? (context.enabled ? '메뉴 선택' : '불러오는 중…');
    if (label.textContent !== text) label.textContent = text;
    playerButton.hidden = !context.local;
    const playerText = `${localPlayer + 1}P 조작 · 전환`;
    if (playerButton.textContent !== playerText) playerButton.textContent = playerText;
  }
  playerButton.addEventListener('click', () => { localPlayer = 1 - localPlayer; clear(); sync(); });
  // 포커스된 터치 버튼의 Enter가 전역 키보드 입력으로 한 번 더 들어가지 않게 한다.
  for (const event of ['keydown', 'keyup']) container.addEventListener(event, (e) => e.stopPropagation());
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
    const point = { x: (event.clientX - rect.left) * 960 / rect.width,
      y: (event.clientY - rect.top) * 540 / rect.height };
    if (!onTap(point) && context.mode !== 'game') queued |= MOBILE_INPUT.confirm;
  });
  for (const name of ['pointercancel', 'lostpointercapture']) canvas.addEventListener(name, () => { start = null; });
  view.addEventListener('blur', () => { start = null; clear(); });
  view.addEventListener('resize', () => { start = null; clear(); sync(); });
  view.document.addEventListener('visibilitychange', () => { if (view.document.hidden) { start = null; clear(); } });
  media.addEventListener('change', sync);
  sync();
  return {
    clear, sync, editLayout() { editor?.open(); }, get visible() { return media.matches; },
    read() {
      sync();
      const input = touch.read() | queued; queued = 0;
      setTouchKeys(keyboard, context.enabled && !editor?.editing ? mobileKeyCodes(input, context) : []);
    },
  };
}
