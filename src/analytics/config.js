// 공개 측정 ID만 설정한다. API secret·사용자 토큰은 여기에 넣지 않는다.
// 개발 Pages와 정식 Pages는 version.json의 deployment로 구분한다.
export const ANALYTICS_CONFIG = Object.freeze({
  production: 'G-99S8RZ03E0',
  development: '', // 별도 테스트 속성의 G-XXXXXXXXXX
  allowedHosts: ['seongyonglee.github.io'],
});
