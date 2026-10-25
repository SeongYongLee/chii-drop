// 표현 계층의 포인터/키 입력을 공통 프레임 비트로 바꾼다. 경기 난수는 사용하지 않는다.
export function attachTouchControls(container) {
  const buttons = [...container.querySelectorAll('button[data-input]')];
  const held = new Map(), pending = new Map(), gestures = new Map();
  let enabled = false;
  let previousRotations = 0;
  const directional = (button) => [1, 2, 4, 32].includes(Number(button.dataset.input));
  function refresh() {
    for (const button of buttons) {
      const bit = Number(button.dataset.input);
      button.setAttribute('aria-pressed', String([...held.values()].includes(bit)));
      button.disabled = !enabled;
    }
  }
  function clear() { held.clear(); pending.clear(); gestures.clear(); previousRotations = 0; refresh(); }
  function release(event) {
    if (!held.has(event.pointerId) && !gestures.has(event.pointerId)) return;
    held.delete(event.pointerId);
    gestures.delete(event.pointerId);
    // 취소된 제스처는 짧은 탭으로 남기지 않는다. 정상 pointerup은 한 프레임 입력을 유지한다.
    const cancelled = event.type === 'pointercancel' || event.type === 'lostpointercapture';
    if (cancelled) pending.delete(event.pointerId);
    refresh();
  }
  function slide(event) {
    const gesture = gestures.get(event.pointerId);
    if (!enabled || !gesture) return;
    event.preventDefault();
    const regions = buttons.filter((button) => directional(button) && !button.disabled && button.parentElement === gesture.group)
      .map((button) => ({ bit: Number(button.dataset.input), rect: button.getBoundingClientRect?.() }))
      .filter(({ rect }) => rect?.width > 0 && rect.height > 0);
    if (!regions.length) return;
    const x = event.clientX, y = event.clientY, margin = 16;
    const inside = x >= Math.min(...regions.map(({ rect }) => rect.left)) - margin
      && x <= Math.max(...regions.map(({ rect }) => rect.right)) + margin
      && y >= Math.min(...regions.map(({ rect }) => rect.top)) - margin
      && y <= Math.max(...regions.map(({ rect }) => rect.bottom)) + margin;
    const ranked = regions.map(({ bit, rect }) => ({ bit,
      distance: Math.hypot(x - rect.left - rect.width / 2, y - rect.top - rect.height / 2) })).sort((a, b) => a.distance - b.distance);
    let bit = inside ? ranked[0].bit : 0;
    const previous = held.get(event.pointerId), oldRegion = ranked.find((region) => region.bit === previous);
    // 경계 근처의 손 떨림으로 방향이 빠르게 뒤바뀌는 것을 막는다.
    if (inside && oldRegion && bit !== previous && oldRegion.distance - ranked[0].distance < 6) bit = previous;
    if (bit === previous) return;
    held.set(event.pointerId, bit);
    if (bit) pending.set(event.pointerId, bit); else pending.delete(event.pointerId);
    refresh();
  }
  for (const button of buttons) {
    const bit = Number(button.dataset.input);
    button.addEventListener('pointerdown', (event) => {
      if (!enabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      held.set(event.pointerId, bit); pending.set(event.pointerId, bit);
      if (directional(button)) gestures.set(event.pointerId, { group: button.parentElement });
      button.setPointerCapture(event.pointerId); refresh();
    });
    button.addEventListener('pointermove', slide);
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, release);
    button.addEventListener('keydown', (event) => {
      if (!enabled || !['Space', 'Enter'].includes(event.code)) return;
      event.preventDefault();
      if (event.repeat) return;
      const key = `${bit}:${event.code}`;
      held.set(key, bit); pending.set(key, bit); refresh();
    });
    button.addEventListener('keyup', (event) => {
      if (!['Space', 'Enter'].includes(event.code)) return;
      event.preventDefault(); held.delete(`${bit}:${event.code}`); refresh();
    });
    button.addEventListener('blur', () => {
      for (const key of [`${bit}:Space`, `${bit}:Enter`]) held.delete(key);
      refresh();
    });
    // 보조 기술이 포인터 없이 버튼을 활성화해도 최소 한 프레임 입력한다.
    button.addEventListener('click', (event) => { if (enabled && event.detail === 0) pending.set(button, bit); });
    button.addEventListener('contextmenu', (event) => event.preventDefault());
    // Safari의 롱프레스 호출·선택·스크롤을 호환 마우스 이벤트보다 먼저 차단한다.
    for (const type of ['touchstart', 'touchmove']) button.addEventListener(type, (event) => { if (enabled) event.preventDefault(); }, { passive: false });
  }
  for (const type of ['contextmenu', 'selectstart', 'dragstart']) container.addEventListener?.(type, (event) => event.preventDefault());
  const doc = container.ownerDocument;
  doc.defaultView.addEventListener('blur', clear);
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) clear(); });
  refresh();
  return {
    clear,
    setEnabled(value) { enabled = value; if (!enabled) clear(); else refresh(); },
    read() {
      let input = [...held.values(), ...pending.values()].reduce((mask, bit) => mask | bit, 0);
      const pressed = [...pending.values()].reduce((mask, bit) => mask | bit, 0);
      const deferred = previousRotations & pressed & (8 | 16);
      input &= ~deferred;
      for (const [key, bit] of pending) if (!(bit & deferred)) pending.delete(key);
      previousRotations = input & (8 | 16);
      return enabled ? input : 0;
    },
  };
}
