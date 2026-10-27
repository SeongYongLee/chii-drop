import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runtimePaths, RUNTIME, STORY } from './pages/assets.mjs';
import { buildInfo } from './build-info.mjs';
import { parseOnlineConfig } from '../src/net/config.js';

export async function checkBuild() {
  async function walk(root) {
    const paths = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = `${root}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`심볼릭 링크는 배포하지 않습니다: ${path}`);
      if (entry.isDirectory()) paths.push(...await walk(path)); else paths.push(path);
    }
    return paths;
  }
  const manifest = JSON.parse(await readFile(`${RUNTIME}/manifest.json`, 'utf8'));
  parseOnlineConfig(JSON.parse(await readFile('online-config.json', 'utf8')), 'https://pages.example/game/');
  const expected = ['index.html','style.css','online.html','online.css','README.md','asset-worker.js','online-config.json', STORY,
    `${RUNTIME}/manifest.json`,`${RUNTIME}/characters.json`,`${RUNTIME}/favicon.svg`,
    ...[...runtimePaths(manifest)].map(path => `${RUNTIME}/${path}`),
    ...(await walk('src')).filter(path => !/\.md$/i.test(path))];
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  for (const path of expected) {
    if (hash(await readFile(path)) !== hash(await readFile(`dist/${path}`))) throw new Error(`작업 코드와 배포 파일이 다릅니다: ${path}`);
  }
  const actual = (await walk('dist')).map(path => path.slice(5)).sort();
  const allowed = [...expected, '.nojekyll', 'version.json'].sort();
  if (JSON.stringify(actual) !== JSON.stringify(allowed)) throw new Error('배포본에 누락되거나 허용하지 않은 파일이 있습니다.');
  if (JSON.stringify(JSON.parse(await readFile('dist/version.json', 'utf8'))) !== JSON.stringify(buildInfo())) throw new Error('빌드 버전이 현재 소스와 다릅니다. 다시 빌드하세요.');
  console.log(`개발·배포 동일성 검사 통과: ${actual.length}개 파일, 동일한 코드·실행 팩·대본`);
}
if (process.argv[1]?.endsWith('/check-build.mjs')) await checkBuild();
