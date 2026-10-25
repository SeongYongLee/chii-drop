import { MODES } from '../app/modes.js';
import { onlineTemplate } from './template.js';

// DOM 화면을 게임 문서에 붙인다. 스타일은 메뉴·게임판과 서로 섞이지 않는다.
export function createOnlineView(app, canvas) {
  let session, loading;
  const host = document.createElement('section');
  host.id = 'online-mode'; host.hidden = true; host.setAttribute('aria-label', '온라인 모드');
  const root = host.attachShadow({ mode: 'open' });
  for (const file of ['online.css', 'src/view/online-menu.css']) {
    const link = document.createElement('link'); link.rel = 'stylesheet';
    link.href = new URL(file, document.baseURI).href + new URL(import.meta.url).search;
    root.append(link);
  }
  const shell = document.createElement('div'); shell.className = 'online-shell';
  Object.assign(shell.dataset, { inRoom: 'false', playing: 'false', connected: 'false' });
  shell.innerHTML = onlineTemplate; root.append(shell); document.body.append(host);
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
    app.goToMenu(); app.mobile.sync();
  }
  return async function open() {
    if (!MODES.multiplayer || app.onlineActive) return;
    app.onlineActive = true; document.body.dataset.onlineActive = 'true'; app.keyboard.enabled = false;
    app.keyboard.held.clear(); app.keyboard.pressed.clear(); app.mobile.clear(); app.mobile.sync();
    canvas.parentElement.hidden = true; host.hidden = false; fitLobby();
    app.sfx.musicAudio?.pause();
    if (!['#play', '#new-room', '#leaderboard', '#controls'].includes(location.hash)) history.replaceState(null, '', '#online');
    try {
      loading ??= import('./browser.js').then(module => module.createOnlineSession({ root, shell, skin: app.skin, sfx: app.sfx, onExit: exit }));
      session = await loading;
      session.open();
    } catch (error) {
      console.error('온라인 모드 준비 실패', error); loading = null;
      shell.querySelector('#connection').textContent = '온라인 모드를 열지 못했습니다';
      shell.querySelector('[data-online-exit]').onclick = event => { event.preventDefault(); exit(); };
    }
  };
}
