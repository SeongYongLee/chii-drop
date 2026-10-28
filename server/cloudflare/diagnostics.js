import { errorCode } from '../../src/analytics/events.js';
import { RULES_VERSION } from '../../src/engine/rules.js';

// 자유 문장·요청·ID를 기록하지 않고 같은 오류의 반복 출력을 제한한다.
export function createDiagnostics(component, { write = line => console.warn(line), now = Date.now } = {}) {
  const counts = new Map();
  return function log(event, reason, operation = 'unknown') {
    try {
      if (!['request_failed', 'protocol_mismatch', 'state_resync', 'reconnect_expired', 'server_error'].includes(event)) return;
      const code = event === 'request_failed' ? errorCode(reason) : event;
      const op = ['create', 'join', 'watch', 'hello', 'resync', 'message', 'fetch', 'flush', 'alarm'].includes(operation) ? operation : 'unknown';
      const key = `${event}:${code}:${op}`, time = now(), entry = counts.get(key);
      if (entry && time - entry.at < 60000 && entry.count >= 5) return;
      counts.set(key, entry && time - entry.at < 60000 ? { at: entry.at, count: entry.count + 1 } : { at: time, count: 1 });
      write(JSON.stringify({ event, severity: event === 'server_error' ? 'error' : 'warn', component, code, operation: op, rules_version: RULES_VERSION }));
    } catch { /* 로그 실패가 게임 처리를 중단하지 않도록 한다. */ }
  };
}
