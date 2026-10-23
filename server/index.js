import { allMusicTracks } from '../src/audio/music-config.js';
import { createServer } from 'node:http';
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.md': 'text/plain; charset=utf-8' };

export function createOnlineServer({ origins = [], profiles = createProfileStore() } = {}) {
  const lobby = createRooms({ profiles });
  const editVoices = createVoiceEditor({ root });
  const editMusic = createMusicEditor({ root });
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (await editVoices(req, res, path)) return;
      if (await editMusic(req, res, path)) return;
      if (path === '/health') { res.writeHead(200); res.end('ok'); return; }
      if (path === '/version.json') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(buildInfo())); return; }
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
      if (!localPreview && !runtimeVoice && !publicRuntime && requested !== '/skins/chiikawa/story.json' && !/^\/(asset-worker\.js|online\.html|index\.html|style\.css|online\.css|src\/[\w/-]+\.js|skins\/[\w-]+\/(manifest\.json|characters\.json|[\w/-]+\.(png|webp))|sounds\/[\w/.-]+\.wav)$/.test(requested)) throw new Error('not public');
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
    if (req.url !== '/socket' || !allowed.includes(req.headers.origin) || wss.clients.size >= 200) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
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
        lobby.handle(peer, message);
        if (message.type !== 'ping') lastAction = Date.now();
      } catch { ws.close(1008, 'Invalid protocol'); }
    });
    ws.on('pong', () => { alive = true; });
    ws.on('error', () => {});
    ws.on('close', () => lobby.leave(peer));
    const timer = setInterval(() => {
      const idleLimit = peer.room?.state && !peer.room.finished ? 30000 : 600000;
      if (!alive || Date.now() - lastAction > idleLimit) { ws.terminate(); return; }
      alive = false;
      ws.ping();
    }, 10000);
    timer.unref();
    ws.on('close', () => clearInterval(timer));
  });
  const matchmaking = setInterval(() => lobby.matchmake(), 1000);
  matchmaking.unref();
  server.on('close', () => clearInterval(matchmaking));
  return { server, wss, lobby };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { server } = createOnlineServer({ origins: (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean), profiles: createProfileStore({ file: process.env.ONLINE_DATA_FILE ?? resolve(root, 'data/online.json') }) });
  const port = Number(process.env.PORT ?? 5180);
  const host = process.env.HOST ?? '0.0.0.0';
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `포트 ${port}이 이미 사용 중입니다. 게임 서버는 한 번만 실행하세요.` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(`chii-drop: http://localhost:${port}/ (게임 + 온라인 대전)`);
    if (host === '0.0.0.0' || host === '::') {
      for (const entries of Object.values(networkInterfaces())) for (const entry of entries ?? []) {
        if (entry.family === 'IPv4' && !entry.internal) console.log(`다른 컴퓨터: http://${entry.address}:${port}/`);
      }
    }
  });
}
