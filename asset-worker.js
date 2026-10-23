// 실행 코드·JSON은 저장하지 않는다. 내용 해시가 붙은 공개 이미지·음성·음악만 보관한다.
const root = new URL(self.registration.scope);
const CACHE = `chii-drop-media-v1:${root.pathname}`;
const indexKey = new URL('__media-generations__', root).href;
const pending = new Map();
const isMedia = url => url.origin === root.origin && url.pathname.startsWith(root.pathname)
  && /^skins\/chiikawa\/pages-runtime\/assets\/[a-f0-9]{20}\.(png|webp|wav|mp3)$/.test(url.pathname.slice(root.pathname.length));
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

async function fullMedia(request) {
  let cache;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(request.url);
    if (hit?.status === 200) return hit;
  } catch { /* 저장 공간을 사용할 수 없어도 네트워크로 실행한다. */ }
  let job = pending.get(request.url);
  if (!job) {
    const headers = new Headers(request.headers);
    headers.delete('range');
    job = (async () => {
      const response = await fetch(new Request(request, { headers }));
      if (response.status === 200 && cache) {
        try { await cache.put(request.url, response.clone()); } catch { /* 용량 초과·비공개 모드에서는 저장을 생략한다. */ }
      }
      return response;
    })();
    pending.set(request.url, job);
    job.finally(() => pending.delete(request.url)).catch(() => {});
  }
  return (await job).clone();
}

async function mediaResponse(request) {
  const response = await fullMedia(request);
  const range = request.headers.get('range');
  if (!range || response.status !== 200) return response;
  // Safari Audio의 부분 요청에도 저장된 전체 음악에서 필요한 구간을 돌려준다.
  const bytes = await response.arrayBuffer(), size = bytes.byteLength;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  let start, end;
  if (match && (match[1] || match[2])) {
    start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  const headers = new Headers(response.headers);
  headers.delete('Content-Encoding');
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Accept-Ranges', 'bytes');
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
}
self.addEventListener('fetch', event => {
  if (event.request.method === 'GET' && isMedia(new URL(event.request.url))) {
    event.respondWith(mediaResponse(event.request));
  }
});

// 현재·직전 두 세대를 남겨 다른 탭이나 업데이트 직후 뒤로 가기에 쓰는 자료를 보호한다.
let cleanup = Promise.resolve();
self.addEventListener('message', event => {
  if (event.data?.type !== 'retain-media' || !Array.isArray(event.data.urls)) return;
  const urls = [...new Set(event.data.urls)].filter(url => {
    try { return isMedia(new URL(url)); } catch { return false; }
  }).sort();
  if (!urls.length) return;
  cleanup = cleanup.catch(() => {}).then(async () => {
    const cache = await caches.open(CACHE);
    let previous = [];
    try { previous = await (await cache.match(indexKey))?.json() ?? []; } catch { /* 처음 사용하거나 목록이 손상됐으면 새 목록을 쓴다. */ }
    if (!Array.isArray(previous)) previous = [];
    const generations = [urls, ...previous.filter(items => Array.isArray(items) && JSON.stringify(items) !== JSON.stringify(urls))].slice(0, 2);
    await cache.put(indexKey, new Response(JSON.stringify(generations), { headers: { 'Content-Type': 'application/json' } }));
    const keep = new Set([indexKey, ...generations.flat()]);
    for (const request of await cache.keys()) if (!keep.has(request.url)) await cache.delete(request);
  });
  event.waitUntil(cleanup.catch(() => {}));
});
