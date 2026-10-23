// 정적 배포본은 별도 녹음 파일을 요청하지 않고 기존 합성 효과음을 사용한다.
export const FOLEY_FILES = {};
export async function preloadRecordedSfx() { return 0; }
export function playRecordedSfx() { return false; }
