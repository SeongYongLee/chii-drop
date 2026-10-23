import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runtimePaths, safeFile, validateCharacterInfo, RUNTIME } from './pages/assets.mjs';

export async function buildPages(output = 'dist') {
  // 고정된 출력 폴더만 지우며 원본 스킨에는 손대지 않는다.
  if (resolve(output) !== resolve('dist')) throw new Error('배포 출력 경로는 dist만 허용합니다.');
  const manifest = JSON.parse(await readFile(`${RUNTIME}/manifest.json`, 'utf8').catch(() => { throw new Error('Pages 이미지 팩이 없습니다. pnpm prepare:pages-assets를 먼저 실행하세요.'); }));
  if (manifest.characters.some(character => character.selectionVisible === false)) throw new Error('공개 매니페스트에 스토리 전용 캐릭터가 포함되어 있습니다.');
  validateCharacterInfo(JSON.parse(await readFile(`${RUNTIME}/characters.json`, 'utf8')), manifest);
  for (const path of runtimePaths(manifest)) await safeFile(RUNTIME, path);
  await rm(output, { recursive: true, force: true });
  await mkdir(`${output}/skins/chiikawa`, { recursive: true });
  for (const path of ['index.html','style.css','README.md']) await cp(path, `${output}/${path}`);
  // src 아래에 로컬 개발 문서가 생겨도 사이트에는 복사하지 않는다.
  await cp('src', `${output}/src`, { recursive: true, filter: (path) => !/\.md$/i.test(path) });
  for (const path of ['manifest.json','characters.json']) await cp(`${RUNTIME}/${path}`, `${output}/skins/chiikawa/${path}`);
  for (const path of runtimePaths(manifest)) { await mkdir(resolve(output,'skins/chiikawa',path,'..'), { recursive: true }); await cp(`${RUNTIME}/${path}`,`${output}/skins/chiikawa/${path}`); }
  await cp('scripts/pages/foley-bank.js', `${output}/src/audio/foley-bank.js`);
  await cp('scripts/pages/online.html', `${output}/online.html`);
  await writeFile(`${output}/.nojekyll`, '');
  console.log('dist/: GitHub Pages 배포본 생성 완료 (싱글·로컬 대전, 캐릭터 음성·배경음악·합성 효과음)');
}
if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/build-pages.mjs')) await buildPages();
