function mixLevels(settings = {}) {
  const level = (key, fallback) => Number.isFinite(settings[key])
    ? Math.min(10, Math.max(0, settings[key])) / 10 : fallback;
  return { master: level('volume', .6), effects: level('effectsVolume', 1),
    music: level('musicVolume', 1), voice: level('voiceVolume', 1) };
}

export { mixLevels };
