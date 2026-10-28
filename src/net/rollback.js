import { createMatch, stepMatch } from '../engine/match.js';

export const PROTOCOL = 14;
export const MAX_PREDICTION = 8;
export const MAX_NETWORK_PREDICTION = 45;
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
    this.pendingReconciliation = false;
  }

  // 입력 자체를 늦추지 않고 왕복 지연과 묶음 전송·흔들림에 필요한 여유를 둔다.
  // 경기 도중 한도를 줄이면 반복적으로 멈추므로 증가만 허용한다.
  setLatency(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    this.predictionLimit = Math.max(this.predictionLimit,
      Math.min(MAX_NETWORK_PREDICTION, Math.max(16, Math.ceil(milliseconds * 60 / 1000) + 6)));
  }

  // 서버 ping으로 보이지 않는 상대 기기·전송 지연에도 멈추기 전에 여유를 확보한다.
  // 실시간 조작은 유지하되 입력 없이 계속 진행하는 범위는 750ms로 제한한다.
  reservePrediction() {
    const lead = this.state.frame - this.confirmedState.frame;
    if (lead >= this.predictionLimit - 3) {
      this.predictionLimit = Math.min(MAX_NETWORK_PREDICTION, Math.max(this.predictionLimit, lead + 6));
    }
  }

  restore(state, hash) {
    if (!Number.isInteger(state?.frame) || state.frame < 0 || stateHash(state) !== hash) throw new Error('invalid snapshot');
    this.state = structuredClone(state); this.confirmedState = structuredClone(state);
    this.inputs = [new Map(), new Map()]; this.received = [state.frame, state.frame];
    this.pendingReconciliation = false;
  }

  get canAdvance() {
    return this.state.frame < this.confirmedState.frame + this.predictionLimit;
  }

  receive(side, frame, input) {
    return this.receiveBatch(side, frame, [input]);
  }

  receiveBatch(side, frame, inputs, { deferReplay = false } = {}) {
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
    this.pendingReconciliation ||= needsReplay;
    if (!deferReplay) this.reconcile();
    const floor = this.confirmedState.frame - 1;
    for (const map of this.inputs) for (const key of map.keys()) if (key < floor) map.delete(key);
    return confirmed;
  }

  // 밀린 패킷이 한꺼번에 도착해도 화면을 그리기 전에 한 번만 보정한다.
  reconcile() {
    if (!this.pendingReconciliation) return;
    const target = this.state.frame, previous = stateHash(this.state);
    this.state = structuredClone(this.confirmedState);
    while (this.state.frame < target) this.predict();
    if (stateHash(this.state) !== previous) this.rollbacks++;
    this.pendingReconciliation = false;
  }

  predict() {
    const frame = this.state.frame;
    const inputs = this.inputs.map((map, side) => map.get(frame) ?? map.get(this.received[side] - 1) ?? 0);
    this.state = stepMatch(this.state, inputs);
  }

  advance(input) {
    this.reconcile();
    if (!this.canAdvance) return null;
    const frame = this.state.frame;
    const confirmed = this.receive(this.side, frame, input);
    this.predict();
    return { frame, input, confirmed };
  }
}
