function mixLevels(settings = {}) {
  const level = (key, fallback) => Number.isFinite(settings[key])
    ? Math.min(10, Math.max(0, settings[key])) / 10 : fallback;
  // 곡별 보정은 유지하면서 작은 배경음의 기준 출력을 1.5배 높인다.
  return { master: level('volume', .6), effects: level('effectsVolume', 1),
    music: level('musicVolume', 1) * 1.5, voice: level('voiceVolume', 1) };
}

export { mixLevels };
