import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function buildInfo(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const git = process.env.GIT_BIN || 'git';
  let commit = null, dirty = true;
  try {
    commit = execFileSync(git, ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim();
    dirty = Boolean(execFileSync(git, ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim());
  } catch { /* Git 없는 소스 패키지에서는 버전만 표시한다. */ }
  function modulesAt(path = 'src') {
    return readdirSync(resolve(root, path), { withFileTypes: true }).flatMap(entry => {
      const file = `${path}/${entry.name}`;
      return entry.isDirectory() ? modulesAt(file) : entry.isFile() && file.endsWith('.js') ? [file] : [];
    }).sort();
  }
  return { version, commit, dirty, deployment: process.env.ANALYTICS_ENV === 'production' ? 'production' : 'development', modules: modulesAt() };
}
