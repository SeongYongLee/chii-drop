// 화면에만 적용하는 기기별 배치. 좌표는 이동 가능한 거리의 비율이다.
export const TOUCH_LAYOUT_KEY = 'chii-drop.touch-layout.v1';
export const TOUCH_AREA_HEIGHT = 180;
export const TOUCH_BUTTONS = [
  { bit: 1, label: '왼쪽 이동', text: '←', x: 0, y: 0 },
  { bit: 4, label: '빠르게 내리기', text: '↓', x: .5, y: 0 },
  { bit: 2, label: '오른쪽 이동', text: '→', x: 1, y: 0 },
  { bit: 16, label: '왼쪽 회전', text: '↺', x: 0, y: .5 },
  { bit: 8, label: '오른쪽 회전', text: '↻', x: 1, y: .5 },
  { bit: 256, label: '대전 메뉴', text: '☰', x: .5, y: 1 },
];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export function normalizeTouchLayout(value, orientation = 'portrait') {
  const landscape = { 1: [.02, .86], 4: [.115, .86], 2: [.21, .86], 16: [.90, .86], 8: [1, .86], 256: [1, 0] };
  return Object.fromEntries(TOUCH_BUTTONS.map(({ bit, x, y }) => {
    const item = value?.[bit];
    if (orientation === 'landscape') [x, y] = landscape[bit];
    return [bit, { x: Number.isFinite(item?.x) ? clamp(item.x, 0, 1) : x,
      y: Number.isFinite(item?.y) ? clamp(item.y, 0, 1) : y,
      size: Number.isFinite(item?.size) ? clamp(item.size, 48, 96) : orientation === 'landscape' && bit !== 256 ? 64 : 48 }];
  }));
}
export function loadTouchLayouts(storage) {
  try {
    const data = JSON.parse(storage?.getItem(TOUCH_LAYOUT_KEY) ?? '{}');
    return Object.fromEntries(['portrait', 'landscape'].filter((key) => data?.[key])
      .map((key) => [key, normalizeTouchLayout(data[key], key)]));
  } catch { return {}; }
}
export function defaultTouchLayout(orientation, width) {
  const layout = normalizeTouchLayout(null, orientation);
  if (orientation === 'landscape') {
    for (const [index, bit] of [1, 4, 2].entries()) layout[bit].x = index * 74 / Math.max(1, width - 64);
    layout[1].y = .65; layout[2].y = .65; layout[4].y = 1;
    layout[16].x = 1 - 74 / Math.max(1, width - 64);
  } else {
    const size = clamp(Math.round(width * .17), 56, 64), edge = 6, gap = 12;
    const positions = { 1: [edge, 48], 2: [edge + size + gap, 48],
      4: [edge + (size + gap) / 2, TOUCH_AREA_HEIGHT - size],
      16: [width - edge - size * 2 - gap, 80], 8: [width - edge - size, 80],
      256: [(width - 48) / 2, 0] };
    for (const { bit } of TOUCH_BUTTONS) {
      const buttonSize = bit === 256 ? 48 : size;
      layout[bit] = { x: positions[bit][0] / Math.max(1, width - buttonSize),
        y: positions[bit][1] / (TOUCH_AREA_HEIGHT - buttonSize), size: buttonSize };
    }
  }
  return layout;
}
export function touchButtonRect(item, width, height = TOUCH_AREA_HEIGHT) {
  const size = Math.min(item.size, Math.max(48, width));
  return { left: item.x * Math.max(0, width - size), top: item.y * Math.max(0, height - size), size };
}

export function createTouchLayoutEditor({ view, game, onOpen, onClose }) {
  let storage;
  try { storage = view.localStorage; } catch { /* 저장소를 막은 브라우저에서도 편집 가능 */ }
  let layouts = loadTouchLayouts(storage), dialog = null, editing = false, orientation = '', applied = '';
  const gameButtons = [...game.querySelectorAll('button[data-input]')];
  function currentOrientation() { return view.innerWidth > view.innerHeight ? 'landscape' : 'portrait'; }
  function apply() {
    const next = currentOrientation();
    const width = game.clientWidth || (next === 'portrait' ? Math.min(view.innerWidth - 20, 580) : view.innerWidth - 20);
    const profile = layouts[next] ?? defaultTouchLayout(next, width);
    const signature = JSON.stringify([next, profile]);
    if (signature === applied) return;
    applied = signature;
    game.classList.toggle('mobile-custom-layout', Boolean(profile));
    for (const button of gameButtons) {
      const item = profile?.[button.dataset.input];
      if (item) {
        // calc는 패널 크기가 바뀌어도 버튼 전체가 패널 안에 남도록 한다.
        button.style.left = `calc(${item.x * 100}% - ${item.x * item.size}px)`;
        button.style.top = next === 'landscape' ? `calc(${item.y * 100}% - ${item.y * item.size}px)` : `${item.y * (TOUCH_AREA_HEIGHT - item.size)}px`;
        button.style.width = `${item.size}px`; button.style.height = `${item.size}px`;
      } else for (const name of ['left', 'top', 'width', 'height']) button.style[name] = '';
    }
  }
  function open() {
    if (editing) return;
    editing = true; onOpen();
    const doc = view.document;
    dialog = doc.createElement('dialog'); dialog.className = 'touch-layout-editor';
    dialog.setAttribute('aria-label', '터치 영역 편집');
    dialog.innerHTML = `<h2>터치 영역 편집</h2>
      <p class="touch-editor-hint">끌어서 이동 · 크기 조절 · 방향별 저장</p>
      <div class="touch-editor-orientation"><button type="button" data-orientation="portrait">세로 배치</button><button type="button" data-orientation="landscape">가로 배치</button></div>
      <div class="touch-editor-arena" aria-label="터치 버튼 배치 미리보기"></div>
      <div class="touch-editor-fields"><label>버튼 <select aria-label="편집할 버튼"></select></label>
      <label data-control="size">크기 <input type="range" min="48" max="96" step="1" aria-label="버튼 크기"><output></output></label>
      </div><p class="touch-editor-status" role="status"></p>
      <div class="touch-editor-actions"><button type="button" data-reset>초기화</button><button type="button" data-cancel>취소</button><button type="button" data-save>저장</button></div>`;
    doc.body.append(dialog);
    const previousFocus = doc.activeElement;
    const draft = structuredClone(layouts);
    const arena = dialog.querySelector('.touch-editor-arena'), select = dialog.querySelector('select');
    let selected = 1, drag = null;
    orientation = currentOrientation();
    const controls = { size: dialog.querySelector('[data-control="size"]') };
    for (const item of TOUCH_BUTTONS) {
      const option = doc.createElement('option'); option.value = item.bit; option.textContent = item.label; select.append(option);
    }
    function defaults() {
      const width = orientation === 'portrait' ? Math.min(Math.min(view.innerWidth, view.innerHeight) - 20, 580)
        : Math.max(view.innerWidth, view.innerHeight) - 20;
      return defaultTouchLayout(orientation, width);
    }
    function profile() { return draft[orientation] ?? defaults(); }
    function editableProfile() { return draft[orientation] ??= defaults(); }
    function previewSize(item) {
      const wide = Math.max(view.innerWidth, view.innerHeight), narrow = Math.min(view.innerWidth, view.innerHeight);
      const targetWidth = orientation === 'landscape' ? wide - 20 : Math.min(narrow - 20, 580);
      const targetHeight = orientation === 'landscape' ? narrow - 16 : TOUCH_AREA_HEIGHT;
      return item.size * Math.min(arena.clientWidth / targetWidth, arena.clientHeight / targetHeight);
    }
    const previews = TOUCH_BUTTONS.map((item) => {
      const button = doc.createElement('button'); button.type = 'button'; button.textContent = item.text;
      button.dataset.action = item.bit === 256 ? 'pause' : [8, 16].includes(item.bit) ? 'rotate' : 'move';
      button.setAttribute('aria-label', `${item.label} 배치`); arena.append(button);
      button.addEventListener('click', () => { selected = item.bit; render(); });
      button.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault(); selected = item.bit;
        drag = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, ...profile()[selected] };
        button.setPointerCapture(event.pointerId); render();
      });
      button.addEventListener('pointermove', (event) => {
        if (!drag || drag.id !== event.pointerId) return;
        const item = editableProfile()[selected], size = previewSize(item);
        item.x = clamp(drag.x + (event.clientX - drag.clientX) / Math.max(1, arena.clientWidth - size), 0, 1);
        item.y = clamp(drag.y + (event.clientY - drag.clientY) / Math.max(1, arena.clientHeight - size), 0, 1);
        render();
      });
      button.addEventListener('keydown', (event) => {
        const axis = { ArrowLeft: ['x', -.02], ArrowRight: ['x', .02], ArrowUp: ['y', -.02], ArrowDown: ['y', .02] }[event.code];
        if (!axis) return;
        event.preventDefault(); selected = item.bit;
        const value = editableProfile()[selected]; value[axis[0]] = clamp(value[axis[0]] + axis[1], 0, 1); render();
      });
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, () => { drag = null; });
      return { button, bit: item.bit };
    });
    function render() {
      arena.dataset.orientation = orientation;
      for (const button of dialog.querySelectorAll('[data-orientation]')) button.setAttribute('aria-pressed', String(button.dataset.orientation === orientation));
      for (const { button, bit } of previews) {
        const item = profile()[bit], size = previewSize(item);
        const rect = { left: item.x * (arena.clientWidth - size), top: item.y * (arena.clientHeight - size), size };
        Object.assign(button.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.size}px`, height: `${rect.size}px` });
        button.style.fontSize = `${Math.max(12, size * .38)}px`;
        button.setAttribute('aria-pressed', String(bit === selected));
      }
      select.value = String(selected);
      for (const [name, label] of Object.entries(controls)) {
        const value = name === 'size' ? profile()[selected][name] : Math.round(profile()[selected][name] * 100);
        label.querySelector('input').value = value;
        label.querySelector('output').textContent = `${value}${name === 'size' ? 'px' : '%'}`;
      }
    }
    for (const button of dialog.querySelectorAll('[data-orientation]')) button.addEventListener('click', () => { orientation = button.dataset.orientation; drag = null; render(); });
    select.addEventListener('change', () => { selected = Number(select.value); render(); });
    for (const [name, label] of Object.entries(controls)) label.querySelector('input').addEventListener('input', (event) => {
      editableProfile()[selected][name] = Number(event.target.value) / (name === 'size' ? 1 : 100); render();
    });
    const resized = () => { drag = null; orientation = currentOrientation(); render(); };
    view.addEventListener('resize', resized);
    function close() { dialog.close(); }
    dialog.querySelector('[data-cancel]').addEventListener('click', close);
    dialog.querySelector('[data-reset]').addEventListener('click', () => { delete draft[orientation]; render(); });
    dialog.querySelector('[data-save]').addEventListener('click', () => {
      try {
        if (!storage) throw Error('Storage unavailable');
        storage.setItem(TOUCH_LAYOUT_KEY, JSON.stringify(draft));
      }
      catch { dialog.querySelector('.touch-editor-status').textContent = '저장하지 못했습니다. 브라우저의 저장 설정을 확인해 주세요.'; return; }
      layouts = draft; applied = ''; apply(); close();
    });
    for (const name of ['keydown', 'keyup']) dialog.addEventListener(name, (event) => event.stopPropagation());
    dialog.addEventListener('close', () => {
      view.removeEventListener('resize', resized); dialog.remove(); dialog = null; editing = false;
      onClose(); previousFocus?.focus();
    });
    dialog.showModal(); render();
  }
  apply(); view.addEventListener('resize', apply);
  return { open, apply, get editing() { return editing; } };
}
