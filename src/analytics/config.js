// 공개 측정 ID만 설정한다. API secret·사용자 토큰은 여기에 넣지 않는다.
// 개발·정식 Pages는 같은 GA 속성에 수집하고 environment 매개변수로 구분한다.
export const ANALYTICS_CONFIG = Object.freeze({
  production: 'G-99S8RZ03E0',
  development: 'G-99S8RZ03E0',
  allowedHosts: ['seongyonglee.github.io'],
});
