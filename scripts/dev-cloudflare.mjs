import { spawn } from 'node:child_process';

// 외부 브라우저에는 기존 5180 포트만 노출한다. workerd는 loopback에서만 동작한다.
const env = { ...process.env, WRANGLER_LOG_PATH: '.wrangler/dev.log', WRANGLER_SEND_METRICS: 'false' };
const backend = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--port', '8787',
  '--var', 'ALLOWED_ORIGINS:http://127.0.0.1:5180'], { env, stdio: 'inherit' });
const frontend = spawn(process.execPath, ['server/index.js'], { env: { ...env, LOCAL_CLOUDFLARE_URL: 'http://127.0.0.1:8787' }, stdio: 'inherit' });
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; backend.kill('SIGTERM'); frontend.kill('SIGTERM'); process.exitCode = code; }
for (const child of [backend, frontend]) {
  child.on('exit', code => stop(code ?? 0));
  child.on('error', error => { console.error(error.message); stop(1); });
}
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
