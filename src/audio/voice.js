// 대사가 한 글자씩 나올 때 내는 캐릭터별 웅얼거림 소리. 녹음·외부 음원 없이 Web Audio로 합성한다.
// 같은 대사는 항상 같은 소리가 나도록 글자 코드로 음을 정한다.

const WAVES = ['sine', 'triangle', 'square'];
const SILENT = new Set(' \n\t…·.,!?~-"“”‘’\'()[]');

// voice: { pitch(기준 Hz), wave, rate(몇 글자마다 한 번), spread(음 변화 폭, 반음), length(초) }
function hashOf(text) {
  let hash = 2166136261;
  for (const ch of String(text)) {
    hash = Math.imul(hash ^ ch.codePointAt(0), 16777619) >>> 0;
  }
  return hash;
}

// 대본에 voice가 없으면 ID로 목소리를 만든다.
function voiceProfile(charId, override = {}) {
  const hash = hashOf(charId);
  return {
    pitch: 260 + (hash % 360),
    wave: WAVES[(hash >>> 9) % WAVES.length],
    rate: 2 + ((hash >>> 13) % 2),
    spread: 2 + ((hash >>> 17) % 5),
    length: 0.05 + ((hash >>> 21) % 3) * 0.01,
    ...override,
  };
}

const MOOD_SHIFT = { happy: 3, win: 4, sad: -3, lose: -5, fever: -9, idle: 0 };

function semitones(freq, steps) {
  return freq * 2 ** (steps / 12);
}

// text의 index번째 글자를 보일 때 낼 소리. 소리를 내지 않으면 null.
function blipFor(profile, text, index, mood = 'idle') {
  const chars = [...text];
  const ch = chars[index];
  if (ch === undefined || SILENT.has(ch)) {
    return null;
  }
  const spoken = chars.slice(0, index + 1).filter((c) => !SILENT.has(c)).length - 1;
  if (spoken % profile.rate !== 0) {
    return null;
  }
  const code = ch.codePointAt(0);
  const range = profile.spread * 2 + 1;
  let steps = (Math.imul(code, 2654435761) >>> 0) % range - profile.spread;
  steps += MOOD_SHIFT[mood] ?? 0;
  // 물음표로 끝나는 문장은 끝 세 글자에서 억양을 올린다.
  const rest = chars.slice(index + 1);
  const remaining = rest.filter((c) => !SILENT.has(c)).length;
  if (rest.includes('?') && remaining < 3) {
    steps += 5 - remaining;
  }
  return {
    freq: semitones(profile.pitch, steps),
    duration: profile.length,
    wave: mood === 'fever' ? 'sawtooth' : profile.wave,
    gain: 0.09,
  };
}

function playVoiceBlip(sfx, blip, volume = 1) {
  const { context, master } = sfx;
  if (!blip || !context || context.state !== 'running') {
    return;
  }
  const t = context.currentTime;
  const osc = context.createOscillator();
  const filter = context.createBiquadFilter();
  const amp = context.createGain();
  osc.type = blip.wave;
  osc.frequency.setValueAtTime(blip.freq, t);
  osc.frequency.exponentialRampToValueAtTime(blip.freq * 0.92, t + blip.duration);
  // 입 모양처럼 고역을 깎아 말소리에 가깝게 한다.
  filter.type = 'lowpass';
  filter.frequency.value = blip.freq * 4;
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(blip.gain * volume, t + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + blip.duration);
  osc.connect(filter).connect(amp).connect(master);
  osc.start(t);
  osc.stop(t + blip.duration + 0.02);
}

export { blipFor, playVoiceBlip, voiceProfile };
