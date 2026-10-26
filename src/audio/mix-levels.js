function mixLevels(settings = {}) {
  const level = (key, fallback) => Number.isFinite(settings[key])
    ? Math.min(10, Math.max(0, settings[key])) / 10 : fallback;
  // 곡별 보정을 유지하고 배경음 기준 출력을 초기 대비 3.375배로 맞춘다.
  return { master: level('volume', .6), effects: level('effectsVolume', 1),
    music: level('musicVolume', 1) * 3.375, voice: level('voiceVolume', 1) };
}

export { mixLevels };
