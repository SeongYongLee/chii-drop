import { createMatch, stepMatch } from '../engine/match.js';

export const PROTOCOL = 13;
export const MAX_PREDICTION = 8;
export const MAX_NETWORK_PREDICTION = 30;
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
    this.predictionLimit = MAX_PREDICTION;
  }

  // 입력 자체를 늦추지 않고 왕복 지연과 묶음 전송·흔들림에 필요한 여유를 둔다.
  // 경기 도중 한도를 줄이면 반복적으로 멈추므로 증가만 허용한다.
  setLatency(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    this.predictionLimit = Math.max(this.predictionLimit,
      Math.min(MAX_NETWORK_PREDICTION, Math.max(16, Math.ceil(milliseconds * 60 / 1000) + 6)));
  }

  restore(state, hash) {
    if (!Number.isInteger(state?.frame) || state.frame < 0 || stateHash(state) !== hash) throw new Error('invalid snapshot');
    this.state = structuredClone(state); this.confirmedState = structuredClone(state);
    this.inputs = [new Map(), new Map()]; this.received = [state.frame, state.frame];
  }

  get canAdvance() {
    return this.state.frame < this.confirmedState.frame + this.predictionLimit;
  }

  receive(side, frame, input) {
    return this.receiveBatch(side, frame, [input]);
  }

  receiveBatch(side, frame, inputs) {
    if (![0, 1].includes(side) || !Number.isInteger(frame) || !Array.isArray(inputs)
      || !inputs.length || inputs.length > MAX_AHEAD || !Array.from(inputs).every(validInput)) throw new Error('invalid input');
    if (frame !== this.received[side] || frame + inputs.length - 1 > this.state.frame + MAX_AHEAD) throw new Error('invalid sequence');
    const target = this.state.frame;
    const predictedInput = this.inputs[side].get(this.received[side] - 1) ?? 0;
    const needsReplay = inputs.some((input, i) => frame + i < target && input !== predictedInput);
    for (const [i, input] of inputs.entries()) this.inputs[side].set(frame + i, input);
    this.received[side] += inputs.length;
    const confirmed = [];
    while (this.inputs.every((map) => map.has(this.confirmedState.frame))) {
      const f = this.confirmedState.frame;
      this.confirmedState = stepMatch(this.confirmedState, this.inputs.map((map) => map.get(f)));
      confirmed.push(this.confirmedState);
    }
    // 묶음 전체를 받은 뒤 한 번만 되감는다. 예측은 최대 30프레임으로 제한한다.
    if (needsReplay) {
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
