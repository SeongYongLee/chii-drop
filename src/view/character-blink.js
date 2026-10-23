// 표시 전용 해시다. 경기 난수나 그리기 호출 횟수를 소비하지 않는다.
function mix(value) {
  let n = value >>> 0;
  n = Math.imul(n ^ (n >>> 16), 0x21f0aaad);
  n = Math.imul(n ^ (n >>> 15), 0x735a2d97);
  return (n ^ (n >>> 15)) >>> 0;
}

function blinkSeed(key, seed = 0) {
  let value = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < key.length; i++) value = Math.imul(value ^ key.charCodeAt(i), 16777619) >>> 0;
  return mix(value);
}

function compileBlink(value, frames, poster) {
  if (!value || typeof value !== 'object') return null;
  const from = value.from ?? 1, to = value.to ?? 3;
  const period = value.period ?? 210, jitter = value.jitter ?? 60;
  const gap = value.gap ?? 8, doubleChance = value.doubleChance ?? 0.12;
  if (![from, to, period, jitter, gap].every(Number.isInteger) ||
      from < 0 || to < from || to >= frames.length || (poster >= from && poster <= to) ||
      period <= 0 || jitter < 0 || gap < 1 || !Number.isFinite(doubleChance) || doubleChance < 0 || doubleChance > 1) return null;
  const duration = frames.slice(from, to + 1).reduce((sum, frame) => sum + frame.duration, 0);
  // 각 시간 구간 안에 두 번 깜박이는 동작까지 들어가도록 여유를 둔다.
  if (Math.floor(period / 2) - jitter < 1 || Math.floor(period / 2) + jitter + duration * 2 + gap > period) return null;
  return { from, to, period, jitter, gap, doubleChance, duration };
}

// 매 구간의 시작 시점을 따로 흩뜨린다. 간격은 고정된 주기를 반복하지 않는다.
// 반환값은 깜박임 내부의 경과 시간이며, -1은 눈을 뜬 대기 상태다.
function blinkTime(frame, seed, config) {
  const elapsed = Number.isFinite(frame) ? Math.max(0, Math.floor(frame)) : 0;
  const window = Math.floor(elapsed / config.period);
  const sample = mix(seed ^ Math.imul(window + 1, 0x9e3779b1));
  const start = Math.floor(config.period / 2) - config.jitter + sample % (config.jitter * 2 + 1);
  const time = elapsed % config.period - start;
  if (time >= 0 && time < config.duration) return time;
  if (mix(sample ^ 0xa511e9b3) / 0x100000000 < config.doubleChance) {
    const second = time - config.duration - config.gap;
    if (second >= 0 && second < config.duration) return second;
  }
  return -1;
}

export { blinkSeed, blinkTime, compileBlink };
