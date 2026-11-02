import { gamepadDiagramMarkup } from './gamepad-diagram.js';

export const GAMEPAD_SETTINGS_KEY = 'chii-drop:gamepad:v1';
export const GAMEPAD_ACTIONS = { left: '왼쪽 이동', right: '오른쪽 이동', down: '빠르게 내리기', ccw: '왼쪽 회전', cw: '오른쪽 회전', pause: '일시정지 / 경기 메뉴' };
export function defaultGamepadBindings() {
  return Array.from({ length: 2 }, () => ({ left: [14], right: [15], down: [13], ccw: [0, 2, 4], cw: [1, 3, 5], pause: [9] }));
}
export function validGamepadBindings(data) {
  return Array.isArray(data) && data.length === 2 && data.every(profile => {
    const used = new Set();
    return Object.keys(GAMEPAD_ACTIONS).every(action => Array.isArray(profile?.[action]) && profile[action].length > 0 && profile[action].length <= 8 && profile[action].every(index => {
      if (!Number.isInteger(index) || index < 0 || index > 31 || used.has(index)) return false;
      used.add(index); return true;
    }));
  });
}
export function loadGamepadBindings(storage) {
  try {
    const data = JSON.parse(storage?.getItem(GAMEPAD_SETTINGS_KEY) ?? 'null');
    if (validGamepadBindings(data)) return data;
  } catch { /* 저장소 접근이 차단되면 기본 배치를 사용한다. */ }
  return defaultGamepadBindings();
}
export function gamepadButtonLabel(index) {
  return ['A / ✕', 'B / ○', 'X / □', 'Y / △', 'LB / L1', 'RB / R1', 'LT / L2', 'RT / R2', 'View / Select', 'Start / Options', '왼쪽 스틱 클릭', '오른쪽 스틱 클릭', '방향키 ↑', '방향키 ↓', '방향키 ←', '방향키 →', '홈'][index] ?? `버튼 ${index + 1}`;
}
// 이미 사용 중인 버튼이면 기존 조작과 배치를 맞바꿔 조작이 사라지지 않게 한다.
export function assignGamepadButton(profile, action, index) {
  const next = structuredClone(profile), previous = next[action];
  const conflict = Object.keys(GAMEPAD_ACTIONS).find(key => key !== action && next[key].includes(index));
  if (conflict) next[conflict] = previous;
  next[action] = [index];
  return next;
}
export function createGamepadSettings({ view, onChange = () => {}, onReset = () => {} }) {
  let storage, dialog, capture;
  try { storage = view.localStorage; } catch { /* 저장 불가 안내는 저장할 때 표시한다. */ }
  let bindings = loadGamepadBindings(storage);
  function open() {
    if (dialog?.open) return;
    bindings = loadGamepadBindings(storage);
    let draft = structuredClone(bindings), slot = 0, selected = 'ccw';
    const doc = view.document, previous = doc.activeElement;
    dialog = doc.createElement('dialog'); dialog.className = 'key-settings gamepad-settings'; dialog.setAttribute('aria-label', '게임패드 버튼 설정');
    dialog.innerHTML = `<h2>게임패드 버튼 설정</h2><p>항목을 선택한 뒤 해당 패드의 버튼을 누르세요. 왼쪽 스틱과 메뉴의 A 결정·B 뒤로는 유지됩니다.</p>
      <div class="key-settings-tabs" role="group" aria-label="게임패드 구분"></div>
      <div class="gamepad-settings-body"><figure class="gamepad-settings-preview" aria-label="선택한 조작의 버튼 위치">
        <div data-gamepad-diagram></div><figcaption><strong data-gamepad-action></strong><span data-gamepad-assignment></span></figcaption>
        <p class="gamepad-diagram-note">분홍색 버튼이 현재 배정이에요.<br>표준 배치 기준 · L / R은 스틱 클릭</p>
      </figure><div class="key-settings-rows"></div></div>
      <p class="key-settings-status" role="status">연결 순서대로 1P / 2P에 적용됩니다.</p>
      <div class="key-settings-actions"><button type="button" data-reset>전체 초기화</button><button type="button" data-cancel>취소</button><button type="button" data-save>저장</button></div>`;
    const status = dialog.querySelector('[role=status]'), rows = dialog.querySelector('.key-settings-rows'), tabs = [], buttons = new Map();
    for (let i = 0; i < 2; i++) {
      const button = doc.createElement('button'); button.type = 'button'; button.textContent = `${i + 1}P`;
      button.addEventListener('click', () => { slot = i; capture = null; render(); });
      tabs.push(button); dialog.querySelector('.key-settings-tabs').append(button);
    }
    for (const [action, label] of Object.entries(GAMEPAD_ACTIONS)) {
      const button = doc.createElement('button'); button.type = 'button';
      button.addEventListener('focus', () => {
        if (!capture) { selected = action; render(); }
      });
      button.addEventListener('click', () => {
        selected = action;
        capture = { slot, armed: false, accept(index) {
          draft[slot] = assignGamepadButton(draft[slot], action, index);
          capture = null; onReset(); render();
          status.textContent = `${label}: ${gamepadButtonLabel(index)} · 중복 배치는 서로 교환됩니다. 저장하면 적용됩니다.`;
        } };
        status.textContent = `${slot + 1}P ${label}: 누르고 있는 버튼을 모두 뗀 뒤 원하는 버튼을 누르세요. Esc로 입력 취소`;
        render(action);
      });
      buttons.set(action, button); rows.append(button);
    }
    function render(waiting) {
      const assigned = draft[slot][selected];
      dialog.querySelector('[data-gamepad-diagram]').innerHTML = gamepadDiagramMarkup(assigned);
      dialog.querySelector('[data-gamepad-action]').textContent = `${slot + 1}P · ${GAMEPAD_ACTIONS[selected]}`;
      dialog.querySelector('[data-gamepad-assignment]').textContent = assigned.map(gamepadButtonLabel).join(' · ') + (assigned.some(index => index > 16) ? ' (장치 추가 버튼)' : '');
      tabs.forEach((button, i) => button.setAttribute('aria-pressed', String(slot === i)));
      for (const [action, button] of buttons) {
        button.textContent = `${GAMEPAD_ACTIONS[action]} · ${waiting === action ? '버튼 입력 대기…' : draft[slot][action].map(gamepadButtonLabel).join(' · ')}`;
        button.setAttribute('aria-pressed', String(selected === action));
      }
    }
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.addEventListener('keyup', event => event.stopPropagation());
    dialog.addEventListener('cancel', event => {
      if (capture) { event.preventDefault(); capture = null; onReset(); render(); status.textContent = '버튼 입력을 취소했습니다.'; }
    });
    dialog.querySelector('[data-reset]').addEventListener('click', () => { draft = defaultGamepadBindings(); capture = null; onReset(); render(); status.textContent = '기본 배치로 되돌렸습니다. 저장하면 적용됩니다.'; });
    dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-save]').addEventListener('click', () => {
      if (capture) { status.textContent = '입력을 마치거나 Esc로 입력을 취소해 주세요.'; return; }
      try {
        if (!storage) throw Error('Storage unavailable');
        storage.setItem(GAMEPAD_SETTINGS_KEY, JSON.stringify(draft));
      } catch { status.textContent = '저장하지 못했습니다. 브라우저의 저장 설정을 확인해 주세요.'; return; }
      bindings = draft; onChange(); dialog.close();
    });
    dialog.addEventListener('close', () => { capture = null; onReset(); dialog.remove(); previous?.focus(); });
    doc.body.append(dialog); render(); dialog.showModal(); onReset();
  }
  return { open, get bindings() { return bindings; }, reload() { bindings = loadGamepadBindings(storage); },
    capture(pads, slots) {
      if (!capture) return false;
      const pad = pads.find(p => p.index === slots[capture.slot]);
      if (!pad) return true;
      const held = Array.from(pad.buttons ?? []).flatMap((button, i) => button.pressed || button.value > .5 ? [i] : []);
      if (!held.length) capture.armed = true;
      else if (capture.armed && held.length === 1 && held[0] <= 31) capture.accept(held[0]);
      return true;
    }, destroy() { dialog?.close(); } };
}
