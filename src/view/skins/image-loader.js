// 이미지 수신·디코딩은 두 개씩 처리하고 다음 작업 전 화면 갱신 기회를 준다.
export function createImageLoader(baseUrl, onImage, { timeoutMs = 30000 } = {}) {
  const jobs = new Map(), queue = [];
  let active = 0;
  function drain() {
    queue.sort((a, b) => a.priority - b.priority);
    while (active < 2 && queue.length) {
      const job = queue.shift();
      active++;
      job.started = true;
      const image = new Image();
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        image.onload = image.onerror = null;
        if (!result) image.removeAttribute?.('src');
        job.image = result;
        onImage?.(job.file, Boolean(result));
        job.resolve(result);
        setTimeout(() => { active--; drain(); }, 0);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      image.onload = async () => {
        try { await image.decode?.(); finish(image); }
        catch { finish(null); }
      };
      image.onerror = () => finish(null);
      image.src = `${baseUrl}/${job.file}`;
    }
  }
  function load(file, priority = 0) {
    const existing = jobs.get(file);
    if (existing) {
      existing.priority = Math.min(existing.priority, priority);
      return existing.promise;
    }
    const job = { file, priority };
    job.promise = new Promise(resolve => { job.resolve = resolve; });
    jobs.set(file, job); queue.push(job); drain();
    return job.promise;
  }
  load.retryFailures = () => { for (const [file, job] of jobs) if (job.image === null) jobs.delete(file); };
  load.failed = files => files.some(file => jobs.get(file)?.image === null);
  load.progress = files => ({ total: files.length, completed: files.filter(file => jobs.get(file)?.image).length });
  return load;
}
