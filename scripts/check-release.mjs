import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export function validateReleaseTag(tag, version) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || tag !== `v${version}`) throw new Error('배포 태그는 package.json 버전과 일치하는 vX.Y.Z여야 합니다.');
}
if (process.argv[1]?.endsWith('/check-release.mjs')) {
  const ref = process.env.RELEASE_REF ?? '';
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  validateReleaseTag(ref, version);
  const git = process.env.GIT_BIN || 'git';
  const sha = args => execFileSync(git, args, { encoding: 'utf8' }).trim();
  const head = sha(['rev-parse','HEAD']);
  if (sha(['rev-parse',`refs/tags/${ref}^{commit}`]) !== head) throw new Error('체크아웃한 커밋과 배포 태그가 다릅니다.');
  execFileSync(git,['merge-base','--is-ancestor',head,'origin/main']);
  if (sha(['status','--porcelain','--untracked-files=normal'])) throw new Error('수정 중인 소스는 정식 배포할 수 없습니다.');
  console.log(`정식 배포 검증 통과: ${ref} (${head})`);
}
