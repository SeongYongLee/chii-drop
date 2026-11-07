import assert from 'node:assert/strict';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createOnlineServer } from '../server/index.js';
import { createFeedbackStore, handleFeedback } from '../server/feedback.js';
import { sendFeedbackEmail } from '../server/cloudflare/feedback-email.js';
import { PROJECT_GITHUB_URL } from '../src/feedback-fields.js';

test('익명 접수, 중복 방지, 출처 제한, 운영자 인증 및 안전한 본문 표시', async () => {
  const db = new DatabaseSync(':memory:');
  const feedback = createFeedbackStore((query, ...params) => db.prepare(query).all(...params));
  const password = 'local-test-only-password-12345678';
  const { server, wss } = createOnlineServer({ feedback, feedbackPassword: password });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const entry = { id: '1'.repeat(32), category: 'bug', message: '<script>alert(1)</script>\n접수 테스트',
      diagnostics: { version: 'v0.1.0', width: 390, height: 844 }, playerId: 'ignore-me' };
    const post = (body, origin = base) => fetch(base + '/feedback', { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post(entry, 'https://untrusted.example')).status, 403);
    assert.equal((await post({ ...entry, message: ' '.repeat(9000) })).status, 400);
    assert.equal((await post({ ...entry, category: 'unknown' })).status, 400);
    assert.equal((await post(entry)).status, 201);
    assert.equal((await post(entry)).status, 201);
    assert.equal((await post({ ...entry, message: 'changed' })).status, 409);

    const inbox = base + '/feedback/inbox';
    assert.equal((await fetch(inbox)).status, 401);
    assert.equal((await fetch(inbox, { headers: { Authorization: 'Basic ' + btoa('operator:wrong') } })).status, 401);
    const response = await fetch(inbox, { headers: { Authorization: 'Basic ' + btoa(`operator:${password}`) } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    const html = await response.text();
    assert.equal(html.match(/접수 테스트/g)?.length, 1);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /v0\.1\.0 · 390×844/);
    assert.doesNotMatch(html, /<script>|ignore-me/);

    const kept = { ...entry, id: '2'.repeat(32), message: '남겨 둘 의견' };
    assert.equal((await post(kept)).status, 201);
    const authorization = { Authorization: 'Basic ' + btoa(`operator:${password}`) };
    const target = `${inbox}?delete=${entry.id}`;
    assert.equal((await fetch(target, { headers: authorization })).status, 200);
    assert.equal((await fetch(target, { method: 'POST', headers: { Origin: base } })).status, 401);
    assert.equal((await fetch(target, { method: 'POST', headers: { ...authorization, Origin: 'https://untrusted.example' } })).status, 403);
    assert.equal(feedback.list(Number.MAX_SAFE_INTEGER).length, 2);
    const removed = await fetch(target, { method: 'POST', redirect: 'manual', headers: { ...authorization, Origin: base } });
    assert.equal(removed.status, 303);
    assert.equal(removed.headers.get('location'), '/feedback/inbox');
    const remaining = await (await fetch(inbox, { headers: authorization })).text();
    assert.match(remaining, /남겨 둘 의견/);
    assert.doesNotMatch(remaining, /접수 테스트/);
  } finally {
    wss.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    db.close();
  }
});

test('새 의견만 메일에 전달하고 메일 오류가 나도 저장한 의견은 남긴다', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = createFeedbackStore((query, ...params) => db.prepare(query).all(...params));
    const origin = 'https://game.example';
    const mails = [];
    const env = {
      FEEDBACK_EMAIL_FROM: 'feedback@example.com', FEEDBACK_EMAIL_TO: 'operator@example.com',
      FEEDBACK_EMAIL: { async send(mail) { mails.push(mail); throw new Error('발송 실패'); } },
    };
    const pending = [];
    const submit = body => handleFeedback(new Request(origin + '/feedback', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }), { origins: [origin], store, onAccepted: entry => {
      pending.push(sendFeedbackEmail(env, entry).catch(() => {}));
    } });
    const entry = { id: '3'.repeat(32), category: 'idea', message: '메일로 받을 의견', playerId: 'private-player' };
    assert.equal((await submit(entry)).status, 201);
    assert.equal((await submit(entry)).status, 201);
    await Promise.all(pending);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, env.FEEDBACK_EMAIL_TO);
    assert.match(mails[0].text, /메일로 받을 의견/);
    assert.ok(mails[0].text.includes(PROJECT_GITHUB_URL + '/issues'));
    assert.doesNotMatch(mails[0].text, /private-player|화면 크기/);
    assert.equal(store.list(Number.MAX_SAFE_INTEGER)[0].message, entry.message);

    assert.equal((await submit({ ...entry, id: '4'.repeat(32), diagnostics: { version: 'v0.1.0', width: 390, height: 844 } })).status, 201);
    await Promise.all(pending);
    assert.match(mails[1].text, /v0\.1\.0[\s\S]*390×844/);
  } finally { db.close(); }
});
