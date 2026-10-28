import { PLAYER_CAPACITY, ROOM_CAPACITY, roomHeadcount } from './room-capacity.js';

// 초대는 대전 참가를 우선한다. 관전 전환은 사용자가 선택한다.
export function roomInviteDecision(room) {
  if (!room) return { action: 'missing', message: '초대받은 방이 닫혔거나 존재하지 않습니다.' };
  if (roomHeadcount(room) >= (room.memberCapacity ?? ROOM_CAPACITY)) {
    return { action: 'full', message: '초대받은 방의 입장 인원이 가득 찼습니다. 대전자와 관전자를 합쳐 최대 6명까지 입장할 수 있어요.' };
  }
  if (room.phase === 'waiting' && room.players.length < (room.capacity ?? PLAYER_CAPACITY)) return { action: 'join' };
  return { action: 'offer-watch', message: room.phase === 'selecting'
    ? '플레이어가 캐릭터를 선택하고 있어요. 관전으로 입장해 함께 기다릴까요?'
    : room.phase === 'playing' ? '지금 경기가 진행 중이에요. 관전으로 입장할까요?'
      : '대전석 2자리가 모두 찼어요. 관전으로 입장할까요?' };
}

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
