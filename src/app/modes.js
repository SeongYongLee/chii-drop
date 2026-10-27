// 온라인 연결은 online-config.json으로 관리하며 스토리는 준비 중이다.
export function modesForURL() {
  return Object.freeze({ story: false, multiplayer: true, online: true });
}

export const MODES = modesForURL(globalThis.location?.href);
