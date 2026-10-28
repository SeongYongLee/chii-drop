// DOM menus use device-neutral actions so a gamepad can dispatch the same commands.
export const MENU_ACTIONS = Object.freeze({ up: 'up', down: 'down', left: 'left', right: 'right', confirm: 'confirm', back: 'back' });
const keys = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'confirm', Space: 'confirm', Escape: 'back', Backspace: 'back' };
export const menuActionForKey = code => keys[code] ?? null;

// Prefer the nearest control in the requested direction, with a strong preference
// for controls whose edges overlap the current row or column.
export function directionalMenuIndex(rects, index, action) {
  if (!rects.length) return -1;
  if (!rects[index]) return 0;
  const vertical = action === 'up' || action === 'down';
  const sign = action === 'up' || action === 'left' ? -1 : 1;
  const axis = vertical ? 'y' : 'x', cross = vertical ? 'x' : 'y';
  const size = vertical ? 'width' : 'height';
  const from = rects[index];
  let best = index, score = Infinity;
  rects.forEach((rect, next) => {
    const forward = (rect[axis] - from[axis]) * sign;
    if (next === index || forward < 2) return;
    const lateral = Math.abs(rect[cross] - from[cross]);
    const gap = Math.max(0, lateral - (rect[size] + from[size]) / 2);
    const rank = forward + lateral * .3 + (gap > 1 ? 10000 + gap * 5 : 0);
    if (rank < score) { score = rank; best = next; }
  });
  return best;
}

export function attachMenuNavigation({ view, root, getContext, onBack, onChange = () => {} }) {
  const controls = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [tabindex="0"]';
  let previous, previousKey, scopeKey, wasOverlay = false, scheduled = false;
  const visible = element => element && !element.disabled && element.getAttribute('aria-disabled') !== 'true'
    && !element.closest('[hidden], [inert], [aria-hidden="true"], dialog:not([open])')
    && !element.closest('details:not([open]) > :not(summary)')
    && element.getClientRects().length > 0 && view.getComputedStyle(element).visibility !== 'hidden';
  function scope() {
    const dialog = [...root.querySelectorAll('dialog[open]')].at(-1);
    if (dialog) return dialog;
    const menu = root.querySelector('#battle-menu[open]');
    if (menu) return menu;
    const profile = root.querySelector('.profile-edit[open]');
    return profile ?? root;
  }
  const candidates = () => [...scope().querySelectorAll(controls)].filter(element => !element.classList?.contains('skip-link') && visible(element));
  const identity = element => element?.id || element?.dataset.navKey;
  function focus(element) {
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (root.activeElement === element) { previous = element; previousKey = identity(element); onChange(); }
  }
  function currentScopeKey() {
    const current = scope();
    if (current !== root) return current.id || current.className;
    if (visible(root.getElementById('online-result'))) return 'online-result';
    return ['panel-create', 'panel-rankings', 'room-view', 'character-select-view', 'game-view']
      .find(id => visible(root.getElementById(id))) ?? 'lobby';
  }
  const externalModal = () => view.document.querySelector('dialog[open]') && !root.querySelector('dialog[open]');
  function sync() {
    if (!getContext().enabled || externalModal()) return;
    const nextScope = currentScopeKey();
    const changed = nextScope !== scopeKey; scopeKey = nextScope;
    const overlay = scope() !== root, closedOverlay = wasOverlay && !overlay; wasOverlay = overlay;
    if (getContext().gameplay && !root.querySelector('dialog[open]')) return;
    const list = candidates(), active = root.activeElement;
    if ((!changed || closedOverlay) && visible(active) && list.includes(active)) return;
    const remembered = !changed && list.find(element => identity(element) && identity(element) === previousKey);
    const panel = root.getElementById(nextScope);
    const preferred = list.find(element => element.hasAttribute('data-menu-default') && (!panel || panel.contains(element)));
    const selectedTab = list.find(element => element.getAttribute('aria-current') === 'page');
    focus(remembered || preferred || selectedTab || list[0]);
  }
  function dispatch(action) {
    const context = getContext();
    if (!context.enabled || externalModal() || !Object.values(MENU_ACTIONS).includes(action)) return false;
    if (action === 'back') {
      const dialog = [...root.querySelectorAll('dialog[open]')].at(-1);
      if (dialog) {
        dialog.close();
        scopeKey = currentScopeKey(); wasOverlay = scope() !== root;
        focus(visible(root.activeElement) ? root.activeElement : candidates()[0]);
        onChange(); return true;
      }
      const details = root.activeElement?.closest('details[open]') ?? root.querySelector('#battle-menu[open], .profile-edit[open]');
      if (details) {
        details.open = false;
        scopeKey = currentScopeKey(); wasOverlay = scope() !== root;
        focus(details.id === 'battle-menu' ? root.getElementById('screen') : details.querySelector('summary'));
        onChange(); return true;
      }
      onBack(); sync(); return true;
    }
    if (context.gameplay && !root.querySelector('dialog[open]')) return false;
    const list = candidates(), active = root.activeElement;
    if (action === 'confirm') {
      const selected = list.includes(active) ? active : list[0];
      if (selected && !['INPUT', 'SELECT', 'TEXTAREA'].includes(selected.tagName)) selected.click();
      else focus(selected);
    } else {
      const rects = list.map(element => { const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height }; });
      focus(list[directionalMenuIndex(rects, list.indexOf(active), action)]);
    }
    return true;
  }
  function keydown(event) {
    if (!getContext().enabled || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    // A guide outside this ShadowRoot retains its own native keyboard handling.
    if (externalModal()) return;
    if (event.code === 'Tab' && scope() !== root) {
      const list = candidates(), index = list.indexOf(root.activeElement);
      const next = index < 0 ? 0 : (index + (event.shiftKey ? -1 : 1) + list.length) % list.length;
      focus(list[next]); event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    const action = menuActionForKey(event.code);
    if (!action) return;
    const target = event.composedPath()[0];
    const editing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName) || target?.isContentEditable;
    if (editing) {
      if (event.code !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (target.id === 'chat-input') {
        target.blur();
        focus(visible(root.getElementById('screen')) ? root.getElementById('screen') : root.getElementById('chat-toggle'));
      } else dispatch('back');
      onChange(); return;
    }
    if (event.repeat && ['confirm', 'back'].includes(action)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (dispatch(action)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }
  view.addEventListener('keydown', keydown, true);
  root.addEventListener('focusin', event => {
    previous = event.target; previousKey = identity(previous); onChange();
  });
  const observer = new view.MutationObserver(mutations => {
    const relevant = mutations.some(mutation => mutation.type === 'attributes' || [...mutation.addedNodes, ...mutation.removedNodes].some(node => node.nodeType === 1 && (node === previous || node.matches?.(controls) || node.querySelector?.(controls))));
    if (!relevant || scheduled) return;
    scheduled = true;
    view.queueMicrotask(() => { scheduled = false; sync(); });
  });
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'disabled', 'open'] });
  return { dispatch, sync, destroy() { observer.disconnect(); view.removeEventListener('keydown', keydown, true); } };
}
