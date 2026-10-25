// 자체 합성한 부드러운 나무·막 타격음. 연쇄 단계는 음량보다 공명과 잔향을 바꾼다.
function arrivalTier(chain = 1) {
  return Number.isFinite(chain) ? Math.min(6, Math.max(1, Math.floor(chain))) : 1;
}

function arrivalSamples(sampleRate, event, chain = 1) {
  const tier = arrivalTier(chain) - 1;
  const offset = event === 'offsetImpact';
  const duration = [.085, .095, .11, .125, .145, .17][tier];
  const frequency = [320, 390, 470, 560, 650, 720][tier] * (offset ? 1.16 : 1);
  const decay = [.017, .02, .024, .029, .035, .043][tier];
  const samples = new Float32Array(Math.ceil(sampleRate * duration));
  const smoothing = 1 - Math.exp(-2 * Math.PI * 1300 / sampleRate);
  let noiseState = 1937, filtered = 0, energy = 0, peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate, phase = 2 * Math.PI * frequency * t;
    noiseState = (Math.imul(noiseState, 1664525) + 1013904223) >>> 0;
    filtered += smoothing * (noiseState / 2147483648 - 1 - filtered);
    const body = .6 * Math.sin(phase) * Math.exp(-t / decay)
      + .23 * Math.sin(phase * 2.76) * Math.exp(-t / (decay * .45))
      + .07 * Math.sin(phase * 5.4) * Math.exp(-t / (decay * .2));
    const weight = tier / 5 * .22 * Math.sin(phase * 2) * Math.exp(-t / (decay * 1.2));
    const contact = filtered * .07 * Math.exp(-t / .006);
    const attack = Math.sin(Math.min(1, t / .0035) * Math.PI / 2) ** 2;
    const release = Math.sin(Math.min(1, (samples.length - 1 - i) / sampleRate / .012) * Math.PI / 2) ** 2;
    samples[i] = (body + weight + contact) * attack * release;
    peak = Math.max(peak, Math.abs(samples[i]));
    energy += samples[i] ** 2;
  }
  // 강한 연쇄도 같은 청감 레벨에 가깝게 유지하고, 이전 버전의 큰 피크를 억제한다.
  const scale = Math.min(.04 / Math.sqrt(energy / samples.length), .18 / peak);
  for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  return samples;
}

function playArrivalImpact(sfx, event, options = {}) {
  if (!['attackImpact', 'offsetImpact'].includes(event)) return false;
  const tier = arrivalTier(options.chain), key = event + ':' + tier;
  sfx.arrivalBuffers ??= new Map();
  if (!sfx.arrivalBuffers.has(key)) {
    const samples = arrivalSamples(sfx.context.sampleRate, event, tier);
    const buffer = sfx.context.createBuffer(1, samples.length, sfx.context.sampleRate);
    buffer.getChannelData(0).set(samples);
    sfx.arrivalBuffers.set(key, buffer);
  }
  const source = sfx.context.createBufferSource();
  source.buffer = sfx.arrivalBuffers.get(key);
  source.connect(sfx.master);
  source.onended = () => source.disconnect();
  source.start(sfx.context.currentTime);
  return true;
}

export { arrivalSamples, arrivalTier, playArrivalImpact };
