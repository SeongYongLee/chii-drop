import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('업로드 검사는 루트 README만 허용하며 이미 추적된 하위 Markdown도 차단한다', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'release-documents-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const git = process.env.GIT_BIN || 'git';
  const options = { cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  const check = () => execFileSync(process.execPath,
    [fileURLToPath(new URL('../scripts/check-git-ready.mjs', import.meta.url))],
    { ...options, env: { ...process.env, GIT_BIN: git } });
  execFileSync(git, ['init', '--quiet'], options);
  await writeFile(join(folder, 'README.md'), 'Public rights and credits');
  execFileSync(git, ['add', 'README.md'], options);
  assert.match(check(), /검사 통과/);
  await mkdir(join(folder, 'docs'));
  await writeFile(join(folder, 'docs/README.MD'), 'Local development notes');
  execFileSync(git, ['add', 'docs/README.MD'], options);
  assert.throws(check, (error) => error.status === 1
    && error.stderr.includes('루트 README 외 Markdown이 포함됨: docs/README.MD'));
  await writeFile(join(folder, '.gitignore'), '*.[mM][dD]\n!/README.md\n');
  assert.throws(check, (error) => error.status === 1
    && error.stderr.includes('이미 추적 중인 제외 파일: docs/README.MD'));
  execFileSync(git, ['rm', '--cached', 'docs/README.MD'], options);
  assert.match(check(), /검사 통과/);
  const privateScript = { characters: {}, scenes: { opening: [{ text: 'private dialogue' }] } };
  await writeFile(join(folder,'renamed-data.json'),JSON.stringify(privateScript));
  assert.throws(check,(error)=>error.status===1 && error.stderr.includes('스토리 장면 데이터가 포함됨: renamed-data.json'));
  await rm(join(folder,'renamed-data.json'));
  await mkdir(join(folder,'sounds/review'),{recursive:true});
  await writeFile(join(folder,'sounds/review/preview.html'),'Local sound review');
  assert.throws(check,(error)=>error.status===1 && error.stderr.includes('로컬 사운드 검토 페이지가 포함됨: sounds/review/preview.html'));
  await rm(join(folder,'sounds/review/preview.html'));
  await mkdir(join(folder,'skins/chiikawa/pages-runtime'),{recursive:true});
  await writeFile(join(folder,'skins/chiikawa/pages-runtime/manifest.json'),JSON.stringify({characters:[{id:'actor',name:'Actor'}]}));
  await writeFile(join(folder,'skins/chiikawa/story.json'),JSON.stringify({characters:{actor:{charId:'actor'}},scenes:{opening:[]}}));
  assert.match(check(),/검사 통과/);
  await writeFile(join(folder,'story.json'),JSON.stringify(privateScript));
  execFileSync(git,['add','story.json'],options);
  assert.throws(check,(error)=>error.status===1 && error.stderr.includes('허용 경로 밖의 스토리 대본이 포함됨: story.json'));
});
