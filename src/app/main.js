import { createSfx, prepareSfx, setSfxOptions, unlockSfx } from '../audio/sfx.js';
import { configureCharacterVoices } from '../audio/character-voice.js';
import { configureMusic, syncMusicVisibility } from '../audio/music.js';
import { attachKeyboard, clearPressed, createKeyboard } from '../input/keyboard.js';
import { attachMobileControls } from '../input/mobile-controls.js';
import { createKeySettings } from '../input/key-settings.js';
import { loadSkinScript } from '../story/script.js';
import { drawBanner } from '../view/renderer.js';
import { captureUiScreen, createUiTransition, reducedUiMotion } from '../view/ui-motion.js';
import { SKIN_DIR, loadSkin } from '../view/skins/index.js';
import { drawFestivalBackground } from '../view/festival.js';

import { createMainMenu, createSinglePlayerMenu, createTitleScene } from './menu-scenes.js';
import { SCREEN_HEIGHT, SCREEN_WIDTH, setupScreen } from './screen.js';
import { loadRecords, loadSettings } from './storage.js';
import { MODES } from './modes.js';

const FRAME_MS = 1000 / 60;
const MAX_STEPS_PER_TICK = 5;

const canvas = document.getElementById('screen');
const ctx = setupScreen(canvas);

const uiTransition = createUiTransition();


const app = {
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
    app.updateMusic();
  },
  musicScene() {
    return typeof app.scene?.musicScene === 'function' ? app.scene.musicScene() : app.scene?.musicScene ?? 'menu';
  },
  updateMusic() {
    configureMusic(app.sfx, app.skin, { enabled: app.settings.music !== false,
      volume: app.settings.volume / 10, scene: app.musicScene(), selectionKey: app.scene?.musicSession });
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
  applySettings() {
    setSfxOptions(app.sfx, { enabled: app.settings.sfx, volume: app.settings.volume / 10 });
    void configureCharacterVoices(app.sfx, app.skin, app.settings.voice !== false);
    app.updateMusic();
  },
};

attachKeyboard(app.keyboard, window);
app.keySettings = createKeySettings({ view: window, keyboard: app.keyboard,
  onOpen: () => app.mobile?.clear(), onClose: () => app.mobile?.clear() });
app.mobile = attachMobileControls({ view: window, canvas, container: document.getElementById('mobile-controls'),
  keyboard: app.keyboard, onUnlock: () => unlockSfx(app.sfx),
  getContext: () => ({ enabled: Boolean(app.scene),
    mode: app.scene?.touchMode?.() ?? 'menu', player: app.scene?.touchPlayer?.() ?? null,
    backPlayer: app.scene?.touchBackPlayer?.() ?? null,
    local: app.scene?.touchLocal?.() ?? false,
    label: app.scene?.touchLabel?.(app),
    items: app.scene?.touchItems?.(app), direct: app.scene?.touchDirect === true,
    title: app.scene?.touchTitle === true, columns: app.scene?.touchColumns ?? 1,
  }),
  onTap: (point) => app.scene?.tap?.(app, point) ?? false,
});
window.addEventListener('pointerdown', () => unlockSfx(app.sfx));
window.addEventListener('keydown', () => unlockSfx(app.sfx));
document.addEventListener('visibilitychange', () => syncMusicVisibility(app.sfx));
// 자료 준비 전에는 안내만 표시한다.
drawFestivalBackground(ctx, SCREEN_WIDTH, SCREEN_HEIGHT, 'title');
drawBanner(ctx, '불러오는 중…');
const [skin, script] = await Promise.all([loadSkin(), loadSkinScript(SKIN_DIR, { includeStory: MODES.story })]);
if (skin && script) {
  app.skin = skin;
  if (skin.branding?.title) document.title = [skin.branding.title,
    [skin.branding.subtitle, skin.branding.tagline].filter(Boolean).join(' - ')].filter(Boolean).join(' — ');
  app.storyScript = script;
  app.applySettings();
  await prepareSfx(app.sfx);
  app.setScene(createTitleScene());
  clearPressed(app.keyboard);
} else {
  drawBanner(ctx, '게임 자료를 불러오지 못했습니다', '이미지·캐릭터 정보 파일을 확인하고 새로고침해 주세요.');
}

let last = performance.now();
let accumulator = 0;

function tick(now) {
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
  app.scene.draw(ctx, app);
  uiTransition.draw(ctx, SCREEN_WIDTH, SCREEN_HEIGHT);
  requestAnimationFrame(tick);
}

if (app.scene) requestAnimationFrame(tick);
