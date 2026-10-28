// 같은 파일의 중복 요청·재시도는 항목 수를 늘리지 않는다. 바이트가 아닌 준비 완료 수다.
export function createDownloadProgress(onChange = () => {}) {
  let tasks = new Set(), started = false;
  const settled = new Map();
  const state = () => {
    const completed = [...tasks].filter(id => settled.get(id) === true).length;
    const failed = [...tasks].filter(id => settled.get(id) === false).length;
    const remaining = tasks.size - completed - failed;
    return { started, total: tasks.size, completed, failed, remaining,
      phase: !started ? 'idle' : remaining ? 'loading' : failed ? 'failed' : 'complete',
      percent: tasks.size ? Math.floor(completed / tasks.size * 100) : 100 };
  };
  const emit = () => onChange(state());
  return {
    state,
    plan(ids) { tasks = new Set(ids); emit(); },
    start() { started = true; emit(); },
    complete(id, ok = true) { settled.set(id, ok); emit(); },
    retry() { for (const id of tasks) if (settled.get(id) === false) settled.delete(id); emit(); },
    settle() { for (const id of tasks) if (!settled.has(id)) settled.set(id, false); emit(); },
  };
}

export function createDownloadIndicator(doc, { onRetry, schedule = setTimeout, cancel = clearTimeout } = {}) {
  const root = doc.getElementById('background-download');
  const label = root?.querySelector?.('[data-download-label]');
  const percent = root?.querySelector?.('[data-download-percent]');
  const bar = root?.querySelector?.('[data-download-bar]');
  const retry = root?.querySelector?.('[data-download-retry]');
  const announcement = root?.querySelector?.('[data-download-announcement]');
  let phase, timer, visible = true, dismissed = false;
  const hide = () => { if (root) root.hidden = !visible || dismissed || phase === 'idle'; };
  retry?.addEventListener('click', () => { onRetry?.(); });
  // 재시도 버튼의 Enter·Space가 뒤쪽 메뉴의 결정 입력으로 전달되지 않게 한다.
  for (const type of ['keydown', 'keyup']) retry?.addEventListener(type, event => event.stopPropagation());
  return {
    setVisible(value) { if (visible !== value) { visible = value; hide(); } },
    update(state) {
      if (!label) return;
      if (phase !== state.phase) {
        if (timer !== undefined) cancel(timer);
        timer = undefined; dismissed = false; phase = state.phase;
        announcement.textContent = phase === 'complete' ? '경기 자료 준비 완료'
          : phase === 'failed' ? '일부 자료 다운로드 실패. 재시도할 수 있습니다.'
          : phase === 'loading' ? '경기 자료를 준비하고 있습니다.' : '';
        if (phase === 'complete') timer = schedule(() => { dismissed = true; hide(); }, 2200);
      }
      root.dataset.phase = phase;
      label.textContent = phase === 'complete' ? '준비 완료' : phase === 'failed' ? '일부 자료 다운로드 실패' : '경기 자료 준비 중';
      percent.textContent = `${state.percent}%`;
      bar.value = state.percent;
      bar.hidden = phase === 'complete';
      retry.hidden = phase !== 'failed';
      root.title = `준비 완료 ${state.completed} / ${state.total}${state.failed ? ` · 실패 ${state.failed}개` : ''}`;
      hide();
    },
  };
}
