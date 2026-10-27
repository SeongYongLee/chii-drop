import { playSfx, unlockSfx } from '../audio/sfx.js';
import { playCharacterVoice } from '../audio/character-voice.js';
import { CPU_LEVELS } from '../cpu/cpu.js';
import { MENU_KEYS, wasPressed } from '../input/keyboard.js';
import { PALETTE, flower, paper } from '../view/festival.js';
import { FONT, INK } from '../view/renderer.js';
import { reducedUiMotion } from '../view/ui-motion.js';

import { withControlsGuide } from './controls-guide.js';
import { MODES } from './modes.js';
import { createGameScene } from './game-scene.js';
import { createStoryFlow } from './story-mode.js';
import { SCREEN_HEIGHT, SCREEN_WIDTH, isPortraitScreen } from './screen.js';
import { drawPortraitHero } from '../view/portrait-ui.js';
import { setupBoxes, drawSetupMenu } from '../view/setup-menu.js';
import { loadStory, saveSettings } from './storage.js';

function drawPanel(ctx, app, title, bottom = 465) {
  app.skin.drawBackground(ctx, SCREEN_WIDTH, SCREEN_HEIGHT, 'menu');
  const notebook = title === '설정' || title === '기록';
  paper(ctx, 140, 55, 680, bottom - 55, { radius: 20 });
  if (notebook) {
    ctx.strokeStyle = '#dfb5b0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(174, 70); ctx.lineTo(174, 450); ctx.stroke();
    for (let y = 140; y < 445; y += 42) {
      ctx.strokeStyle = '#d6e0dc70'; ctx.beginPath(); ctx.moveTo(188, y); ctx.lineTo(796, y); ctx.stroke();
    }
  } else {
    paper(ctx, 317, 38, 326, 66, { fill: PALETTE.cream, radius: 12 });
    flower(ctx, 337, 71, 9); flower(ctx, 623, 71, 9, PALETTE.blue);
  }
  ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold ${title.length > 10 ? 25 : 29}px ${FONT}`;
  ctx.fillText(title, 480, notebook ? 95 : 72);
  const character = app.skin.characters?.[0];
  if (character) app.skin.drawCharacter(ctx, character.id, 'idle', 22, 352, 120, { frame: app.animationFrame, instance: 'menu-portrait' });
}

function drawFooter(ctx, text, y = 488) {
  ctx.fillStyle = PALETTE.muted; ctx.font = `14px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, SCREEN_WIDTH / 2, y);
}

function moveCursor(items, index, delta) {
  let next = index;
  for (let i = 0; i < items.length; i++) {
    next = (next + delta + items.length) % items.length;
    if (!items[next].disabled) {
      return next;
    }
  }
  return index;
}

// items(app)는 매 프레임 다시 만들어 현재 설정 값을 표시한다.
function createListMenu({ title, items, onBack, notice, noticeSummary, columns = 1, compact = false, initialIndex = 0, navigationOrder, footer = '↑↓ 선택 · Enter 결정 · Esc 뒤로' }) {
  let index = initialIndex;
  let selectionAge = 12;
  const lifts = [];
  function activate(app, picked, delta = 1) {
    const item = items(app)[picked];
    if (!item || item.disabled) return;
    index = picked; selectionAge = 0;
    if (item.select) { playSfx(app.sfx, 'confirm'); item.select(app); }
    else if (item.change) { playSfx(app.sfx, 'cursor'); item.change(app, delta); }
  }
  return {
    touchDirect: true,
    touchColumns: columns,
    touchNotice: (app) => notice?.(app),
    touchNoticeSummary: app => noticeSummary?.(app),
    touchItems: (app) => items(app).map((item, i) => ({ label: item.label,
      compactLabel: item.compactLabel,
      sectionLabel: item.sectionLabel,
      value: item.value, disabled: Boolean(item.disabled), selected: index === i,
      adjustable: Boolean(item.change && (typeof item.value === 'number' || item.adjustable)),
      focus: () => { index = i; selectionAge = 0; },
      activate: (delta = 1) => activate(app, i, delta) })),
    touchLabel(app) {
      if (app.portraitScreen) return '';
      const item = items(app)[index];
      return `${title} · ${item?.label ?? ''}${item?.value === undefined ? '' : ` ${item.value}`}`;
    },
    tap(app, { x, y }, viewport) {
      if (viewport?.portrait) return true;
      const list = items(app);
      const step = Math.min(49, 254 / Math.max(1, list.length - 1));
      const picked = Math.round((y - 148) / step);
      if (x < 195 || x > 765 || picked < 0 || picked >= list.length
        || Math.abs(y - (148 + picked * step)) > step / 2 || list[picked].disabled) return true;
      activate(app, picked, x < 480 ? -1 : 1);
      return true;
    },
    update(app) {
      const { keyboard, sfx } = app;
      const list = items(app);
      if (list[index]?.disabled) index = moveCursor(list, index, 1);
      selectionAge += 1;
      if (wasPressed(keyboard, MENU_KEYS.up) || wasPressed(keyboard, MENU_KEYS.down)) {
        const direction = wasPressed(keyboard, MENU_KEYS.up) ? -1 : 1;
        const order = navigationOrder?.(app);
        index = order ? order[moveCursor(order.map(i => list[i]), order.indexOf(index), direction)] : moveCursor(list, index, direction);
        selectionAge = 0;
        playSfx(sfx, 'cursor');
      } else if (wasPressed(keyboard, MENU_KEYS.left) || wasPressed(keyboard, MENU_KEYS.right)) {
        const change = list[index].change;
        if (change) {
          change(app, wasPressed(keyboard, MENU_KEYS.left) ? -1 : 1);
          selectionAge = 0;
          playSfx(sfx, 'cursor');
        }
      } else if (wasPressed(keyboard, MENU_KEYS.confirm)) {
        const item = list[index];
        if (item.disabled) return;
        if (item.select) {
          playSfx(sfx, 'confirm');
          item.select(app);
        } else if (item.change) {
          item.change(app, 1);
          selectionAge = 0;
          playSfx(sfx, 'cursor');
        }
      } else if (wasPressed(keyboard, MENU_KEYS.back) && onBack) {
        playSfx(sfx, 'cancel');
        onBack(app);
      }
      list.forEach((item, i) => {
        const target = i === index && !item.disabled && !reducedUiMotion() ? 4 : 0;
        lifts[i] = (lifts[i] ?? 0) + (target - (lifts[i] ?? 0)) * .35;
      });
    },
    draw(ctx, app) {
      const list = items(app);
      if (list[index]?.disabled) index = moveCursor(list, index, 1);
      if(isPortraitScreen(ctx)){
        drawPortraitHero(ctx,app,title);return;
      }
      const rowStep = Math.min(49, 254 / Math.max(1, list.length - 1));
      const itemHeight = Math.min(42, rowStep - 4);
      const panelBottom = compact ? Math.min(465, 148 + Math.max(0, list.length - 1) * rowStep + itemHeight / 2 + 22) : 465;
      drawPanel(ctx, app, title, panelBottom);
      list.forEach((item, i) => {
        const y = 148 + i * rowStep;
        const selected = i === index && !item.disabled;
        const lift = reducedUiMotion() ? 0 : (lifts[i] ?? 0);
        ctx.save(); ctx.translate(480, y - lift); ctx.scale(1 + lift * .002, 1 + lift * .002); ctx.translate(-480, -y);
        paper(ctx, 195, y - itemHeight / 2, 570, itemHeight, {
          fill: selected ? PALETTE.pink : item.disabled ? '#f3eee3' : '#fffdf8',
          edge: selected ? '#bd7c88' : '#e4d9c8', radius: 11, shadow: selected,
        });
        if (selected) {
          const t = Math.min(1, selectionAge / 10);
          const bloom = reducedUiMotion() ? 1 : 1 + .35 * Math.sin(Math.PI * t);
          flower(ctx, 215, y, 7 * bloom, '#fffdf5');
        }
        ctx.fillStyle = item.disabled ? '#877b6b' : INK;
        ctx.font = `${selected ? 'bold ' : ''}${item.label.length > 25 ? 17 : 20}px ${FONT}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(item.value === undefined ? item.label : `${item.label}   ◀ ${item.value} ▶`, 480, y);
        ctx.restore();
      });
      const message = notice?.(app);
      const lines = message ? message.split('\n') : [];
      const footerY = Math.min(compact ? panelBottom + 26 : 488, 526 - (lines.length - 1) * 16 - 20);
      const noticeStart = compact ? footerY + 30 : 526 - (lines.length - 1) * 16;
      const noticeStep = compact ? Math.min(18, (526 - noticeStart) / Math.max(1, lines.length - 1)) : 16;
      drawFooter(ctx, footer, footerY);
      if (message) {
        ctx.fillStyle = PALETTE.muted; ctx.font = `12px ${FONT}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        lines.forEach((line, i) => ctx.fillText(line, SCREEN_WIDTH / 2, noticeStart + i * noticeStep, SCREEN_WIDTH - 48));
      }
    },
  };
}

function createTitleScene() {
  let frame = 0;
  return {
    touchTitle: true,
    touchLabel: app => app.portraitScreen ? '' : '화면을 누르거나 결정 버튼으로 시작하세요',
    update(app) {
      frame += 1;
      if (wasPressed(app.keyboard, MENU_KEYS.confirm)) {
        void unlockSfx(app.sfx).then(() => playSfx(app.sfx, 'confirm'));
        app.goToMenu();
      }
    },
    draw(ctx, app) {
      if(isPortraitScreen(ctx)){
        drawPortraitHero(ctx,app,app.skin.branding?.title??'퍼즐 대전',{
          characters:app.skin.characters.slice(0,3),frame,
        });return;
      }
      app.skin.drawBackground(ctx, SCREEN_WIDTH, SCREEN_HEIGHT, 'title');
      paper(ctx, 160, 80, 640, 136, { fill: '#fffdf5', radius: 24 });
      flower(ctx, 192, 148, 12); flower(ctx, 768, 148, 12, PALETTE.blue);
      const { characters } = app.skin;
      const size = 166;
      characters.slice(0, 3).forEach((character, i) => {
        const x = SCREEN_WIDTH / 2 - (size * 3 + 40) / 2 + i * (size + 20);
        app.skin.drawCharacter(ctx, character.id, 'idle', x, 263, size, { frame, instance: `title-${i}` });
      });
      ctx.fillStyle = INK;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const title = app.skin.branding?.title ?? '퍼즐 대전';
      const subtitle = app.skin.branding?.subtitle ?? '';
      const tagline = app.skin.branding?.tagline;
      ctx.font = `bold 46px ${FONT}`;
      ctx.strokeStyle = '#e8c2b2'; ctx.lineWidth = 7; ctx.lineJoin = 'round';
      ctx.strokeText(title, SCREEN_WIDTH / 2, 139, 534);
      ctx.fillText(title, SCREEN_WIDTH / 2, 139, 534);
      ctx.font = `17px ${FONT}`; ctx.fillStyle = PALETTE.muted;
      if (tagline) {
        const prefix = subtitle ? `${subtitle} - ` : '';
        const prefixWidth = ctx.measureText(prefix).width;
        ctx.font = `italic 17px ${FONT}`;
        const width = prefixWidth + ctx.measureText(tagline).width;
        ctx.save();
        ctx.translate(480, 187);
        const scale = Math.min(1, 534 / width);
        ctx.scale(scale, scale);
        ctx.textAlign = 'left';
        ctx.font = `17px ${FONT}`;
        ctx.fillText(prefix, -width / 2, 0);
        ctx.font = `italic 17px ${FONT}`;
        ctx.fillText(tagline, -width / 2 + prefixWidth, 0);
        ctx.restore();
      } else ctx.fillText(subtitle, 480, 187, 534);
      {
        paper(ctx, 355, 453, 250, 44, { fill: PALETTE.cream, radius: 22 });
        ctx.fillStyle = INK; ctx.font = `bold 18px ${FONT}`;
        ctx.fillText(app.mobile?.visible ? '화면을 눌러 시작' : 'Enter를 눌러 시작', SCREEN_WIDTH / 2, 475);
      }
    },
  };
}

function selectionCharacters(skin) {
  return (skin.characterRoster ?? skin.characters).filter((character) => character.selectionVisible !== false);
}

// 캐릭터·CPU 난이도는 모든 모드에서 같은 선수 카드로 설정한다.
function createMatchSetup({ mode = 'cpu', characters: initialCharacters, cpuLevel, cpuLevels, onBack } = {}) {
  const labels = mode === 'watch' ? ['CPU 1', 'CPU 2'] : mode === 'cpu' ? ['1P', 'CPU'] : mode === 'versus' ? ['1P', '2P'] : ['1P'];
  const title = { cpu: 'CPU 대전', watch: 'CPU 관전', versus: '로컬 대전', solo: '연습' }[mode];
  const players = labels.map((label, side) => ({ label, characterIndex: side,
    levelIndex: mode === 'watch' ? labels.length + side : mode === 'cpu' && side === 1 ? 2 : undefined }));
  const startIndex = labels.length + players.filter(player => player.levelIndex !== undefined).length;
  const setup = { title, players, startIndex, startLabel: mode === 'watch' ? '관전 시작' : mode === 'solo' ? '연습 시작' : '대전 시작' };
  const indices = labels.map((_, side) => side);
  const levels = labels.map((_, side) => Math.max(0, CPU_LEVELS.findIndex(level => level.id === (cpuLevels?.[side] ?? cpuLevel ?? (mode === 'cpu' ? 'beginner' : 'hard')))));
  const available = app => selectionCharacters(app.skin).filter(character => character.selectable !== false);
  const choices = (app, side) => selectionCharacters(app.skin).concat(mode === 'cpu' && side === 1 ? [{ id: 'random-opponent', name: '랜덤', random: true }] : []);
  let initialized = false;
  function initialize(app) {
    if (initialized || !available(app).length) return;
    initialized = true;
    indices.forEach((_, side) => {
      const pool = choices(app, side), previous = pool.findIndex(character => character.id === initialCharacters?.[side]?.id);
      indices[side] = previous >= 0 && pool[previous].selectable !== false ? previous : mode === 'cpu' && side === 1 ? pool.length - 1 : pool.map((character, index) => character.selectable !== false ? index : -1).filter(index => index >= 0)[side % available(app).length];
    });
  }
  const cycle = (value, delta, length) => ((value + delta) % length + length) % length;
  const selectedCharacters = app => labels.map((_, side) => choices(app, side)[indices[side] % choices(app, side).length]);
  function start(app) {
    const pool = available(app); if (!pool.length) return;
    const picks = selectedCharacters(app);
    if (picks[1]?.random) {
      const others = pool.filter(character => character.id !== picks[0].id);
      const candidates = others.length ? others : pool;
      picks[1] = candidates[crypto.getRandomValues(new Uint32Array(1))[0] % candidates.length];
    }
    const next = () => createGameScene({ mode, characters: picks, cpuLevel: CPU_LEVELS[levels[1] ?? levels[0]].id,
      cpuLevels: levels.map(index => CPU_LEVELS[index].id), ...(mode === 'watch' ? { onQuit: app => app.setScene(menu) } : {}) });
    if (mode === 'watch') app.setScene(next());
    else {
      picks.forEach((character, side) => { if (mode !== 'cpu' || side === 0) playCharacterVoice(app.sfx, character.id, 'select', { channel: side }); });
      withControlsGuide(app, { mode, background: menu, next });
    }
  }
  function items(app) {
    initialize(app);
    const result = labels.map((label, side) => {
      const pool = choices(app, side), character = pool[indices[side] % pool.length];
      return { label: `${label} 캐릭터`, value: character?.name ?? '준비 중', adjustable: true, disabled: !available(app).length,
        previewKey: character?.id, choiceLabels: pool.map(entry => entry.selectable === false ? `${entry.name} · 준비 중` : entry.name), choiceDisabled: pool.map(entry => entry.selectable === false), choiceIndex: indices[side] % pool.length,
        change: (_, delta) => {
          if (!pool.length || !available(app).length) return;
          let next = cycle(indices[side], delta, pool.length);
          for (let attempt = 0; pool[next].selectable === false && attempt < pool.length; attempt++) next = cycle(next, Math.sign(delta) || 1, pool.length);
          indices[side] = next;
        },
        drawPreview(ctx, size, frame = app.animationFrame ?? 0) {
          if (character?.random) {
            ctx.fillStyle = '#665247'; ctx.font = `bold ${size * .65}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', size / 2, size / 2);
          } else if (character) app.skin.drawCharacter(ctx, character.id, 'idle', size * .12, size * .12, size * .76,
            { frame, instance: `setup-${side}`, presentation: 'selection' });
        } };
    });
    players.forEach((player, side) => {
      if (player.levelIndex === undefined) return;
      result.push({ label: `${player.label} 난이도`, value: CPU_LEVELS[levels[side]].label, adjustable: true,
        choiceLabels: CPU_LEVELS.map(level => level.label), choiceIndex: levels[side],
        change: (_, delta) => { levels[side] = cycle(levels[side], delta, CPU_LEVELS.length); } });
    });
    result.push({ label: setup.startLabel, disabled: !available(app).length, select: () => start(app) });
    return result;
  }
  const order = players.flatMap(player => [player.characterIndex, player.levelIndex].filter(index => index !== undefined)).concat(startIndex);
  const menu = createListMenu({ title, columns: labels.length, items, navigationOrder: () => order,
    onBack: app => onBack ? onBack(app) : mode === 'versus' ? app.goToMultiplayer() : app.goToSinglePlayer() });
  menu.touchLayout = 'match-setup'; menu.touchSetup = setup;
  menu.touchLabel = () => ''; menu.touchNotice = () => null;
  const touchItems = menu.touchItems;
  menu.touchItems = app => {
    const presentation = items(app);
    return touchItems(app).map((item, i) => {
      const { change, select, ...details } = presentation[i]; return { ...item, ...details };
    });
  };
  menu.draw = (ctx, app) => {
    initialize(app);
    drawSetupMenu(ctx, app, { ...setup, characters: selectedCharacters(app), levels: levels.map(index => CPU_LEVELS[index].label),
      selected: menu.touchItems(app).findIndex(item => item.selected) });
  };
  menu.tap = (app, { x, y }, viewport) => {
    if (viewport?.portrait) return true;
    const boxes = setupBoxes(setup), index = boxes.findIndex(box => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height);
    if (index >= 0) menu.touchItems(app)[index].activate(x < boxes[index].x + boxes[index].width / 2 ? -1 : 1);
    return true;
  };
  return menu;
}

function createSettingsMenu() {
  const update = (app, patch) => {
    Object.assign(app.settings, patch);
    saveSettings(app.settings);
    app.applySettings();
  };
  const settingsMenu = createListMenu({
    title: '설정',
    footer: '↑↓ 선택 · ←→ 변경 · Esc 뒤로',
    items: (app) => {
      return [
        {
          label: '효과음',
          value: app.settings.sfx ? '켬' : '끔',
          change: (a) => update(a, { sfx: !a.settings.sfx }),
        },
        {
          label: '배경음악',
          value: app.settings.music !== false ? '켬' : '끔',
          change: (a) => update(a, { music: a.settings.music === false }),
        },
        {
          label: '목소리',
          value: app.settings.voice !== false ? '켬' : '끔',
          change: (a) => update(a, { voice: a.settings.voice === false }),
        },
        {
          label: '음량 조절',
          select: (a) => a.setScene(createListMenu({
            title: '음량 조절',
            notice: () => '기본 5 · 무음 0',
            items: (a) => [
              ['전체', 'volume', 5], ['효과음', 'effectsVolume', 5],
              ['배경음악', 'musicVolume', 5], ['목소리', 'voiceVolume', 5],
            ].map(([label, key, fallback]) => ({
              label, value: a.settings[key] ?? fallback,
              change: (app, delta) => update(app, { [key]: Math.min(10, Math.max(0, (app.settings[key] ?? fallback) + delta)) }),
            })),
            onBack: (app) => app.setScene(settingsMenu),
          })),
        },
        {
          label: '착지 위치 표시',
          value: app.settings.ghost ? '켬' : '끔',
          change: (a) => update(a, { ghost: !a.settings.ghost }),
        },
        { label: '터치 영역 편집', select: (a) => a.mobile?.editLayout() },
        { label: '키보드 키 설정', select: (a) => a.keySettings?.open() },
      ];
    },
    onBack: (app) => app.goToMenu(),
  });
  return settingsMenu;
}

function storyRecordItems() {
  const story = loadStory();
  const records = story?.records;
  if (!records) {
    return [{ label: '스토리  기록 없음', disabled: true }];
  }
  const cleared = records.secretCleared ? '추가 경기까지 완료' : records.mainCleared ? '우승' : '진행 중';
  return [
    { label: `스토리  ${cleared}`, disabled: true },
    { label: `낯선 손님  만남 ${records.hiddenMet.length}/4 · 승리 ${records.hiddenWon.length}/4`, disabled: true },
  ];
}

function createRecordsMenu() {
  return createListMenu({
    title: '기록',
    footer: 'Esc 뒤로',
    items: ({ records }) => [
      ...storyRecordItems(),
      { label: `연습 최고 점수  ${records.soloBest}`, disabled: true },
      { label: `연습 최대 연쇄  ${records.soloMaxChain}`, disabled: true },
      ...CPU_LEVELS.map(({ id, label }) => ({
        label: `CPU ${label}  ${records.cpu[id].win}승 ${records.cpu[id].lose}패`,
        disabled: true,
      })),
    ],
    onBack: (app) => app.goToMenu(),
  });
}

function createStoryMenu(app) {
  const flow = createStoryFlow(app);
  return createListMenu({
    title: '스토리',
    footer: `히든전 클리어 ${flow.hiddenWins()} / 4 · 진행은 자동 저장됩니다`,
    items: () => [
      ...(flow.hasRun() ? [{ label: '이어하기', select: () => flow.resume() }] : []),
      { label: '처음부터', select: () => flow.start() },
      { label: flow.canChallenge() ? '마지막 초대 · 다시 도전' : '마지막 초대 · 히든 4승과 대회 우승 필요',
        disabled: !flow.canChallenge(), select: () => flow.challenge() },
    ],
    onBack: (a) => a.goToSinglePlayer(),
  });
}

function createSinglePlayerMenu() {
  return createListMenu({
    title: '싱글플레이',
    items: (app) => [
      { label: MODES.story ? '스토리' : '스토리 · 준비 중', disabled: !MODES.story, select: () => app.setScene(createStoryMenu(app)) },
      { label: 'CPU 대전', select: () => app.setScene(createMatchSetup({ mode: 'cpu' })) },
      { label: 'CPU 관전', select: () => app.setScene(createMatchSetup({ mode: 'watch' })) },
      { label: '연습', select: () => app.setScene(createMatchSetup({ mode: 'solo' })) },
    ],
    onBack: (app) => app.goToMenu(),
  });
}

function createMultiplayerMenu() {
  return createListMenu({
    title: '멀티플레이',
    items: (app) => [
      { label: MODES.multiplayer ? '로컬 대전' : '로컬 대전 · 준비 중', disabled: !MODES.multiplayer, select: () => app.setScene(createMatchSetup({ mode: 'versus' })) },
      { label: (MODES.multiplayer && (MODES.online && app.onlineAvailable)) ? '온라인 대전' : '온라인 대전 · 준비 중', disabled: !(MODES.multiplayer && (MODES.online && app.onlineAvailable)),
        select: () => { void app.openOnline(); } },
    ],
    onBack: (app) => app.goToMenu(),
  });
}

function createMainMenu() {
  return createListMenu({
    title: '메인 메뉴',
    compact: true,
    noticeSummary: app => app.portraitScreen ? '비공식 팬게임 · 제작·권리 안내' : null,
    notice: (app) => [app.skin.branding?.fanNotice, app.versionLabel].filter(Boolean).join('\n'),
    footer: '↑↓ 선택 · Enter 결정 · Esc 타이틀',
    items: (app) => [
      { label: '싱글플레이', select: () => app.goToSinglePlayer() },
      { label: MODES.multiplayer ? '멀티플레이' : '멀티플레이 · 준비 중', disabled: !MODES.multiplayer, select: () => app.goToMultiplayer() },
      { label: '설정', select: () => app.setScene(createSettingsMenu()) },
      { label: '기록', select: () => app.setScene(createRecordsMenu()) },
      { label: '게임 방법', select: () => {
        const menu = app.scene;
        withControlsGuide(app, { force: true, background: menu, next: () => menu });
      } },
    ],
    onBack: (app) => app.setScene(createTitleScene()),
  });
}

export { createListMenu, createMatchSetup, createMainMenu, createSinglePlayerMenu, createMultiplayerMenu, createTitleScene };
