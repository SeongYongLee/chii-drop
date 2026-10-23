import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const run = args => execFileSync(process.execPath, args, { stdio: 'inherit' });
run(['scripts/check-git-ready.mjs']);
const tests = (await readdir('test')).filter(path => path.endsWith('.test.js')).sort().map(path => `test/${path}`);
run(['--test', '--test-concurrency=1', ...tests]);
run(['scripts/build-pages.mjs']);
run(['scripts/check-build.mjs']);
