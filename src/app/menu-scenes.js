import { playSfx, unlockSfx } from '../audio/sfx.js';
import { playCharacterVoice } from '../audio/character-voice.js';
import { CPU_LEVELS } from '../cpu/cpu.js';
import { MENU_KEYS, PLAYER_MENU_KEYS, wasPressed } from '../input/keyboard.js';
import { PALETTE, flower, paper } from '../view/festival.js';
import { FONT, INK } from '../view/renderer.js';
import { drawConfirmationStamp, reducedUiMotion } from '../view/ui-motion.js';

import { withControlsGuide } from './controls-guide.js';
import { MODES } from './modes.js';
import { createGameScene } from './game-scene.js';
import { createStoryFlow } from './story-mode.js';
import { SCREEN_HEIGHT, SCREEN_WIDTH, isPortraitScreen } from './screen.js';
import { drawPortraitHero } from '../view/portrait-ui.js';
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
function createListMenu({ title, items, onBack, notice, columns = 1, compact = false, initialIndex = 0, footer = '↑↓ 선택 · Enter 결정 · Esc 뒤로' }) {
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
    touchItems: (app) => items(app).map((item, i) => ({ label: item.label,
      value: item.value, disabled: Boolean(item.disabled), selected: index === i,
      adjustable: Boolean(item.change && typeof item.value === 'number'),
      activate: (delta = 1) => activate(app, i, delta) })),
    touchLabel(app) {
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
        index = moveCursor(list, index, wasPressed(keyboard, MENU_KEYS.up) ? -1 : 1);
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
        drawPortraitHero(ctx,app,title,{subtitle:list[index]?.label??''});return;
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
    touchLabel: () => '화면을 누르거나 결정 버튼으로 시작하세요',
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
          characters:app.skin.characters.slice(0,3),subtitle:app.skin.branding?.tagline??'화면을 눌러 시작',frame,
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

function characterKeys(mode, player) {
  if (mode === 'versus') {
    return PLAYER_MENU_KEYS[player];
  }
  return MENU_KEYS;
}

function pickCpuCharacter(characters, taken) {
  const others = characters.filter((c) => c.id !== taken.id);
  const pool = others.length > 0 ? others : characters;
  return pool[crypto.getRandomValues(new Uint32Array(1))[0] % pool.length];
}

function selectionCharacters(skin) {
  return (skin.characterRoster ?? skin.characters).filter((character) => character.selectionVisible !== false);
}

// 결정 도장(12프레임)과 효과음이 끝난 뒤 잠깐 머무른다. 경기 시뮬레이션과는 별개다.
const CHARACTER_CONFIRM_FRAMES = 36;

function createCharacterSelect({ mode, cpuLevel, cpuPlayer, cpuCharacters, onBack }) {
  const randomChoice = { id: 'random-opponent', name: '랜덤', random: true };
  const choices = skin => cpuPlayer ? [...cpuCharacters, randomChoice] : selectionCharacters(skin);
  const title = cpuPlayer ? 'CPU 상대 선택' : '캐릭터 선택';
  const humans = mode === 'versus' ? 2 : 1;
  const cursors = [cpuPlayer ? cpuCharacters.length : 0, 1];
  const confirmed = [false, false];
  const pickedAt = [0, 0];
  let frame = 0, completeAt = null;
  return {
    touchColumns: 2,
    touchItems(app) {
      const characters = choices(app.skin);
      const player = mode === 'versus' && confirmed[0] ? 1 : 0;
      return characters.map((character, i) => ({
        label: character.selectable === false ? '준비 중' : character.name,
        disabled: completeAt !== null || character.selectable === false, selected: cursors[player] % characters.length === i,
        activate: () => { if (completeAt !== null) return; cursors[player] = i; playSfx(app.sfx, 'cursor'); },
      }));
    },
    touchPlayer: () => mode === 'versus' ? (confirmed[0] ? 1 : 0) : null,
    touchBackPlayer: () => mode === 'versus' ? 0 : null,
    touchLabel(app) {
      if (completeAt !== null) return '결정 완료 · 잠시 후 시작합니다';
      const player = mode === 'versus' && confirmed[0] ? 1 : 0;
      const characters = choices(app.skin);
      const character = characters[cursors[player] % characters.length];
      return `${mode === 'versus' ? `${player + 1}P ` : ''}${title} · ${character.selectable === false ? '준비 중' : character.name}`;
    },
    tap(app, { x, y }, viewport) {
      if (viewport?.portrait) return true;
      if (completeAt !== null) return true;
      const characters = choices(app.skin);
      const columns = Math.min(4, characters.length);
      const column = Math.floor((x - 62) / 145), row = Math.floor((y - 127) / 157);
      const index = row * columns + column;
      if (column < 0 || column >= columns || row < 0 || index >= characters.length
        || (x - 62) % 145 > 132 || (y - 127) % 157 > 144 || characters[index].selectable === false) return true;
      const player = mode === 'versus' && confirmed[0] ? 1 : 0;
      cursors[player] = index;
      playSfx(app.sfx, 'cursor');
      return true;
    },
    update(app) {
      frame += 1;
      const { keyboard, sfx } = app;
      const characters = choices(app.skin);
      if (completeAt !== null && frame - completeAt < CHARACTER_CONFIRM_FRAMES) return;
      if (completeAt === null) {
        for (let p = 0; p < humans; p++) {
          const keys = characterKeys(mode, p);
          if (!confirmed[p] && [keys.left, keys.right, keys.up, keys.down].some((codes) => codes && wasPressed(keyboard, codes))) {
            const columns = Math.min(app.portraitScreen ? this.touchColumns : 4, characters.length);
            const horizontal = wasPressed(keyboard, keys.left) || wasPressed(keyboard, keys.right);
            if (app.portraitScreen) {
              const row = Math.floor(cursors[p] / columns), column = cursors[p] % columns;
              if (horizontal) {
                const length = Math.min(columns, characters.length - row * columns);
                const delta = wasPressed(keyboard, keys.left) ? -1 : 1;
                cursors[p] = row * columns + (column + delta + length) % length;
              } else {
                const rows = Math.ceil(characters.length / columns);
                const delta = wasPressed(keyboard, keys.up) ? -1 : 1;
                const nextRow = (row + delta + rows) % rows;
                cursors[p] = Math.min(characters.length - 1, nextRow * columns + column);
              }
            } else {
              const delta = horizontal ? (wasPressed(keyboard, keys.left) ? -1 : 1)
                : (wasPressed(keyboard, keys.up) ? -columns : columns);
              cursors[p] = (cursors[p] + delta + characters.length) % characters.length;
            }
            playSfx(sfx, 'cursor');
          } else if (!confirmed[p] && wasPressed(keyboard, keys.confirm)) {
            if (characters[cursors[p] % characters.length].selectable === false) continue;
            confirmed[p] = true;
            pickedAt[p] = frame;
            playSfx(sfx, 'confirm');
            if (!characters[cursors[p] % characters.length].random) {
              playCharacterVoice(sfx, characters[cursors[p] % characters.length].id, 'select', { channel: cpuPlayer ? 1 : p });
            }
          } else if (wasPressed(keyboard, keys.back)) {
            playSfx(sfx, 'cancel');
            if (confirmed[p]) {
              confirmed[p] = false;
            } else if (!confirmed.some(Boolean)) {
              if (onBack) onBack(app);
              else if (mode === 'cpu') app.setScene(createCpuLevelMenu());
              else if (mode === 'versus') app.goToMultiplayer();
              else app.goToSinglePlayer();
              return;
            }
          }
        }
        if (confirmed.slice(0, humans).every(Boolean)) completeAt = frame;
        return;
      }
      const picks = cursors.slice(0, humans).map((i) => characters[i % characters.length]);
      if (cpuPlayer) {
        const opponent = picks[0].random ? pickCpuCharacter(cpuCharacters, cpuPlayer) : picks[0];
        if (picks[0].random) playCharacterVoice(sfx, opponent.id, 'select', { channel: 1 });
        withControlsGuide(app, { mode, background: this,
          next: () => createGameScene({ mode, cpuLevel, characters: [cpuPlayer, opponent] }) });
        return;
      }
      if (mode === 'cpu') {
        app.setScene(createCharacterSelect({ mode, cpuLevel, cpuPlayer: picks[0],
          cpuCharacters: characters.filter(character => character.selectable !== false),
          onBack: app => { confirmed[0] = false; completeAt = null; app.setScene(this); },
        }));
        return;
      }
      withControlsGuide(app, { mode, background: this,
        next: () => createGameScene({ mode, cpuLevel, characters: picks }) });
    },
    draw(ctx, app) {
      if(isPortraitScreen(ctx)){
        const player=mode==='versus'&&confirmed[0]?1:0;
        const entries=choices(app.skin),character=entries[cursors[player]%entries.length];
        drawPortraitHero(ctx,app,cpuPlayer ? title : humans>1?`${player+1}P 캐릭터 선택`:title,{
          character, random: character.random, subtitle:completeAt!==null?'결정 완료!':character.selectable===false?'준비 중':character.name,frame,
        });return;
      }
      app.skin.drawBackground(ctx, SCREEN_WIDTH, SCREEN_HEIGHT, 'menu');
      paper(ctx, 38, 60, 884, 405, { radius: 22 });
      ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `bold 28px ${FONT}`; ctx.fillText(title, 480, 91);
      const characters = choices(app.skin);
      const columns = Math.min(4, characters.length);
      characters.forEach((character, i) => {
        const x = 62 + (i % columns) * 145;
        const y = 127 + Math.floor(i / columns) * 157;
        paper(ctx, x, y, 132, 144, { fill: '#faf5e9', radius: 12, shadow: false });
        const picked = confirmed.some((c, p) => c && cursors[p] % characters.length === i);
        const pickedBy = confirmed.findIndex((c, p) => c && cursors[p] % characters.length === i);
        if (character.random) {
          ctx.fillStyle = INK; ctx.font = `bold 72px ${FONT}`; ctx.fillText('?', x + 66, y + 66);
        } else app.skin.drawCharacter(ctx, character.id, picked ? 'happy' : 'idle', x + 17, y + 10, 98,
          { frame: picked ? frame - pickedAt[pickedBy] : frame, instance: `card-${i}`, presentation: 'selection', silhouette: character.selectable === false });
        ctx.fillStyle = INK; ctx.font = `bold 15px ${FONT}`; ctx.textAlign = 'center';
        ctx.fillText(character.selectable === false ? '준비 중' : character.name, x + 66, y + 125);
        if (picked) drawConfirmationStamp(ctx, { x: x + 66, y: y + 92, player: pickedBy }, frame - pickedAt[pickedBy]);
        for (let p = 0; p < humans; p++) {
          if (cursors[p] % characters.length !== i) continue;
          ctx.strokeStyle = p === 0 ? '#c76e83' : '#4b8ea7';
          ctx.lineWidth = confirmed[p] ? 4 : 2;
          ctx.beginPath(); ctx.roundRect(x - 2 - p * 3, y - 2 - p * 3, 136 + p * 6, 148 + p * 6, 14); ctx.stroke();
          paper(ctx, x + 4 + p * 66, y - 9, 55, 20, { fill: p === 0 ? PALETTE.pink : PALETTE.blue, radius: 7, shadow: false });
          ctx.font = `bold 12px ${FONT}`; ctx.fillStyle = INK;
          ctx.fillText(`${cpuPlayer ? 'CPU' : `${p + 1}P`}${confirmed[p] ? ' ✓' : ''}`, x + 31 + p * 66, y + 1);
        }
      });
      for (let p = 0; p < humans; p++) {
        const character = characters[cursors[p] % characters.length];
        const size = humans === 1 ? 180 : 120;
        const y = humans === 1 ? 170 : 130 + p * 157;
        if (character.random) {
          ctx.fillStyle = INK; ctx.font = `bold 128px ${FONT}`; ctx.fillText('?', 769, y + size / 2);
        } else app.skin.drawCharacter(ctx, character.id, confirmed[p] ? 'happy' : 'idle', 679, y, size,
          { frame: confirmed[p] ? frame - pickedAt[p] : frame, instance: `selection-${p}`, presentation: 'selection', silhouette: character.selectable === false });
        ctx.fillStyle = INK; ctx.font = `bold 17px ${FONT}`; ctx.textAlign = 'center';
        ctx.fillText(`${humans > 1 ? `${p + 1}P · ` : ''}${character.selectable === false ? '준비 중' : character.name}`, 769, y + size + 17);
      }
      if (cpuPlayer) {
        ctx.font = `14px ${FONT}`; ctx.fillStyle = INK; ctx.textAlign = 'center';
        ctx.fillText(`1P · ${cpuPlayer.name}`, 769, 407);
        if (characters[cursors[0]].random) ctx.fillText('랜덤은 내 캐릭터를 제외합니다', 769, 432);
      }
      const hint = mode === 'versus'
        ? '1P: WASD 선택 · G 결정 · F 취소   2P: 방향키 선택 · . 결정 · , 취소'
        : '방향키 선택 · Enter 결정 · Esc 뒤로';
      drawFooter(ctx, completeAt !== null ? '결정 완료 · 잠시 후 시작합니다' : hint);
    },
  };
}

function createCpuLevelMenu({ characters, cpuLevel, onBack } = {}) {
  return createListMenu({
    title: 'CPU 대전 · 난이도 선택',
    columns: 2,
    initialIndex: Math.max(0, CPU_LEVELS.findIndex(level => level.id === cpuLevel)),
    items: (app) =>
      CPU_LEVELS.map((level) => ({
        label: level.label,
        select: () => app.setScene(characters
          ? createGameScene({ mode: 'cpu', cpuLevel: level.id, characters })
          : createCharacterSelect({ mode: 'cpu', cpuLevel: level.id })),
      })),
    onBack: (app) => onBack ? onBack(app) : app.goToSinglePlayer(),
  });
}

function createSettingsMenu() {
  const update = (app, patch) => {
    Object.assign(app.settings, patch);
    saveSettings(app.settings);
    app.applySettings();
  };
  return createListMenu({
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
          label: '음량',
          value: app.settings.volume,
          change: (a, delta) => update(a, { volume: Math.min(10, Math.max(0, a.settings.volume + delta)) }),
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
      { label: 'CPU 대전', select: () => app.setScene(createCpuLevelMenu()) },
      { label: '연습', select: () => app.setScene(createCharacterSelect({ mode: 'solo' })) },
    ],
    onBack: (app) => app.goToMenu(),
  });
}

function createMultiplayerMenu() {
  return createListMenu({
    title: '멀티플레이',
    items: (app) => [
      { label: MODES.multiplayer ? '로컬 대전' : '로컬 대전 · 준비 중', disabled: !MODES.multiplayer, select: () => app.setScene(createCharacterSelect({ mode: 'versus' })) },
      { label: (MODES.multiplayer && (MODES.online || app.onlineAvailable)) ? '온라인 대전' : '온라인 대전 · 준비 중', disabled: !(MODES.multiplayer && (MODES.online || app.onlineAvailable)),
        select: () => { void app.openOnline(); } },
    ],
    onBack: (app) => app.goToMenu(),
  });
}

function createMainMenu() {
  return createListMenu({
    title: '메인 메뉴',
    compact: true,
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

export { createListMenu, createCpuLevelMenu, createCharacterSelect, createMainMenu, createSinglePlayerMenu, createMultiplayerMenu, createTitleScene };
