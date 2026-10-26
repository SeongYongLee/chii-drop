import { stepMatch } from '../engine/match.js';
import { stateHash, validInput } from './rollback.js';

// 관전에는 예측·로컬 입력이 없다. 확정된 양쪽 입력을 60fps로 재생한다.
export class SpectatorMatch {
  constructor(state, hash) { this.restore(state, hash); }
  restore(state, hash) {
    if (!Number.isInteger(state?.frame) || state.frame < 0 || stateHash(state) !== hash) throw new Error('invalid spectator snapshot');
    this.state = structuredClone(state); this.confirmedState = this.state;
    this.next = state.frame; this.pending = []; this.rollbacks = 0;
  }
  receiveBatch(frame, inputs) {
    if (!Number.isInteger(frame) || frame < 0 || !Array.isArray(inputs) || !inputs.length || inputs.length > 6
      || inputs.some(pair => !Array.isArray(pair) || pair.length !== 2 || pair.some(input => !validInput(input)))) throw new Error('invalid spectator inputs');
    const skip = Math.max(0, this.next - frame);
    if (frame > this.next || this.pending.length + Math.max(0, inputs.length - skip) > 600) throw new Error('spectator needs snapshot');
    this.pending.push(...inputs.slice(skip)); this.next += Math.max(0, inputs.length - skip);
  }
  get canAdvance() { return this.pending.length > 0; }
  advance() {
    if (!this.canAdvance) return null;
    this.state = stepMatch(this.state, this.pending.shift()); this.confirmedState = this.state;
    return { confirmed: [this.state] };
  }
}
