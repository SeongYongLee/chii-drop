import { ANALYTICS_CONFIG } from './config.js';
import { eventParams } from './events.js';
import { RULES_VERSION } from '../engine/rules.js';

export function cleanURL(value) {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.origin + url.pathname : ''; } catch { return ''; }
}
// 실패·차단 때도 큐와 타이머를 무한히 유지하지 않는다.
export function createAnalytics({ config = ANALYTICS_CONFIG, view = globalThis, timeoutMs = 5000 } = {}) {
  let state = 'pending', queue = [], common = {}, emit = null, timer;
  const stop = () => { state = 'disabled'; queue = []; emit = null; if (timer) clearTimeout(timer); };
  function track(name, values) {
    const params = eventParams(name, values);
    if (!params || state === 'disabled') return;
    if (state !== 'ready') { if (queue.length < 48) queue.push([name, params]); return; }
    try { emit('event', name, { ...common, ...params }); } catch { stop(); }
  }
  function start(info = {}) {
    if (state !== 'pending') return;
    try {
      const env = info.deployment === 'production' ? 'production' : 'development';
      const id = config[env];
      if (!/^G-[A-Z0-9]+$/.test(id ?? '') || !config.allowedHosts.includes(view.location?.hostname)
        || view.location?.protocol !== 'https:' || info.dirty !== false
        || view.navigator?.globalPrivacyControl === true) { stop(); return; }
      try { if (view.localStorage?.getItem('analytics-disabled') === 'true') { stop(); return; } } catch { stop(); return; }
      const page = cleanURL(view.location.href), referrer = cleanURL(view.document.referrer);
      common = { schema_version: 1, game_version: String(info.version ?? 'unknown').slice(0, 40), rules_version: RULES_VERSION,
        environment: env, page_location: page, page_referrer: referrer, page_title: 'Game', send_to: id };
      state = 'loading';
      const script = view.document.createElement('script');
      script.async = true; script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
      script.onerror = stop;
      script.onload = () => {
        if (state !== 'loading') return;
        clearTimeout(timer);
        try {
          view.dataLayer ??= [];
          emit = function () { view.dataLayer.push(arguments); };
          emit('js', new Date());
          emit('config', id, { ...common, send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
          state = 'ready';
          emit('event', 'page_view', common);
          const pending = queue; queue = [];
          for (const [name, params] of pending) track(name, params);
        } catch { stop(); }
      };
      timer = setTimeout(stop, timeoutMs);
      view.dataLayer ??= [];
      view.document.head.append(script);
    } catch { stop(); }
  }
  return { track, start, disable: stop, get state() { return state; } };
}
export const analytics = createAnalytics();
