// 소프트 키보드는 레이아웃 뷰포트를 그대로 두고 보이는 영역만 줄일 수 있다.
// 경기 시계와 분리해 폼·입력 시트의 크기와 포커스만 관리한다.
export function isTextEntry(element) {
  if (!element) return false;
  if (element.isContentEditable) return true;
  if (element.tagName === 'TEXTAREA') return !element.disabled && !element.readOnly;
  return element.tagName === 'INPUT' && !element.disabled && !element.readOnly
    && ['text', 'search', 'password', 'email', 'tel', 'url', 'number'].includes(element.type);
}

export function attachMobileViewport(view, { shell = view.document.body, root: surface = view.document } = {}) {
  const doc = view.document;
  const root = shell === doc.body ? doc.documentElement : (surface.host ?? shell);
  const viewport = view.visualViewport;
  let frame = null, ensureFocus = false;
  function update() {
    frame = null;
    const height = viewport?.height ?? view.innerHeight;
    const top = viewport?.offsetTop ?? 0;
    root.style.setProperty('--visible-height', `${height}px`);
    root.style.setProperty('--visible-top', `${top}px`);
    const editing = isTextEntry(surface.activeElement);
    shell.dataset.editing = String(editing);
    shell.dataset.compactViewport = String(height < 360);
    // 핀치 줌으로 줄어든 영역을 키보드로 잘못 판단하지 않는다.
    const keyboard = editing && Math.abs((viewport?.scale ?? 1) - 1) < 0.05
      && view.innerHeight - height > 120;
    shell.dataset.keyboardOpen = String(keyboard);
    if (ensureFocus && editing) {
      const rect = surface.activeElement.getBoundingClientRect();
      const dialog = surface.activeElement.closest?.('dialog[open]');
      const submit = dialog?.querySelector('button[type="submit"]');
      const bottom = submit ? Math.min(top + height - 12, submit.getBoundingClientRect().top - 12) : top + height - 12;
      if (rect.top < top + 12 || rect.bottom > bottom) {
        surface.activeElement.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      }
    }
    ensureFocus = false;
  }
  function schedule({ focus = false } = {}) {
    ensureFocus ||= focus;
    if (frame === null) frame = view.requestAnimationFrame(update);
  }
  const resize = () => schedule({ focus: true });
  const scroll = () => schedule();
  // 포커스를 바꾼 직후 activeElement가 아직 이전 입력창인 브라우저도 있어 다음 프레임에 읽는다.
  doc.addEventListener('focusin', resize);
  doc.addEventListener('focusout', scroll);
  view.addEventListener('resize', resize);
  viewport?.addEventListener('resize', resize);
  viewport?.addEventListener('scroll', scroll);
  schedule();
  return {
    dismissKeyboard() { if (isTextEntry(surface.activeElement)) surface.activeElement.blur(); },
    dispose() {
      if (frame !== null) view.cancelAnimationFrame(frame);
      doc.removeEventListener('focusin', resize); doc.removeEventListener('focusout', scroll);
      view.removeEventListener('resize', resize);
      viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', scroll);
      root.style.removeProperty('--visible-height'); root.style.removeProperty('--visible-top');
      delete shell.dataset.editing; delete shell.dataset.keyboardOpen; delete shell.dataset.compactViewport;
    },
  };
}
