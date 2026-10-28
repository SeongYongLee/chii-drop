import { createRoundTracker } from '../analytics/round.js';
import { playSfx } from '../audio/sfx.js';
import { playBoardSounds } from '../audio/board-sounds.js';
import { playCharacterEvents, playCharacterVoice } from '../audio/character-voice.js';
import { SET_WINS } from '../engine/rules.js';
import { KEYMAPS, MENU_KEYS, readInput, wasPressed } from '../input/keyboard.js';
import { createEffects, setMood, tickCharacters, tickEffect } from '../view/effects.js';
import { drawBanner, drawGame } from '../view/renderer.js';
import { drawRoundIntro } from '../view/round-intro.js';
import { drawStoryForm } from '../view/story-art.js';
import { drawFieldResults, drawResultActions, resultMenuLayout } from '../view/field-results.js';
import { drawPauseMenu } from '../view/pause-menu.js';
import { drawFeverEntry, FEVER_ENTRY_FRAMES, FEVER_GO_FRAMES } from '../view/fever-entry.js';
import { chooseBattleScenery } from '../view/battle-backgrounds.js';

import { GO_FRAMES, createSession, sessionPlayers, stepSession } from './session.js';
import { saveRecords } from './storage.js';

const PAUSE_ITEMS = ['계속하기', '다시 시작', '싱글플레이로'];
function returnMenuLabel(scene) {
  return scene.options.mode === 'versus' ? '멀티플레이' : '싱글플레이';
}
function pauseItems(scene) {
  if (scene.options.mode === 'watch') return ['계속 관전', '다시 시작', '관전 설정으로'];
  return [PAUSE_ITEMS[0], PAUSE_ITEMS[1], `${returnMenuLabel(scene)}로`];
}
function returnToModeMenu(app, scene) {
  reportRoundEnd(scene, 'quit');
  if (scene.options.onQuit) scene.options.onQuit(app);
  else if (scene.options.mode === 'versus') app.goToMultiplayer();
  else app.goToSinglePlayer();
}
// 경기 중 회전 키와 겹치지 않게 결과 화면은 Enter·Esc만 받는다.
const RESULT_KEYS = { confirm: ['Enter', 'Space'], back: ['Escape', 'Backspace'] };
const RESULT_INPUT_DELAY = 40;

// 경기 시드는 표현 계층에서 정해 엔진에 넘긴다.
function makeSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

function humanInputs(app, mode) {
  if (mode === 'watch') return [0, 0];
  if (mode === 'versus') {
    return [readInput(app.keyboard, KEYMAPS.p1), readInput(app.keyboard, KEYMAPS.p2)];
  }
  return [readInput(app.keyboard, KEYMAPS.solo), 0];
}

function playEventSounds(app, events, isHuman, channel) {
  for (const event of events) {
    if ((event.type === 'move' || event.type === 'rotate') && !isHuman) {
      continue;
    }
    if (event.type === 'over' || event.type === 'lock') {
      continue;
    }
    playSfx(app.sfx, event.type, { ...event, channel });
  }
}

function recordResult(app, scene) {
  const { session, options } = scene;
  const { records } = app;
  if (session.mode === 'story' || session.mode === 'watch') {
    return;
  }
  if (session.mode === 'solo') {
    const [player] = session.match.players;
    records.soloBest = Math.max(records.soloBest, player.score);
    records.soloMaxChain = Math.max(records.soloMaxChain, player.maxChain);
  } else if (session.mode === 'cpu' && session.match.winner !== -1) {
    const entry = records.cpu[options.cpuLevel];
    if (session.match.winner === 0) {
      entry.win += 1;
    } else {
      entry.lose += 1;
    }
  }
  saveRecords(records);
}

// 승패가 정해진 순간: 표정·효과음·세트 점수. 결과 화면은 진 쪽 연출이 끝난 뒤 나온다.
function onMatchOver(app, scene) {
  const { session } = scene;
  if (session.mode === 'solo') {
    playSfx(app.sfx, 'over');
    playCharacterVoice(app.sfx, scene.options.characters[0]?.id, 'lose');
    return;
  }
  const { winner } = session.match;
  if (winner >= 0) {
    if (session.mode !== 'story') {
      scene.tally[winner] += 1;
    }
    setMood(scene.effects[winner], 'win', Infinity);
    setMood(scene.effects[1 - winner], 'lose', Infinity);
    scene.options.characters.forEach((character, i) => playCharacterVoice(app.sfx, character.id,
      i === winner ? 'win' : 'lose', { channel: i }));
  }
  const humanWon = ['versus', 'watch'].includes(session.mode) ? winner >= 0 : winner === 0;
  playSfx(app.sfx, humanWon ? 'win' : 'over');
}

function reportRoundEnd(scene, reason = 'completed') {
  const match = scene.session.match;
  scene.telemetry.end(scene.roundKey, { reason, winner: match.winner, player: match.players[0], playMs: match.timer / 60 * 1000 });
}

function startRound(scene) {
  if (scene.session) reportRoundEnd(scene, 'quit');
  scene.roundKey = {}; // 영구 ID나 게임 난수를 사용하지 않는다.

  const { mode, cpuLevel, cpuLevels, boss, story } = scene.options;
  if (scene.tally.some((wins) => wins >= SET_WINS)) {
    scene.tally = [0, 0];
  }
  scene.session = createSession({ mode, seed: makeSeed(), cpuLevel, cpuLevels, cpuSeed: makeSeed(), boss, story });
  // 프레임마다 교체되는 경기 상태와 별도로 이번 판의 음악 선택을 유지한다.
  scene.musicSession = {};
  scene.sceneryReady = false;
  scene.effects = createEffects(mode === 'solo' ? 1 : 2);
  // 첫 화면부터 첫 쌍이 NEXT에 보이도록 준비하되 출현 연출은 진행하지 않는다.
  sessionPlayers(scene.session).forEach((player, i, players) => tickEffect(scene.effects[i], player, {
    table: scene.session.match.table, opponentSide: players.length > 1 ? 1 - i : null,
    opponent: players[1 - i] ?? null,
  }));
  scene.paused = false;
  scene.resultIndex = 0;
  scene.pauseIndex = 0;
  scene.reviveDialogue = null;
  scene.feverEntryTimer = 0;
  scene.feverEntrySide = null;
  scene.revealedForm = false;
  scene.resultFrame = 0;
}

function gameScenery(scene, skin) {
  if (!scene.sceneryReady) {
    scene.scenery = scene.options.scenery;
    if (!scene.scenery && ['cpu', 'versus', 'watch'].includes(scene.options.mode)) {
      scene.scenery = chooseBattleScenery(skin, scene.previousScenery, () => makeSeed() / 0x100000000);
      scene.previousScenery = scene.scenery;
    }
    scene.sceneryReady = true;
  }
  return scene.scenery;
}

function updatePause(app, scene) {
  const { keyboard } = app;
  if (wasPressed(keyboard, MENU_KEYS.up) || wasPressed(keyboard, MENU_KEYS.down)) {
    const delta = wasPressed(keyboard, MENU_KEYS.up) ? -1 : 1;
    scene.pauseIndex = (scene.pauseIndex + delta + PAUSE_ITEMS.length) % PAUSE_ITEMS.length;
    playSfx(app.sfx, 'cursor');
  } else if (wasPressed(keyboard, MENU_KEYS.pause)) {
    scene.paused = false;
  } else if (wasPressed(keyboard, MENU_KEYS.confirm)) {
    selectPauseItem(app,scene,scene.pauseIndex);
  }
}

function selectPauseItem(app, scene, index) {
  scene.pauseIndex = index;
  playSfx(app.sfx, 'confirm');
  if (index === 0) scene.paused = false;
  else if (index === 1) startRound(scene);
  else returnToModeMenu(app, scene);
}

function updateGame(app, scene) {
  const { keyboard } = app;
  if (scene.reviveDialogue) {
    scene.reviveDialogue.update(app);
    return;
  }
  if (scene.paused) {
    updatePause(app, scene);
    return;
  }
  tickCharacters(scene.effects);
  const { session } = scene;
  if (session.phase === 'result') scene.resultFrame += 1;
  if (session.phase === 'result' && session.mode === 'story') {
    updateStoryResult(app, scene);
    return;
  }
  if (session.phase === 'result') {
    if (scene.resultDelay > 0) {
      scene.resultDelay -= 1;
    } else if (wasPressed(keyboard, RESULT_KEYS.confirm)) {
      chooseResult(app, scene, scene.resultIndex);
    } else if (wasPressed(keyboard, RESULT_KEYS.back)) {
      chooseResult(app, scene, 1);
    } else if ([MENU_KEYS.up, MENU_KEYS.down, MENU_KEYS.left, MENU_KEYS.right].some(keys => wasPressed(keyboard, keys))) {
      const count = resultActions(scene).length;
      const columns = app.mobile?.visible && count === 4 ? 2 : 1;
      const horizontal = wasPressed(keyboard, MENU_KEYS.left) || wasPressed(keyboard, MENU_KEYS.right);
      const delta = horizontal ? (wasPressed(keyboard, MENU_KEYS.left) ? -1 : 1)
        : (wasPressed(keyboard, MENU_KEYS.up) ? -columns : columns);
      if (horizontal && columns === 2) {
        scene.resultIndex = Math.floor(scene.resultIndex / 2) * 2 + (scene.resultIndex % 2 + delta + 2) % 2;
      } else scene.resultIndex = (scene.resultIndex + delta + count) % count;
      playSfx(app.sfx, 'cursor');
    }
    return;
  }
  if (wasPressed(keyboard, MENU_KEYS.pause)) {
    scene.paused = true;
    scene.pauseIndex = 0;
    return;
  }
  if (scene.feverEntryTimer > 0) {
    updateFeverReady(app, scene);
    return;
  }

  const next = stepSession(session, humanInputs(app, session.mode));
  if (next.phase === 'ready' && next.readyTimer > GO_FRAMES && next.readyTimer % 30 === 0) {
    playSfx(app.sfx, 'count');
  } else if (next.phase === 'ready' && next.readyTimer === GO_FRAMES) {
    playSfx(app.sfx, 'go');
  }
  scene.session = next;
  if (session.phase === 'ready' && next.phase === 'playing') {
    scene.telemetry.begin(scene.roundKey, { mode: scene.options.mode, role: scene.options.mode === 'watch' ? 'spectator' : 'player',
      cpu_level: scene.options.cpuLevel, char_id: scene.options.characters[0]?.id, opponent_char_id: scene.options.characters[1]?.id,
      input_method: app.mobile?.touchInput ? 'touch' : 'keyboard' });
  }

  const players = sessionPlayers(next);
  const feverSide = players.findIndex(player => player.events.some(event => event.type === 'feverStart'));
  if (feverSide >= 0) {
    scene.feverEntryTimer = FEVER_ENTRY_FRAMES;
    scene.feverEntrySide = feverSide;
    playSfx(app.sfx, 'count');
  }
  players.forEach((player, i) => {
    tickEffect(scene.effects[i], player, {
      table: next.match.table,
      opponentSide: players.length > 1 ? 1 - i : null,
      opponent: players.length > 1 ? players[1 - i] : null,
    });
    const isHuman = session.mode !== 'watch' && (!session.cpu || i === 0);
    playBoardSounds(app.sfx, sessionPlayers(session)[i], player, i, scene.effects[i].warningChange, scene.effects[i].arrivalSounds);
    playEventSounds(app, player.events, isHuman, i);
    playCharacterEvents(app.sfx, scene.options.characters[i]?.id, player.events, i);
  });

  if (players.some((player) => player.events.some((event) => event.type === 'revive'))) {
    scene.revealedForm = true;
    if (scene.options.onRevive) {
      scene.reviveDialogue = scene.options.onRevive(() => { scene.reviveDialogue = null; });
    }
  }

  if (session.match.phase !== 'over' && next.match.phase === 'over') {
    reportRoundEnd(scene);
    onMatchOver(app, scene);
  }
  if (next.phase === 'result') {
    scene.resultFrame = 0;
    scene.resultDelay = RESULT_INPUT_DELAY;
    recordResult(app, scene);
    scene.telemetry.viewed(scene.roundKey);
  }
}

// 스토리 경기는 한 판 승부다. 이기면 이야기를 잇고, 지면 다시 도전하거나 메뉴로 나간다.
function storyResult(scene) {
  const [player] = scene.session.match.players;
  const { match } = scene.session;
  return { won: match.winner === 0, score: player.score, maxChain: player.maxChain, seconds: match.timer / 60 };
}

function updateStoryResult(app, scene) {
  const { keyboard } = app;
  if (scene.resultDelay > 0) {
    scene.resultDelay -= 1;
    return;
  }
  const result = storyResult(scene);
  if (wasPressed(keyboard, RESULT_KEYS.confirm)) {
    playSfx(app.sfx, 'confirm');
    scene.options.onFinish(app, result);
  } else if (wasPressed(keyboard, RESULT_KEYS.back) && !result.won) {
    playSfx(app.sfx, 'cancel');
    scene.options.onQuit(app, result);
  }
}

function resultActions(scene) {
  if (scene.session.mode === 'watch') return ['다시 관전', '관전 설정'];
  if (scene.session.mode === 'story') return storyResult(scene).won ? ['계속하기'] : ['다시 도전', `${returnMenuLabel(scene)}로`];
  return ['다시하기', '메인메뉴', ...(scene.session.mode === 'cpu' ? ['대전 설정'] : [])];
}

function chooseResult(app, scene, index) {
  if (scene.resultDelay > 0) return;
  scene.telemetry.action(scene.roundKey, index === 0 ? 'retry' : index === 2 || scene.options.mode === 'watch' ? 'settings' : 'menu');
  playSfx(app.sfx, index ? 'cancel' : 'confirm');
  if (scene.session.mode === 'story') {
    const result = storyResult(scene);
    if (!index) scene.options.onFinish(app, result);
    else if (!result.won) scene.options.onQuit(app, result);
  } else if (!index) startRound(scene);
  else if (index === 1 && scene.session.mode === 'watch') returnToModeMenu(app, scene);
  else if (index === 1) app.goToMenu();
  else if (index === 2 && scene.session.mode === 'cpu') app.goToMatchSetup({
    mode: 'cpu', characters: scene.options.characters, cpuLevel: scene.options.cpuLevel, onBack: () => app.setScene(scene.screen),
  });
}

function drawGameScene(ctx, app, scene) {
  if (scene.reviveDialogue) {
    scene.reviveDialogue.draw(ctx, app);
    return;
  }
  const { session } = scene;
  drawGame(ctx, {
    skin: scene.revealedForm && scene.options.revivedForm ? {
      ...app.skin,
      drawCharacter(ctx, id, mood, x, y, size, motion) {
        if (id === scene.options.characters[1]?.id) drawStoryForm(ctx, scene.options.revivedForm, x, y, size, false, app.skin, { ...motion, mood });
        else app.skin.drawCharacter(ctx, id, mood, x, y, size, motion);
      },
    } : app.skin,
    scenery: gameScenery(scene, app.skin),
    match: session.match,
    effects: scene.effects,
    characters: scene.options.characters,
    showGhost: app.settings.ghost,
    result: session.phase === 'result',
  });

  if (scene.paused) {
    if(!app.mobile?.visible && !app.mobile?.pauseDialogOpen)drawPauseMenu(ctx, pauseItems(scene), scene.pauseIndex);
  } else if (session.phase === 'ready') {
    drawRoundIntro(ctx, session.readyTimer, { playerCount: session.match.players.length });
  } else if (session.phase === 'result') {
    drawFieldResults(ctx, { skin: app.skin, match: session.match, characters: scene.options.characters,
      tally: session.mode === 'solo' || session.mode === 'story' ? null : scene.tally,
      mode: session.mode, age: scene.resultFrame,
      quiet: scene.options.scenery === 'inside' || Boolean(scene.options.boss),
    });
    if (!app.mobile?.visible) drawResultActions(ctx, resultActions(scene), scene.resultIndex, scene.resultDelay === 0);
  }
  if (!scene.paused && session.match.phase !== 'over') drawFeverEntry(ctx, scene.feverEntryTimer,
    { side: scene.feverEntrySide ?? 1, playerCount: session.match.players.length });
}

// 준비 예고 중에는 stepSession을 호출하지 않아 양쪽 필드·CPU·피버 시간을 보존한다.
function updateFeverReady(app, scene) {
  scene.feverEntryTimer = Math.max(0, scene.feverEntryTimer - 1);
  if (scene.feverEntryTimer === FEVER_GO_FRAMES) playSfx(app.sfx, 'go');
  else if (scene.feverEntryTimer > FEVER_GO_FRAMES && (scene.feverEntryTimer - FEVER_GO_FRAMES) % 40 === 0) playSfx(app.sfx, 'count');
}

// options: { mode, cpuLevel, characters: [{ id, name }], boss, story: { startLevel, colors }, reviveLine, onFinish, onQuit }
// onFinish·onQuit은 스토리 경기에서만 쓴다.
function createGameScene(options) {
  const scene = {
    options,
    telemetry: createRoundTracker(),
    roundKey: null,
    session: null,
    effects: [],
    paused: false,
    pauseIndex: 0,
    resultDelay: 0,
    tally: [0, 0],
  };
  startRound(scene);
  const screen = {
    get touchColumns() { return scene.session.phase === 'result' && options.mode === 'cpu' ? 2 : 1; },
    touchGame: () => !scene.reviveDialogue,
    backgroundScene: (skin) => {
      const scenery = gameScenery(scene, skin);
      return scenery ? `game:${scenery}` : 'game';
    },
    touchCanPause: () => !scene.reviveDialogue && scene.session.phase !== 'result',
    openPause() { scene.paused = true; scene.pauseIndex = 0; },
    touchPaused: () => scene.paused,
    touchHideBack: () => (scene.session.phase === 'result' || options.mode === 'watch') && !scene.paused,
    touchDirect: () => options.mode === 'watch' || scene.paused || scene.session.phase === 'result',
    touchItems: (app) => scene.paused ? pauseItems(scene).map((label, index) => ({
      label, selected:scene.pauseIndex === index, activate:() => selectPauseItem(app,scene,index),
    })) : scene.session.phase === 'result' ? resultActions(scene).map((label, index) => ({
      label, selected: index === scene.resultIndex, disabled: scene.resultDelay > 0, activate: () => chooseResult(app, scene, index),
    })) : options.mode === 'watch' ? [{ label: '일시정지', activate: () => screen.openPause() }] : [],
    touchMode: () => options.mode === 'watch' || scene.reviveDialogue || scene.paused || scene.session.phase === 'result' ? 'menu' : 'game',
    touchLocal: () => options.mode === 'versus' && !scene.reviveDialogue && !scene.paused && scene.session.phase !== 'result',
    touchLabel: () => scene.paused ? `일시정지 · ${pauseItems(scene)[scene.pauseIndex]}`
      : scene.session.phase === 'result' ? '경기 종료 · 다음 행동을 선택하세요'
      : options.mode === 'watch' ? 'CPU 관전 · 자동으로 대전 중' : '이동 · 빠르게 내리기 · 회전',
    tap(app, { x, y }, viewport) {
      if (scene.session.phase === 'result' && !scene.paused) {
        if (viewport?.portrait) return true;
        const boxes = resultMenuLayout(viewport?.height ?? 540, resultActions(scene).length);
        const index = boxes.findIndex(box => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height);
        if (index >= 0 && index < resultActions(scene).length) chooseResult(app, scene, index);
        return true;
      }
      if (!scene.paused) return false;
      if(viewport){const scale=viewport.portrait?1.85:1;x=480+(x-480)/scale;y=270+(y-viewport.height/2)/scale;}
      const index = Math.floor((y - 199) / 56);
      if (x >= 306 && x <= 654 && index >= 0 && index < PAUSE_ITEMS.length && (y - 199) % 56 <= 44) {
        selectPauseItem(app,scene,index);
      }
      return true;
    },
    get musicSession() { return scene.musicSession; },
    musicScene: () => scene.session.phase === 'result' ? 'result'
      : options.boss ? 'intense' : 'battle',
    update: (app) => updateGame(app, scene),
    draw: (ctx, app) => drawGameScene(ctx, app, scene),
  };
  scene.screen = screen;
  return screen;
}

export { createGameScene, updateFeverReady };
