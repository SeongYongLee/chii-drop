// 오디오 요청·디코딩 폭주가 첫 입력의 렌더링과 겹치지 않도록 컨텍스트당 두 개씩 준비한다.
import { withAssetTimeout } from '../app/asset-request.js';
const queues = new WeakMap();

function loadAudioBuffer(context, file, { timeoutMs = 15000 } = {}) {
  let queue = queues.get(context);
  if (!queue) { queue = { active: 0, jobs: [] }; queues.set(context, queue); }
  return new Promise((resolve, reject) => {
    queue.jobs.push({ file, resolve, reject, timeoutMs });
    drain(context, queue);
  });
}

function drain(context, queue) {
  while (queue.active < 2 && queue.jobs.length) {
    const job = queue.jobs.shift();
    queue.active++;
    (async () => {
      try {
        job.resolve(await withAssetTimeout(async signal => {
          const response = await fetch(job.file, { signal });
          if (!response.ok) throw new Error('Audio unavailable');
          return context.decodeAudioData(await response.arrayBuffer());
        }, job.timeoutMs));
      } catch (error) { job.reject(error); }
      finally {
        // 각 준비 작업 사이에 화면 갱신 기회를 준다.
        setTimeout(() => { queue.active--; drain(context, queue); }, 0);
      }
    })();
  }
}

export { loadAudioBuffer };
