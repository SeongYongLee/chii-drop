import WebSocket from 'ws';
import { resolve } from 'node:path';
import { parseOnlineConfig } from '../src/net/config.js';
import { PROTOCOL } from '../src/net/rollback.js';
import { RULES_VERSION } from '../src/engine/rules.js';

// 플레이어를 생성하지 않는 운영 점검. 브라우저와 같은 Origin으로 WS 연결한다.
export async function checkOnline(base, origin = 'https://seongyonglee.github.io') {
  if (new URL(origin).origin !== origin) throw new Error('Pages origin에는 /chii-drop 경로를 넣지 않습니다.');
  const { socketURL } = parseOnlineConfig({ enabled: true, serverUrl: base }, 'http://localhost/');
  const response = await fetch(new URL('/health', base), { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`서버 상태 응답: ${response.status}`);
  const info = await response.json();
  if (info.status !== 'ok' || info.protocol !== PROTOCOL || info.rulesVersion !== RULES_VERSION) throw new Error('서버와 현재 코드의 프로토콜·규칙 버전이 다릅니다.');
  await new Promise((done, reject) => {
    const ws = new WebSocket(socketURL, { origin });
    let finished = false;
    const timer = setTimeout(() => finish(new Error('WebSocket 응답 시간 초과')), 10000);
    function finish(error) { if (finished) return; finished = true; clearTimeout(timer); ws.terminate(); error ? reject(error) : done(); }
    ws.on('error', error => finish(error));
    ws.on('open', () => ws.send(JSON.stringify({ type: 'ping', time: 12345 })));
    ws.on('message', bytes => {
      try { const message = JSON.parse(bytes); if (message.type === 'pong' && message.time === 12345) finish(); }
      catch (error) { finish(error); }
    });
    ws.on('close', () => finish(new Error('점검 완료 전에 연결이 종료됐습니다.')));
  });
  return info;
}
if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/check-online.mjs')) {
  try {
    const info = await checkOnline(process.argv[2], process.argv[3]);
    console.log(`온라인 서버 점검 통과: 프로토콜 ${info.protocol}, 규칙 ${info.rulesVersion}, HTTP·WebSocket 연결`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
