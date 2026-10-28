// fetch 자체뿐 아니라 응답 본문·오디오 디코딩까지 제한한다.
// Promise.race는 AbortSignal을 무시하는 환경에서도 대기열을 풀어 준다.
export async function withAssetTimeout(work, timeoutMs = 15000) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => work(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('자료 준비 시간이 초과되었습니다.');
          error.name = 'TimeoutError';
          controller.abort(error); reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

export function fetchAssetJson(url, options = {}, timeoutMs) {
  return withAssetTimeout(async signal => {
    const response = await fetch(url, { ...options, signal });
    if (!response.ok) throw new Error(`자료 요청 실패: HTTP ${response.status}`);
    return response.json();
  }, timeoutMs);
}
