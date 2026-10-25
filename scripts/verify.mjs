import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const run = args => execFileSync(process.execPath, args, { stdio: 'inherit', env: {
  ...process.env, WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH ?? '.wrangler/verify.log', WRANGLER_SEND_METRICS: 'false',
} });
run(['scripts/check-git-ready.mjs']);
const tests = (await readdir('test')).filter(path => path.endsWith('.test.js')).sort().map(path => `test/${path}`);
run(['--test', '--test-concurrency=1', ...tests]);
run(['test/cloudflare-runtime.mjs']);
run(['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--outdir', '.wrangler/dry-run']);
run(['scripts/build-pages.mjs']);
run(['scripts/check-build.mjs']);
