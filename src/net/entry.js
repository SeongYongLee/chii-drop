import { MODES } from '../app/modes.js';

if (MODES.online) {
  await import('./browser.js');
} else {
  // 기존 북마크로 열어도 게임 자료나 WebSocket 연결을 시작하지 않는다.
  document.title = '온라인 모드 준비 중';
  document.getElementById('connection').textContent = '준비 중';
  document.getElementById('touch-options').hidden = true;
  const card = document.createElement('section');
  card.className = 'card unavailable-mode';
  const title = document.createElement('h2');
  title.textContent = '온라인 모드는 준비 중이에요';
  const description = document.createElement('p');
  description.textContent = '지금은 CPU 대전·로컬 대전·연습을 즐길 수 있어요.';
  const back = document.createElement('a');
  back.className = 'button primary'; back.href = 'index.html'; back.textContent = '메인 메뉴로 돌아가기';
  card.append(title, description, back);
  document.getElementById('main').replaceChildren(card);
}
