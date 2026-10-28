import { MENU_KEYS, wasPressed } from '../input/keyboard.js';
import { drawBanner } from '../view/renderer.js';

// 준비 중에는 경기 장면을 생성하지 않아 경기 시간·난수·입력이 진행되지 않는다.
export function withGameAssets(app, { characters, next, background }) {
  const ids = characters.map(character => character.id);
  const progress = app.skin.gameAssetProgress(ids);
  if (progress.completed === progress.total) { next(); return; }
  let failed = false, attempt = 0;
  const back = () => { attempt++; app.setScene(background); };
  function load() {
    const current = ++attempt;
    failed = false;
    void app.skin.preloadCharacters(ids).then(() => {
      if (current === attempt && app.scene === scene) next();
    }).catch(() => { if (current === attempt) failed = true; });
  }
  const scene = {
    touchLayout: 'list-menu', touchHeading: '경기 자료 준비', touchDirect: true,
    back,
    touchNotice: () => {
      const { completed, total } = app.skin.gameAssetProgress(ids);
      return failed ? '경기 자료를 불러오지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.'
        : `준비 진행 ${completed} / ${total}`;
    },
    touchItems: () => [
      ...(failed ? [{ label: '다시 시도', activate: load }] : []),
      { label: '뒤로', activate: back },
    ],
    update() {
      if (wasPressed(app.keyboard, MENU_KEYS.back)) back();
      else if (failed && wasPressed(app.keyboard, MENU_KEYS.confirm)) load();
    },
    draw(ctx) {
      background.draw(ctx, app);
      const { completed, total } = app.skin.gameAssetProgress(ids);
      drawBanner(ctx, failed ? '경기 자료를 불러오지 못했습니다' : '경기 자료 준비 중…',
        failed ? 'Enter 다시 시도 · Esc 뒤로' : `준비 진행 ${completed} / ${total} · Esc 뒤로`);
    },
  };
  app.setScene(scene);
  load();
  return scene;
}
