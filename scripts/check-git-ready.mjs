// 커밋된 파일과 아직 추가하지 않은 파일을 함께 검사한다. 파일 내용은 출력하지 않는다.
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';

const git = process.env.GIT_BIN || 'git';
function list(args) {
  try { return execFileSync(git, ['ls-files', '-z', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\0').filter(Boolean); }
  catch { console.error('Git을 실행할 수 없습니다. Git 설치를 확인하거나 GIT_BIN에 실행 경로를 지정하세요.'); process.exit(1); }
}
const paths = [...new Set(list(['--cached', '--others', '--exclude-standard']))].sort();
const issues = list(['--cached', '--ignored', '--exclude-standard']).map(path => `이미 추적 중인 제외 파일: ${path}`);
const privatePath = /^(?:data|node_modules|\.git|\.codex|\.agents|\.pnpm-store)(?:\/|$)|^skins\/chiikawa(?:\/|$)(?!pages-runtime\/)|^(?:AGENTS\.md|README\.local\.md|docs\/classic-rules\.md)$|(?:^|\/)\.env(?!\.example$)(?:\.|$)|\.(?:pem|key|p12|pfx)$/i;
const audio = /^sounds\/.*\.(?:wav|mp3|ogg|flac|m4a)$/i;
const secret = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/;
let count = 0, bytes = 0;
for (const path of paths) {
  let info;
  try { info = await stat(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  if (!info.isFile()) continue;
  count++; bytes += info.size;
  if (/(?:^|\/)story\.json$/i.test(path)) issues.push(`로컬 전용 스토리 대본이 포함됨: ${path}`);
  if (/^sounds\/.*\/preview\.html$/i.test(path)) issues.push(`로컬 사운드 검토 페이지가 포함됨: ${path}`);
  if (/\.md$/i.test(path) && path !== 'README.md') issues.push(`루트 README 외 Markdown이 포함됨: ${path}`);
  if (privatePath.test(path) || audio.test(path)) issues.push(`로컬 전용 자료가 포함됨: ${path}`);
  if (info.size > 5 * 1024 * 1024) issues.push(`5MB 초과 파일을 검토하세요: ${path}`);
  if (/\.(?:[cm]?js|json|html|css|md|ya?ml|py|toml|txt)$/.test(path) || path === '.env.example') {
    const content = await readFile(path, 'utf8');
    if (secret.test(content)) issues.push(`인증 정보 형식이 발견됨: ${path}`);
    if (/\.json$/i.test(path)) {
      try {
        const data = JSON.parse(content);
        if (data?.scenes && Object.values(data.scenes).some(scene => Array.isArray(scene))) {
          issues.push(`스토리 장면 데이터가 포함됨: ${path}`);
        }
        if (/^skins\/[\w-]+\/pages-runtime\/characters\.json$/.test(path)) {
          const { validateCharacterInfo } = await import('./pages/assets.mjs');
          const manifest = JSON.parse(await readFile(path.replace(/characters\.json$/, 'manifest.json'), 'utf8'));
          validateCharacterInfo(data, manifest);
        }
      } catch (error) { issues.push(`JSON 배포 검사 실패: ${path} (${error.message})`); }
    }
  }
}
console.log(`Git 포함 후보: ${count}개, ${(bytes / 1024 / 1024).toFixed(2)}MB`);
if (issues.length) { issues.forEach(issue => console.error(issue)); process.exitCode = 1; }
else console.log('로컬 전용 경로·큰 파일·알려진 비밀 키 형식 검사 통과 (전체 보안 감사를 대신하지 않음)');
