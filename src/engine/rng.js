// 3.1절. 32비트 선형 합동 난수. 원작은 프레임 카운터와 패드 입력도 더하지만,
// 이 게임은 같은 시드면 같은 결과가 나오도록 그 항을 넣지 않는다.
function createRng(seed) {
  return seed >>> 0;
}

function nextRng(state) {
  return (Math.imul(state, 1103515245) + 12345) >>> 0;
}

// 상한이 0이면 결과는 0이고 상태만 바뀐다.
function randomInt(state, max) {
  const next = nextRng(state);
  return { value: max > 0 ? (next >>> 16) % max : 0, state: next };
}

export { createRng, nextRng, randomInt };
