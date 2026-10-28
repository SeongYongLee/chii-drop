const enums = {
  mode: ['practice', 'cpu', 'local', 'online', 'cpu_watch'],
  role: ['player', 'spectator'],
  input_method: ['keyboard', 'touch', 'mixed', 'unknown'],
  action: ['shown', 'completed', 'cancelled', 'retry', 'cancel_retry', 'menu', 'settings', 'lobby', 'create', 'join', 'watch'],
  status: ['attempt', 'success', 'failed'],
  stage: ['initial', 'lobby', 'room', 'playing', 'sync'],
  end_reason: ['completed', 'quit', 'disconnect_timeout', 'forfeit'],
  outcome: ['win', 'loss', 'draw', 'not_applicable'],
  asset_kind: ['startup', 'online'],
};
const schema = {
  game_ready: ['load_ms'], game_load_failed: ['error_code', 'asset_kind'],
  mode_selected: ['mode'], controls_guide: ['mode', 'action', 'input_method'],
  round_started: ['mode', 'role', 'input_method', 'cpu_level', 'char_id', 'opponent_char_id'],
  round_ended: ['mode', 'role', 'cpu_level', 'char_id', 'opponent_char_id', 'end_reason', 'outcome', 'winner_side', 'play_ms', 'score', 'max_chain'],
  result_viewed: ['mode', 'role', 'outcome'], result_action: ['mode', 'role', 'action'],
  room_action: ['action', 'status', 'error_code', 'elapsed_ms'], room_left: ['role', 'wait_ms'],
  connection_issue: ['stage', 'error_code'], connection_recovered: ['stage', 'recovery_ms', 'attempts'],
};
export function analyticsMode(mode) { return ({ solo: 'practice', versus: 'local', watch: 'cpu_watch' })[mode] ?? mode; }
export function eventParams(name, values = {}) {
  if (!schema[name]) return null;
  const result = {};
  for (const key of schema[name]) {
    const value = values[key];
    if (enums[key]) { if (enums[key].includes(value)) result[key] = value; }
    else if (['cpu_level', 'char_id', 'opponent_char_id', 'error_code'].includes(key)) {
      if (typeof value === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(value)) result[key] = value;
    } else if (typeof value === 'number' && Number.isFinite(value) && value >= 0) result[key] = Math.round(value);
  }
  return result;
}
// 메시지 원문은 전송하지 않는다. 미분류 실패도 고정 코드로 기록한다.
export function errorCode(reason) {
  const text = typeof reason === 'string' ? reason : '';
  if (/비밀번호/.test(text)) return 'wrong_password';
  if (/가득|정원|빈자리/.test(text)) return 'capacity_reached';
  if (/버전|protocol|규칙/.test(text)) return 'version_mismatch';
  if (/찾을 수|없는 방|존재하지/.test(text)) return 'room_not_found';
  if (/너무 빠|rate limit/.test(text)) return 'rate_limited';
  if (/인증|authentication/.test(text)) return 'authentication_failed';
  return 'request_failed';
}
