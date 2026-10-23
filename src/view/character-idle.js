import { blinkSeed } from './character-blink.js';

function compileIdleMotion(value, clips) {
  if (!value || typeof value !== 'object' || !clips.length) return null;
  const period = value.period ?? 720, jitter = value.jitter ?? 180;
  const duration = Math.max(...clips.map((clip) => clip.total));
  if (![period, jitter].every(Number.isInteger) || period <= 0 || jitter < 0 ||
      Math.floor(period / 2) - jitter < 60 || Math.floor(period / 2) + jitter + duration > period) return null;
  return { period, jitter, clips };
}

// 경기 시계와 분리된 표시 시계로 계산한다. 그리기 순서·횟수는 결과를 바꾸지 않는다.
function idleMotionAt(frame, idleAge, seed, config) {
  if (!config || !Number.isFinite(frame) || !Number.isFinite(idleAge)) return null;
  const elapsed = Math.max(0, Math.floor(frame)), window = Math.floor(elapsed / config.period);
  const sample = blinkSeed(`idle/${window}`, seed);
  const start = Math.floor(config.period / 2) - config.jitter + sample % (2 * config.jitter + 1);
  const clip = config.clips[blinkSeed(`pose/${window}`, seed) % config.clips.length];
  const time = elapsed % config.period - start;
  // 반응 도중 시작된 대기 동작을 중간부터 이어 재생하지 않는다.
  if (time < 0 || time >= clip.total || idleAge < time + 60) return null;
  return { clip, frame: time };
}

export { compileIdleMotion, idleMotionAt };
