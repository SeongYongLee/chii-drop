import { playRecordedSfx, preloadRecordedSfx } from './foley-bank.js';
import { preloadCharacterVoices } from './character-voice.js';
import { unlockMusic } from './music.js';
import { playSoftContact } from './soft-contact.js';
import { playArrivalImpact } from './arrival-impact.js';

// CC0 녹음 편집본을 우선 사용하고 자료가 없으면 직접 합성한 소리로 대체한다.
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

function createSfx({ recorded = false } = {}) {
  // 일반 게임은 개발·배포 모두 같은 합성음을 쓴다. 녹음 비교는 명시적인 개발 용도다.
  return { context: null, master: null, enabled: true, volume: 0.6, recorded, buffers: new Map() };
}

// 정지된 컨텍스트에서도 파일 준비는 가능하다. 첫 입력 전 로딩 화면에서 끝낸다.
function prepareSfx(sfx) {
  if (sfx.context) return Promise.all([preloadRecordedSfx(sfx), preloadCharacterVoices(sfx)]);
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }
  sfx.context = new AudioContextClass();
  sfx.master = sfx.context.createGain();
  sfx.master.gain.value = sfx.volume;
  if (sfx.context.createDynamicsCompressor) {
    const limiter = sfx.context.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 18;
    limiter.ratio.value = 4;
    limiter.attack.value = .003;
    limiter.release.value = .12;
    sfx.master.connect(limiter).connect(sfx.context.destination);
  } else sfx.master.connect(sfx.context.destination);
  return Promise.all([preloadRecordedSfx(sfx), preloadCharacterVoices(sfx)]);
}

// 사용자 입력에서는 디코딩 대신 준비된 오디오 장치만 시작한다.
function unlockSfx(sfx) {
  unlockMusic(sfx);
  if (!sfx.context) void prepareSfx(sfx);
  const resumed = ['suspended', 'interrupted'].includes(sfx.context?.state) ? sfx.context.resume() : Promise.resolve();
  if (sfx.context && !sfx.audioWarmed) {
    sfx.audioWarmed = true;
    const source = sfx.context.createBufferSource();
    source.buffer = sfx.context.createBuffer(1, 128, sfx.context.sampleRate);
    source.connect(sfx.master);
    source.onended = () => source.disconnect();
    source.start();
  }
  return resumed;
}

function setSfxOptions(sfx, { enabled, volume }) {
  sfx.enabled = enabled;
  sfx.volume = volume;
  if (sfx.master) {
    sfx.master.gain.value = volume;
  }
}

function tone(sfx, { freq, type = 'sine', start = 0, duration = 0.1, gain = 0.3, slideTo }) {
  const { context, master } = sfx;
  const t = context.currentTime + start;
  const osc = context.createOscillator();
  const amp = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) {
    osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  }
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(amp).connect(master);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function noise(sfx, { start = 0, duration = 0.2, gain = 0.2, cutoff = 800 }) {
  const { context, master } = sfx;
  const t = context.currentTime + start;
  const length = Math.floor(context.sampleRate * duration);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const amp = context.createGain();
  source.buffer = buffer;
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  amp.gain.value = gain;
  source.connect(filter).connect(amp).connect(master);
  source.start(t);
}

function midi(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

const SOUNDS = {
  move: (sfx) => tone(sfx, { freq: 660, type: 'triangle', duration: 0.04, gain: 0.08 }),
  rotate: (sfx) => tone(sfx, { freq: 880, type: 'triangle', duration: 0.05, gain: 0.1, slideTo: 1100 }),
  lock: (sfx) => tone(sfx, { freq: 220, type: 'sine', duration: 0.08, gain: 0.2, slideTo: 140 }),
  clear: (sfx, { chain = 1 } = {}) => {
    const base = 72 + PENTATONIC[Math.min(chain - 1, PENTATONIC.length - 1)];
    [0, 4, 7].forEach((step, i) => {
      tone(sfx, { freq: midi(base + step), type: 'square', start: i * 0.05, duration: 0.12, gain: 0.07 });
    });
  },
  attack: (sfx) => tone(sfx, { freq: 400, type: 'sawtooth', duration: 0.25, gain: 0.08, slideTo: 1200 }),
  offset: (sfx) => tone(sfx, { freq: 1200, type: 'triangle', duration: 0.18, gain: 0.1, slideTo: 500 }),
  garbage: (sfx) => noise(sfx, { duration: 0.35, gain: 0.35, cutoff: 500 }),
  warning: (sfx) => noise(sfx, { duration: 0.07, gain: 0.07, cutoff: 2400 }),
  garbageLand: (sfx) => noise(sfx, { duration: 0.12, gain: 0.15, cutoff: 700 }),
  over: (sfx) => {
    [67, 64, 60, 55].forEach((note, i) => {
      tone(sfx, { freq: midi(note), type: 'triangle', start: i * 0.14, duration: 0.2, gain: 0.15 });
    });
  },
  win: (sfx) => {
    [72, 76, 79, 84].forEach((note, i) => {
      tone(sfx, { freq: midi(note), type: 'square', start: i * 0.1, duration: 0.18, gain: 0.08 });
    });
  },
  cursor: (sfx) => tone(sfx, { freq: 990, type: 'triangle', duration: 0.04, gain: 0.08 }),
  confirm: (sfx) => {
    tone(sfx, { freq: midi(79), type: 'triangle', duration: 0.08, gain: 0.12 });
    tone(sfx, { freq: midi(84), type: 'triangle', start: 0.06, duration: 0.1, gain: 0.12 });
  },
  cancel: (sfx) => tone(sfx, { freq: midi(72), type: 'triangle', duration: 0.1, gain: 0.1, slideTo: midi(65) }),
  count: (sfx) => tone(sfx, { freq: midi(76), type: 'sine', duration: 0.12, gain: 0.15 }),
  go: (sfx) => tone(sfx, { freq: midi(88), type: 'sine', duration: 0.25, gain: 0.15 }),
};

function playSfx(sfx, name, options) {
  if (!sfx.enabled || !sfx.context || sfx.context.state !== 'running') {
    return;
  }
  if (playSoftContact(sfx, name, options)) return;
  if (playArrivalImpact(sfx, name, options)) return;
  if (!playRecordedSfx(sfx, name, options)) SOUNDS[name === 'land' ? 'lock' : name]?.(sfx, options);
}

export { createSfx, playSfx, prepareSfx, setSfxOptions, unlockSfx };
