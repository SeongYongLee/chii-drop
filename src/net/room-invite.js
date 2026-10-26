export function normalizeRoomCode(value) {
  return typeof value === 'string' && /^[a-f0-9]{8}$/i.test(value) ? value.toUpperCase() : null;
}

export function roomInviteCode(href) {
  try { return normalizeRoomCode(new URL(href).searchParams.get('room')); }
  catch { return null; }
}

export function roomInviteURL(href, code) {
  const normalized = normalizeRoomCode(code);
  if (!normalized) throw new Error('invalid room code');
  const page = new URL(href);
  const url = new URL('index.html', page);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid invite URL');
  url.username = ''; url.password = '';
  // 로컬 테스트 진입만 보존한다. 비밀번호·플레이어 키·다른 검색 조건은 공유하지 않는다.
  if (page.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(page.hostname)
    && page.searchParams.get('multiplayer-test') === '1') url.searchParams.set('multiplayer-test', '1');
  url.searchParams.set('room', normalized);
  url.hash = 'play';
  return url.href;
}
