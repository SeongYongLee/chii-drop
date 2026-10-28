const number = value => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
const format = value => number(value).toLocaleString('ko-KR');

export function recordSummary(records, levels) {
  const cpu = levels.map(({ id, label }) => ({ id, label,
    win: number(records?.cpu?.[id]?.win), lose: number(records?.cpu?.[id]?.lose) }));
  return { best: number(records?.soloBest), chain: number(records?.soloMaxChain), cpu,
    wins: cpu.reduce((sum, row) => sum + row.win, 0), losses: cpu.reduce((sum, row) => sum + row.lose, 0) };
}

export function renderRecordsPanel(document, container, records) {
  const make = (tag, className, value) => {
    const node = document.createElement(tag); node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  };
  container.replaceChildren(); container.hidden = false;
  const panel = make('div', 'records-panel'); panel.tabIndex = 0;
  panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', '내 기록 · 방향키로 스크롤');
  const practice = make('section', 'records-practice'); practice.setAttribute('aria-label', '연습 기록');
  for (const [label, value, unit] of [['최고 점수', records.best, '점'], ['최대 연쇄', records.chain, '연쇄']]) {
    const card = make('div', 'record-stat');
    const score = make('div', 'record-stat-number');
    score.append(make('strong', '', format(value)), make('span', '', unit));
    card.append(make('span', 'record-stat-label', `연습 ${label}`), score); practice.append(card);
  }
  const section = make('section', 'records-cpu');
  const heading = make('div', 'records-section-heading');
  heading.append(make('h2', '', 'CPU 대전'), make('span', '', `${format(records.wins)}승 · ${format(records.losses)}패`));
  const table = make('table', 'records-table'); table.setAttribute('aria-label', 'CPU 난이도별 전적');
  const head = make('thead', ''), tr = make('tr', '');
  for (const text of ['난이도', '승', '패', '승률']) {
    const th = make('th', '', text); th.scope = 'col'; tr.append(th);
  }
  head.append(tr);
  const body = make('tbody', '');
  records.cpu.forEach(row => {
    const line = make('tr', ''), name = make('th', '', row.label); name.scope = 'row';
    const played = row.win + row.lose;
    line.append(name, make('td', 'record-wins', format(row.win)), make('td', '', format(row.lose)),
      make('td', 'record-rate', played ? `${Math.round(row.win / played * 100)}%` : '—'));
    body.append(line);
  });
  table.append(head, body); section.append(heading, table);
  if (!records.wins && !records.losses) section.append(make('p', 'records-empty', 'CPU 대전을 마치면 난이도별 전적이 쌓여요.'));
  panel.append(practice, section);
  if (records.story?.length) {
    const story = make('section', 'records-story'); story.append(make('h2', '', '스토리'));
    records.story.forEach(text => story.append(make('p', '', text))); panel.append(story);
  }
  container.append(panel);
}
