// 표시 중에는 10Hz로 감시하고 숨김·표시 중단 시에만 60Hz 프레임을 공급한다.
let timer = null, period = null;
self.onmessage = ({ data }) => {
  const next = data === 'start' ? 1000 / 60 : data === 'watch' ? 100 : null;
  if (next === period) return;
  if (timer !== null) clearInterval(timer);
  period = next;
  timer = next === null ? null : setInterval(() => self.postMessage('tick'), next);
};
