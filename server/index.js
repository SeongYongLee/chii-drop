import { allMusicTracks } from '../src/audio/music-config.js';
import { createServer, request as httpRequest } from 'node:http';
import { networkInterfaces } from 'node:os';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { createRooms } from './rooms.js';
import { createProfileStore } from './profiles.js';
import { createVoiceEditor } from './voice-editor.js';
import { createMusicEditor } from './music-editor.js';
import { buildInfo } from '../scripts/build-info.mjs';
import { runtimeConfig } from './runtime-config.js';
import { PROTOCOL } from '../src/net/rollback.js';
import { RULES_VERSION } from '../src/engine/rules.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.md': 'text/plain; charset=utf-8' };

export function createOnlineServer({ origins = [], profiles = createProfileStore(), serveStatic = true, cloudflareURL } = {}) {
  if (!serveStatic && !origins.length) throw new Error('운영 서버의 허용 origin이 필요합니다.');
  const lobby = createRooms({ profiles });
  const editVoices = serveStatic ? createVoiceEditor({ root }) : null;
  const editMusic = serveStatic ? createMusicEditor({ root }) : null;
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (editVoices && await editVoices(req, res, path)) return;
      if (editMusic && await editMusic(req, res, path)) return;
      if (serveStatic && path === '/online-config.json') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ enabled: true, ...(cloudflareURL ? { identityScope: 'cloudflare-local-v1' } : {}) })); return; }
      if (path === '/health') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ status: 'ok', protocol: PROTOCOL, rulesVersion: RULES_VERSION, activeMatches: [...lobby.rooms.values()].filter(room => room.state && !room.finished).length })); return; }
      if (path === '/version.json') { const info = buildInfo(); res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ ...info, commit: process.env.RENDER_GIT_COMMIT ?? info.commit, protocol: PROTOCOL, rulesVersion: RULES_VERSION, activeMatches: [...lobby.rooms.values()].filter(room => room.state && !room.finished).length })); return; }
      if (!serveStatic) { res.writeHead(404); res.end('Not found'); return; }
      const requested = path === '/' ? '/index.html' : path;
      // 소스 트리 전체, .git, 문서, 생성 프롬프트 등은 공개하지 않는다.
      const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
      const localPreview = loopback && (
        /^\/skins\/[\w-]+\/sounds\/(?:music-review-v1\/(?:preview\.html|samples\/[\w-]+\.mp3)|temporary-bgm-v1\/[\w-]+\.mp3)$/.test(requested) ||
        /^\/skins\/[\w-]+\/story\.json$/.test(requested) ||
        /^\/sounds\/[\w-]+\/preview\.html$/.test(requested) ||
        /^\/skins\/[\w-]+\/drafts\/animation-v\d+\/preview\.html$/.test(requested) ||
        /^\/skins\/[\w-]+\/drafts\/story-roster-v\d+\/preview\.html$/.test(requested) ||
        /^\/skins\/[\w-]+\/story-preview\.html$/.test(requested) ||
        /^\/skins\/[\w-]+\/backgrounds\/preview\.html$/.test(requested) ||
        /^\/skins\/[\w-]+\/blocks\/(?:preview\.html|gameplay-check\.html|motion-replay\.js)$/.test(requested) ||
        /^\/skins\/[\w-]+\/sounds\/voice-[\w-]+\/(preview\.html|CREDITS\.md|(?:[\w-]+\/)*[\w.-]+\.wav)$/.test(requested)
      );
      // 게임에 실제 배정된 음성·음악만 다른 기기에도 제공한다. 검토본 전체를 공개하지 않는다.
      const voiceSkin = requested.match(/^\/skins\/([\w-]+)\/sounds\/[\w/.-]+\.(?:wav|mp3)$/)?.[1];
      let runtimeVoice = false;
      if (!localPreview && voiceSkin) {
        try {
          const manifest = JSON.parse(await readFile(resolve(root, 'skins', voiceSkin, 'manifest.json'), 'utf8'));
          const musicFiles = allMusicTracks(manifest.music).map(track => track.file);
          runtimeVoice = musicFiles.some((file) => file && `/skins/${voiceSkin}/${file}` === requested) || (manifest.characters ?? []).some((character) =>
            Object.values(character.voices ?? {}).some((files) => Array.isArray(files) &&
              files.some((file) => `/skins/${voiceSkin}/${file}` === requested)));
        } catch { /* 스킨이나 배정표가 없으면 제공하지 않는다. */ }
      }
      const publicRuntime = /^\/skins\/chiikawa\/pages-runtime\/(manifest\.json|characters\.json|assets\/[a-f0-9]{20}\.(png|webp|wav|mp3))$/.test(requested);
      if (!localPreview && !runtimeVoice && !publicRuntime && requested !== '/skins/chiikawa/story.json' && !/^\/(asset-worker\.js|online\.html|index\.html|style\.css|online\.css|src\/[\w/-]+\.(js|css)|skins\/[\w-]+\/(manifest\.json|characters\.json|[\w/-]+\.(png|webp))|sounds\/[\w/.-]+\.wav)$/.test(requested)) throw new Error('not public');
      const file = await realpath(resolve(root, '.' + requested));
      if (!file.startsWith(root + sep)) throw new Error('outside root');
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    let sameHost;
    try { sameHost = new URL(`http://${req.headers.host}`); }
    catch { socket.destroy(); return; }
    const localOrigins = [sameHost.origin, `https://${sameHost.host}`];
    const allowed = origins.length ? origins : localOrigins;
    const socketPath = new URL(req.url, 'http://localhost').pathname === '/socket';
    if (!socketPath || !allowed.includes(req.headers.origin) || wss.clients.size >= 200) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    if (cloudflareURL) {
      const backend = new URL(cloudflareURL);
      if (!serveStatic || backend.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(backend.hostname)) { socket.destroy(); return; }
      const localPath = new URL(req.url, 'http://localhost');
      const upstream = httpRequest(new URL(localPath.pathname + localPath.search, backend), { headers: { ...req.headers, host: backend.host, origin: 'http://127.0.0.1:5180' } });
      upstream.on('upgrade', (response, remote, remoteHead) => {
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${response.rawHeaders.reduce((out, value, i, headers) => i % 2 ? out : out + value + ': ' + headers[i + 1] + '\r\n', '')}\r\n`);
        if (head.length) remote.write(head);
        if (remoteHead.length) socket.write(remoteHead);
        remote.on('error', () => socket.destroy()); socket.on('error', () => remote.destroy());
        remote.on('close', () => socket.destroy()); socket.on('close', () => remote.destroy());
        socket.pipe(remote); remote.pipe(socket);
      });
      upstream.on('response', response => { socket.end(`HTTP/1.1 ${response.statusCode} Backend unavailable\r\nConnection: close\r\n\r\n`); response.resume(); });
      upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
      upstream.end(); return;
    }
    if (req.url !== '/socket') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });
  wss.on('connection', (ws) => {
    let count = 0;
    let period = Date.now();
    let alive = true;
    let lastAction = Date.now();
    const peer = { send(message) {
      if (ws.bufferedAmount > 65536) { ws.terminate(); return; }
      if (ws.readyState === 1) ws.send(JSON.stringify(message));
    } };
    ws.on('message', (data, binary) => {
      try {
        if (Date.now() - period >= 1000) { count = 0; period = Date.now(); }
        if (binary || ++count > 180) throw new Error('rate limit');
        const message = JSON.parse(data.toString());
        if (message?.type === 'hello' && (message.protocol !== PROTOCOL || message.rulesVersion !== RULES_VERSION)) {
          ws.send(JSON.stringify({ type: 'incompatible', reason: '게임과 서버 버전이 다릅니다. 새로고침 후에도 같으면 서버 업데이트를 기다려 주세요.' }));
          ws.close(1008, 'Version mismatch'); return;
        }
        lobby.handle(peer, message);
        // 관전자는 프레임 입력을 보내지 않는다. 정상 heartbeat를 유휴 종료로 취급하지 않는다.
        if (message.type !== 'ping' || peer.spectator) lastAction = Date.now();
      } catch { ws.close(1008, 'Invalid protocol'); }
    });
    ws.on('pong', () => { alive = true; });
    ws.on('error', () => {});
    ws.on('close', () => lobby.disconnect(peer));
    const timer = setInterval(() => {
      const idleLimit = peer.room?.state && !peer.room.finished ? 30000 : 600000;
      if (!alive || Date.now() - lastAction > idleLimit) { ws.terminate(); return; }
      alive = false;
      ws.ping();
    }, 10000);
    timer.unref();
    ws.on('close', () => clearInterval(timer));
  });
  const matchmaking = setInterval(() => { lobby.sweep(); lobby.matchmake(); }, 1000);
  matchmaking.unref();
  server.on('close', () => clearInterval(matchmaking));
  return { server, wss, lobby };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = runtimeConfig();
  const { server, wss } = createOnlineServer({ origins: config.origins, serveStatic: config.serveStatic, cloudflareURL: config.cloudflareURL, profiles: createProfileStore({ file: config.file }) });
  const { port, host } = config;
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    server.close();
    for (const client of wss.clients) client.close(1012, 'Server restarting');
    wss.close();
    setTimeout(() => process.exit(0), 5000).unref();
  });
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `포트 ${port}이 이미 사용 중입니다. 게임 서버는 한 번만 실행하세요.` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(`chii-drop: http://localhost:${port}/ (${config.serveStatic ? '게임 + 온라인 대전' : '온라인 서버 전용'})`);
    if (host === '0.0.0.0' || host === '::') {
      for (const entries of Object.values(networkInterfaces())) for (const entry of entries ?? []) {
        if (entry.family === 'IPv4' && !entry.internal) console.log(`다른 컴퓨터: http://${entry.address}:${port}/`);
      }
    }
  });
}
