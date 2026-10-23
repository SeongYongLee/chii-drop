// localhost / HTTPS에서 사용할 수 있다. 미지원·용량 부족 때도 일반 로딩을 계속한다.
export async function setupAssetCache() {
  if (!globalThis.navigator?.serviceWorker || !globalThis.isSecureContext) return null;
  let timer, stopWaiting;
  let finished = false;
  try {
    const setup = (async () => {
      const registration = await navigator.serviceWorker.register(new URL('../../asset-worker.js', import.meta.url), { updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller && !finished) {
        await new Promise(resolve => {
          const changed = () => { navigator.serviceWorker.removeEventListener('controllerchange', changed); resolve(); };
          stopWaiting = changed;
          navigator.serviceWorker.addEventListener('controllerchange', changed, { once: true });
          if (navigator.serviceWorker.controller) changed();
        });
      }
      return registration.active ?? navigator.serviceWorker.controller;
    })();
    return await Promise.race([setup, new Promise(resolve => { timer = setTimeout(() => resolve(null), 3000); })]);
  } catch { return null; }
  finally { finished = true; clearTimeout(timer); stopWaiting?.(); }
}

export function retainMedia(worker, manifest, baseUrl) {
  if (!worker) return;
  const files = new Set();
  function visit(value) {
    if (typeof value === 'string' && /^assets\/[a-f0-9]{20}\.(png|webp|wav|mp3)$/.test(value)) files.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  }
  visit(manifest);
  try { worker.postMessage({ type: 'retain-media', urls: [...files].map(file => new URL(`${baseUrl}/${file}`, document.baseURI).href) }); }
  catch { /* 캐시 정리 실패가 게임 진행을 막지 않는다. */ }
}
