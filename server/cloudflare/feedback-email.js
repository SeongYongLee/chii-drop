import { FEEDBACK_CATEGORIES, PROJECT_GITHUB_URL } from '../../src/feedback-fields.js';

export async function sendFeedbackEmail(env, { id, category, message, diagnostics }) {
  const label = FEEDBACK_CATEGORIES[category];
  const text = [
    `분류: ${label}`,
    `접수 번호: ${id}`,
    '',
    message,
    ...(diagnostics ? ['', `게임 버전: ${diagnostics.version}`, `화면 크기: ${diagnostics.width}×${diagnostics.height}`] : []),
    '',
    `GitHub 저장소: ${PROJECT_GITHUB_URL}`,
    `GitHub 이슈: ${PROJECT_GITHUB_URL}/issues`,
  ].join('\n');
  await env.FEEDBACK_EMAIL.send({
    from: { email: env.FEEDBACK_EMAIL_FROM, name: '치와치와 의견 접수' },
    to: env.FEEDBACK_EMAIL_TO,
    subject: `[치와치와] ${label}`,
    text,
  });
}
