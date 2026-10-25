import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawFeverEntry, feverEntryCue, FEVER_ENTRY_FRAMES } from '../src/view/fever-entry.js';
import { updateFeverReady } from '../src/app/game-scene.js';
import { createSession } from '../src/app/session.js';
import { FIELD_HEIGHT, FIELD_TOP, FIELD_WIDTH, SIDES, gameTransform, portraitGameLayout } from '../src/view/layout.js';

test('2차전은 3·2·1·시작을 표시하는 동안 경기·CPU·피버 시간을 소비하지 않는다', () => {
  const scene = { feverEntryTimer: FEVER_ENTRY_FRAMES,
    session: createSession({ mode: 'story', seed: 7, cpuSeed: 10, cpuLevel: 1, boss: true }) };
  scene.session.match.players[1].fever = { timer: 900, target: 5 };
  const before = structuredClone(scene.session), cues = [];
  for (let i = 0; i < FEVER_ENTRY_FRAMES; i++) {
    const cue = feverEntryCue(scene.feverEntryTimer);
    if (cues.at(-1) !== cue) cues.push(cue);
    updateFeverReady({ sfx: { enabled: false } }, scene);
    assert.deepEqual(scene.session, before);
  }
  assert.deepEqual(cues, ['3', '2', '1', '시작!']);
  assert.equal(scene.feverEntryTimer, 0);
});

test('피버 시작 안내는 가로·세로 화면에서 진입한 쪽 필드 안으로 제한한다', () => {
  for (const portrait of [false, true]) for (const side of [0, 1]) {
    const calls = [], fills = [];
    const ctx = new Proxy({ portraitScreen: portrait, screenHeight: portrait ? 1600 : 540, globalAlpha: 1,
      fillRect(...args) { fills.push(args); },
    }, { get: (o, key) => key in o ? o[key] : (...args) => calls.push([key, ...args]) });
    drawFeverEntry(ctx, FEVER_ENTRY_FRAMES, { side, playerCount: 2 });
    const translations = calls.filter(c => c[0] === 'translate');
    if (portrait) {
      const box = portraitGameLayout(1600, 2)[side];
      assert.deepEqual(translations, [['translate', box.x, box.y]]);
    } else {
      const t = gameTransform();
      assert.deepEqual(translations, [['translate', t.x, t.y], ['translate', SIDES[side].fieldX, FIELD_TOP]]);
    }
    assert.ok(calls.some(c => c[0] === 'rect' && c.slice(1).join(',') === [0, 0, FIELD_WIDTH, FIELD_HEIGHT].join(',')));
    assert.ok(calls.findIndex(c => c[0] === 'clip') < calls.findIndex(c => c[0] === 'fillText'));
    assert.ok(fills.every(([x, y, w, h]) => x >= 0 && y >= 0 && x + w <= FIELD_WIDTH && y + h <= FIELD_HEIGHT));
    calls.length = 0; fills.length = 0;
    drawFeverEntry(ctx, 0, { side }); assert.equal(calls.length + fills.length, 0);
  }
});
