import { analytics } from '../analytics/client.js';
import { MODES } from '../app/modes.js';
import { AUTOMATIC_MATCHMAKING } from './features.js';
import { onlineTemplate } from './template.js';

// DOM 화면을 게임 문서에 붙인다. 스타일은 메뉴·게임판과 서로 섞이지 않는다.
export function createOnlineView(app, canvas) {
  let session, loading;
  const host = document.createElement('section');
  host.id = 'online-mode'; host.hidden = true; host.setAttribute('aria-label', '온라인 모드');
  const root = host.attachShadow({ mode: 'open' });
  const styles = [];
  for (const file of ['online.css', 'src/view/online-menu.css']) {
    const link = document.createElement('link'); link.rel = 'stylesheet';
    link.href = new URL(file, document.baseURI).href + new URL(import.meta.url).search;
    styles.push(new Promise((resolve, reject) => {
      link.onload = resolve;
      link.onerror = () => reject(new Error(`온라인 화면 스타일을 불러오지 못했습니다: ${file}`));
    }));
    root.append(link);
  }
  // Shadow DOM의 stylesheet는 첫 화면 표시를 막지 않으므로 직접 준비를 기다린다.
  const stylesReady = Promise.all(styles);
  void stylesReady.catch(() => {});
  const shell = document.createElement('div'); shell.className = 'online-shell';
  Object.assign(shell.dataset, { embedded: 'true', inRoom: 'false', playing: 'false', connected: 'false', matchmaking: String(AUTOMATIC_MATCHMAKING) });
  shell.innerHTML = onlineTemplate; root.append(shell); document.body.append(host);
  app.onlineCompanionsVisible=()=>!host.hidden&&host.dataset.playing!=='true';
  app.onlineCompanionAnchor={getBoundingClientRect(){
    return root.getElementById('main').getBoundingClientRect();
  }};
  // viewport 수치 대신 실제 프레임을 측정해 확대·창 크기 변경도 같은 기준을 쓴다.
  function fitLobby() {
    const { width, height } = host.getBoundingClientRect();
    shell.dataset.compact = String(width >= 440 && height <= 680);
    shell.dataset.short = String(height < 420);
    shell.dataset.narrow = String(width < 600);
    shell.dataset.flat = String(width >= 440 && height <= 360);
  }
  const frameObserver = new ResizeObserver(fitLobby);
  frameObserver.observe(host);

  function exit() {
    host.hidden = true; canvas.parentElement.hidden = false;
    app.onlineActive = false; document.body.dataset.onlineActive = 'false'; app.keyboard.enabled = true;
    app.keyboard.held.clear(); app.keyboard.pressed.clear();
    history.replaceState(null, '', location.pathname + location.search);
    if (app.goToMultiplayer) app.goToMultiplayer(); else app.goToMenu();
    app.mobile.sync();
  }
  return async function open() {
    if (!MODES.multiplayer || app.onlineActive) return;
    analytics.track('mode_selected', { mode: 'online' });
    app.onlineActive = true; document.body.dataset.onlineActive = 'true'; app.keyboard.enabled = false;
    app.keyboard.held.clear(); app.keyboard.pressed.clear(); app.mobile.clear(); app.mobile.sync();
    app.sfx.musicAudio?.pause();
    if (!['#play', '#new-room', '#leaderboard', '#controls'].includes(location.hash)) history.replaceState(null, '', '#online');
    try {
      loading ??= Promise.all([stylesReady, import('./browser.js')]).then(([, module]) => module.createOnlineSession({ root, shell, skin: app.skin, sfx: app.sfx, onExit: exit }));
      session = await loading;
      // 스타일·이벤트·초기 패널이 준비된 뒤 실제 프레임을 측정하고 한 번에 전환한다.
      canvas.parentElement.hidden = true; host.hidden = false; fitLobby();
      session.open();
    } catch (error) {
      analytics.track('game_load_failed', { error_code: 'online_assets_failed', asset_kind: 'online' });
      console.error('온라인 모드 준비 실패', error); loading = null;
      exit();
    }
  };
}
