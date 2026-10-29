import {createTitleEntrance} from '../input/title-entrance.js';
import {menuCompanionsForApp} from './menu-companions.js';
import { analytics } from '../analytics/client.js';
const analyticsBootAt = performance.now();

import { setupAssetCache, retainMedia } from './asset-cache.js';
import { createSfx, prepareSfx, setSfxOptions, unlockSfx } from '../audio/sfx.js';
import { configureCharacterVoices } from '../audio/character-voice.js';
import { configureMusic, syncMusicVisibility } from '../audio/music.js';
import { mixLevels } from '../audio/mix-levels.js';
import { attachKeyboard, clearPressed, createKeyboard } from '../input/keyboard.js';
import { attachMobileControls } from '../input/mobile-controls.js';
import { createKeySettings } from '../input/key-settings.js';
import { loadSkinScript } from '../story/script.js';
import { drawBanner } from '../view/renderer.js';
import { captureUiScreen, createUiTransition, reducedUiMotion } from '../view/ui-motion.js';
import { SKIN_DIR, STORY_DIR, loadSkin } from '../view/skins/index.js';
import { skinImageFiles } from '../view/skins/image-skin.js';
import { withGameAssets } from './game-assets.js';
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
import { createDownloadIndicator, createDownloadProgress } from './download-progress.js';

const FRAME_MS = 1000 / 60;
const MAX_STEPS_PER_TICK = 5;
let last = performance.now(), accumulator = 0, loopStarted = false, booting = false;
let onlineMenuVisible = null;
const storyTest = storyTestTarget(globalThis.location?.href);
const includeStory = MODES.story || Boolean(storyTest);

const canvas = document.getElementById('screen');
const ctx = setupScreen(canvas);

const uiTransition = createUiTransition();
const titleEntrance = createTitleEntrance(document, canvas);


const app = {
  get menuEntranceActive() { return titleEntrance.active; },
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
  setScene(scene, { stamps = [], instant = false } = {}) {
    if (app.scene && app.scene !== scene) {
      uiTransition.start(instant || reducedUiMotion() ? null : captureUiScreen(canvas, { gameplay: Boolean(scene.touchGame?.()) }), stamps);
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
  goToMenu({ titleBox } = {}) {
    const source = titleBox && { box: titleBox, rect: canvas.getBoundingClientRect(), height: screenHeight(ctx) };
    app.mainMenu ??= createMainMenu();
    app.setScene(app.mainMenu, { instant: Boolean(source && app.skin.titleEntrance) });
    if (source) titleEntrance.start(app.skin, source, app.menuFrame ?? 0);
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
    void configureCharacterVoices(app.sfx, app.skin, app.settings.voice !== false, { preload: false });
    if (app.backgroundAssetsStarted) {
      planBackgroundDownloads();
      void prepareSfx(app.sfx);
      void downloadBackgroundAssets();
    }
    app.updateMusic();
  },
};

app.openOnline = async () => {
  if (!MODES.multiplayer || !MODES.online) return;
  const open = createOnlineView(app, canvas);
  app.openOnline = () => {
    const characters = app.skin.characterRoster ?? app.skin.characters;
    withGameAssets(app, { characters, background: app.scene, next: () => { void open(); } });
  };
  return app.openOnline();
};
app.prepareGame = (characters, next, background) => withGameAssets(app, { characters, next, background });
app.prioritizeCharacters = characters => {
  void app.skin.preloadCharacters(characters.filter(c => !c.random).map(c => c.id)).catch(() => {});
};

const loadingScreen = createLoadingScreen(document, { onRetry: () => { void startGame(); } });
const loading = createLoadingProgress(state => loadingScreen.update(state));
const downloadIndicator = createDownloadIndicator(document, { onRetry: () => { void downloadBackgroundAssets(); } });
const downloads = createDownloadProgress(state => downloadIndicator.update(state));
let backgroundDownloadJob;
function planBackgroundDownloads() {
  const audioAvailable = Boolean(window.AudioContext || window.webkitAudioContext);
  const voices = audioAvailable && app.settings.voice !== false
    ? [...new Set((loadedManifest?.characters ?? []).flatMap(c => Object.values(c.voices ?? {}).flat()))] : [];
  downloads.plan([
    ...skinImageFiles(loadedManifest ?? {}).map(file => `image:${file}`),
    ...voices.map(file => `voice:${SKIN_DIR}/${file}`),
  ]);
}
function downloadBackgroundAssets() {
  if (backgroundDownloadJob) return backgroundDownloadJob;
  downloads.retry(); downloads.start();
  backgroundDownloadJob = Promise.allSettled([
    app.skin.preloadAll(), Promise.resolve().then(() => prepareSfx(app.sfx)),
  ]).then(async () => {
    // 음성 설정을 다운로드 중 켠 경우에도 새로 계획한 항목까지 준비한다.
    try { await prepareSfx(app.sfx); } catch { /* 실패는 아래 진행 상태에 반영한다. */ }
    downloads.settle();
  }).finally(() => { backgroundDownloadJob = null; });
  return backgroundDownloadJob;
}
app.sfx.onLoadProgress = (id, ok) => { loading.complete(id, ok); downloads.complete(id, ok); };
void fetch('version.json', { cache: 'no-store' }).then(response => response.ok ? response.json() : null).then(info => {
  analytics.start(info ?? {});
  if (typeof info?.version === 'string') app.versionLabel = `v${info.version} · ${info.commit?.slice(0, 7) ?? '소스 패키지'}${info.dirty ? ' · 개발 중' : ''}`;
}).catch(() => analytics.disable());
attachKeyboard(app.keyboard, window);
app.keySettings = createKeySettings({ view: window, keyboard: app.keyboard,
  onOpen: () => app.mobile?.clear(), onClose: () => app.mobile?.clear() });
app.mobile = attachMobileControls({ view: window, canvas, container: document.getElementById('mobile-controls'),
  keyboard: app.keyboard, onUnlock: () => unlockSfx(app.sfx),
  menuButton: document.getElementById('game-menu-toggle'),
  backNavigationButton: document.getElementById('screen-back'),
  onBack: () => app.scene?.back?.(app),
  onPause: () => app.scene?.openPause?.(),
  getContext: () => ({ enabled: Boolean(app.scene) && !app.onlineActive,
    mode: app.scene?.touchMode?.() ?? 'menu', player: app.scene?.touchPlayer?.() ?? null,
    gameScreen: app.scene?.touchGame?.() ?? false,
    canPause: app.scene?.touchCanPause?.() ?? false,
    canBack: typeof app.scene?.back === 'function',
    layout: app.scene?.touchLayout,
    titleSource: app.scene?.touchTitleSource ? { ...app.scene.touchTitleSource(), interactions: app.skin?.titleInteractions } : undefined,
    onlineActive: Boolean(app.onlineActive),
    onlineMenu: Boolean(app.onlineActive && app.onlineCompanionsVisible?.()),
    heading: app.scene?.touchHeading,
    compactMenu: Boolean(app.scene?.touchCompact),
    backSelected: app.scene?.touchBackSelected?.(),
    fanNotice: app.skin?.branding?.fanNotice,
    versionLabel: app.versionLabel,
    animationFrame: app.animationFrame,
    companions: app.onlineActive
      ? (app.onlineCompanionsVisible?.() ? menuCompanionsForApp(app) : [])
      : (['list-menu','match-setup'].includes(app.scene?.touchLayout) ? menuCompanionsForApp(app) : []),
    companionAnchor: app.onlineActive ? app.onlineCompanionAnchor : undefined,
    setup: app.scene?.touchSetup,
    records: app.scene?.touchRecords?.(app),
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
async function startGame() {
  if (booting) return;
  booting = true;
  loadingScreen.reset(); loading.reset();
  try {
    const [skin, script] = await Promise.all([
      loadSkin({
        progressive: !includeStory,
        onManifest(manifest, initial) {
          loadedManifest = manifest;
          planBackgroundDownloads();
          loading.plan([
            ...skinImageFiles(initial).map(file => `image:${file}`),
          ]);
          loading.complete('manifest');
        },
        onImage: (file, ok) => { loading.complete(`image:${file}`, ok); downloads.complete(`image:${file}`, ok); },
      }).then(skin => { loading.complete('manifest', Boolean(skin)); loading.settleGroup('image:'); return skin; }),
      loadSkinScript(includeStory ? STORY_DIR : SKIN_DIR, { includeStory }).then(script => { loading.complete('characters', Boolean(script)); return script; }),
    ]);
    if (skin && script) {
      app.skin = skin;
      if (skin.branding?.title) document.title = skin.branding.title;
      app.storyScript = script;
      app.applySettings();
      loading.settleGroup('voice:'); loading.settleGroup('effect:'); loading.finish();
      if (storyTest) startStoryTest(app, storyTest);
      else app.setScene(createTitleScene());
      loadingScreen.hide();
      analytics.track('game_ready', { load_ms: performance.now() - analyticsBootAt });
      retainMedia(assetWorker, loadedManifest, SKIN_DIR);
      clearPressed(app.keyboard);
      if (!loopStarted) { loopStarted = true; last = performance.now(); requestAnimationFrame(tick); }
    } else {
      analytics.track('game_load_failed', { error_code: 'startup_assets_failed', asset_kind: 'startup' });
      loadingScreen.fail();
      drawBanner(ctx, '게임 자료를 불러오지 못했습니다', '연결 상태를 확인한 뒤 다시 시도해 주세요.');
    }
  } catch (error) {
    console.error('게임 자료 준비 실패', error);
    loadingScreen.fail();
  } finally { booting = false; }
}
await startGame();

function tick(now) {
  if (!app.backgroundAssetsStarted) {
    app.backgroundAssetsStarted = true;
    // 첫 타이틀을 그린 다음 작업부터 내려받는다. 실패 항목은 경기 시작 때 재시도한다.
    setTimeout(() => {
      void downloadBackgroundAssets();
    }, 0);
  }
  app.menuFrame=Math.floor(now/FRAME_MS);
  downloadIndicator.setVisible(app.onlineActive ? Boolean(app.onlineCompanionsVisible?.()) : !app.scene?.touchGame?.());
  if (app.onlineActive) {
    titleEntrance.finish();
    const visible = Boolean(app.onlineCompanionsVisible?.());
    // 경기 중 숨겨진 단일 모드 폼은 전환 때 한 번만 갱신한다.
    if (visible || onlineMenuVisible !== visible) app.mobile.sync();
    onlineMenuVisible = visible;
    last = now; accumulator = 0; requestAnimationFrame(tick); return;
  }
  onlineMenuVisible = null;
  accumulator = Math.min(accumulator + now - last, FRAME_MS * MAX_STEPS_PER_TICK);
  last = now;
  while (accumulator >= FRAME_MS) {
    uiTransition.update();
    app.animationFrame += 1;
    if (!titleEntrance.active) {
      app.mobile.read();
      app.scene.update(app);
    }
    app.mobile.sync();
    if (app.sfx.musicScene !== app.musicScene() || app.sfx.musicSelectionKey !== app.scene?.musicSession) app.updateMusic();
    clearPressed(app.keyboard);
    accumulator -= FRAME_MS;
  }
  applyPageBackdrop(ctx, app.skin, app.scene.backgroundScene?.(app.skin)
    ?? (app.scene.touchGame?.() ? 'game' : app.scene.touchTitle ? 'title' : 'menu'));
  app.scene.draw(ctx, app);
  uiTransition.draw(ctx, SCREEN_WIDTH, screenHeight(ctx));
  titleEntrance.draw(app.menuFrame);
  requestAnimationFrame(tick);
}

// 로컬과 Pages가 같은 공개 연결 설정을 사용한다.
void loadOnlineConfig().then(info => { app.onlineAvailable = MODES.multiplayer && MODES.online && info.enabled; if (app.scene && ['#online', '#play', '#new-room', '#leaderboard', '#controls'].includes(window.location?.hash) && MODES.multiplayer && MODES.online && info.enabled) void app.openOnline(); });
