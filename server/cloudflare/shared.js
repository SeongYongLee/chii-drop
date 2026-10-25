import { PROTOCOL } from '../../src/net/rollback.js';
import { RULES_VERSION } from '../../src/engine/rules.js';

export const AUTO_PING = JSON.stringify({ type: 'heartbeat' });
export const AUTO_PONG = JSON.stringify({ type: 'heartbeatAck' });
export function setupStorage(ctx) {
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID');
  ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(AUTO_PING, AUTO_PONG));
}
export function readState(ctx) {
  const row = ctx.storage.sql.exec("SELECT value FROM state WHERE key = 'state'").toArray()[0];
  return row ? JSON.parse(row.value) : null;
}
export function writeState(ctx, state) {
  const text = JSON.stringify(state);
  if (new TextEncoder().encode(text).byteLength > 1500000) throw new Error('저장 공간을 정리해야 합니다.');
  return ctx.storage.sql.exec("INSERT INTO state VALUES ('state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", text).rowsWritten;
}
export function parseMessage(data) {
  if (typeof data !== 'string' || data.length > 4096) throw new Error('invalid packet');
  const msg = JSON.parse(data);
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new Error('invalid packet');
  return msg;
}
export function checkVersion(msg) {
  if (msg.protocol !== PROTOCOL || msg.rulesVersion !== RULES_VERSION) throw new Error('게임과 서버 버전이 다릅니다. 새로고침해 주세요.');
}
export function send(ws, msg) { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); }
export async function accept(ctx, limit) {
  if (ctx.getWebSockets().filter(ws => ws.readyState === 1).length >= limit) return new Response('연결이 가득 찼습니다.', { status: 503 });
  const [client, server] = Object.values(new WebSocketPair());
  ctx.acceptWebSocket(server);
  server.serializeAttachment({ connectedAt: Date.now() });
  if (await ctx.storage.getAlarm() === null) await ctx.storage.setAlarm(Date.now() + 30000);
  return new Response(null, { status: 101, webSocket: client });
}
export function closeUnauthenticated(ctx) {
  for (const ws of ctx.getWebSockets()) {
    const meta = ws.deserializeAttachment();
    if (!meta?.profileId && Date.now() - (meta?.connectedAt ?? 0) >= 30000) ws.close(1008, 'Authentication timeout');
  }
}
export function rateLimit(ws) {
  const meta = ws.deserializeAttachment() ?? {};
  if (!meta.period || Date.now() - meta.period >= 1000) { meta.period = Date.now(); meta.count = 0; }
  if (++meta.count > 180) throw new Error('rate limit');
  ws.serializeAttachment(meta);
  return meta;
}
