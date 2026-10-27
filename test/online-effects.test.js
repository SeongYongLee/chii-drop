import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, stepMatch } from '../src/engine/match.js';
import { createEffects, observeMatchEffects, animateMatchEffects, tickCharacters, orbArrival } from '../src/view/effects.js';

function playing() {
  let state = createMatch({ seed: 81 });
  for (let frame = 0; frame < 12; frame++) state = stepMatch(state, [0, 0]);
  return state;
}

test('online NEXT advances every display tick instead of jumping with three-frame packets', () => {
  let state = playing();
  const effects = createEffects(2);
  for (let frame = 0; frame < 3; frame++) {
    state = stepMatch(state, [0, 0]); observeMatchEffects(effects, state);
  }
  assert.equal(effects[0].next.frame, 0);
  animateMatchEffects(effects, state); // first display of the new pair
  const positions = [];
  for (let frame = 0; frame < 8; frame++) {
    animateMatchEffects(effects, state);
    positions.push(effects[0].next.frame);
  }
  assert.deepEqual(positions, [1, 2, 3, 4, 5, 6, 7, 8]);
  const before = effects[0].next.frame;
  for (let frame = 0; frame < 3; frame++) {
    state = stepMatch(state, [0, 0]); observeMatchEffects(effects, state);
  }
  assert.equal(effects[0].next.frame, before);
});

test('chain labels, particles and character clips move smoothly between network arrivals without duplicate events', () => {
  const state = playing(), effects = createEffects(2);
  state.players[0].events = [{ type: 'clear', chain: 1, points: 40, groups: [{ cells: [{ x: 0, y: 12 }] }] }];
  observeMatchEffects(effects, state);
  effects[0].particles.push({ x: 20, y: 20, vx: 1, vy: -1, gravity: .5, age: 0, still: 0, life: 30 });
  const before = structuredClone(state);
  for (let frame = 1; frame <= 6; frame++) {
    tickCharacters(effects); animateMatchEffects(effects, state);
    assert.equal(effects[0].chainLabels.length, 1);
    assert.equal(effects[0].chainLabels[0].age, frame);
    assert.equal(effects[0].particles[0].age, frame);
    assert.equal(effects[0].fieldChain.frame, frame);
  }
  assert.deepEqual(state, before);
});

test('orb arrival sounds occur once on the display clock even with no new packet', () => {
  const state = playing(), effects = createEffects(2);
  state.players[0].events = [{ type: 'attack', amount: 1 }];
  observeMatchEffects(effects, state);
  const frames = orbArrival(effects[0].orbs[0]) + 3, sounds = [];
  for (let frame = 0; frame < frames; frame++) {
    animateMatchEffects(effects, state);
    sounds.push(...effects[0].arrivalSounds);
  }
  assert.deepEqual(sounds.map(sound => sound.type), ['attackImpact']);
});
