import { validInput } from './rollback.js';

// 변경된 입력은 즉시 전송한다. 같은 입력만 최대 두 프레임 기다린다.
export const MAX_INPUT_BATCH = 3;

export function createInputBatcher() {
  let pending = [], first = 0, next = null, previous = null;
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
      previous = input;
      return changed || pending.length === MAX_INPUT_BATCH ? flush() : null;
    },
    flush,
    reset() { pending = []; next = null; previous = null; },
  };
}

export function validInputBatch(message) {
  return Number.isInteger(message.frame) && message.frame >= 0
    && Array.isArray(message.inputs) && message.inputs.length > 0 && message.inputs.length <= MAX_INPUT_BATCH
    && Array.from(message.inputs).every(validInput);
}
