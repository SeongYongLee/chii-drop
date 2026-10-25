import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrivalSamples, arrivalTier } from '../src/audio/arrival-impact.js';
import { contactSamples } from '../src/audio/soft-contact.js';
import { playSfx } from '../src/audio/sfx.js';
import { boardSoundEvents } from '../src/audio/board-sounds.js';
import { createEffects, tickEffect } from '../src/view/effects.js';
import { createMatch } from '../src/engine/match.js';

test('직접 공격·상쇄·상쇄 후 공격의 실제 구슬 도착 프레임에만 타격음을 낸다', () => {
  for (const [events, expected] of [
    [[{ type: 'attack' }], [[41, 'attackImpact']]],
    [[{ type: 'offset' }], [[25, 'offsetImpact']]],
    [[{ type: 'offset' }, { type: 'attack' }], [[25, 'offsetImpact'], [64, 'attackImpact']]],
  ]) {
    const match = createMatch({ seed: 7 });
    const player = match.players[0], [effect] = createEffects(1);
    effect.lastClearCenter = { x: 100, y: 200 };
    player.chain = 3;
    player.events = events;
    const actual = [];
    for (let frame = 1; frame <= 90; frame++) {
      const before = structuredClone(player);
      tickEffect(effect, player, { table: match.table, opponentSide: 1 });
      assert.deepEqual(player, before, '도착 효과음은 엔진 상태를 바꾸지 않는다');
      for (const sound of boardSoundEvents(player, player, null, effect.arrivalSounds)) {
        assert.equal(sound.chain, 3, '도착할 때의 현재 연쇄가 아닌 발사 때의 연쇄를 사용한다');
        actual.push([frame, sound.type]);
      }
      player.events = [];
      player.chain = 9;
    }
    assert.deepEqual(actual, expected);
  }
});

const rms = samples => Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);

test('도착음은 과도한 피크 없이 부드러운 경계와 낮춘 음량을 유지한다', () => {
  for (const rate of [22050, 44100, 48000]) {
    for (const type of ['attackImpact', 'offsetImpact']) for (let chain = 1; chain <= 6; chain++) {
      const samples = arrivalSamples(rate, type, chain);
      assert.equal(samples[0], 0);
      assert.equal(Math.abs(samples.at(-1)), 0);
      assert.ok(samples.length / rate <= .181);
      let peak = 0;
      for (const sample of samples) {
        assert.ok(Number.isFinite(sample));
        peak = Math.max(peak, Math.abs(sample));
      }
      assert.ok(peak > .1 && peak <= .181);
      assert.ok(rms(samples) >= .025 && rms(samples) <= .041);
      assert.ok(rms(samples) < rms(contactSamples(rate, 'rotate')));
      assert.deepEqual(samples, arrivalSamples(rate, type, chain));
    }
    assert.notDeepEqual(arrivalSamples(rate, 'attackImpact'), arrivalSamples(rate, 'offsetImpact'));
  }
});

test('1~6연쇄는 서로 다른 음색이며 큰 연쇄는 마지막 음색으로 제한한다', () => {
  for (const event of ['attackImpact', 'offsetImpact']) {
    for (let chain = 1; chain < 6; chain++) {
      assert.notDeepEqual(arrivalSamples(44100, event, chain), arrivalSamples(44100, event, chain + 1));
    }
    assert.deepEqual(arrivalSamples(44100, event, 6), arrivalSamples(44100, event, 19));
  }
  assert.equal(arrivalTier(0), 1);
  assert.equal(arrivalTier(NaN), 1);
  assert.equal(arrivalTier(3), 3);
  assert.equal(arrivalTier(19), 6);
});

test('공격·상쇄 모두 연쇄 단계가 높을수록 실제 파형의 주된 음정이 올라간다', () => {
  const rate = 22050;
  for (const event of ['attackImpact', 'offsetImpact']) {
    let previous = 0;
    for (let chain = 1; chain <= 6; chain++) {
      const samples = arrivalSamples(rate, event, chain);
      let strongest = 0, frequency = 0;
      for (let hz = 250; hz <= 950; hz += 10) {
        let real = 0, imaginary = 0;
        for (let i = 0; i < samples.length; i += 2) {
          const angle = 2 * Math.PI * hz * i / rate;
          real += samples[i] * Math.cos(angle);
          imaginary += samples[i] * Math.sin(angle);
        }
        const power = real * real + imaginary * imaginary;
        if (power > strongest) { strongest = power; frequency = hz; }
      }
      assert.ok(frequency > previous + 20, `${event} ${chain}연쇄: ${previous} → ${frequency}Hz`);
      previous = frequency;
    }
  }
});

test('도착음은 생성한 버퍼를 재사용하고 동시 도착을 누락시키지 않으며 음소거를 따른다', () => {
  let allocations = 0;
  const played = [];
  const context = { currentTime: 10, state: 'running', sampleRate: 44100,
    createBuffer(_, length) { allocations++; const samples = new Float32Array(length); return { getChannelData: () => samples }; },
    createBufferSource: () => ({ connect() {}, disconnect() {}, start() { played.push(this.buffer); } }),
  };
  const sfx = { enabled: true, context, master: {}, recorded: false };
  for (let i = 0; i < 4; i++) playSfx(sfx, 'attackImpact', { channel: i % 2 });
  playSfx(sfx, 'offsetImpact');
  assert.equal(allocations, 2);
  assert.equal(played.length, 5);
  assert.equal(new Set(played.slice(0, 4)).size, 1);
  playSfx(sfx, 'attackImpact', { chain: 6 });
  playSfx(sfx, 'attackImpact', { chain: 12 });
  assert.equal(allocations, 3);
  assert.equal(played.at(-1), played.at(-2));
  assert.notEqual(played[0], played.at(-1));
  sfx.enabled = false;
  playSfx(sfx, 'attackImpact');
  assert.equal(played.length, 7);
});
