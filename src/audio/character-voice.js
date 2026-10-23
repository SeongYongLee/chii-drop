// 스킨이 지정한 짧은 발성을 표현 계층에서만 재생한다. 경기 난수는 사용하지 않는다.
import { loadAudioBuffer } from './buffer-loader.js';
function configureCharacterVoices(sfx, skin, enabled = true) {
  if (sfx.characterVoiceBank !== skin?.voices) stopCharacterVoices(sfx);
  sfx.characterVoiceEnabled = enabled;
  sfx.characterVoiceBank = skin?.voices ?? {};
  if (!enabled) stopCharacterVoices(sfx);
  return preloadCharacterVoices(sfx);
}

async function preloadCharacterVoices(sfx) {
  if (!sfx.context || !sfx.characterVoiceEnabled) return 0;
  sfx.characterVoiceBuffers ??= new Map();
  sfx.characterVoicePending ??= new Map();
  const files = [...new Set(Object.values(sfx.characterVoiceBank ?? {}).flatMap((events) => Object.values(events).flat()))];
  await Promise.all(files.map((file) => {
    if (sfx.characterVoiceBuffers.has(file)) return;
    if (!sfx.characterVoicePending.has(file)) {
      const loading = (async () => {
        try {
          const buffer = await loadAudioBuffer(sfx.context, file);
          sfx.characterVoiceBuffers.set(file, buffer);
        } catch { /* 음성이 없어도 게임과 효과음은 계속 동작한다. */ }
        finally { sfx.characterVoicePending.delete(file); }
      })();
      sfx.characterVoicePending.set(file, loading);
    }
    return sfx.characterVoicePending.get(file);
  }));
  return files.filter((file) => sfx.characterVoiceBuffers.has(file)).length;
}

function stopVoice(voice, time) {
  voice.amp.gain.setTargetAtTime(0, time, .012);
  voice.source.stop(time + .045);
}

function stopCharacterVoices(sfx) {
  for (const voice of sfx.characterVoiceActive?.values() ?? []) stopVoice(voice, sfx.context.currentTime);
  sfx.characterVoiceActive?.clear();
}

function playCharacterVoice(sfx, charId, event, { channel = 0, chain = 1 } = {}) {
  if (!sfx?.characterVoiceEnabled || sfx.context?.state !== 'running') return false;
  const bank = sfx.characterVoiceBank?.[charId];
  const key = event === 'clear' ? `chain${Math.min(7, Math.max(1, chain))}` : event;
  const files = bank?.[key];
  if (!files?.length) return false;
  const available = files.filter((file) => sfx.characterVoiceBuffers?.has(file));
  if (!available.length) return false;
  const t = sfx.context.currentTime;
  sfx.characterVoiceActive ??= new Map();
  sfx.characterVoiceSequence ??= new Map();
  const previous = sfx.characterVoiceActive.get(channel);
  const priority = ['win', 'lose'].includes(event) ? 3 : event === 'damage' ? 1 : 2;
  if (previous && (previous.priority > priority || (previous.priority === priority && t - previous.started < .18))) return false;
  const sequenceKey = `${charId}:${key}:${channel}`;
  const index = sfx.characterVoiceSequence.get(sequenceKey) ?? 0;
  const source = sfx.context.createBufferSource();
  source.buffer = sfx.characterVoiceBuffers.get(available[index % available.length]);
  const amp = sfx.context.createGain();
  amp.gain.value = .7;
  source.connect(amp).connect(sfx.master);
  if (previous) stopVoice(previous, t);
  const voice = { source, amp, started: t, priority };
  source.onended = () => {
    if (sfx.characterVoiceActive.get(channel) === voice) sfx.characterVoiceActive.delete(channel);
    source.disconnect(); amp.disconnect();
  };
  sfx.characterVoiceActive.set(channel, voice);
  sfx.characterVoiceSequence.set(sequenceKey, index + 1);
  source.start(t);
  return true;
}

function playCharacterEvents(sfx, charId, events, channel) {
  // 같은 프레임의 소거·공격은 한 번의 연쇄 발성으로 묶는다.
  const clear = events.find((event) => event.type === 'clear');
  if (clear) playCharacterVoice(sfx, charId, 'clear', { ...clear, channel });
  else if (events.some((event) => event.type === 'garbage')) playCharacterVoice(sfx, charId, 'damage', { channel });
}

export { configureCharacterVoices, preloadCharacterVoices, playCharacterVoice, playCharacterEvents, stopCharacterVoices };
