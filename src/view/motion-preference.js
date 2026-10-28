// 매번 MediaQueryList를 만들지 않고 같은 브라우저의 조회 객체를 공유한다.
let owner, factory, query;
export function prefersReducedMotion() {
  const target = typeof globalThis.matchMedia === 'function' ? globalThis : globalThis.window;
  const method = target?.matchMedia;
  if (typeof method !== 'function') return false;
  if (target !== owner || method !== factory) {
    owner = target; factory = method; query = method.call(target, '(prefers-reduced-motion: reduce)');
  }
  // matches는 OS 설정 변경에도 갱신되므로 참·거짓 값 자체는 캐시하지 않는다.
  return Boolean(query?.matches);
}
