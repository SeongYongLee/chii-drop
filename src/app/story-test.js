import { createStoryFlow } from './story-mode.js';
import { createListMenu } from './menu-scenes.js';

const TARGETS = new Map([
  ['opening', '스토리 처음부터'],
  ['secretFinal', '히든 최종전 · 초대부터'],
  ['reveal', '변신 장면만 보기'],
  ['secretEnding', '히든 결말만 보기'],
]);

export function storyTestTarget(href) {
  try {
    const url = new URL(href);
    const target = url.searchParams.get('story-test');
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && (target === 'menu' || TARGETS.has(target)) ? target : null;
  } catch { return null; }
}

export function startStoryTest(app, initial = 'menu') {
  const panel = document.createElement('details');
  panel.style.cssText = 'position:fixed;z-index:1000;top:8px;left:8px;max-width:min(540px,calc(100vw - 16px));padding:10px;background:#fffaf2f5;color:#40363e;border:1px solid #b5a0ab;border-radius:12px;font:14px system-ui;box-shadow:0 2px 12px #0002';
  const summary = document.createElement('summary');
  summary.textContent = '로컬 스토리 테스트 · 기록 저장 안 함';
  summary.style.cursor = 'pointer';
  panel.append(summary);
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  panel.append(status);
  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
  panel.append(buttons);
  panel.addEventListener('keydown', event => event.stopPropagation());
  const button = (text, action) => {
    const el = document.createElement('button');
    el.type = 'button'; el.textContent = text;
    el.style.cssText = 'font:inherit;padding:7px 10px;border:1px solid #b5a0ab;border-radius:7px;background:white;color:#40363e;cursor:pointer';
    el.addEventListener('click', () => { action(); el.blur(); });
    buttons.append(el); return el;
  };
  let flow;
  const launch = target => { panel.open = false; flow.testStart(target); };
  const menu = () => {
    panel.open = true;
    status.textContent = '실제 경기와 대사를 확인합니다. 승리 처리는 테스트 점수 40,000점으로 이후 대사를 진행합니다. Enter 다음 대사 / Esc 장면 건너뛰기.';
    win.disabled = lose.disabled = true;
    app.setScene(createListMenu({ title: '스토리 테스트', footer: '로컬 전용 · 기존 진행·해금·전적을 저장하지 않습니다',
      items: () => [...TARGETS].map(([target, label]) => ({ label, select: () => launch(target) })),
      onBack: () => { location.href = location.pathname; },
    }));
  };
  for (const [target, label] of TARGETS) button(label, () => launch(target));
  const win = button('승리 처리 (+40,000점)', () => flow.testFinish(true));
  const lose = button('현재 경기 패배 처리', () => flow.testFinish(false));
  button('테스트 메뉴', menu);
  button('일반 게임으로', () => { location.href = location.pathname; });
  flow = createStoryFlow(app, { testMode: true, onExit: menu,
    onTestState({ phase, opponent, skippable }) {
      win.disabled = lose.disabled = phase !== 'battle';
      status.textContent = `${({ dialogue: skippable === false ? 'Enter 다음 · 장면 전체 건너뛰기 불가' : '대사 진행 중 · Enter 다음 / Esc 장면 건너뛰기', battle: '경기 진행 중 · 직접 플레이하거나 승패 처리', tower: '상대 선택 · Enter 결정' })[phase]}${opponent ? ' · ' + (app.storyScript.characters[opponent]?.name ?? opponent) : ''}`;
    },
  });
  document.body.append(panel);
  if (initial === 'menu') menu(); else launch(initial);
}
