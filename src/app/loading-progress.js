// 요청 건수가 아닌 고유 자료의 완료를 센다. 실패한 선택 자료도 재시도를 무한 대기하지 않는다.
export function createLoadingProgress(onChange = () => {}) {
  const tasks = new Set(['manifest', 'characters']), settled = new Map();
  let planned = false, ready = false;
  function state() {
    const completed = [...tasks].filter(id => settled.has(id)).length;
    const failed = [...tasks].filter(id => settled.get(id) === false).length;
    const pending = [...tasks].filter(id => !settled.has(id));
    return { planned, ready, total: tasks.size, completed, remaining: tasks.size - completed, failed,
      percent: ready ? 100 : Math.min(99, Math.floor(completed / tasks.size * 100)),
      stage: !planned ? '게임 자료 확인 중…' : pending.some(id => id.startsWith('image:')) ? '이미지 준비 중…'
        : pending.some(id => /^(voice|effect):/.test(id)) ? '음성·효과음 준비 중…' : '마무리 중…' };
  }
  const emit = () => onChange(state());
  emit();
  return {
    plan(ids) { for (const id of ids) tasks.add(id); planned = true; emit(); },
    complete(id, ok = true) { settled.set(id, ok); emit(); },
    settleGroup(prefix) { for (const id of tasks) if (id.startsWith(prefix) && !settled.has(id)) settled.set(id, false); emit(); },
    finish() { ready = state().remaining === 0; emit(); },
    state,
  };
}

export function createLoadingScreen(doc) {
  let failed = false;
  const root = doc.getElementById('loading-screen');
  const stage = root?.querySelector('[data-loading-stage]'), bar = root?.querySelector('[data-loading-bar]');
  const percent = root?.querySelector('[data-loading-percent]'), detail = root?.querySelector('[data-loading-detail]');
  return {
    update(state) {
      if (!root || failed) return;
      if (stage.textContent !== state.stage) stage.textContent = state.stage;
      if (state.planned) {
        bar.value = state.percent; percent.textContent = `${state.percent}%`;
        detail.textContent = `준비 진행 ${state.completed} / ${state.total} · 남은 항목 ${state.remaining}개`;
        if (state.failed) detail.textContent += ' · 일부 자료를 불러오지 못했습니다.';
      }
    },
    hide() { if (root) root.hidden = true; },
    fail() {
      if (!root) return;
      failed = true;
      stage.textContent = '게임 자료를 불러오지 못했습니다';
      bar.removeAttribute('value'); percent.textContent = '다시 불러와 주세요';
      detail.textContent = '연결 상태를 확인한 뒤 새로고침해 주세요.';
    },
  };
}
