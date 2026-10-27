import { setupAssetCache, retainMedia } from './asset-cache.js';
import { createSfx, prepareSfx, setSfxOptions, unlockSfx } from '../audio/sfx.js';
import { configureCharacterVoices } from '../audio/character-voice.js';
import { configureMusic, syncMusicVisibility } from '../audio/music.js';
import { mixLevels } from '../audio/mix-levels.js';
import { FOLEY_FILES } from '../audio/foley-bank.js';
import { attachKeyboard, clearPressed, createKeyboard } from '../input/keyboard.js';
import { attachMobileControls } from '../input/mobile-controls.js';
import { createKeySettings } from '../input/key-settings.js';
import { loadSkinScript } from '../story/script.js';
import { drawBanner } from '../view/renderer.js';
import { captureUiScreen, createUiTransition, reducedUiMotion } from '../view/ui-motion.js';
import { SKIN_DIR, STORY_DIR, loadSkin } from '../view/skins/index.js';
import { skinImageFiles } from '../view/skins/image-skin.js';
import { drawFestivalBackground } from '../view/festival.js';
import { applyPageBackdrop } from '../view/battle-backgrounds.js';

import { createMatchSetup, createMainMenu, createSinglePlayerMenu, createMultiplayerMenu, createTitleScene } from './menu-scenes.js';
import { SCREEN_HEIGHT, SCREEN_WIDTH, screenHeight, setupScreen } from './screen.js';
import { loadRecords, loadSettings } from './storage.js';
import { MODES } from './modes.js';
import { storyTestTarget, startStoryTest } from './story-test.js';
import { createOnlineView } from '../net/in-game.js';
import { loadOnlineConfig } from '../net/config.js';
import { createLoadingProgress, createLoadingScreen } from './loading-progress.js';

const FRAME_MS = 1000 / 60;
const MAX_STEPS_PER_TICK = 5;
const storyTest = storyTestTarget(globalThis.location?.href);
const includeStory = MODES.story || Boolean(storyTest);

const canvas = document.getElementById('screen');
const ctx = setupScreen(canvas);

const uiTransition = createUiTransition();


const app = {
  get portraitScreen() { return canvas.portraitScreen === true; },
  keyboard: createKeyboard(),
  sfx: createSfx(),
  settings: loadSettings(),
  records: loadRecords(),
  skin: null,
  storyScript: null,
  scene: null,
  animationFrame: 0,
  mainMenu: null,
  singlePlayerMenu: null,
  setScene(scene, { stamps = [] } = {}) {
    if (app.scene && app.scene !== scene) {
      uiTransition.start(reducedUiMotion() ? null : captureUiScreen(canvas), stamps);
    }
    app.scene = scene;
    app.mobile?.clear();
    app.mobile?.sync();
    const scenery = scene.backgroundScene?.(app.skin) ?? (scene.touchGame?.() ? 'game' : scene.touchTitle ? 'title' : 'menu');
    applyPageBackdrop(ctx, app.skin, scenery);
    app.updateMusic();
  },
  musicScene() {
    return typeof app.scene?.musicScene === 'function' ? app.scene.musicScene() : app.scene?.musicScene ?? 'menu';
  },
  updateMusic() {
    const mix = mixLevels(app.settings);
    configureMusic(app.sfx, app.skin, { enabled: app.settings.music !== false,
      volume: mix.master * mix.music, scene: app.musicScene(), selectionKey: app.scene?.musicSession });
  },
  // 메인 메뉴는 하나만 만들어 돌아왔을 때 커서 위치를 유지한다.
  goToMenu() {
    app.mainMenu ??= createMainMenu();
    app.setScene(app.mainMenu);
  },
  goToSinglePlayer() {
    app.singlePlayerMenu ??= createSinglePlayerMenu();
    app.setScene(app.singlePlayerMenu);
  },
  goToMatchSetup(options) { app.setScene(createMatchSetup(options)); },
  goToMultiplayer() {
    if (!MODES.multiplayer) return;
    app.multiplayerMenu ??= createMultiplayerMenu();
    app.setScene(app.multiplayerMenu);
  },
  applySettings() {
    const mix = mixLevels(app.settings);
    setSfxOptions(app.sfx, { enabled: app.settings.sfx, volume: mix.master,
      effectsVolume: mix.effects, voiceVolume: mix.voice });
    void configureCharacterVoices(app.sfx, app.skin, app.settings.voice !== false);
    app.updateMusic();
  },
};

app.openOnline = async () => {
  if (!MODES.multiplayer || !MODES.online) return;
  app.openOnline = createOnlineView(app, canvas);
  return app.openOnline();
};

const loadingScreen = createLoadingScreen(document);
const loading = createLoadingProgress(state => loadingScreen.update(state));
app.sfx.onLoadProgress = (id, ok) => loading.complete(id, ok);
void fetch('version.json', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(info => {
  if (typeof info?.version === 'string') app.versionLabel = `v${info.version} · ${info.commit?.slice(0, 7) ?? '소스 패키지'}${info.dirty ? ' · 개발 중' : ''}`;
}).catch(() => {});
attachKeyboard(app.keyboard, window);
app.keySettings = createKeySettings({ view: window, keyboard: app.keyboard,
  onOpen: () => app.mobile?.clear(), onClose: () => app.mobile?.clear() });
app.mobile = attachMobileControls({ view: window, canvas, container: document.getElementById('mobile-controls'),
  keyboard: app.keyboard, onUnlock: () => unlockSfx(app.sfx),
  menuButton: document.getElementById('game-menu-toggle'),
  onPause: () => app.scene?.openPause?.(),
  getContext: () => ({ enabled: Boolean(app.scene) && !app.onlineActive,
    mode: app.scene?.touchMode?.() ?? 'menu', player: app.scene?.touchPlayer?.() ?? null,
    gameScreen: app.scene?.touchGame?.() ?? false,
    layout: app.scene?.touchLayout,
    animationFrame: app.animationFrame,
    setup: app.scene?.touchSetup,
    paused: app.scene?.touchPaused?.() ?? false,
    hideBack: app.scene?.touchHideBack?.() ?? false,
    backPlayer: app.scene?.touchBackPlayer?.() ?? null,
    local: app.scene?.touchLocal?.() ?? false,
    label: app.scene?.touchLabel?.(app),
    notice: app.scene?.touchNotice?.(app),
    noticeSummary: app.scene?.touchNoticeSummary?.(app),
    items: app.scene?.touchItems?.(app), direct: typeof app.scene?.touchDirect === 'function'
      ? app.scene.touchDirect() : app.scene?.touchDirect === true,
    title: app.scene?.touchTitle === true, columns: app.scene?.touchColumns ?? 1,
  }),
  onTap: (point, viewport) => app.scene?.tap?.(app, point, viewport) ?? false,
});
window.addEventListener('pointerdown', () => unlockSfx(app.sfx));
window.addEventListener('keydown', () => unlockSfx(app.sfx));
document.addEventListener('visibilitychange', () => syncMusicVisibility(app.sfx));
// 자료 준비 전에는 안내만 표시한다.
drawFestivalBackground(ctx, SCREEN_WIDTH, SCREEN_HEIGHT, 'title');
drawBanner(ctx, '불러오는 중…');
const assetWorker = await setupAssetCache();
let loadedManifest;
const [skin, script] = await Promise.all([
  loadSkin({
    onManifest(manifest) {
      loadedManifest = manifest;
      const audioAvailable = Boolean(window.AudioContext || window.webkitAudioContext);
      const voices = audioAvailable && app.settings.voice !== false
        ? [...new Set((manifest.characters ?? []).flatMap(character => Object.values(character.voices ?? {}).flat()))] : [];
      loading.plan([
        ...skinImageFiles(manifest).map(file => `image:${file}`),
        ...voices.map(file => `voice:${SKIN_DIR}/${file}`),
        ...(audioAvailable && app.sfx.recorded !== false ? Object.values(FOLEY_FILES).flat().map(file => `effect:${file}`) : []),
      ]);
      loading.complete('manifest');
    },
    onImage: (file, ok) => loading.complete(`image:${file}`, ok),
  }).then(skin => { loading.complete('manifest', Boolean(skin)); loading.settleGroup('image:'); return skin; }),
  loadSkinScript(includeStory ? STORY_DIR : SKIN_DIR, { includeStory }).then(script => { loading.complete('characters', Boolean(script)); return script; }),
]);
if (skin && script) {
  app.skin = skin;
  if (skin.branding?.title) document.title = skin.branding.title;
  app.storyScript = script;
  app.applySettings();
  try { await prepareSfx(app.sfx); } catch { /* 소리 장치를 준비할 수 없어도 게임은 시작한다. */ }
  loading.settleGroup('voice:'); loading.settleGroup('effect:'); loading.finish();
  if (storyTest) startStoryTest(app, storyTest);
  else app.setScene(createTitleScene());
  loadingScreen.hide();
  retainMedia(assetWorker, loadedManifest, SKIN_DIR);
  clearPressed(app.keyboard);
} else {
  loadingScreen.fail();
  drawBanner(ctx, '게임 자료를 불러오지 못했습니다', '이미지·캐릭터 정보 파일을 확인하고 새로고침해 주세요.');
}

let last = performance.now();
let accumulator = 0;

function tick(now) {
  if (app.onlineActive) { last = now; accumulator = 0; requestAnimationFrame(tick); return; }
  accumulator = Math.min(accumulator + now - last, FRAME_MS * MAX_STEPS_PER_TICK);
  last = now;
  while (accumulator >= FRAME_MS) {
    uiTransition.update();
    app.animationFrame += 1;
    app.mobile.read();
    app.scene.update(app);
    app.mobile.sync();
    if (app.sfx.musicScene !== app.musicScene() || app.sfx.musicSelectionKey !== app.scene?.musicSession) app.updateMusic();
    clearPressed(app.keyboard);
    accumulator -= FRAME_MS;
  }
  applyPageBackdrop(ctx, app.skin, app.scene.backgroundScene?.(app.skin)
    ?? (app.scene.touchGame?.() ? 'game' : app.scene.touchTitle ? 'title' : 'menu'));
  app.scene.draw(ctx, app);
  uiTransition.draw(ctx, SCREEN_WIDTH, screenHeight(ctx));
  requestAnimationFrame(tick);
}

if (app.scene) requestAnimationFrame(tick);

// 로컬과 Pages가 같은 공개 연결 설정을 사용한다.
void loadOnlineConfig().then(info => { app.onlineAvailable = MODES.multiplayer && MODES.online && info.enabled; if (['#online', '#play', '#new-room', '#leaderboard', '#controls'].includes(window.location?.hash) && MODES.multiplayer && MODES.online && info.enabled) void app.openOnline(); });
