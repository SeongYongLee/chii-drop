import { musicTracks } from '../src/audio/music-config.js';
import { withManifestLock } from './manifest-lock.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';


const local = (address) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const musicOf = manifest => manifest.music;
const revision = (music) => createHash('sha256').update(JSON.stringify(music)).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });

async function body(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw fail(415, 'JSON 형식으로 저장해 주세요.');
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 131072) throw fail(413, '배정표가 너무 큽니다.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks.map(c => Buffer.from(c))).toString()); }
  catch { throw fail(400, '배정표 형식을 읽지 못했습니다.'); }
}

async function validate(music, manifest, folder) {
  if (!music || typeof music !== 'object' || Array.isArray(music)) throw fail(400, '음악 배정표가 필요합니다.');
  const keys = Object.keys(manifest.music?.scenes ?? {}).sort();
  if (JSON.stringify(Object.keys(music.scenes ?? {}).sort()) !== JSON.stringify(keys)) throw fail(400, '현재 지원하는 사용 상황을 유지해 주세요.');
  const catalog = JSON.parse(await readFile(resolve(folder, 'sounds/music-review-v1/catalog.json'), 'utf8'));
  const allowed = new Set(catalog.tracks.map(t => t.file));
  for (const entry of [music, ...Object.values(music.scenes)]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw fail(400, '음악 목록 형식이 올바르지 않습니다.');
    if (Object.hasOwn(entry, 'tracks') && (!Array.isArray(entry.tracks) || entry.tracks.length > 32)) throw fail(400, '상황별 음악은 최대 32곡까지 선택할 수 있습니다.');
    const tracks = musicTracks(entry);
    if (entry === music && !tracks.length) throw fail(400, '기본 음악은 한 곡 이상 필요합니다.');
    if (new Set(tracks.map(t => t?.file)).size !== tracks.length) throw fail(400, '같은 상황에 중복된 곡이 있습니다.');
    if (entry.tracks?.length && entry.file && (entry.file !== tracks[0].file || entry.gain !== tracks[0].gain)) throw fail(400, '대표곡과 첫 번째 곡이 일치해야 합니다.');
    if (entry.tracks?.length === 0 && entry.file) throw fail(400, '빈 목록의 대표곡을 제거해 주세요.');
    for (const track of tracks) {
      if (!track || !allowed.has(track.file) || !/^sounds\/[\w/-]+\.(mp3|wav)$/.test(track.file) || track.file.split('/').includes('..') || !Number.isFinite(track.gain) || track.gain < 0 || track.gain > 1) throw fail(400, '검토 목록의 곡과 0~100% 음량만 배정할 수 있습니다.');
      let file;
      try { file = await realpath(resolve(folder, track.file)); } catch { throw fail(400, '음악 파일을 찾을 수 없습니다.'); }
      if (!file.startsWith(folder + sep) || !(await stat(file)).isFile()) throw fail(400, '음악 파일 경로가 올바르지 않습니다.');
    }
  }
}

async function atomic(path, text) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, text, { flag: 'wx' }); await rename(temp, path); }
  finally { await unlink(temp).catch(() => {}); }
}

// Only loopback, same-origin editing. No game simulation or random state changes.
export function createMusicEditor({ root }) {
  let pending = Promise.resolve();
  return async function handle(req, res, path) {
    const match = path.match(/^\/api\/local\/skins\/([\w-]+)\/music$/);
    if (!match) return false;
    const reply = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    try {
      let host;
      try { host = new URL(`http://${req.headers.host}`); } catch { throw fail(403, '로컬 페이지에서만 변경할 수 있습니다.'); }
      if (!local(req.socket.remoteAddress) || !['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)) throw fail(403, '로컬 페이지에서만 변경할 수 있습니다.');
      const origin = req.headers.origin;
      if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && ![host.origin, `https://${host.host}`].includes(origin))) throw fail(403, '같은 로컬 페이지에서만 변경할 수 있습니다.');
      if (!['GET', 'PUT', 'POST'].includes(req.method)) throw fail(405, '지원하지 않는 요청입니다.');
      if (req.method !== 'GET' && !origin) throw fail(403, '페이지에서 저장해 주세요.');
      const folder = await realpath(resolve(root, 'skins', match[1]));
      const skins = await realpath(resolve(root, 'skins'));
      if (!folder.startsWith(skins + sep)) throw fail(403, '스킨 경로가 올바르지 않습니다.');
      const manifestFile = resolve(folder, 'manifest.json');
      const history = resolve(folder, '.music-history');
      const latest = resolve(history, 'latest.json');
      const previous = async () => {
        try { return JSON.parse(await readFile(latest, 'utf8')); } catch { return null; }
      };
      if (req.method === 'GET') {
        const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
        const music = musicOf(manifest);
        const catalog = JSON.parse(await readFile(resolve(folder, 'sounds/music-review-v1/catalog.json'), 'utf8'));
        reply(200, { music, catalog, revision: revision(music), canRestore: !!(await previous()) });
        return true;
      }
      const input = await body(req);
      const operation = pending.then(() => withManifestLock(manifestFile, async () => {
        const text = await readFile(manifestFile, 'utf8');
        const manifest = JSON.parse(text);
        const before = musicOf(manifest);
        if (input.revision !== revision(before)) throw fail(409, '다른 곳에서 배정이 바뀌었습니다. 새로고침한 뒤 다시 변경해 주세요.');
        let next = input.music;
        if (req.method === 'POST') {
          if (input.action !== 'restore') throw fail(400, '지원하지 않는 작업입니다.');
          const backup = await previous();
          if (!backup) throw fail(400, '되돌릴 저장 기록이 없습니다.');
          next = backup.music;
        }
        await validate(next, manifest, folder);
        if (revision(next) === revision(before)) return { music: before, revision: revision(before), canRestore: !!(await previous()), unchanged: true };
        manifest.music = next;
        const backup = { savedAt: new Date().toISOString(), music: before, revision: revision(before), nextRevision: revision(next) };
        await mkdir(history, { recursive: true });
        // Detect concurrent edits outside this API before replacing the manifest.
        if (await readFile(manifestFile, 'utf8') !== text) throw fail(409, '게임 설정이 바뀌었습니다. 새로고침해 주세요.');
        await writeFile(resolve(history, `${Date.now()}-${randomUUID()}.json`), JSON.stringify(backup, null, 2) + '\n', { flag: 'wx' });
        await atomic(latest, JSON.stringify(backup, null, 2) + '\n');
        await atomic(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
        const music = musicOf(manifest);
        return { music, revision: revision(music), canRestore: true };
      }));
      pending = operation.catch(() => {});
      reply(200, await operation);
    } catch (error) {
      reply(error.status ?? 500, { error: error.status ? error.message : '배정표를 저장하지 못했습니다. 서버와 파일을 확인해 주세요.' });
    }
    return true;
  };
}
