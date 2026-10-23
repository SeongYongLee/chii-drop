import { playSfx } from '../audio/sfx.js';
import { playBoardSounds } from '../audio/board-sounds.js';
import { playCharacterEvents, playCharacterVoice } from '../audio/character-voice.js';
import { SET_WINS } from '../engine/rules.js';
import { CPU_LEVELS } from '../cpu/cpu.js';
import { KEYMAPS, MENU_KEYS, readInput, wasPressed } from '../input/keyboard.js';
import { createEffects, setMood, tickCharacters, tickEffect } from '../view/effects.js';
import { drawBanner, drawGame } from '../view/renderer.js';
import { drawStoryForm } from '../view/story-art.js';
import { drawResultPanel } from '../view/scene-motion.js';
import { drawPauseMenu } from '../view/pause-menu.js';

import { GO_FRAMES, createSession, sessionPlayers, stepSession } from './session.js';
import { saveRecords } from './storage.js';

const PAUSE_ITEMS = ['계속하기', '다시 시작', '싱글플레이로'];
function returnMenuLabel(scene) {
  return scene.options.mode === 'versus' ? '멀티플레이' : '싱글플레이';
}
function pauseItems(scene) {
  return [PAUSE_ITEMS[0], PAUSE_ITEMS[1], `${returnMenuLabel(scene)}로`];
}
function returnToModeMenu(app, scene) {
  if (scene.options.onQuit) scene.options.onQuit(app);
  else if (scene.options.mode === 'versus') app.goToMultiplayer();
  else app.goToSinglePlayer();
}
// 경기 중 회전 키와 겹치지 않게 결과 화면은 Enter·Esc만 받는다.
const RESULT_KEYS = { confirm: ['Enter', 'Space'], back: ['Escape', 'Backspace'] };
const RESULT_INPUT_DELAY = 40;
const REVIVE_BANNER_FRAMES = 80;
const LEVEL_LABELS = Object.fromEntries(CPU_LEVELS.map(({ id, label }) => [id, label]));

// 경기 시드는 표현 계층에서 정해 엔진에 넘긴다.
function makeSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

function humanInputs(app, mode) {
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
  if (session.mode === 'story') {
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
  const humanWon = session.mode === 'versus' ? winner >= 0 : winner === 0;
  playSfx(app.sfx, humanWon ? 'win' : 'over');
}

function startRound(scene) {
  const { mode, cpuLevel, boss, story } = scene.options;
  if (scene.tally.some((wins) => wins >= SET_WINS)) {
    scene.tally = [0, 0];
  }
  scene.session = createSession({ mode, seed: makeSeed(), cpuLevel, cpuSeed: makeSeed(), boss, story });
  // 프레임마다 교체되는 경기 상태와 별도로 이번 판의 음악 선택을 유지한다.
  scene.musicSession = {};
  scene.effects = createEffects(mode === 'solo' ? 1 : 2);
  scene.paused = false;
  scene.pauseIndex = 0;
  scene.reviveDialogue = null;
  scene.reviveTimer = 0;
  scene.revealedForm = false;
  scene.resultFrame = 0;
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
      playSfx(app.sfx, 'confirm');
      startRound(scene);
    } else if (wasPressed(keyboard, RESULT_KEYS.back)) {
      playSfx(app.sfx, 'cancel');
      returnToModeMenu(app, scene);
    }
    return;
  }
  if (wasPressed(keyboard, MENU_KEYS.pause)) {
    scene.paused = true;
    scene.pauseIndex = 0;
    return;
  }

  const next = stepSession(session, humanInputs(app, session.mode));
  if (next.phase === 'ready' && next.readyTimer > GO_FRAMES && next.readyTimer % 30 === 0) {
    playSfx(app.sfx, 'count');
  } else if (next.phase === 'ready' && next.readyTimer === GO_FRAMES) {
    playSfx(app.sfx, 'go');
  }
  scene.session = next;

  const players = sessionPlayers(next);
  players.forEach((player, i) => {
    tickEffect(scene.effects[i], player, {
      table: next.match.table,
      opponentSide: players.length > 1 ? 1 - i : null,
      opponent: players.length > 1 ? players[1 - i] : null,
    });
    const isHuman = !session.cpu || i === 0;
    playBoardSounds(app.sfx, sessionPlayers(session)[i], player, i);
    playEventSounds(app, player.events, isHuman, i);
    playCharacterEvents(app.sfx, scene.options.characters[i]?.id, player.events, i);
  });

  if (players.some((player) => player.events.some((event) => event.type === 'revive'))) {
    scene.revealedForm = true;
    if (scene.options.onRevive) {
      scene.reviveDialogue = scene.options.onRevive(() => { scene.reviveDialogue = null; });
    } else {
      scene.reviveTimer = REVIVE_BANNER_FRAMES;
    }
  }
  scene.reviveTimer = Math.max(0, (scene.reviveTimer ?? 0) - 1);

  if (session.match.phase !== 'over' && next.match.phase === 'over') {
    onMatchOver(app, scene);
  }
  if (next.phase === 'result') {
    scene.resultFrame = 0;
    scene.resultDelay = RESULT_INPUT_DELAY;
    recordResult(app, scene);
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

function resultText(scene) {
  const { session, options, tally } = scene;
  if (session.mode === 'story') {
    const { won, score } = storyResult(scene);
    return won
      ? ['승리!', `점수 ${score}\nEnter 계속`]
      : ['패배…', 'Enter 다시 도전 · Esc 싱글플레이로 (진행 저장됨)'];
  }
  if (session.mode === 'solo') {
    const { score, maxChain } = session.match.players[0];
    return ['게임 오버', `점수 ${score} · 최대 ${maxChain}연쇄\nEnter 다시 하기 · Esc ${returnMenuLabel(scene)}`];
  }
  const { winner } = session.match;
  const names = options.characters.map((c) => c.name);
  const setWon = winner >= 0 && tally[winner] >= SET_WINS;
  const title = winner === -1 ? '무승부' : setWon ? `${names[winner]} 세트 승리!` : `${names[winner]} 승리!`;
  const level = session.mode === 'cpu' ? ` (CPU ${LEVEL_LABELS[options.cpuLevel]})` : '';
  return [title, `${tally[0]} : ${tally[1]}${level}\nEnter 다시 하기 · Esc ${returnMenuLabel(scene)}`];
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
    scenery: scene.options.scenery,
    match: session.match,
    effects: scene.effects,
    characters: scene.options.characters,
    showGhost: app.settings.ghost,
  });

  if (scene.paused) {
    if(!app.mobile?.visible)drawPauseMenu(ctx, pauseItems(scene), scene.pauseIndex);
  } else if (session.phase === 'ready') {
    drawBanner(ctx, session.readyTimer > GO_FRAMES ? '준비' : '시작!');
  } else if (scene.reviveTimer > 0) {
    drawBanner(ctx, scene.options.reviveLine ?? '부활!', '피버 모드');
  } else if (session.phase === 'result') {
    const [title, sub] = resultText(scene);
    const winner = session.match.winner;
    const won = session.mode !== 'solo' && (session.mode === 'versus' ? winner >= 0 : winner === 0);
    drawResultPanel(ctx, title, sub, { age: scene.resultFrame, won,
      quiet: scene.options.scenery === 'inside' || Boolean(scene.options.boss),
    });
  }
}

// options: { mode, cpuLevel, characters: [{ id, name }], boss, story: { startLevel, colors }, reviveLine, onFinish, onQuit }
// onFinish·onQuit은 스토리 경기에서만 쓴다.
function createGameScene(options) {
  const scene = {
    options,
    session: null,
    effects: [],
    paused: false,
    pauseIndex: 0,
    resultDelay: 0,
    tally: [0, 0],
  };
  startRound(scene);
  return {
    touchGame: () => !scene.reviveDialogue,
    touchPaused: () => scene.paused,
    touchDirect: () => scene.paused,
    touchItems: (app) => scene.paused ? pauseItems(scene).map((label, index) => ({
      label, selected:scene.pauseIndex === index, activate:() => selectPauseItem(app,scene,index),
    })) : [],
    touchMode: () => scene.reviveDialogue || scene.paused || scene.session.phase === 'result' ? 'menu' : 'game',
    touchLocal: () => options.mode === 'versus' && !scene.reviveDialogue && !scene.paused && scene.session.phase !== 'result',
    touchLabel: () => scene.paused ? `일시정지 · ${pauseItems(scene)[scene.pauseIndex]}`
      : scene.session.phase === 'result' ? `결정: 다시 하기 · 뒤로: ${returnMenuLabel(scene)}`
      : '이동 · 빠르게 내리기 · 회전',
    tap(app, { x, y }, viewport) {
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
      : options.boss || (options.mode === 'cpu' && ['expert', 'master'].includes(options.cpuLevel)) ? 'intense' : 'battle',
    update: (app) => updateGame(app, scene),
    draw: (ctx, app) => drawGameScene(ctx, app, scene),
  };
}

export { createGameScene };
