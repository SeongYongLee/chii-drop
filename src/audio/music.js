import { musicTracks } from './music-config.js';

// 긴 음악은 Audio 요소로 재생하며 경기 시뮬레이션·효과음 난수와 분리한다.
function configureMusic(sfx, skin, { enabled = true, volume = .6, scene = sfx.musicScene ?? 'menu', selectionKey, chooseNew = false, random = musicRandom } = {}) {
  const assigned = musicTracks(skin?.music?.scenes?.[scene]);
  const pool = assigned.length ? assigned : musicTracks(skin?.music);
  const signature = JSON.stringify(pool);
  if (chooseNew || sfx.musicScene !== scene || sfx.musicSignature !== signature || sfx.musicSelectionKey !== selectionKey) {
    sfx.musicTrack = pool.length ? pool[pool.length === 1 ? 0 : Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length))) ] : null;
  }
  sfx.musicSignature = signature;
  sfx.musicSelectionKey = selectionKey;
  const track = sfx.musicTrack;
  sfx.musicScene = scene;
  sfx.musicEnabled = enabled;
  if (sfx.musicFile !== track?.file) {
    sfx.musicAudio?.pause();
    sfx.musicFile = track?.file;
    sfx.musicAudio = null;
    if (track?.file) {
      sfx.musicCache ??= new Map();
      if (!sfx.musicCache.has(track.file)) {
        const audio = new Audio(track.file);
        audio.loop = true; audio.preload = 'none';
        sfx.musicCache.set(track.file, audio);
      }
      sfx.musicAudio = sfx.musicCache.get(track.file);
    }
  }
  if (sfx.musicAudio) sfx.musicAudio.volume = Math.min(1, Math.max(0, volume * (track?.gain ?? .15)));
  if (!enabled) sfx.musicAudio?.pause();
  else if (sfx.musicUnlocked && !globalThis.document?.hidden) startMusic(sfx);
}

function startMusic(sfx) {
  if (!sfx.musicEnabled || !sfx.musicAudio || !sfx.musicAudio.paused) return;
  // 자동 재생이 차단되면 다음 사용자 입력에서 다시 시도한다.
  void sfx.musicAudio.play()?.catch(() => {});
}

function unlockMusic(sfx) {
  sfx.musicUnlocked = true;
  if (!globalThis.document?.hidden) startMusic(sfx);
}

function syncMusicVisibility(sfx) {
  if (globalThis.document?.hidden) sfx.musicAudio?.pause();
  else if (sfx.musicUnlocked) startMusic(sfx);
}

export { configureMusic, unlockMusic, syncMusicVisibility };

// Presentation-only randomness; never consumes a match or CPU generator. Repeats are allowed.
function musicRandom() { return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296; }
