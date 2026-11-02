import { createGamepadSettings, defaultGamepadBindings, GAMEPAD_ACTIONS, gamepadButtonLabel } from './gamepad-settings.js';
import { INPUT } from '../engine/input.js';
import { directionalMenuIndex } from './menu-navigation.js';

const DEFAULT_BINDINGS = defaultGamepadBindings()[0];
const ROTATIONS = INPUT.ROTATE_CW | INPUT.ROTATE_CCW;
const MENU_CODES = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', confirm: 'Enter', back: 'Escape' };
const pressed = (pad, index) => Boolean(pad.buttons?.[index]?.pressed || pad.buttons?.[index]?.value > .5);
const axis = (value, previous) => value <= (previous === -1 ? -.3 : -.5) ? -1 : value >= (previous === 1 ? .3 : .5) ? 1 : 0;

export function readGamepad(pad, previous = {}, bindings = DEFAULT_BINDINGS) {
  const x = axis(pad.axes?.[0] ?? 0, previous.x), y = axis(pad.axes?.[1] ?? 0, previous.y);
  const actions = new Set();
  if (x < 0 || pressed(pad, 14)) actions.add('left');
  if (x > 0 || pressed(pad, 15)) actions.add('right');
  if (y < 0 || pressed(pad, 12)) actions.add('up');
  if (y > 0 || pressed(pad, 13)) actions.add('down');
  if (pressed(pad, 0)) actions.add('confirm');
  if (pressed(pad, 1)) actions.add('back');
  if (bindings.pause.some(index => pressed(pad, index))) actions.add('pause');
  let input = 0;
  for (const [action, bit] of Object.entries({ left: INPUT.LEFT, right: INPUT.RIGHT, down: INPUT.DOWN, cw: INPUT.ROTATE_CW, ccw: INPUT.ROTATE_CCW })) {
    if (bindings[action].some(index => pressed(pad, index))) input |= bit;
  }
  if (x < 0) input |= INPUT.LEFT;
  if (x > 0) input |= INPUT.RIGHT;
  if (y > 0) input |= INPUT.DOWN;
  return { x, y, actions, input };
}

export function dispatchGamepadDialog(view, action) {
  const doc = view.document, dialog = [...doc.querySelectorAll('dialog[open]')].at(-1);
  if (!dialog) return false;
  if (action === 'back' || action === 'pause') {
    const event = new view.Event('cancel', { cancelable: true });
    if (dialog.dispatchEvent(event)) dialog.close();
    return true;
  }
  const controls = [...dialog.querySelectorAll('button, select, input, textarea, summary, a[href], [tabindex="0"]')]
    .filter(el => !el.disabled && !el.closest('[hidden], [inert]') && el.getClientRects().length);
  const active = controls.includes(doc.activeElement) ? doc.activeElement : controls[0];
  if (!active) return true;
  if (adjustGamepadValue(view, active, action)) return true;
  if (action === 'confirm') active.click();
  else {
    const rects = controls.map(el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height }; });
    controls[directionalMenuIndex(rects, controls.indexOf(active), action)]?.focus({ preventScroll: true });
  }
  return true;
}

export function adjustGamepadValue(view, element, action) {
  if (!['left', 'right', 'confirm'].includes(action)) return false;
  if (element?.tagName === 'SELECT') {
    const options = [...element.options].filter(option => !option.disabled);
    if (!options.length) return true;
    const current = options.findIndex(option => option.value === element.value);
    element.value = options[(current + (action === 'left' ? -1 : 1) + options.length) % options.length].value;
    element.dispatchEvent(new view.Event('change', { bubbles: true }));
    return true;
  }
  if (element?.tagName === 'INPUT' && element.type === 'range' && action !== 'confirm') {
    if (action === 'left') element.stepDown(); else element.stepUp();
    element.dispatchEvent(new view.Event('input', { bubbles: true }));
    element.dispatchEvent(new view.Event('change', { bubbles: true }));
    return true;
  }
  return false;
}

// 브라우저 상태는 입력 계층에서만 읽는다. 엔진에는 키보드와 같은 프레임 비트를 전달한다.
export function attachGamepads({ view, keyboard, getContext, onMenu, onActivity = () => {}, onDisconnect = () => {} }) {
  const slots = [null, null], states = new Map();
  let contextKey, contextMode, needsRelease = false, guide;
  keyboard.gamepadPlayers = [null, null];
  keyboard.gamepadPressed = new Set();
  const clear = () => { keyboard.gamepadPlayers = [null, null]; keyboard.gamepadPressed.clear(); keyboard.rotationInputs?.clear(); };
  function reset() { clear(); needsRelease = true; for (const s of states.values()) s.blocked = true; }
  const settings = createGamepadSettings({ view, onReset: reset, onChange: reset });
  const visible = () => !view.document.hidden && view.document.hasFocus?.() !== false;
  view.addEventListener('blur', reset);
  const visibility = () => { if (!visible()) reset(); };
  view.document.addEventListener('visibilitychange', visibility);
  function poll(now = view.performance.now()) {
    const context = getContext(), modal = view.document.querySelector('dialog[open]');
    const mode = modal ? 'dialog' : context.mode;
    const key = modal ?? context.key;
    if (key !== contextKey || mode !== contextMode) {
      for (const s of states.values()) s.blocked = true;
      clear(); contextKey = key; contextMode = mode;
    }
    if (!context.enabled || !visible()) { reset(); return; }
    let pads;
    try { pads = [...(view.navigator.getGamepads?.() ?? [])].filter(pad => pad && pad.connected !== false); }
    catch { reset(); return; }
    const connected = new Set(pads.map(p => p.index));
    let committed = false;
    for (let slot = 0; slot < slots.length; slot++) if (slots[slot] !== null && !connected.has(slots[slot])) {
      states.delete(slots[slot]); slots[slot] = null; keyboard.gamepadPlayers[slot] = null;
      keyboard.gamepadPressed.clear(); onDisconnect();
    }
    // 연결 슬롯을 먼저 등록해 새로 연결한 패드도 버튼 배정에 사용할 수 있다.
    for (const pad of pads) if (!slots.includes(pad.index) && slots.includes(null)) {
      slots[slots.indexOf(null)] = pad.index;
      states.set(pad.index, { blocked: needsRelease, actions: new Set(), input: 0, repeats: new Map() });
    }
    if (settings.capture(pads, slots)) { reset(); return; }
    settings.reload();
    for (const pad of pads) {
      if (!slots.includes(pad.index)) {
        const free = slots.indexOf(null);
        if (free < 0) continue;
        slots[free] = pad.index; states.set(pad.index, { blocked: needsRelease, actions: new Set(), input: 0, repeats: new Map() });
      }
      const slot = slots.indexOf(pad.index), state = states.get(pad.index);
      const sample = readGamepad(pad, state, settings.bindings[slot]);
      if (mode !== 'game') {
        sample.actions.delete('pause');
        if (pressed(pad, 9)) sample.actions.add('pause');
      }
      const active = sample.input || sample.actions.size;
      if (state.blocked) {
        if (!active) state.blocked = false;
        state.actions = sample.actions; state.input = sample.input; state.x = sample.x; state.y = sample.y;
        keyboard.gamepadPlayers[slot] = null;
        continue;
      }
      if (active && (!state.input || [...sample.actions].some(action => !state.actions.has(action)))) onActivity();
      const previous = keyboard.gamepadPlayers[slot];
      keyboard.gamepadPlayers[slot] = mode === 'game' ? {
        held: sample.input, pressed: (previous?.pressed ?? 0) | (sample.input & ~state.input & ROTATIONS),
      } : null;
      for (const action of sample.actions) {
        if (committed && mode !== 'game') break;
        const fresh = !state.actions.has(action), directional = ['up', 'down', 'left', 'right'].includes(action);
        if (fresh) state.repeats.set(action, now + 350);
        const repeat = directional && now >= (state.repeats.get(action) ?? Infinity);
        if (!fresh && !repeat) continue;
        if (repeat) state.repeats.set(action, now + 100);
        if (mode === 'game') {
          if (action === 'pause') {
            if (!onMenu?.('pause')) keyboard.gamepadPressed.add('Escape');
          }
        } else {
          const command = action === 'pause' ? 'confirm' : action;
          if (!dispatchGamepadDialog(view, command) && !onMenu?.(command)) keyboard.gamepadPressed.add(MENU_CODES[command]);
        }
        // 결정이 화면을 바꾸면 같은 폴링에서 다른 버튼을 이어서 적용하지 않는다.
        if (fresh && (mode === 'game' ? action === 'pause' : ['confirm', 'back', 'pause'].includes(action))) { committed = true; break; }
      }
      Object.assign(state, { actions: sample.actions, input: sample.input, x: sample.x, y: sample.y });
    }
    needsRelease = false;
    if (guide?.open) guide.querySelector('[data-gamepad-status]').textContent = status();
  }
  function status() {
    if (!view.navigator.getGamepads) return view.isSecureContext === false
      ? '게임패드 인식에는 HTTPS 또는 localhost 접속이 필요합니다.' : '이 브라우저는 게임패드 인식을 지원하지 않습니다.';
    const count = slots.filter(index => index !== null).length;
    return count ? `게임패드 ${count}개 연결됨 · 연결 순서대로 1P / 2P` : '연결된 게임패드가 없습니다. 연결 후 버튼을 한 번 눌러 주세요.';
  }
  return { poll, clear: reset, status, openSettings: settings.open,
    get bindings() { return settings.bindings; },
    openGuide() {
      if (guide?.open) return;
      const doc = view.document;
      guide = doc.createElement('dialog'); guide.className = 'gamepad-guide'; guide.setAttribute('aria-label', '게임패드 조작 안내');
      guide.innerHTML = '<h2>게임패드 조작</h2><p data-gamepad-status></p><dl><dt>방향키 / 왼쪽 스틱</dt><dd>이동 · 아래로 빠르게 내리기</dd><dt>왼쪽 X / □ · 아래 A / ✕</dt><dd>왼쪽 회전 (A: 메뉴 결정)</dd><dt>위 Y / △ · 오른쪽 B / ○</dt><dd>오른쪽 회전 (B: 메뉴 뒤로)</dd><dt>L1 / R1</dt><dd>왼쪽 / 오른쪽 회전</dd><dt>Start / Options</dt><dd>일시정지 · 메뉴에서 결정</dd></dl><p>로컬 대전은 게임패드 두 개 또는 키보드와 함께 조작할 수 있어요. 표준 매핑 기준이며 장치에 따라 버튼 배치가 다를 수 있어요.</p><button type="button">닫기</button>';
      const list = guide.querySelector('dl'); list.replaceChildren();
      for (const [slot, profile] of settings.bindings.entries()) for (const [action, label] of Object.entries(GAMEPAD_ACTIONS)) {
        const dt = doc.createElement('dt'), dd = doc.createElement('dd');
        dt.textContent = `${slot + 1}P ${label}`; dd.textContent = profile[action].map(gamepadButtonLabel).join(' · '); list.append(dt, dd);
      }
      guide.querySelector('[data-gamepad-status]').textContent = status();
      guide.querySelector('button').addEventListener('click', () => guide.close());
      guide.addEventListener('close', () => { reset(); guide.remove(); });
      doc.body.append(guide); guide.showModal();
    },
    destroy() { settings.destroy(); reset(); view.removeEventListener('blur', reset); view.document.removeEventListener('visibilitychange', visibility); guide?.close(); },
  };
}
