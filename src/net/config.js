// Pages의 하위 경로에서도 같은 설정 파일을 읽는다. 서버 주소는 공개 설정이다.
export function parseOnlineConfig(value, pageURL) {
  if (!value || typeof value !== 'object' || typeof value.enabled !== 'boolean') throw new Error('온라인 설정 형식이 올바르지 않습니다.');
  const page = new URL(pageURL);
  let endpoint = new URL('/socket', page);
  if (value.serverUrl != null) {
    const server = new URL(value.serverUrl);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(server.hostname);
    if ((server.protocol !== 'https:' && !(server.protocol === 'http:' && loopback && page.protocol === 'http:'))
      || server.username || server.password || server.pathname !== '/' || server.search || server.hash) {
      throw new Error('온라인 서버는 경로·인증 정보가 없는 HTTPS 주소여야 합니다.');
    }
    endpoint = new URL('/socket', server);
  } else if (value.enabled && page.protocol === 'https:') {
    throw new Error('공개 온라인 모드에는 serverUrl이 필요합니다.');
  }
  endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
  if (value.identityScope !== undefined && (typeof value.identityScope !== 'string' || !/^[a-z0-9-]{1,64}$/.test(value.identityScope))) throw new Error('온라인 저장 구분이 올바르지 않습니다.');
  return { enabled: value.enabled, socketURL: endpoint.href, ...(value.identityScope ? { identityScope: value.identityScope } : {}) };
}

export function onlineTokenKey(config) {
  return 'online-player-key-v1' + (config.identityScope ? ':' + config.identityScope : '');
}

export async function loadOnlineConfig() {
  try {
    const response = await fetch(new URL('../../online-config.json', import.meta.url), {
      cache: 'no-store', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { enabled: false };
    return parseOnlineConfig(await response.json(), location.href);
  } catch { return { enabled: false }; }
}
