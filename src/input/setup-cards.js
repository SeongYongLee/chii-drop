// 대전 설정은 캐릭터와 설정을 하나의 선수 카드 안에 묶는다.
function updateSetupSelection(container, items, focusSelection = false) {
  for (const field of container.querySelectorAll?.('[data-setup-field]') ?? []) {
    const selected = Boolean(items[Number(field.dataset.setupField)]?.selected);
    field.setAttribute('aria-current', String(selected));
    if (selected && focusSelection) field.focus({ preventScroll: true });
  }
}

function renderSetupCards(document, container, items, setup, activate, focus = () => {}, openPicker) {
  const focusedField = document.activeElement?.dataset?.setupField;
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  container.replaceChildren();
  container.hidden = false;
  container.dataset.players = String(setup.players.length);
  container.append(make('h2', 'setup-menu-title', setup.title));
  const hint = make('p', 'setup-keyboard-hint', '↑↓ 항목 이동 · ←→ 변경 · Enter 결정 · Esc 뒤로');
  hint.id = 'setup-keyboard-hint'; container.append(hint);
  for (let side = 0; side < setup.players.length; side++) {
    const player = setup.players[side];
    const character = items[player.characterIndex], difficulty = items[player.levelIndex];
    const card = make('section', 'setup-player-card');
    card.dataset.side = String(side);
    card.setAttribute('aria-label', `${player.label} 설정`);
    card.append(make('span', 'setup-player-badge', player.label));
    const portrait = make('canvas', 'setup-player-portrait');
    portrait.width = portrait.height = 320;
    portrait.dataset.setupPreview = String(player.characterIndex);
    portrait.setAttribute('aria-hidden', 'true');
    const ctx = portrait.getContext('2d');
    if (ctx) character?.drawPreview?.(ctx, 320);
    card.append(portrait);
    for (const [item, index] of [[character, player.characterIndex], [difficulty, player.levelIndex]]) {
      if (!item) continue;
      const isCharacter = index === player.characterIndex;
      if (!isCharacter) card.append(make('span', 'setup-field-label', '난이도'));
      const select = make(openPicker ? 'button' : 'select', isCharacter ? 'setup-character-select' : 'setup-level-select');
      select.setAttribute('aria-label', item.label);
      select.setAttribute('aria-describedby', hint.id);
      select.dataset.setupField = String(index);
      select.addEventListener('focus', () => focus(index));
      select.disabled = Boolean(item.disabled);
      if (openPicker) {
        select.type = 'button'; select.textContent = item.value;
        select.setAttribute('aria-label', `${item.label} · ${item.value}`);
        select.dataset.setupChoice = 'true'; select.setAttribute('aria-haspopup', 'dialog');
        select.addEventListener('click', () => openPicker(index));
      } else {
        (item.choiceLabels ?? [item.value]).forEach((name, optionIndex) => {
          const option = make('option', '', name);
          option.value = String(optionIndex); option.disabled = Boolean(item.choiceDisabled?.[optionIndex]); select.append(option);
        });
        select.value = String(item.choiceIndex ?? 0);
        select.addEventListener('change', () => activate(index, Number(select.value) - (item.choiceIndex ?? 0)));
      }
      card.append(select);
    }
    container.append(card);
  }
  const start = make('button', 'setup-start-button', setup.startLabel);
  start.type = 'button'; start.disabled = Boolean(items[setup.startIndex]?.disabled);
  start.setAttribute('aria-describedby', hint.id);
  start.dataset.setupField = String(setup.startIndex);
  start.addEventListener('focus', () => focus(setup.startIndex));
  start.addEventListener('click', () => activate(setup.startIndex, 1));
  container.append(start);
  updateSetupSelection(container, items, focusedField !== undefined);
}

function animateSetupCards(container, items, frame) {
  for (const canvas of container.querySelectorAll?.('[data-setup-preview]') ?? []) {
    const ctx = canvas.getContext('2d'); if (!ctx) continue;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    items[Number(canvas.dataset.setupPreview)]?.drawPreview?.(ctx, canvas.width, frame);
  }
}
export { renderSetupCards, updateSetupSelection, animateSetupCards };

// 펼친 목록도 게임의 글꼴·정렬·비활성 표시를 사용한다.
function createSetupPicker(view, { choose, opened, closed }) {
  const doc = view.document;
  if (!doc.createElement || !doc.body?.append) return null;
  const dialog = doc.createElement('dialog');
  if (!dialog.showModal) return null;
  dialog.className = 'setup-choice-dialog';
  dialog.setAttribute('aria-labelledby', 'setup-choice-title');
  let field = 0;
  const dismiss = () => { if (dialog.open) dialog.close(); };
  dialog.addEventListener('close', () => closed(field));
  dialog.addEventListener('keydown', event => {
    event.stopPropagation();
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...dialog.querySelectorAll('[data-choice-index]:not(:disabled)')];
    if (!buttons.length) return;
    const current = buttons.indexOf(doc.activeElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[index].focus();
  });
  dialog.addEventListener('keyup', event => event.stopPropagation());
  return {
    get isOpen() { return dialog.open; },
    open(index, item) {
      if (dialog.open || !item || item.disabled) return;
      field = index; opened(); dialog.replaceChildren();
      const title = doc.createElement('h2'); title.id = 'setup-choice-title'; title.textContent = item.label;
      const list = doc.createElement('div'); list.className = 'setup-choice-list';
      (item.choiceLabels ?? []).forEach((label, choice) => {
        const button = doc.createElement('button'); button.type = 'button'; button.textContent = label;
        button.dataset.choiceIndex = String(choice); button.disabled = Boolean(item.choiceDisabled?.[choice]);
        if (choice === item.choiceIndex) button.setAttribute('aria-current', 'true');
        button.addEventListener('click', () => { dismiss(); choose(index, choice - item.choiceIndex); });
        list.append(button);
      });
      const back = doc.createElement('button'); back.type = 'button'; back.className = 'setup-choice-close'; back.textContent = '닫기';
      back.addEventListener('click', dismiss); dialog.append(title, list, back);
      if (!dialog.isConnected) doc.body.append(dialog);
      dialog.showModal();
      (list.querySelector('[aria-current="true"]:not(:disabled)') ?? list.querySelector('button:not(:disabled)') ?? back).focus();
    },
  };
}
export { createSetupPicker };
