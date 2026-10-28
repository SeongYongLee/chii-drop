import { createMatch, stepMatch } from '../engine/match.js';
import { stateHash, MAX_NETWORK_PREDICTION } from './rollback.js';

export const STATE_INTERVAL = 4; // 60Hz 경기에서 일반 상태는 15Hz. 중요 변화는 별도 즉시 전송.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
// 정적 테이블과 바뀌지 않은 필드는 다시 보내지 않는다. 보드 배열은 바뀐 칸만 보낸다.
export function stateDelta(before, after) {
  if (JSON.stringify(before) === JSON.stringify(after)) return undefined;
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    const changes = after.flatMap((value, i) => {
      const patch = stateDelta(before[i], value);
      return patch === undefined ? [] : [[i, patch]];
    });
    const sparse = { $array: changes };
    if (JSON.stringify(sparse).length < JSON.stringify([after]).length) return sparse;
  }
  if (!object(before) || !object(after)) return [after];
  const patch = {};
  for (const key of Object.keys(after)) {
    const next = stateDelta(before[key], after[key]);
    if (next !== undefined) patch[key] = next;
  }
  // 엔진 객체의 필드는 사라지지 않고 null로 바뀐다.
  return patch;
}
export function applyStateDelta(before, patch) {
  if (Array.isArray(patch)) return structuredClone(patch[0]);
  if (patch.$array) {
    if (!Array.isArray(before)) throw new Error('invalid array patch');
    const next = before.slice();
    for (const [index, value] of patch.$array) {
      if (!Number.isInteger(index) || index < 0 || index >= next.length) throw new Error('invalid patch index');
      next[index] = applyStateDelta(before[index], value);
    }
    return next;
  }
  const next = { ...before };
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('invalid state patch');
    next[key] = applyStateDelta(before?.[key], value);
  }
  return next;
}
export function importantState(before, after) {
  return before.phase !== after.phase || before.projectiles.length !== after.projectiles.length
    || after.players.some((p, i) => p.phase !== before.players[i].phase
      || p.events.some(e => !['move', 'rotate'].includes(e.type))
      || JSON.stringify(p.stocks) !== JSON.stringify(before.players[i].stocks));
}
export function statePacket(before, after, critical) {
  // players 배열은 플레이어별 객체 차분으로 압축한다.
  const { players: oldPlayers, ...oldMatch } = before;
  const { players, ...match } = after;
  return { type: 'state15', base: before.frame, frame: after.frame, critical,
    match: stateDelta(oldMatch, match) ?? {}, players: players.map((p, i) => stateDelta(oldPlayers[i], p) ?? {}), hash: stateHash(after) };
}

// 실험용 서버 상태 수신기. 예측은 표시 전용이며 효과음·공격 판정에는 확정 상태만 쓴다.
export class StateStreamMatch {
  constructor(seed, side) { this.side = side; this.restore(createMatch({ seed }), stateHash(createMatch({ seed }))); }
  restore(state, hash) {
    if (stateHash(state) !== hash) throw new Error('invalid stream snapshot');
    this.confirmedState = structuredClone(state); this.predicted = structuredClone(state);
    this.inputs = new Map(); this.rollbacks = 0; this.pendingReconciliation = false;
    this.previousRemote = null; this.blendAge = STATE_INTERVAL;
  }
  setLatency() {}
  reservePrediction() {}
  reconcile() {}
  get canAdvance() { return this.predicted.frame < this.confirmedState.frame + MAX_NETWORK_PREDICTION; }
  get state() {
    const players = this.confirmedState.players.slice();
    players[this.side] = { ...this.predicted.players[this.side], stocks: this.confirmedState.players[this.side].stocks,
      score: this.confirmedState.players[this.side].score };
    const remote = 1 - this.side, current = players[remote], previous = this.previousRemote;
    const t = Math.min(1, this.blendAge / STATE_INTERVAL);
    if (previous && previous.phase === current.phase && JSON.stringify(previous.board.cells) === JSON.stringify(current.board.cells)) {
      players[remote] = { ...current, board: { ...current.board,
        offset: current.board.offset.map((value, i) => previous.board.offset[i] + (value - previous.board.offset[i]) * t) } };
    }
    if (previous?.piece && current.piece && previous.nextIndex === current.nextIndex && previous.phase === current.phase
      && previous.piece.orient === current.piece.orient) {
      players[remote] = { ...players[remote], displayPiece: { ...current.piece,
        x: previous.piece.x + (current.piece.x - previous.piece.x) * t,
        h: previous.piece.h + (current.piece.h - previous.piece.h) * t,
        moveFrames: previous.piece.moveFrames + (current.piece.moveFrames - previous.piece.moveFrames) * t } };
    }
    return { ...this.confirmedState, frame: this.predicted.frame, players };
  }
  advance(input) {
    if (!this.canAdvance) return null;
    const frame = this.predicted.frame;
    this.inputs.set(frame, input);
    this.predicted = stepMatch(this.predicted, this.side === 0 ? [input, 0] : [0, input]);
    this.blendAge++;
    return { frame, input, confirmed: [] };
  }
  receiveState(packet) {
    if (packet.base !== this.confirmedState.frame || packet.frame <= packet.base) throw new Error('stream needs snapshot');
    const previous = this.confirmedState;
    const state = applyStateDelta(previous, packet.match);
    state.players = previous.players.map((p, i) => applyStateDelta(p, packet.players[i]));
    if (state.frame !== packet.frame || stateHash(state) !== packet.hash) throw new Error('invalid stream hash');
    this.previousRemote = packet.critical ? null : previous.players[1 - this.side]; this.blendAge = 0;
    this.confirmedState = state;
    const target = Math.max(state.frame, this.predicted.frame), old = this.predicted.players[this.side];
    this.predicted = structuredClone(state);
    while (this.predicted.frame < target) {
      const input = this.inputs.get(this.predicted.frame) ?? 0;
      this.predicted = stepMatch(this.predicted, this.side === 0 ? [input, 0] : [0, input]);
    }
    if (JSON.stringify(old.board.cells) !== JSON.stringify(this.predicted.players[this.side].board.cells)
      || JSON.stringify(old.piece) !== JSON.stringify(this.predicted.players[this.side].piece)) this.rollbacks++;
    for (const frame of this.inputs.keys()) if (frame < state.frame) this.inputs.delete(frame);
    return [state];
  }
}
