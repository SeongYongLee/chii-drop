import { loadOnlineConfig } from '../net/config.js';
import { FEEDBACK_CATEGORIES, FEEDBACK_LIMIT, PROJECT_GITHUB_URL } from '../feedback-fields.js';

export function openFeedback(app, view = window) {
  const doc = view.document;
  if (doc.querySelector('.feedback-dialog[open]')) return;
  const previous = doc.activeElement;
  const dialog = doc.createElement('dialog');
  dialog.className = 'feedback-dialog';
  dialog.setAttribute('aria-labelledby', 'feedback-title');
  dialog.innerHTML = `
    <h2 id="feedback-title">의견 보내기</h2>
    <form>
      <p>의견은 익명으로 접수돼요. 연락처나 방 비밀번호는 적지 말아 주세요.</p>
      <label>분류
        <select name="category" autofocus>
          ${Object.entries(FEEDBACK_CATEGORIES).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
        </select>
      </label>
      <label>내용
        <textarea name="message" rows="4" maxlength="${FEEDBACK_LIMIT}" required
          placeholder="어느 화면에서 무엇을 했을 때 문제가 생겼나요?"></textarea>
      </label>
      <label class="feedback-diagnostics"><input type="checkbox" name="diagnostics">
        <span>게임 버전·화면 크기 첨부 <small data-feedback-preview></small></span>
      </label>
      <p role="status"></p>
      <div class="feedback-actions"><button type="button" data-close>닫기</button><button type="submit">보내기</button></div>
    </form>
    <section data-feedback-done hidden>
      <p>의견이 접수됐어요. 보내주셔서 고마워요!</p>
      <button type="button" data-close>확인</button>
    </section>
    <p class="feedback-github"><a href="${PROJECT_GITHUB_URL}/issues" target="_blank" rel="noopener noreferrer">GitHub에서 공개 이슈 보기</a></p>`;
  const form = dialog.querySelector('form');
  const { category, message, diagnostics } = form.elements;
  const status = form.querySelector('[role=status]');
  const preview = form.querySelector('[data-feedback-preview]');
  const submit = form.querySelector('[type=submit]');
  const close = form.querySelector('[data-close]');
  const done = dialog.querySelector('[data-feedback-done]');
  let pending = false, submission, shownDetails;
  function updatePreview() {
    const version = app.versionLabel ?? '버전 확인 중', width = view.innerWidth, height = view.innerHeight;
    shownDetails = { version, width, height };
    preview.textContent = `${version} · ${width}×${height}`;
  }
  updatePreview();
  view.addEventListener('resize', updatePreview);
  category.addEventListener('change', () => {
    message.placeholder = category.value === 'bug' ? '어느 화면에서 무엇을 했을 때 문제가 생겼나요?' : '게임에 대해 전하고 싶은 의견을 적어 주세요.';
  });
  for (const button of dialog.querySelectorAll('[data-close]')) button.onclick = () => dialog.close();
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('keyup', event => event.stopPropagation());
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    view.removeEventListener('resize', updatePreview);
    dialog.remove();
    previous?.focus();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending) return;
    const content = message.value.trim();
    if (!content) { status.textContent = '의견 내용을 적어 주세요.'; message.focus(); return; }
    const entry = { category: category.value, message: content,
      ...(diagnostics.checked ? { diagnostics: shownDetails } : {}) };
    const fingerprint = JSON.stringify(entry);
    if (submission?.fingerprint !== fingerprint) {
      const bytes = view.crypto.getRandomValues(new Uint8Array(16));
      submission = { fingerprint, id: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') };
    }
    pending = submit.disabled = close.disabled = true;
    category.disabled = message.disabled = diagnostics.disabled = true;
    status.textContent = '의견을 보내고 있어요…';
    try {
      const config = await loadOnlineConfig();
      if (!config.socketURL) throw new Error('Missing feedback server');
      const endpoint = new URL('/feedback', config.socketURL);
      endpoint.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:';
      const response = await view.fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'omit', signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ ...entry, id: submission.id }),
      });
      if (response.status === 429) { status.textContent = '지금은 접수가 많아요. 잠시 후 다시 보내 주세요.'; return; }
      if (response.status !== 201) throw new Error('Feedback was not accepted');
      form.hidden = true;
      done.hidden = false;
      done.querySelector('button').focus();
    } catch {
      status.textContent = '의견을 보내지 못했어요. 입력 내용은 그대로 있으니 다시 시도해 주세요.';
    } finally {
      pending = submit.disabled = close.disabled = false;
      category.disabled = message.disabled = diagnostics.disabled = false;
    }
  });
  doc.body.append(dialog);
  dialog.showModal();
}
