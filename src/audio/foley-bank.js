import { loadAudioBuffer } from './buffer-loader.js';

const GROUPS = {
  move: 3, rotate: 4, land: 4, warning: 3, warningHeavy: 3,
  garbage: 3, garbageLand: 3, clear: 4, attack: 3, offset: 3,
  cursor: 3, confirm: 2, cancel: 2, count: 1, go: 1, over: 1,
  win: 1, allClear: 1, revive: 1,
};
const SOUND_ROOT = new URL('../../sounds/foley-play-v1/', import.meta.url);
const FILES = Object.fromEntries(Object.entries(GROUPS).map(([name, count]) => [name,
  Array.from({ length: count }, (_, i) => new URL(`${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}-${String(i + 1).padStart(2, '0')}.wav`, SOUND_ROOT).href),
]));
const LEVELS = { move: .4, rotate: .65, land: .85, warning: .65, warningHeavy: .8,
  garbage: .65, garbageLand: .85, clear: .8, attack: .7, offset: .7,
  cursor: .6, confirm: .8, cancel: .65, count: .8, go: .85, over: .8, win: .85, allClear: .8, revive: .85 };
const INTERVALS = { move: .025, rotate: .025, land: .035, warning: .09, garbage: .12, garbageLand: .07, clear: .05 };

async function preloadRecordedSfx(sfx) {
  if (sfx.loading) return sfx.loading;
  if (!sfx.context) return false;
  sfx.buffers ??= new Map();
  sfx.loading = Promise.all(Object.values(FILES).flat().map(async (file) => {
    try {
      const buffer = await loadAudioBuffer(sfx.context, file);
      sfx.buffers.set(file, buffer);
    } catch { /* 자료가 없으면 기존 합성 효과음으로 계속 실행한다. */ }
  })).then(() => sfx.buffers.size);
  return sfx.loading;
}

function playRecordedSfx(sfx, event, options = {}) {
  const name = event === 'lock' ? 'land' : event === 'warning' && options.total >= 30 ? 'warningHeavy' : event;
  const files = FILES[name];
  const available = files?.filter((file) => sfx.buffers?.has(file));
  if (!available?.length) return false;
  sfx.soundCursor ??= {};
  sfx.lastSound ??= new Map();
  sfx.voices ??= new Set();
  const now = sfx.context.currentTime;
  const key = `${options.channel ?? 'ui'}:${event}`;
  if (now - (sfx.lastSound.get(key) ?? -Infinity) < (INTERVALS[event] ?? .018)) return true;
  sfx.lastSound.set(key, now);
  const turn = sfx.soundCursor[key] ?? 0;
  sfx.soundCursor[key] = turn + 1;
  const index = name === 'clear' ? Math.min(available.length - 1, Math.max(0, Math.floor(((options.chain ?? 1) - 1) / 2))) : turn % available.length;
  const source = sfx.context.createBufferSource(), amp = sfx.context.createGain();
  source.buffer = sfx.buffers.get(available[index]);
  // 작은 음량 차이만 주고 녹음의 음정과 질감은 유지한다.
  const variation = [1, .96, 1.025, .985][turn % 4];
  const weight = ['land', 'garbageLand'].includes(name) ? Math.min(1.12, .84 + Math.log2(1 + (options.amount ?? 1)) * .1) : 1;
  amp.gain.value = (LEVELS[name] ?? .7) * variation * weight;
  source.connect(amp).connect(sfx.master);
  const voice = { source, amp };
  source.onended = () => { sfx.voices.delete(voice); source.disconnect(); amp.disconnect(); };
  if (sfx.voices.size >= 16) {
    const oldest = sfx.voices.values().next().value;
    oldest.amp.gain.setTargetAtTime(0, now, .003);
    oldest.source.stop(now + .012);
    sfx.voices.delete(oldest);
  }
  sfx.voices.add(voice);
  source.start(now);
  return true;
}

export { FILES as FOLEY_FILES, playRecordedSfx, preloadRecordedSfx };
