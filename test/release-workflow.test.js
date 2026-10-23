import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateReleaseTag } from '../scripts/check-release.mjs';

test('정식 배포는 버전과 일치하는 안정 태그만 허용한다', () => {
  assert.doesNotThrow(() => validateReleaseTag('v1.0.0','1.0.0'));
  for (const tag of ['main','v1.0.0-rc.1','v2.0.0','v1.0.0; echo bad','refs/tags/v1.0.0']) assert.throws(() => validateReleaseTag(tag,'1.0.0'));
});

test('태그·실제 커밋·main 이력·깨끗한 작업 트리가 모두 일치해야 배포한다', async t => {
  const folder = await mkdtemp(join(tmpdir(),'release-workflow-'));
  t.after(() => rm(folder,{recursive:true,force:true}));
  const git = process.env.GIT_BIN || 'git', options = {cwd:folder,encoding:'utf8',stdio:['ignore','pipe','pipe']};
  const run = args => execFileSync(git,args,options).trim();
  const check = ref => execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/check-release.mjs',import.meta.url))],
    {...options,env:{...process.env,GIT_BIN:git,RELEASE_REF:ref}});
  run(['init','--quiet']);run(['config','user.name','Release Test']);run(['config','user.email','test@example.invalid']);
  await writeFile(join(folder,'package.json'),JSON.stringify({version:'1.0.0'}));
  run(['add','.']);run(['commit','--quiet','-m','Base']);run(['update-ref','refs/remotes/origin/main','HEAD']);run(['tag','v1.0.0']);
  assert.match(check('v1.0.0'),/정식 배포 검증 통과/);
  await writeFile(join(folder,'package.json'),JSON.stringify({version:'1.0.0',modified:true}));
  assert.throws(()=>check('v1.0.0'));
  await writeFile(join(folder,'package.json'),JSON.stringify({version:'1.0.1'}));
  run(['add','.']);run(['commit','--quiet','-m','Unmerged']);run(['tag','v1.0.1']);
  assert.throws(()=>check('v1.0.1')); // main에 없는 커밋은 태그가 올바르더라도 공개하지 않는다.
});

test('main·PR은 검사만 수행하고 Pages는 태그·명시한 태그로만 같은 verify를 실행한다', async () => {
  const ci = await readFile('.github/workflows/ci.yml','utf8'), deploy = await readFile('.github/workflows/pages.yml','utf8');
  assert.match(ci,/branches: \[main\]/); assert.match(ci,/pull_request:/); assert.match(ci,/pnpm verify/);
  assert.ok(!ci.includes('actions/deploy-pages'));
  assert.match(deploy,/tags: \['v\*'\]/); assert.ok(!deploy.includes('branches: [main]'));
  assert.match(deploy,/release_ref:/);assert.match(deploy,/pnpm check:release/);assert.match(deploy,/pnpm verify/);
});

test('개발 배포는 main에서 명시한 커밋만 검증하고 태그를 만들지 않는다', async () => {
  const deploy = await readFile('.github/workflows/development-pages.yml','utf8');
  assert.match(deploy,/workflow_dispatch:/);
  assert.ok(!/^  push:/m.test(deploy));
  assert.match(deploy,/github.ref == 'refs\/heads\/main'/);
  assert.match(deploy,/\^\[a-f0-9\]\{40\}\$/);
  assert.match(deploy,/git merge-base --is-ancestor HEAD origin\/main/);
  assert.match(deploy,/pnpm verify/);
  assert.match(deploy,/group: github-pages/);
  assert.ok(!deploy.includes('git tag') && !deploy.includes('gh release'));
});
