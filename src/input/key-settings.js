import { KEYMAPS, MENU_KEYS } from './keyboard.js';

export const KEY_SETTINGS_KEY = 'chii-drop:keyboard:v1';
export const KEY_ACTIONS = { LEFT: '왼쪽 이동', RIGHT: '오른쪽 이동', DOWN: '빠르게 내리기', ROTATE_CCW: '왼쪽 회전', ROTATE_CW: '오른쪽 회전' };
export const KEY_GROUPS = { solo: '1인 조작', p1: '로컬 1P', p2: '로컬 2P' };
export function defaultKeyBindings() { return structuredClone({ ...KEYMAPS, pause: MENU_KEYS.pause }); }
export function keyLabel(code) {
  return ({ ArrowLeft: '←', ArrowRight: '→', ArrowDown: '↓', ArrowUp: '↑', Space: 'Space', Escape: 'Esc',
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Backquote: '`', Minus: '−', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\' })[code] ?? code.replace(/^Key|^Digit/, '').replace(/^Numpad/, '숫자패드 ');
}
export function allowedGameKey(code) {
  return /^(Key[A-Z]|Digit[0-9]|Arrow(Left|Right|Up|Down)|Space|Comma|Period|Slash|Semicolon|Quote|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Numpad([0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter))$/.test(code);
}
export function validateKeyBindings(bindings) {
  for (const group of Object.keys(KEY_GROUPS)) {
    const used = new Set();
    for (const action of Object.keys(KEY_ACTIONS)) {
      const codes = bindings?.[group]?.[action];
      if (!Array.isArray(codes) || !codes.length || codes.length > 4 || codes.some((code) => !allowedGameKey(code))) return '사용할 수 없는 경기 키입니다.';
      for (const code of codes) {
        if (used.has(code)) return `${KEY_GROUPS[group]}에서 ${keyLabel(code)} 키가 중복됩니다.`;
        used.add(code);
      }
    }
  }
  const first = new Set(Object.values(bindings.p1).flat());
  const shared = Object.values(bindings.p2).flat().find((code) => first.has(code));
  if (shared) return `${keyLabel(shared)} 키를 로컬 1P와 2P가 함께 사용하고 있습니다.`;
  if (!Array.isArray(bindings.pause) || !bindings.pause.includes('Escape') || bindings.pause.length > 2 || bindings.pause.some((code) => code !== 'Escape' && !allowedGameKey(code))) return '사용할 수 없는 일시정지 키입니다.';
  for (const code of bindings.pause) if (Object.keys(KEY_GROUPS).some((group) => Object.values(bindings[group]).flat().includes(code))) return `${keyLabel(code)} 키는 경기 조작에 사용 중입니다.`;
  return null;
}
export function loadKeyBindings(storage) {
  try {
    const data = JSON.parse(storage?.getItem(KEY_SETTINGS_KEY) ?? 'null');
    if (!data || validateKeyBindings(data)) return defaultKeyBindings();
    return { ...Object.fromEntries(Object.keys(KEY_GROUPS).map((group) => [group,
      Object.fromEntries(Object.keys(KEY_ACTIONS).map((action) => [action, [...data[group][action]]]))])), pause: [...data.pause] };
  } catch { return defaultKeyBindings(); }
}

export function createKeySettings({ view, keyboard, onOpen, onClose }) {
  let storage, editing = false;
  try { storage = view.localStorage; } catch { /* 저장 차단 환경에서는 기본 키로 실행한다. */ }
  keyboard.bindings = loadKeyBindings(storage);
  function clear() { for (const name of ['held', 'pressed', 'touchHeld', 'touchPressed']) keyboard[name]?.clear(); }
  function open() {
    if (editing || !view.document?.createElement) return;
    editing = true; clear(); onOpen?.();
    const doc = view.document, previous = doc.activeElement;
    const dialog = doc.createElement('dialog'); dialog.className = 'key-settings';
    dialog.setAttribute('aria-label', '키보드 키 설정');
    dialog.innerHTML = `<h2>키보드 키 설정</h2><p>항목을 누른 뒤 원하는 키를 입력하세요. 메뉴는 방향키·Enter·Esc로 조작합니다.</p>
      <div class="key-settings-tabs" role="group" aria-label="조작 구분"></div><div class="key-settings-rows"></div>
      <p class="key-settings-status" role="status">Esc는 항상 일시정지로 사용할 수 있습니다.</p>
      <div class="key-settings-actions"><button type="button" data-reset>전체 초기화</button><button type="button" data-cancel>취소</button><button type="button" data-save>저장</button></div>`;
    let draft = structuredClone(keyboard.bindings), group = 'solo', waiting = null;
    const status = dialog.querySelector('.key-settings-status'), rows = dialog.querySelector('.key-settings-rows');
    const buttons = new Map(), tabs = new Map();
    for (const [id, label] of Object.entries(KEY_GROUPS)) {
      const button = doc.createElement('button'); button.type = 'button'; button.textContent = label;
      button.addEventListener('click', () => { group = id; waiting = null; render(); });
      tabs.set(id, button); dialog.querySelector('.key-settings-tabs').append(button);
    }
    for (const [action, label] of [...Object.entries(KEY_ACTIONS), ['pause', '일시정지']]) {
      const button = doc.createElement('button'); button.type = 'button';
      button.addEventListener('click', () => { waiting = action; status.textContent = `${label}: 사용할 키를 누르세요. Esc로 입력 취소`; render(); });
      buttons.set(action, { button, label }); rows.append(button);
    }
    function render() {
      for (const [id, button] of tabs) button.setAttribute('aria-pressed', String(group === id));
      for (const [action, { button, label }] of buttons) {
        const codes = action === 'pause' ? draft.pause : draft[group][action];
        button.textContent = `${label} · ${waiting === action ? '키 입력 대기…' : codes.map(keyLabel).join(' / ')}`;
        button.setAttribute('aria-label', `${label} 키 변경`);
        button.setAttribute('aria-pressed', String(waiting === action));
      }
    }
    dialog.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (!waiting) return;
      event.preventDefault();
      if (event.repeat) return;
      if (event.code === 'Escape') { waiting = null; status.textContent = '키 입력을 취소했습니다.'; render(); return; }
      if (event.ctrlKey || event.metaKey || event.altKey || !allowedGameKey(event.code)) {
        status.textContent = '문자·숫자·방향키·Space·기호 키 중에서 눌러 주세요.'; return;
      }
      const next = structuredClone(draft);
      if (waiting === 'pause') next.pause = ['Escape', event.code];
      else next[group][waiting] = [event.code];
      const error = validateKeyBindings(next);
      if (error) { status.textContent = error; return; }
      draft = next; status.textContent = `${keyLabel(event.code)} 키로 변경했습니다. 저장하면 적용됩니다.`;
      waiting = null; render();
    });
    dialog.addEventListener('keyup', (event) => event.stopPropagation());
    dialog.querySelector('[data-reset]').addEventListener('click', () => {
      draft = defaultKeyBindings(); waiting = null; status.textContent = '모든 키를 기본값으로 되돌렸습니다. 저장하면 적용됩니다.'; render();
    });
    dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-save]').addEventListener('click', () => {
      if (waiting) { status.textContent = '키 입력을 마치거나 Esc로 입력을 취소해 주세요.'; return; }
      try {
        if (!storage) throw Error('Storage unavailable');
        storage.setItem(KEY_SETTINGS_KEY, JSON.stringify(draft));
      } catch { status.textContent = '저장하지 못했습니다. 브라우저의 저장 설정을 확인해 주세요.'; return; }
      keyboard.bindings = draft; dialog.close();
    });
    dialog.addEventListener('close', () => { clear(); editing = false; dialog.remove(); onClose?.(); previous?.focus(); });
    doc.body.append(dialog); render(); dialog.showModal();
  }
  return { open, get editing() { return editing; } };
}
