import { PROTOCOL } from '../../src/net/rollback.js';
import { RULES_VERSION } from '../../src/engine/rules.js';
export { Directory } from './directory.js';
export { GameRoom } from './room.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ status: 'ok', protocol: PROTOCOL, rulesVersion: RULES_VERSION, backend: 'cloudflare' });
    if (url.pathname !== '/socket') return new Response('Not found', { status: 404 });
    const origins = (env.ALLOWED_ORIGINS ?? '').split(',').map(x => x.trim());
    if (!origins.includes(request.headers.get('Origin'))) return new Response('Forbidden', { status: 403 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    const code = url.searchParams.get('room');
    if (code && !/^[A-F0-9]{8}$/.test(code)) return new Response('Invalid room', { status: 400 });
    try {
      if (code && !await env.DIRECTORY.getByName('lobby').hasRoom(code)) return new Response('Room not found', { status: 404 });
      const target = code ? env.ROOMS.getByName(code, { locationHint: 'apac' }) : env.DIRECTORY.getByName('lobby', { locationHint: 'apac' });
      return await target.fetch(request);
    } catch {
      return new Response('온라인 서버를 잠시 사용할 수 없습니다.', { status: 503 });
    }
  },
};
