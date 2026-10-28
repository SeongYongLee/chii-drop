export const ONLINE_PORTRAIT_QUERY = '(max-width: 760px) and (orientation: portrait)';

// 표시 영역 안에 게임판을 맞춘다. 경기 상태·입력·난수에는 관여하지 않는다.
export function fitStage(width, height, focused = false, portrait = false) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { width: 0, height: 0 };
  if (portrait && !focused) return { width, height };
  const ratio = focused ? 8 / 9 : 16 / 9;
  const fittedWidth = Math.min(width, height * ratio);
  return { width: fittedWidth, height: fittedWidth / ratio };
}

export function attachStageLayout(area, stage, view = window) {
  const media = view.matchMedia?.(ONLINE_PORTRAIT_QUERY);
  function update() {
    const rect = area.getBoundingClientRect();
    const focused = stage.classList.contains('focus-field');
    const portrait = !focused && Boolean(media?.matches);
    if (stage.dataset) stage.dataset.portrait = String(portrait);
    const size = fitStage(rect.width, rect.height, focused, portrait);
    stage.style.width = `${size.width}px`;
    stage.style.height = `${size.height}px`;
  }
  const observer = new view.ResizeObserver(update);
  observer.observe(area);
  view.addEventListener?.('resize', update);
  media?.addEventListener?.('change', update);
  update();
  return { update, dispose() { observer.disconnect(); view.removeEventListener?.('resize', update); media?.removeEventListener?.('change', update); } };
}
