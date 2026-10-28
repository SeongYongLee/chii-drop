// 표시 주기를 우선하고 숨김·표시 중단 시 Worker 주기로 이어간다.
// OS가 페이지 자체를 중단하는 경우는 기존 재접속·재동기화로 처리한다.
export function startOnlineFrameClock({ view = window, page = document, tick, enabled = () => true }) {
  let worker = null, failed = false, fallback = null, stopped = false, animation = null, running = false, lastDisplay = -Infinity, lastTick = -Infinity;
  const background = () => {
    const now = view.performance.now();
    // 내장 브라우저는 표시되지 않는 탭도 visible로 보고할 수 있다.
    if (!stopped && enabled() && (page.hidden || now - lastDisplay >= 50)) tick(now, { render: false });
    refresh();
  };
  function refresh() {
    if (stopped) return;
    const needed = enabled();
    if (needed && !worker && !failed) {
      try {
        worker = new view.Worker(new URL('./frame-clock-worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = background;
        worker.onerror = () => { worker.terminate(); worker = null; running = false; failed = true; refresh(); };
      } catch { failed = true; }
    }
    const mode = !needed ? 'stop' : page.hidden || view.performance.now() - lastDisplay >= 50 ? 'start' : 'watch';
    if (worker && mode !== running) { worker.postMessage(mode); running = mode; }
    if (needed && failed && fallback === null) fallback = view.setInterval(background, 1000 / 60);
    if (!needed && fallback !== null) { view.clearInterval(fallback); fallback = null; }
  }
  function display(now) {
    if (stopped) return;
    lastDisplay = now;
    refresh();
    // 120/144Hz 표시에서도 60Hz 경기 화면을 중복해서 그리지 않는다.
    if (!page.hidden && enabled() && now - lastTick >= 1000 / 60 - .25) {
      lastTick = Number.isFinite(lastTick)
        ? lastTick + 1000 / 60 * Math.max(1, Math.floor((now - lastTick + .25) / (1000 / 60))) : now;
      tick(now, { render: true });
    }
    animation = view.requestAnimationFrame(display);
  }
  page.addEventListener('visibilitychange', refresh);
  animation = view.requestAnimationFrame(display); refresh();
  return { refresh, stop() {
    stopped = true; page.removeEventListener('visibilitychange', refresh);
    view.cancelAnimationFrame(animation); worker?.terminate();
    if (fallback !== null) view.clearInterval(fallback);
  } };
}
