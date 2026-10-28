const SETTINGS_KEY = 'chii-drop:settings';
const RECORDS_KEY = 'chii-drop:records';
const STORY_KEY = 'chii-drop:story';

// 첫 실행에는 착지 위치를 표시한다. 사용자가 저장한 켜짐·꺼짐 선택은 유지한다.
const DEFAULT_SETTINGS = { sfx: true, voice: true, music: true, volume: 5,
  effectsVolume: 5, musicVolume: 5, voiceVolume: 5, audioScaleVersion: 2, ghost: true };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

function normalizeSettings(value) {
  const source = object(value), settings = { ...DEFAULT_SETTINGS };
  for (const key of ['sfx', 'voice', 'music', 'ghost']) if (typeof source[key] === 'boolean') settings[key] = source[key];
  for (const key of ['volume', 'effectsVolume', 'musicVolume', 'voiceVolume']) {
    if (Number.isFinite(source[key])) settings[key] = Math.max(0, Math.min(10, source[key]));
  }
  return settings;
}

function defaultRecords() {
  return {
    soloBest: 0,
    soloMaxChain: 0,
    cpu: {
      beginner: { win: 0, lose: 0 },
      easy: { win: 0, lose: 0 },
      normal: { win: 0, lose: 0 },
      hard: { win: 0, lose: 0 },
      expert: { win: 0, lose: 0 },
      master: { win: 0, lose: 0 },
      grandmaster: { win: 0, lose: 0 },
    },
  };
}

// 비공개 창이나 저장소 차단 환경에서도 기본값으로 동작한다.
function read(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장하지 못해도 게임은 계속한다.
  }
}

function loadSettings() {
  const saved = object(read(SETTINGS_KEY));
  const settings = { ...DEFAULT_SETTINGS, ...saved };
  const migrateAudio = Object.keys(saved).length > 0 && saved.audioScaleVersion !== 2;
  if (migrateAudio) {
    // 기존 10을 새 5로 옮긴다. 소수 값도 보존해 이전 조절 비율과 무음을 유지한다.
    for (const [key, fallback] of [['volume', 6], ['effectsVolume', 10], ['musicVolume', 10], ['voiceVolume', 10]]) {
      const value = Number.isFinite(saved[key]) ? saved[key] : fallback;
      settings[key] = Math.min(10, Math.max(0, value)) / 2;
    }
  }
  settings.audioScaleVersion = 2;
  delete settings.skin;
  if (migrateAudio || (saved && Object.hasOwn(saved, 'skin'))) write(SETTINGS_KEY, settings);
  return normalizeSettings(settings);
}

function saveSettings(settings) {
  write(SETTINGS_KEY, normalizeSettings(settings));
}

function loadRecords() {
  const saved = object(read(RECORDS_KEY));
  const base = defaultRecords();
  base.soloBest = count(saved.soloBest);
  base.soloMaxChain = count(saved.soloMaxChain);
  for (const key of Object.keys(base.cpu)) {
    const entry = object(object(saved.cpu)[key]);
    base.cpu[key] = { win: count(entry.win), lose: count(entry.lose) };
  }
  return base;
}

function saveRecords(records) {
  write(RECORDS_KEY, records);
}

// { run, records }: run은 진행 중인 회차(없으면 null), records는 회차를 넘어 남는 기록
function loadStory() {
  return read(STORY_KEY);
}

function saveStory(story) {
  write(STORY_KEY, story);
}

export { DEFAULT_SETTINGS, loadRecords, loadSettings, loadStory, saveRecords, saveSettings, saveStory };
