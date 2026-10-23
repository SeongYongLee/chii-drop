import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contactSamples, playSoftContact } from '../src/audio/soft-contact.js';

test('회전·착지 파형은 시작·끝이 무음이며 고주파 불연속과 클리핑이 없다', () => {
  for (const rate of [22050, 44100, 48000]) for (const event of ['rotate', 'land']) for (let variant = 0; variant < 4; variant++) {
    const samples = contactSamples(rate, event, variant);
    assert.equal(samples[0], 0); assert.equal(Math.abs(samples.at(-1)), 0);
    let peak = 0, jump = 0, energy = 0;
    for (let i = 0; i < samples.length; i++) {
      assert.ok(Number.isFinite(samples[i]));
      peak = Math.max(peak, Math.abs(samples[i]));
      jump = Math.max(jump, Math.abs(samples[i] - (samples[i - 1] ?? 0)));
      energy += samples[i] ** 2;
    }
    assert.ok(peak > .08 && peak < .25);
    assert.ok(jump * rate < 1100);
    assert.ok(energy > 1);
    assert.deepEqual(samples, contactSamples(rate, event, variant));
  }
});

test('착지·고정 중복은 한 번만 재생하고 두 플레이어의 접촉음은 독립적이다', () => {
  let starts = 0, allocations = 0;
  const context = { currentTime: 0, sampleRate: 44100,
    createBuffer(_, length) { allocations++; const data = new Float32Array(length); return { getChannelData: () => data }; },
    createBufferSource: () => ({ connect() {}, disconnect() {}, start() { starts++; } }),
  };
  const sfx = { context, master: {} };
  assert.equal(playSoftContact(sfx, 'clear'), false);
  playSoftContact(sfx, 'land', { channel: 0 });
  playSoftContact(sfx, 'lock', { channel: 0 });
  playSoftContact(sfx, 'land', { channel: 1 });
  assert.equal(starts, 2); assert.equal(allocations, 1);
  for (let i = 1; i <= 8; i++) { context.currentTime = i * .1; playSoftContact(sfx, 'land', { channel: 0 }); }
  assert.equal(starts, 10); assert.equal(allocations, 4);
});
