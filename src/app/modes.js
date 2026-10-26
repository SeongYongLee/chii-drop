// 공개 메뉴는 로컬 대전까지 제공한다. 스토리·온라인 대전은 준비 중이다.
export function modesForURL() {
  return Object.freeze({ story: false, multiplayer: true, online: false });
}

export const MODES = modesForURL(globalThis.location?.href);
