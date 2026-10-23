// 짧은 회전·접촉음. 녹음 노이즈 없이 위상이 연속적인 사인파와 부드러운 양끝만 사용한다.
function contactSamples(sampleRate, event, variant = 0) {
  const landing = event === 'land' || event === 'lock';
  const variation = [1, .97, 1.025, .985][variant % 4];
  const duration = landing ? .105 : .062;
  const startFrequency = (landing ? 190 : 540) * variation;
  const endFrequency = (landing ? 90 : 360) * variation;
  const length = Math.ceil(sampleRate * duration);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const phase = 2 * Math.PI * (startFrequency * t + (endFrequency - startFrequency) * t * t / (2 * duration));
    const attack = Math.sin(Math.min(1, t / .006) * Math.PI / 2) ** 2;
    const release = Math.sin(Math.min(1, (length - 1 - i) / sampleRate / .018) * Math.PI / 2) ** 2;
    const envelope = attack * release * Math.exp(-t / (landing ? .027 : .019));
    samples[i] = (Math.sin(phase) + .08 * Math.sin(2 * phase)) * envelope * (landing ? .28 : .23);
  }
  return samples;
}

function playSoftContact(sfx, event, options = {}) {
  if (!['rotate', 'land', 'lock'].includes(event)) return false;
  const name = event === 'lock' ? 'land' : event;
  const now = sfx.context.currentTime;
  const key = `${options.channel ?? 'ui'}:${name}`;
  sfx.contactLast ??= new Map();
  if (now - (sfx.contactLast.get(key) ?? -Infinity) < (name === 'land' ? .055 : .035)) return true;
  sfx.contactLast.set(key, now);
  sfx.contactCursor ??= new Map();
  const turn = sfx.contactCursor.get(key) ?? 0;
  sfx.contactCursor.set(key, turn + 1);
  const variant = turn % 4;
  const bufferKey = `${name}:${variant}`;
  sfx.contactBuffers ??= new Map();
  if (!sfx.contactBuffers.has(bufferKey)) {
    const samples = contactSamples(sfx.context.sampleRate, name, variant);
    const buffer = sfx.context.createBuffer(1, samples.length, sfx.context.sampleRate);
    buffer.getChannelData(0).set(samples);
    sfx.contactBuffers.set(bufferKey, buffer);
  }
  const source = sfx.context.createBufferSource();
  source.buffer = sfx.contactBuffers.get(bufferKey);
  source.connect(sfx.master);
  source.onended = () => source.disconnect();
  source.start(now);
  return true;
}

export { contactSamples, playSoftContact };
