// 표시 영역 안에 게임판을 맞춘다. 경기 상태·입력·난수에는 관여하지 않는다.
export function fitStage(width, height, focused = false) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { width: 0, height: 0 };
  const ratio = focused ? 8 / 9 : 16 / 9;
  const fittedWidth = Math.min(width, height * ratio);
  return { width: fittedWidth, height: fittedWidth / ratio };
}

export function attachStageLayout(area, stage, view = window) {
  function update() {
    const rect = area.getBoundingClientRect();
    const size = fitStage(rect.width, rect.height, stage.classList.contains('focus-field'));
    stage.style.width = `${size.width}px`;
    stage.style.height = `${size.height}px`;
  }
  const observer = new view.ResizeObserver(update);
  observer.observe(area);
  update();
  return { update, dispose: () => observer.disconnect() };
}
