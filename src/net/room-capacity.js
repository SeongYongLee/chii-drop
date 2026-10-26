// 대전 좌석과 입장 정원을 구분한다. 재접속 예약도 정원에 포함한다.
export const ROOM_CAPACITY = 6;
export const PLAYER_CAPACITY = 2;
export const SPECTATOR_CAPACITY = 6;

export function roomHeadcount(room) {
  return (room?.players ?? room?.peers ?? []).length
    + (typeof room?.spectators === 'number' ? room.spectators : room?.spectators?.length ?? 0);
}
