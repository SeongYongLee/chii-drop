import { analytics } from './client.js';
import { createRoundTracker } from './round.js';
import { errorCode } from './events.js';

export function createOnlineTelemetry({ track = (...args) => analytics.track(...args), now = () => performance.now(),
  schedule = setTimeout, cancel = clearTimeout } = {}) {
  const rounds = createRoundTracker({ track });
  let request = null, requestTimer, enteredAt = null, issue = null, current = null;
  function requestResult(status, code) {
    if (!request) return;
    cancel(requestTimer);
    track('room_action', { action: request.action, status, error_code: code, elapsed_ms: now() - request.at });
    request = null;
  }
  function requestStart(action, available) {
    if (!['create', 'join', 'watch'].includes(action)) return;
    requestResult('failed', 'superseded');
    track('room_action', { action, status: 'attempt' });
    request = { action, at: now() };
    if (!available) { requestResult('failed', 'connection_unavailable'); return; }
    requestTimer = schedule(() => requestResult('failed', 'request_timeout'), 15000);
  }
  function connectionIssue(stage, code) {
    if (!issue) { issue = { stage, at: now(), attempts: 0 }; track('connection_issue', { stage, error_code: code }); }
  }
  function recovered(stage) {
    if (!issue || (issue.stage === 'playing' || issue.stage === 'sync') && stage !== 'playing') return;
    track('connection_recovered', { stage: issue.stage, recovery_ms: now() - issue.at, attempts: issue.attempts });
    issue = null;
  }
  function begin(id, details, fresh) {
    current = { id: `${id}:${details.role}`, role: details.role };
    if (fresh) rounds.begin(current.id, { ...details, mode: 'online' });
    if (fresh) recovered('playing');
  }
  return {
    requestStart, requestResult, connectionIssue, recovered,
    attempt() { if (issue) issue.attempts++; },
    failed(reason) { requestResult('failed', errorCode(reason)); },
    joined() { requestResult('success'); enteredAt = now(); },
    begin,
    endFor(id, details) { rounds.end(`${id}:player`, details); },
    end(details) { if (current) rounds.end(current.id, details); },
    viewed() { if (current) rounds.viewed(current.id); },
    action(action) { if (current) rounds.action(current.id, action); },
    left(role, playing) {
      if (!playing && enteredAt !== null) track('room_left', { role, wait_ms: now() - enteredAt });
      enteredAt = null;
    },
    waiting() { enteredAt = now(); current = null; },
    close() { requestResult('failed', 'cancelled'); enteredAt = null; issue = null; current = null; },
  };
}
