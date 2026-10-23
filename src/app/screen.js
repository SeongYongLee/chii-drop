const SCREEN_WIDTH = 960;
const SCREEN_HEIGHT = 540;

// 논리 좌표를 유지하면서 실제 표시 크기와 화면 밀도에 맞춰 그린다.
function setupCanvas(canvas, { width, height, devicePixelRatio, fitHeight = false, view = canvas.ownerDocument?.defaultView } = {}) {
  const ctx = canvas.getContext('2d');
  if (canvas.style) canvas.style.aspectRatio = `${width} / ${height}`;
  const resize = () => {
    const rect = canvas.getBoundingClientRect?.();
    const displayWidth = canvas.clientWidth || rect?.width || width;
    const portrait = fitHeight && view?.getComputedStyle?.(canvas).getPropertyValue('--portrait-game').trim() === '1';
    const logicalHeight = portrait && canvas.clientHeight > 0 ? width * canvas.clientHeight / displayWidth : height;
    const density = devicePixelRatio ?? view?.devicePixelRatio ?? 1;
    const ratio = Number.isFinite(density) && density > 0 ? density : 1;
    const scale = displayWidth / width * ratio;
    const pixelWidth = Math.max(1, Math.round(width * scale));
    const pixelHeight = Math.max(1, Math.round(logicalHeight * scale));
    // 크기를 대입하면 Canvas 상태가 초기화되므로 바뀔 때만 설정한다.
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    ctx.screenHeight = logicalHeight;
    ctx.portraitScreen = portrait;
    canvas.portraitScreen = portrait;
    ctx.setTransform(pixelWidth / width, 0, 0, pixelHeight / logicalHeight, 0, 0);
  };
  resize();
  if (view?.ResizeObserver) new view.ResizeObserver(resize).observe(canvas);
  view?.addEventListener('resize', resize);
  return ctx;
}

function setupScreen(canvas, devicePixelRatio) {
  return setupCanvas(canvas, { width: SCREEN_WIDTH, height: SCREEN_HEIGHT, devicePixelRatio, fitHeight: true });
}

function screenHeight(ctx) {
  return Number.isFinite(ctx.screenHeight) ? ctx.screenHeight : SCREEN_HEIGHT;
}
function isPortraitScreen(ctx) { return ctx.portraitScreen === true; }

export { SCREEN_HEIGHT, SCREEN_WIDTH, screenHeight, isPortraitScreen, setupCanvas, setupScreen };
