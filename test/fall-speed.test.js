import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, stepSession } from '../src/app/session.js';
import { createMatch, stepMatch } from '../src/engine/match.js';
import { FALL_SPEED_TABLE, STORY_RULES } from '../src/engine/rules.js';
import { INPUT } from '../src/engine/input.js';
import { RollbackMatch } from '../src/net/rollback.js';

test('연습·CPU·로컬·온라인은 자연 낙하가 절반이며 스토리는 별도 속도표를 쓴다', () => {
  for (const mode of ['solo', 'cpu', 'versus']) {
    let session = createSession({ mode, seed: 4, cpuLevel: 'normal', cpuSeed: 5 });
    while (session.phase === 'ready' || session.match.players[0].phase !== 'control') session = stepSession(session, [0, 0]);
    const initial = session.match.players[0].piece.h;
    for (let f = 0; f < 60; f++) session = stepSession(session, [0, 0]);
    assert.equal(initial - session.match.players[0].piece.h, 60, mode);
  }
  assert.equal(new RollbackMatch(4, 0).state.players[0].rules.fallTable[0], 8);
  const story = createSession({ mode: 'story', seed: 4, cpuLevel: 'normal', cpuSeed: 5,
    story: { startLevel: 6, colors: 4 } });
  assert.equal(story.match.players[0].rules, STORY_RULES);
  assert.equal(story.match.players[0].rules.fallTable[6], 5);
});

test('스토리 낮은 레벨은 천천히 떨어지고 결승 속도와 소프트 드롭은 유지한다', () => {
  const levels = [[0, 2], [2, 2.5], [5, 4], [8, 8], [9, 20], [10, 30], [12, 45],
    [13, 60], [14, 72], [16, 96], [17, 128], [23, 254]];
  for (const [startLevel, expected] of levels) {
    let natural = createMatch({ seed: 4, ruleset: 'story', startLevel });
    let soft = createMatch({ seed: 4, ruleset: 'story', startLevel });
    while (natural.players[0].phase !== 'control') {
      natural = stepMatch(natural, [0, 0]);
      soft = stepMatch(soft, [0, 0]);
    }
    const initial = natural.players[0].piece.h;
    for (let f = 0; f < 8; f++) {
      natural = stepMatch(natural, [0, 0]);
      soft = stepMatch(soft, [INPUT.DOWN, INPUT.DOWN]);
    }
    for (const player of natural.players) {
      assert.equal(initial - player.piece.h + player.piece.acc / 65536, expected, `story ${startLevel}`);
    }
    for (const player of soft.players) {
      assert.equal(initial - player.piece.h, Math.max(128, expected), `story soft ${startLevel}`);
    }
  }
  for (let level = 1; level < STORY_RULES.fallTable.length; level++) {
    assert.ok(STORY_RULES.fallTable[level] >= STORY_RULES.fallTable[level - 1], `속도가 역전된 레벨 ${level}`);
  }
});

test('모든 대전 레벨에서 절반 속도로 내리고 소프트 드롭 속도는 유지한다', () => {
  for (let level = 0; level < FALL_SPEED_TABLE.length; level++) {
    let normal = createMatch({ seed: 4, startLevel: level });
    let soft = createMatch({ seed: 4, startLevel: level });
    while (normal.players[0].phase !== 'control') {
      normal = stepMatch(normal, [0, 0]); soft = stepMatch(soft, [0, 0]);
    }
    const h = normal.players[0].piece.h;
    for (let f = 0; f < 8; f++) {
      normal = stepMatch(normal, [0, 0]);
      soft = stepMatch(soft, [INPUT.DOWN, 0]);
    }
    assert.equal(h - normal.players[0].piece.h, Math.floor(FALL_SPEED_TABLE[level] / 2), `level ${level}`);
    assert.equal(h - soft.players[0].piece.h, 128, `soft level ${level}`);
  }
});
