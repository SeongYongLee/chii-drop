import { validInput } from './rollback.js';

// 변경된 입력은 즉시 전송한다. 같은 입력만 최대 두 프레임 기다린다.
export const MAX_INPUT_BATCH = 3;
export const MAX_EXPERIMENTAL_INPUT_BATCH = 6;

export function createInputBatcher({ maxBatch = MAX_INPUT_BATCH, adaptive = false } = {}) {
  if (![3, 4, 6].includes(maxBatch)) throw new Error('invalid batch limit');
  let pending = [], first = 0, next = null, previous = null, stableFrames = 0, pressure = false;
  const flush = () => {
    if (!pending.length) return null;
    const packet = { type: 'inputBatch', frame: first, inputs: pending };
    pending = [];
    return packet;
  };
  return {
    push(frame, input) {
      if (!Number.isInteger(frame) || frame < 0 || (next !== null && frame !== next) || !validInput(input)) throw new Error('invalid batched input');
      if (!pending.length) first = frame;
      pending.push(input); next = frame + 1;
      const changed = previous !== input;
      stableFrames = changed ? 1 : stableFrames + 1;
      previous = input;
      const limit = adaptive && (stableFrames < 12 || pressure) ? MAX_INPUT_BATCH : maxBatch;
      return changed || pending.length >= limit ? flush() : null;
    },
    flush,
    setPressure(value) { pressure = !!value; },
    configure(limit) {
      if (![3, 4, 6].includes(limit) || pending.length) throw new Error('invalid batch reconfiguration');
      maxBatch = limit;
    },
    reset() { pending = []; next = null; previous = null; stableFrames = 0; pressure = false; },
  };
}

export function validInputBatch(message, limit = MAX_INPUT_BATCH) {
  return Number.isInteger(message.frame) && message.frame >= 0
    && [3, 4, 6].includes(limit) && Array.isArray(message.inputs) && message.inputs.length > 0 && message.inputs.length <= limit
    && Array.from(message.inputs).every(validInput);
}
