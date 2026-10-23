import { execFileSync } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';

const root = process.cwd();
execFileSync(process.execPath, ['scripts/check-git-ready.mjs'], { stdio: 'inherit' });
const git = process.env.GIT_BIN || 'git';
const paths = execFileSync(git, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean);
await mkdir(resolve(root, 'artifacts'), { recursive: true });
const folder = await mkdtemp(resolve(root, 'artifacts', 'source-'));
let count = 0;
for (const path of new Set(paths)) {
  let info;
  try { info = await lstat(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  if (info.isSymbolicLink()) throw new Error(`소스 패키지의 심볼릭 링크를 먼저 검토하세요: ${path}`);
  if (!info.isFile()) continue;
  const target = resolve(folder, path);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(path, target); count++;
}
const archive = `${folder}.tar.gz`;
execFileSync('tar', ['-czf', archive, '-C', dirname(folder), basename(folder)]);
console.log(`Git 이력·의존성·로컬 자료를 제외한 ${count}개 파일`);
console.log(`폴더: ${folder}`);
console.log(`압축본: ${archive}`);
