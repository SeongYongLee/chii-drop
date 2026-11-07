import { Buffer } from 'node:buffer';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { FEEDBACK_CATEGORIES, FEEDBACK_LIMIT } from '../src/feedback-fields.js';

export const FEEDBACK_BODY_LIMIT = 8192;
const PAGE_SIZE = 30;
const FEEDBACK_ID = /^[0-9a-f]{32}$/;

export function createFeedbackStore(exec) {
  exec(`CREATE TABLE IF NOT EXISTS feedback (
    seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, category TEXT NOT NULL, message TEXT NOT NULL,
    version TEXT, width INTEGER, height INTEGER, received_at INTEGER NOT NULL
  )`);
  exec('CREATE INDEX IF NOT EXISTS feedback_received ON feedback(received_at)');
  return {
    save(entry) {
      const previous = exec('SELECT category, message, version, width, height FROM feedback WHERE id = ?', entry.id)[0];
      const { category, message, diagnostics } = entry;
      const values = [category, message, diagnostics?.version ?? null, diagnostics?.width ?? null, diagnostics?.height ?? null];
      if (previous) {
        const { category, message, version, width, height } = previous;
        const same = [category, message, version, width, height].every((value, i) => value === values[i]);
        return { status: same ? 201 : 409, inserted: false };
      }
      const now = Date.now();
      // 익명 접수량만 제한한다. 네트워크 주소나 계정은 저장하지 않는다.
      const counts = exec(`SELECT COUNT(*) AS daily, COUNT(CASE WHEN received_at > ? THEN 1 END) AS recent
        FROM feedback WHERE received_at > ?`, now - 60_000, now - 86_400_000)[0];
      if (counts.recent >= 30 || counts.daily >= 200) return { status: 429, inserted: false };
      exec('INSERT INTO feedback (id, category, message, version, width, height, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)', entry.id, ...values, now);
      return { status: 201, inserted: true };
    },
    list(before) {
      return exec(`SELECT seq, id, category, message, version, width, height, received_at FROM feedback
        WHERE seq < ? ORDER BY seq DESC LIMIT ?`, before, PAGE_SIZE + 1);
    },
    remove(id) { exec('DELETE FROM feedback WHERE id = ?', id); },
  };
}

async function readEntry(request) {
  if (!request.body || Number(request.headers.get('content-length')) > FEEDBACK_BODY_LIMIT) return null;
  const reader = request.body.getReader();
  const bytes = new Uint8Array(FEEDBACK_BODY_LIMIT);
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (size + value.byteLength > bytes.length) { await reader.cancel(); return null; }
      bytes.set(value, size);
      size += value.byteLength;
    }
    const { id, category, message, diagnostics } = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
    if (typeof id !== 'string' || !FEEDBACK_ID.test(id) || typeof category !== 'string' || !Object.hasOwn(FEEDBACK_CATEGORIES, category)
      || typeof message !== 'string' || !message.trim() || message.length > FEEDBACK_LIMIT) return null;
    let context;
    if (diagnostics !== undefined) {
      if (!diagnostics || typeof diagnostics.version !== 'string' || diagnostics.version.length > 100
        || ![diagnostics.width, diagnostics.height].every(value => Number.isInteger(value) && value > 0 && value <= 32768)) return null;
      const { version, width, height } = diagnostics;
      context = { version, width, height };
    }
    return { id, category, message: message.trim(), diagnostics: context };
  } catch { return null; }
  finally { reader.releaseLock(); }
}

const secureHeaders = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};
const escapeHtml = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' });
function inboxMarkup(rows, before, nonce) {
  const next = rows.length > PAGE_SIZE;
  const visible = rows.slice(0, PAGE_SIZE);
  const entries = visible.map(row => `<article>
    <header><strong>${escapeHtml(FEEDBACK_CATEGORIES[row.category])}</strong> · <time datetime="${new Date(row.received_at).toISOString()}">${dateFormat.format(row.received_at)}</time></header>
    <p>${escapeHtml(row.message)}</p>
    ${row.version !== null ? `<small>${escapeHtml(row.version)} · ${row.width}×${row.height}</small>` : ''}
    <form method="post" action="?delete=${row.id}${before < Number.MAX_SAFE_INTEGER ? `&amp;before=${before}` : ''}">
      <button type="submit" aria-label="의견 삭제" disabled>삭제</button>
    </form>
  </article>`).join('');
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>의견 접수함</title><style>
    body{max-width:720px;margin:32px auto;padding:0 16px;background:#fff8ee;color:#594a40;font:16px/1.5 system-ui,sans-serif}
    h1{margin-bottom:4px} article{background:#fffdf7;border:1px solid #d6c3a9;border-radius:16px;margin:12px 0;padding:16px}
    article p{white-space:pre-wrap;overflow-wrap:anywhere}small,time{color:#736051}nav{display:flex;gap:20px}a{color:#873951}
    article form{display:flex;justify-content:flex-end;margin-top:8px}
    article button{min-height:44px;padding:0 14px;border:1px solid #c8949e;border-radius:10px;background:#fff1f3;color:#873951;font:inherit;cursor:pointer}
    </style><main><h1>의견 접수함</h1><small>접수 시각은 한국 시간으로 표시돼요.</small>
    ${entries || '<p>접수된 의견이 없어요.</p>'}
    <nav aria-label="접수함 페이지">${before < Number.MAX_SAFE_INTEGER ? '<a href="?">최신 의견</a>' : ''}
    ${next ? `<a href="?before=${visible.at(-1).seq}">이전 의견 더 보기</a>` : ''}</nav></main>
    <script nonce="${nonce}">
      for (const form of document.querySelectorAll('article form')) {
        form.addEventListener('submit', event => {
          if (!window.confirm('이 의견을 삭제할까요? 삭제한 의견은 되돌릴 수 없어요.')) event.preventDefault();
        });
        form.querySelector('button').disabled = false;
      }
    </script></html>`;
}

function validAuthorization(request, password) {
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Basic ') || header.length > 1024) return false;
  const hash = value => createHash('sha256').update(value).digest();
  try {
    return timingSafeEqual(hash(Buffer.from(header.slice(6), 'base64')), hash(`operator:${password}`));
  } catch { return false; }
}

export async function handleFeedback(request, { origins, store, password, inboxAllowed = true, onAccepted }) {
  const url = new URL(request.url);
  if (url.pathname === '/feedback/inbox') {
    if (!inboxAllowed || typeof password !== 'string' || password.length < 24) return new Response(null, { status: 404, headers: secureHeaders });
    if (request.method !== 'GET' && request.method !== 'POST') return new Response(null, { status: 405, headers: { ...secureHeaders, Allow: 'GET, POST' } });
    if (!validAuthorization(request, password)) return new Response('운영자 인증이 필요합니다.', { status: 401,
      headers: { ...secureHeaders, 'WWW-Authenticate': 'Basic realm="Feedback inbox", charset="UTF-8"' } });
    const cursor = Number(url.searchParams.get('before'));
    const before = Number.isSafeInteger(cursor) && cursor > 0 ? cursor : Number.MAX_SAFE_INTEGER;
    try {
      if (request.method === 'POST') {
        if (request.headers.get('origin') !== url.origin) return new Response(null, { status: 403, headers: secureHeaders });
        const id = url.searchParams.get('delete');
        if (!FEEDBACK_ID.test(id ?? '')) return new Response(null, { status: 400, headers: secureHeaders });
        await store.remove(id);
        const location = '/feedback/inbox' + (before < Number.MAX_SAFE_INTEGER ? `?before=${before}` : '');
        return new Response(null, { status: 303, headers: { ...secureHeaders, Location: location } });
      }
      const nonce = randomBytes(16).toString('base64');
      const headers = { ...secureHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'same-origin',
        'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'` };
      return new Response(inboxMarkup(await store.list(before), before, nonce), { headers });
    } catch { return new Response(null, { status: 503, headers: secureHeaders }); }
  }
  const origin = request.headers.get('origin');
  if (!origin || !origins.includes(origin)) return new Response(null, { status: 403, headers: secureHeaders });
  const headers = { ...secureHeaders, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204,
    headers: { ...headers, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...headers, Allow: 'POST, OPTIONS' } });
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return new Response(null, { status: 415, headers });
  const entry = await readEntry(request);
  if (!entry) return new Response(null, { status: 400, headers });
  let result;
  try { result = await store.save(entry); }
  catch { return new Response(null, { status: 503, headers }); }
  if (result.inserted) onAccepted?.(entry);
  return new Response(null, { status: result.status, headers });
}
