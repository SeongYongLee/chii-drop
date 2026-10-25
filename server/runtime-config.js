import { isAbsolute, resolve } from 'node:path';

export function runtimeConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const origins = (env.ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  for (const value of origins) {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.origin !== value || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) {
      throw new Error('ALLOWED_ORIGINS에는 경로 없는 HTTPS origin을 입력하세요.');
    }
  }
  if (production && (!origins.length || !env.ONLINE_DATA_FILE || !isAbsolute(env.ONLINE_DATA_FILE))) {
    throw new Error('운영 서버에는 ALLOWED_ORIGINS와 영구 디스크의 절대 경로 ONLINE_DATA_FILE이 필요합니다.');
  }
  const port = Number(env.PORT ?? 5180);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT가 올바르지 않습니다.');
  if (env.LOCAL_CLOUDFLARE_URL) {
    const backend = new URL(env.LOCAL_CLOUDFLARE_URL);
    if (production || backend.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(backend.hostname)
      || backend.username || backend.password || backend.pathname !== '/' || backend.search || backend.hash) throw new Error('로컬 Cloudflare 주소는 개발용 loopback HTTP 주소여야 합니다.');
  }
  return { origins, serveStatic: !production, cloudflareURL: env.LOCAL_CLOUDFLARE_URL, file: env.ONLINE_DATA_FILE ?? resolve('data/online.json'),
    port, host: env.HOST ?? '0.0.0.0' };
}
