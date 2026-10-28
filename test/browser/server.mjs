import { readFile } from 'node:fs/promises';
import { createOnlineServer } from '../../server/index.js';

// 합성 테스트용 서버만 제공하는 제어점이다. 운영 서버·Pages에는 포함되지 않는다.
const { server, wss, lobby } = createOnlineServer();
let mediaDelayMs = 0, mediaOffline = false, manifestRevision = null;
const requests = new Map();
const handlers = server.listeners('request');
server.removeAllListeners('request');
server.on('request', (req, res) => {
  if (req.url === '/__test/media' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const config = JSON.parse(body);
        mediaDelayMs = Math.max(0, Math.min(500, Number(config.delayMs) || 0));
        mediaOffline = config.offline === true;
        manifestRevision = typeof config.revision === 'string' ? config.revision : null;
        if (config.reset) requests.clear();
        res.writeHead(204); res.end();
      } catch { res.writeHead(400); res.end(); }
    });
    return;
  }
  if (req.url === '/__test/requests') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(Object.fromEntries(requests))); return;
  }
  requests.set(req.url, (requests.get(req.url) ?? 0) + 1);
  if (req.url === '/skins/chiikawa/pages-runtime/manifest.json' && manifestRevision) {
    void readFile(new URL('../../skins/chiikawa/pages-runtime/manifest.json', import.meta.url), 'utf8').then(bytes => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ...JSON.parse(bytes), browserTestRevision: manifestRevision }));
    }).catch(() => { res.writeHead(500); res.end(); });
    return;
  }
  if (/^\/skins\/chiikawa\/pages-runtime\/assets\//.test(req.url)) {
    if (mediaOffline) { res.writeHead(503); res.end('media network unavailable'); return; }
    if (mediaDelayMs) {
      setTimeout(() => { for (const handler of handlers) handler.call(server, req, res); }, mediaDelayMs);
      return;
    }
  }
  if (req.url === '/__test/disconnect' && req.method === 'POST') {
    for (const socket of wss.clients) socket.terminate();
    res.writeHead(204); res.end(); return;
  }
  if (req.url === '/__test/rooms') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([...lobby.rooms.values()].map(room => ({ code: room.code, matchId: room.matchId,
      frame: room.state?.frame ?? 0, paused: Boolean(room.paused), players: room.peers.length })))); return;
  }
  for (const handler of handlers) handler.call(server, req, res);
});
server.listen(5217, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  for (const socket of wss.clients) socket.terminate();
  wss.close(); server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
});
