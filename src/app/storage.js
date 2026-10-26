const SETTINGS_KEY = 'chii-drop:settings';
const RECORDS_KEY = 'chii-drop:records';
const STORY_KEY = 'chii-drop:story';

// 첫 실행에는 착지 위치를 표시한다. 사용자가 저장한 켜짐·꺼짐 선택은 유지한다.
const DEFAULT_SETTINGS = { sfx: true, voice: true, music: true, volume: 5,
  effectsVolume: 5, musicVolume: 5, voiceVolume: 5, audioScaleVersion: 2, ghost: true };

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
  const saved = read(SETTINGS_KEY);
  const settings = { ...DEFAULT_SETTINGS, ...saved };
  const migrateAudio = saved && saved.audioScaleVersion !== 2;
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
  return settings;
}

function saveSettings(settings) {
  const current = { ...settings, audioScaleVersion: 2 };
  delete current.skin;
  write(SETTINGS_KEY, current);
}

function loadRecords() {
  const saved = read(RECORDS_KEY) ?? {};
  const base = defaultRecords();
  return { ...base, ...saved, cpu: { ...base.cpu, ...saved.cpu } };
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
