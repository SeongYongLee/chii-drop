import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMatch } from '../src/engine/match.js';
import { COLS, ROWS } from '../src/engine/rules.js';
import { createEffects, setMood, tickCharacters, tickEffect, tickMatchEffects } from '../src/view/effects.js';
import { pressure, tickSituation, characterPresentation } from '../src/view/character-situation.js';

function field(player, height) {
  player.board.cells.fill(0);
  for (let y = ROWS - height; y < ROWS; y++) player.board.cells[y * COLS] = 1;
}
const ticks = (effect, player, opponent, count) => {
  for (let i = 0; i < count; i++) { tickCharacters([effect]); tickSituation(effect, player, opponent); }
};

test('온라인 확정 프레임은 양쪽 상대 상태를 전달하고 필드 역전도 반영한다', () => {
  const match = createMatch({ seed: 42 }), effects = createEffects(2);
  field(match.players[0], 3); field(match.players[1], 10);
  const before = structuredClone(match);
  for (let frame = 0; frame < 60; frame++) tickMatchEffects(effects, match);
  assert.deepEqual(effects.map(effect => effect.situation), ['leading', 'trailing']);
  assert.deepEqual(match, before);
  field(match.players[0], 10); field(match.players[1], 3);
  for (let frame = 0; frame < 60; frame++) tickMatchEffects(effects, match);
  assert.deepEqual(effects.map(effect => effect.situation), ['trailing', 'leading']);
  // 양쪽 모두 높으면 상대와의 차이가 작으므로 거짓 열세 판정이 생기지 않는다.
  field(match.players[0], 8); field(match.players[1], 8);
  for (let frame = 0; frame < 90; frame++) tickMatchEffects(effects, match);
  assert.deepEqual(effects.map(effect => effect.situation), ['neutral', 'neutral']);
});

test('필드·예고 방해가 지속될 때 우세와 위기를 판단하고 엔진을 바꾸지 않는다', () => {
  const match = createMatch({ seed: 42 });
  const [own, opponent] = match.players, [effect] = createEffects(1);
  field(own, 3); field(opponent, 10);
  const before = structuredClone(match);
  ticks(effect, own, opponent, 59); assert.equal(effect.situation, 'neutral');
  ticks(effect, own, opponent, 1); assert.equal(effect.situation, 'leading');
  assert.equal(effect.situationFrame, 0);
  assert.deepEqual(match, before);
  field(own, 10); field(opponent, 4);
  ticks(effect, own, opponent, 60); assert.equal(effect.situation, 'trailing');
  field(own, 4); own.stocks.a = 36;
  assert.equal(pressure(own), 10);
  ticks(effect, own, opponent, 60); assert.equal(effect.situation, 'trailing');
});

test('잠깐의 높이 변화는 무시하고 안전해져도 90틱 뒤에 대기로 돌아간다', () => {
  const match = createMatch({ seed: 42 }), [own, opponent] = match.players, [effect] = createEffects(1);
  for (let i = 0; i < 8; i++) { field(own, 10); ticks(effect, own, opponent, 30); field(own, 3); ticks(effect, own, opponent, 30); }
  assert.equal(effect.situation, 'neutral');
  field(own, 10); ticks(effect, own, opponent, 60);
  field(own, 3); ticks(effect, own, opponent, 89); assert.equal(effect.situation, 'trailing');
  ticks(effect, own, opponent, 1); assert.equal(effect.situation, 'neutral');
  assert.equal(characterPresentation(effect).mood, 'idle');
});

test('공격·피격·부활·결과 반응이 우선이며 반복 그리기는 시계를 바꾸지 않는다', () => {
  const [effect] = createEffects(1);
  effect.situation = 'leading'; effect.situationFrame = 23;
  assert.deepEqual(characterPresentation(effect), { mood: 'leading', frame: 23 });
  for (const mood of ['happy', 'sad', 'fever', 'win', 'lose']) {
    setMood(effect, mood); effect.characterFrame = 7;
    assert.deepEqual(characterPresentation(effect), { mood, frame: 7 });
  }
  const frame = effect.situationFrame;
  characterPresentation(effect); characterPresentation(effect);
  assert.equal(effect.situationFrame, frame);
});

test('혼자하기는 우세를 만들지 않고 실제 표시 업데이트에도 상대 상태가 전달된다', () => {
  const match = createMatch({ seed: 42 }), [own, opponent] = match.players, [effect] = createEffects(1);
  ticks(effect, own, null, 120); assert.equal(effect.situation, 'neutral');
  field(opponent, 10);
  for (let i = 0; i < 60; i++) tickEffect(effect, own, { table: match.table, opponentSide: 1, opponent });
  assert.equal(effect.situation, 'leading');
});
