const KEY = 'chii-drop:online-touch-v1';
export const DEFAULT_TOUCH = Object.freeze({ size: 64, gap: 10, edge: 8, lift: 8, swapped: false });
export function normalizeTouch(value = {}) {
  const number = (key, min, max) => Number.isFinite(value?.[key]) ? Math.min(max, Math.max(min, value[key])) : DEFAULT_TOUCH[key];
  return { size: number('size', 56, 80), gap: number('gap', 6, 18), edge: number('edge', 0, 24), lift: number('lift', 0, 28), swapped: value?.swapped === true };
}
export function fitTouch(value, width, height, landscape) {
  const setting = normalizeTouch(value);
  // 작은 화면에서도 양손 조작 영역과 게임판을 확보하고 버튼끼리 겹치지 않게 한다.
  const available = Math.max(0, width - 2 * setting.edge - (landscape ? 4 : 3) * setting.gap - (landscape ? 160 : 0));
  const size = Math.max(48, Math.min(setting.size, available / 4, (height - setting.lift - setting.gap) / 2));
  return { ...setting, size, wing: 2 * size + setting.gap, controlHeight: 2 * size + setting.gap + setting.lift };
}
export function attachTouchLayout({ view, dialog, container, preview, surface = view.document.documentElement, onEdit = () => {} }) {
  let saved;
  try { saved = JSON.parse(view.localStorage.getItem(KEY)); } catch { /* 저장 차단 시 기본값 */ }
  const settings = { portrait: normalizeTouch(saved?.portrait), landscape: normalizeTouch(saved?.landscape) };
  const $ = (id) => dialog.querySelector(`#${id}`);
  const orientation = () => view.innerWidth > view.innerHeight ? 'landscape' : 'portrait';
  const applyVars = (element, value) => {
    for (const key of ['size', 'gap', 'edge', 'lift', 'wing', 'controlHeight']) element.style.setProperty(`--touch-${key}`, `${value[key]}px`);
    element.dataset.swapped = String(value.swapped);
  };
  function update() {
    const mode = orientation();
    const width = surface.clientWidth || view.innerWidth;
    const height = surface.clientHeight || view.innerHeight;
    const layout = fitTouch(settings[mode], width - 24, height - (mode === 'landscape' ? 24 : 100), mode === 'landscape');
    applyVars(surface, layout);
    container.dataset.swapped = String(layout.swapped);
    if (dialog.open) renderPreview();
  }
  function renderPreview() {
    const setting = settings[$('touch-orientation').value];
    for (const key of ['size', 'gap', 'edge', 'lift']) {
      $(`touch-${key}`).value = setting[key];
      $(`touch-${key}-value`).textContent = `${setting[key]}px`;
    }
    $('touch-swapped').checked = setting.swapped;
    applyVars(preview, fitTouch(setting, preview.clientWidth, 200, false));
    $('touch-save-status').textContent = saved === false ? '이 브라우저에서는 저장할 수 없어 현재 화면에만 적용돼요.' : '자동 저장 · 화면이 작으면 버튼 크기를 안전하게 맞춰요.';
  }
  function save() {
    try { view.localStorage.setItem(KEY, JSON.stringify(settings)); saved = true; } catch { saved = false; }
    onEdit(); update();
  }
  for (const key of ['size', 'gap', 'edge', 'lift']) $(`touch-${key}`).addEventListener('input', () => {
    settings[$('touch-orientation').value][key] = Number($(`touch-${key}`).value); save();
  });
  $('touch-swapped').addEventListener('change', () => { settings[$('touch-orientation').value].swapped = $('touch-swapped').checked; save(); });
  $('touch-orientation').addEventListener('change', renderPreview);
  $('touch-reset').addEventListener('click', () => { settings[$('touch-orientation').value] = normalizeTouch(); save(); });
  $('close-touch-options').addEventListener('click', () => dialog.close());
  view.addEventListener('resize', update);
  const observer = new view.ResizeObserver(update); observer.observe(preview); observer.observe(surface);
  update();
  return { open() { onEdit(); $('touch-orientation').value = orientation(); dialog.showModal(); renderPreview(); $('close-touch-options').focus({ preventScroll: true }); } };
}
