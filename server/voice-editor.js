import { withManifestLock } from './manifest-lock.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const EVENTS = new Set(['select', 'damage', 'win', 'lose', ...Array.from({ length: 7 }, (_, i) => `chain${i + 1}`)]);
const local = (address) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const voicesOf = (manifest) => Object.fromEntries(manifest.characters.filter(c => c.voices).map(c => [c.id, c.voices]));
const revision = (voices) => createHash('sha256').update(JSON.stringify(voices)).digest('hex');
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

async function validate(voices, manifest, folder) {
  if (!voices || typeof voices !== 'object' || Array.isArray(voices)) throw fail(400, '음성 배정표가 필요합니다.');
  const known = new Set(manifest.characters.map(c => c.id));
  for (const [charId, events] of Object.entries(voices)) {
    if (!known.has(charId) || !events || typeof events !== 'object' || Array.isArray(events)) throw fail(400, '캐릭터 배정이 올바르지 않습니다.');
    for (const [event, files] of Object.entries(events)) {
      if (!EVENTS.has(event) || !Array.isArray(files) || files.length > 16 || new Set(files).size !== files.length) throw fail(400, '사용 상황이나 음성 목록이 올바르지 않습니다.');
      for (const file of files) {
        if (typeof file !== 'string' || !/^sounds\/voice-[\w-]+\/(?:[\w-]+\/)*[\w.-]+\.wav$/.test(file) || file.split('/').includes('..')) throw fail(400, '검토한 음성 WAV만 배정할 수 있습니다.');
        let path;
        try { path = await realpath(resolve(folder, file)); }
        catch { throw fail(400, '음성 파일을 찾을 수 없습니다.'); }
        if (!path.startsWith(folder + sep) || !(await stat(path)).isFile()) throw fail(400, '음성 파일 경로가 올바르지 않습니다.');
      }
    }
  }
}

async function atomic(path, text) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, text, { flag: 'wx' }); await rename(temp, path); }
  finally { await unlink(temp).catch(() => {}); }
}

// Only loopback, same-origin editing. No game simulation or random state changes.
export function createVoiceEditor({ root }) {
  let pending = Promise.resolve();
  return async function handle(req, res, path) {
    const match = path.match(/^\/api\/local\/skins\/([\w-]+)\/voices$/);
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
      const history = resolve(folder, '.voice-history');
      const latest = resolve(history, 'latest.json');
      const previous = async () => {
        try { return JSON.parse(await readFile(latest, 'utf8')); } catch { return null; }
      };
      if (req.method === 'GET') {
        const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
        const voices = voicesOf(manifest);
        reply(200, { voices, revision: revision(voices), canRestore: !!(await previous()) });
        return true;
      }
      const input = await body(req);
      const operation = pending.then(() => withManifestLock(manifestFile, async () => {
        const text = await readFile(manifestFile, 'utf8');
        const manifest = JSON.parse(text);
        const before = voicesOf(manifest);
        if (input.revision !== revision(before)) throw fail(409, '다른 곳에서 배정이 바뀌었습니다. 새로고침한 뒤 다시 변경해 주세요.');
        let next = input.voices;
        if (req.method === 'POST') {
          if (input.action !== 'restore') throw fail(400, '지원하지 않는 작업입니다.');
          const backup = await previous();
          if (!backup) throw fail(400, '되돌릴 저장 기록이 없습니다.');
          next = backup.voices;
        }
        await validate(next, manifest, folder);
        if (revision(next) === revision(before)) return { voices: before, revision: revision(before), canRestore: !!(await previous()), unchanged: true };
        for (const character of manifest.characters) {
          if (Object.hasOwn(next, character.id)) character.voices = next[character.id];
          else delete character.voices;
        }
        const backup = { savedAt: new Date().toISOString(), voices: before, revision: revision(before), nextRevision: revision(next) };
        await mkdir(history, { recursive: true });
        // Detect concurrent edits outside this API before replacing the manifest.
        if (await readFile(manifestFile, 'utf8') !== text) throw fail(409, '게임 설정이 바뀌었습니다. 새로고침해 주세요.');
        await writeFile(resolve(history, `${Date.now()}-${randomUUID()}.json`), JSON.stringify(backup, null, 2) + '\n', { flag: 'wx' });
        await atomic(latest, JSON.stringify(backup, null, 2) + '\n');
        await atomic(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
        const voices = voicesOf(manifest);
        return { voices, revision: revision(voices), canRestore: true };
      }));
      pending = operation.catch(() => {});
      reply(200, await operation);
    } catch (error) {
      reply(error.status ?? 500, { error: error.status ? error.message : '배정표를 저장하지 못했습니다. 서버와 파일을 확인해 주세요.' });
    }
    return true;
  };
}
