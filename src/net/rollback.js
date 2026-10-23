import { createMatch, stepMatch } from '../engine/match.js';

export const PROTOCOL = 2;
export const MAX_PREDICTION = 8;
export const MAX_AHEAD = 120;

export function validInput(value) {
  return Number.isInteger(value) && value >= 0 && value <= 31;
}

// 엔진 상태만 비교한다. 스킨·음향·브라우저 시간은 포함하지 않는다.
export function stateHash(state) {
  const text = JSON.stringify(state);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// 프레임 f의 입력은 상태 f → f+1에 적용한다. 서버의 확정 상태와 별도로 예측한다.
export class RollbackMatch {
  constructor(seed, side) {
    if (side !== 0 && side !== 1) throw new Error('invalid side');
    this.side = side;
    this.state = createMatch({ seed });
    this.confirmedState = structuredClone(this.state);
    this.inputs = [new Map(), new Map()];
    this.received = [0, 0];
    this.rollbacks = 0;
  }

  get canAdvance() {
    return this.state.frame < this.confirmedState.frame + MAX_PREDICTION;
  }

  receive(side, frame, input) {
    if (![0, 1].includes(side) || !Number.isInteger(frame) || !validInput(input)) throw new Error('invalid input');
    if (frame !== this.received[side] || frame > this.state.frame + MAX_AHEAD) throw new Error('invalid sequence');
    this.inputs[side].set(frame, input);
    this.received[side]++;
    const target = this.state.frame;
    const confirmed = [];
    while (this.inputs.every((map) => map.has(this.confirmedState.frame))) {
      const f = this.confirmedState.frame;
      this.confirmedState = stepMatch(this.confirmedState, this.inputs.map((map) => map.get(f)));
      confirmed.push(this.confirmedState);
    }
    // 확정 지점에서 예측 구간만 다시 계산한다. 최대 8프레임으로 비용을 제한한다.
    if (frame < target) {
      const previous = stateHash(this.state);
      this.state = structuredClone(this.confirmedState);
      while (this.state.frame < target) this.predict();
      if (stateHash(this.state) !== previous) this.rollbacks++;
    }
    const floor = this.confirmedState.frame - 1;
    for (const map of this.inputs) for (const key of map.keys()) if (key < floor) map.delete(key);
    return confirmed;
  }

  predict() {
    const frame = this.state.frame;
    const inputs = this.inputs.map((map, side) => map.get(frame) ?? map.get(this.received[side] - 1) ?? 0);
    this.state = stepMatch(this.state, inputs);
  }

  advance(input) {
    if (!this.canAdvance) return null;
    const frame = this.state.frame;
    const confirmed = this.receive(this.side, frame, input);
    this.predict();
    return { frame, input, confirmed };
  }
}
