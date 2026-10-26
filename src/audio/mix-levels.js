function mixLevels(settings = {}) {
  const level = (key, fallback) => Number.isFinite(settings[key])
    ? Math.min(10, Math.max(0, settings[key])) / 5 : fallback;
  // 5가 기준 출력이다. 음악은 직전 기준보다 20% 높이고 목소리는 10% 낮춘다.
  return { master: level('volume', 1), effects: level('effectsVolume', 1),
    music: level('musicVolume', 1) * 4.05, voice: level('voiceVolume', 1) * .9 };
}

export { mixLevels };
