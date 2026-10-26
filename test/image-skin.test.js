import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadImageSkin, skinImageFiles } from '../src/view/skins/image-skin.js';
import { situationMotionAt } from '../src/view/character-situation.js';

async function animatedSkin(t, moods, extra = [], metadata = {}) {
  const loads = [];
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({
    characters: [{ id: 'char-1', name: 'Character', moods }, ...extra], ...metadata,
  }) }));
  const PreviousImage = globalThis.Image;
  globalThis.Image = class {
    width = 300; height = 100;
    set src(url) { this.url = url; loads.push(url); queueMicrotask(() => url.includes('missing') ? this.onerror() : this.onload()); }
  };
  t.after(() => { globalThis.Image = PreviousImage; });
  const skin = await loadImageSkin('skin');
  const draws = [];
  const ctx = { drawImage: (...args) => draws.push(args) };
  const draw = (frame, mood = 'idle', reducedMotion = false, motion = {}) => {
    skin.drawCharacter(ctx, 'char-1', mood, 0, 0, 100, { frame, reducedMotion, ...motion });
    return draws.at(-1).slice(1);
  };
  return { draw, loads, skin, ctx, draws };
}

test('달리기 컷의 동선과 방향 반전은 크기를 유지하고 움직임 줄이기는 제자리 대표 컷을 쓴다', async t => {
  const clip = { file: 'run.png', columns: 3, loop: false, poster: 1,
    frames: [{ frame: 0, duration: 4 }, { frame: 1, duration: 4, flipX: true }, { frame: 2, duration: 5 }],
    travel: [{ frame: 0, x: 0, y: 0 }, { frame: 4, x: .2, y: -.1 }, { frame: 12, x: 0, y: 0 }] };
  const { draw, ctx } = await animatedSkin(t, { idle: 'idle.png', chain5: clip });
  const transforms = [];
  Object.assign(ctx, { save: () => transforms.push('save'), restore: () => transforms.push('restore'),
    translate: (...args) => transforms.push(args), scale: (...args) => transforms.push(args) });
  assert.deepEqual(draw(0, 'happy', false, { chain: 5 }).slice(4), [0, 0, 100, 100]);
  assert.deepEqual(draw(4, 'happy', false, { chain: 5 }).slice(4), [20, -10, 100, 100]);
  assert.deepEqual(transforms.slice(-4), ['save', [140, 0], [-1, 1], 'restore']);
  assert.deepEqual(draw(4, 'happy', true, { chain: 5 }).slice(4), [0, 0, 100, 100]);
  assert.deepEqual(draw(12, 'happy', false, { chain: 5 }).slice(4), [0, 0, 100, 100]);
});

test('관전 캐릭터는 걷기 컷을 교대로 재생하고 정지 모드에서는 대표 컷을 쓴다', async t => {
  const { skin, ctx, draws, loads } = await animatedSkin(t, { idle: 'idle.png' }, [], {
    mascot: { moods: {
      idle: { file: 'mascot.png', columns: 3, poster: 0, frames: [0, 1, 2] },
      walk: { file: 'mascot.png', columns: 3, poster: 0, frames: [1, 0, 2, 0] },
    } },
  });
  assert.ok(skin.drawMascot);
  for (const [frame, expected] of [[0, 100], [6, 0], [12, 200], [18, 0], [24, 100]]) {
    skin.drawMascot(ctx, 'walk', 0, 0, 32, { frame });
    assert.equal(draws.at(-1)[1], expected);
  }
  skin.drawMascot(ctx, 'walk', 0, 0, 32, { frame: 12, reducedMotion: true });
  assert.equal(draws.at(-1)[1], 100);
  assert.equal(loads.filter(url => url === 'skin/mascot.png').length, 1);
});

test('필드 연쇄 연출은 스킨에서 명시적으로 허용한 캐릭터만 사용한다', async t => {
  const { skin } = await animatedSkin(t, { idle: 'idle.png' }, [
    { id: 'char-2', name: 'Second', fieldChainReaction: true, moods: { idle: 'idle.png' } },
    { id: 'char-3', name: 'Third', fieldChainReaction: false, moods: { idle: 'idle.png' } },
  ]);
  assert.deepEqual(skin.fieldChainCharacters, ['char-2']);
});

test('선택창·경기 배율은 모든 표정의 정지·동작 컷과 실루엣의 중심·발 위치를 유지한다', async (t) => {
  const moods = Object.fromEntries(['idle', 'happy', 'sad', 'win', 'lose', 'leading', 'trailing'].map(mood =>
    [mood, { file: `${mood}.png`, columns: 3, offsetY: -10, frames: [0, 1, 2] }]));
  const { draw, ctx } = await animatedSkin(t, moods, [], {
    characters: [{ id: 'char-1', name: 'Character', moods, selectionPortrait: { scale: 1.2, baseline: .9 } }],
  });
  ctx.save = () => {}; ctx.restore = () => {}; ctx.globalAlpha = 1;
  for (const mood of Object.keys(moods)) for (const reduced of [false, true]) {
    for (const frame of [0, 6, 12]) {
      const movement = situationMotionAt(mood, frame, reduced);
      const plain = draw(frame, mood, reduced).slice(4);
      assert.ok(Math.abs(plain[0] + plain[2] / 2 - (50 + movement.x * 100)) < 1e-10);
      assert.ok(Math.abs(plain[1] + plain[3] - 90) < 1e-10);
      for (const presentation of ['selection', 'battle']) for (const silhouette of [false, true]) {
        const [, , , , x, y, width, height] = draw(frame, mood, reduced, { presentation, silhouette });
        assert.ok(Math.abs(x + width / 2 - (50 + movement.x * 120)) < 1e-10);
        assert.ok(Math.abs(y + height - 90) < 1e-10);
        assert.equal(width, 120 * movement.sx);
        assert.equal(height, 120 * movement.sy);
      }
    }
  }
});

test('우세·열세는 긴 시간에도 대표 표정을 유지하며 작은 움직임만 반복한다', async (t) => {
  const { draw } = await animatedSkin(t, Object.fromEntries(['leading', 'trailing'].map(mood =>
    [mood, { file: `${mood}.png`, columns: 3, poster: 1,
      frames: [{ frame: 0, duration: 90 }, { frame: 1, duration: 32 }, { frame: 2, duration: 90 }] }])));
  for (const mood of ['leading', 'trailing']) {
    const positions = new Set();
    for (let frame = 0; frame < 1440; frame++) {
      const [sx, sy, sw, sh, x, y, w, h] = draw(frame, mood);
      assert.deepEqual([sx, sy, sw, sh], [100, 0, 100, 100]);
      assert.ok(Math.abs(x + w / 2 - 50) <= .401);
      assert.ok(Math.abs(w - 100) <= .301 && Math.abs(h - 100) <= .801);
      assert.equal(y + h, 100);
      positions.add(x);
      assert.deepEqual(draw(frame, mood, true), [100, 0, 100, 100, 0, 0, 100, 100]);
    }
    assert.ok(positions.size > 100);
    assert.deepEqual(draw(300, mood), draw(300, mood));
  }
});

test('연쇄 단계는 다른 클립을 고르고 일반 기쁨·결과 표정과 누락 스킨은 유지한다', async (t) => {
  const moods = { idle: 'idle.png', happy: 'happy.png', win: 'win.png', lose: 'lose.png' };
  for (const tier of [1, 2, 3, 4, 5, 6, 7]) moods[`chain${tier}`] = {
    file: `chain${tier}.png`, columns: 3, loop: false, poster: 1,
    frames: [{ frame: 0, duration: 4 + tier }, { frame: 1, duration: 3 }, { frame: 2, duration: 5 }],
  };
  const { draw, draws, loads, skin } = await animatedSkin(t, moods);
  for (const [chain, tier] of [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [19, 7]]) {
    draw(0, 'happy', false, { chain });
    assert.equal(draws.at(-1)[0].url, `skin/chain${tier}.png`);
    assert.equal(skin.fieldChainFrames('char-1', chain),12+tier);
    assert.equal(draw(999, 'happy', false, { chain })[0], 200);
    assert.equal(draw(0, 'happy', true, { chain })[0], 100);
  }
  for (const mood of ['happy', 'win', 'lose', 'idle']) {
    draw(0, mood, false, { chain: mood === 'happy' ? 0 : 7 });
    assert.equal(draws.at(-1)[0].url, `skin/${mood}.png`);
  }
  assert.equal(loads.length, 11);
});

test('일부 연쇄 컷만 있는 스킨은 요청 단계 이하의 가장 가까운 컷으로 대체한다', async t => {
  const { draw, draws, skin } = await animatedSkin(t, { idle:'idle.png',happy:'happy.png',
    chain1:'first.png',chain3:'third.png',chain5:'fifth.png' });
  for (const [chain,file] of [[2,'first'],[4,'third'],[6,'fifth'],[7,'fifth']]) {
    draw(0,'happy',false,{chain});
    assert.equal(draws.at(-1)[0].url,`skin/${file}.png`);
    assert.equal(skin.fieldChainFrames('char-1',chain),80);
  }
});

test('연쇄 전용 컷이 없으면 기존 기쁨으로 안전하게 대체한다', async (t) => {
  const { draw, draws } = await animatedSkin(t, { idle: 'idle.png', happy: 'happy.png', chain7: 'missing.png' });
  for (const chain of [1, 5, 7]) {
    draw(10, 'happy', false, { chain });
    assert.equal(draws.at(-1)[0].url, 'skin/happy.png');
  }
});

test('우세·위기 전용 클립과 대표 컷을 재생하고 없는 스킨은 기쁨·걱정으로 대체한다', async (t) => {
  const { draw, draws } = await animatedSkin(t, {
    idle: 'idle.png', happy: 'happy.png', sad: 'sad.png',
    leading: { file: 'leading.png', columns: 3, poster: 1, frames: [0, 1, 2] },
    trailing: 'missing.png',
  });
  draw(6, 'leading'); assert.equal(draws.at(-1)[0].url, 'skin/leading.png');
  assert.equal(draw(0, 'leading', true)[0], 100);
  draw(8, 'trailing'); assert.equal(draws.at(-1)[0].url, 'skin/sad.png');
  draw(8, 'happy'); assert.equal(draws.at(-1)[0].url, 'skin/happy.png');
});

test('대기 몸동작은 idle에서만 나오고 공격·피격·결과와 움직임 줄이기에 끼어들지 않는다', async (t) => {
  const { draw, draws, skin, ctx } = await animatedSkin(t, { idle: 'idle.png', happy: 'happy.png', sad: 'sad.png',
    win: 'win.png', lose: 'lose.png' }, [{ id: 'moving', name: 'Moving', idleMotion: { period: 360, jitter: 60 },
    moods: { idle: 'idle.png', happy: 'happy.png', sad: 'sad.png', win: 'win.png', lose: 'lose.png',
      idleMove1: { file: 'move.png', columns: 3, loop: false,
        frames: [{ frame: 0, duration: 4 }, { frame: 1, duration: 8 }, { frame: 2, duration: 4 }] } } }]);
  let active = -1;
  const moving = (frame, mood = 'idle', extra = {}) => {
    skin.drawCharacter(ctx, 'moving', mood, 0, 0, 100, { frame, seed: 42, reducedMotion: false, ...extra });
    return draws.at(-1)[0].url;
  };
  const sequence = Array.from({ length: 720 }, (_, frame) => moving(frame));
  active = sequence.findIndex((file) => file === 'skin/move.png');
  assert.ok(active > 0);
  for (const mood of ['happy', 'sad', 'win', 'lose']) assert.equal(moving(active, mood), `skin/${mood}.png`);
  assert.equal(moving(active, 'idle', { reducedMotion: true }), 'skin/idle.png');
  assert.equal(moving(0, 'idle', { blinkFrame: active }), 'skin/idle.png');
  for (let frame = 719; frame >= 0; frame--) assert.equal(moving(frame), sequence[frame]);
  for (const mood of ['idle', 'happy', 'sad', 'win', 'lose']) {
    draw(180, mood, false, { seed: 42 });
    assert.equal(draws.at(-1)[0].url, `skin/${mood}.png`);
  }
});

test('여러 시트의 컷을 연결해도 대기와 시작·종료의 그림 및 표시 위치가 같다', async (t) => {
  const rest = { file: 'idle.png', rect: { x: 0, y: 0, width: 100, height: 100 }, scale: 0.8 };
  const { draw, draws, loads } = await animatedSkin(t, {
    idle: { ...rest },
    happy: { file: 'reaction.png', columns: 3, scale: 0.9, loop: false,
      frames: [{ ...rest, duration: 3 }, { frame: 1, duration: 4 }, { ...rest, duration: 5 }] },
  });
  draw(0, 'idle'); const idle = draws.at(-1);
  draw(0, 'happy'); assert.deepEqual(draws.at(-1), idle);
  draw(3, 'happy'); assert.equal(draws.at(-1)[0].url, 'skin/reaction.png');
  draw(7, 'happy'); assert.deepEqual(draws.at(-1), idle);
  draw(99, 'happy'); assert.deepEqual(draws.at(-1), idle);
  assert.deepEqual(loads.sort(), ['skin/idle.png', 'skin/reaction.png']);
});

test('스킨의 기본·장면별 음악 경로를 같은 스킨 폴더 기준으로 해석한다', async (t) => {
  const { skin } = await animatedSkin(t, { idle: 'idle.png' }, [], {
    music: { file: 'sounds/menu.mp3', gain: .5, scenes: { battle: { file: 'sounds/battle.mp3', gain: .4 } } },
  });
  assert.equal(skin.music.file, 'skin/sounds/menu.mp3');
  assert.deepEqual(skin.music.scenes.battle, { file: 'skin/sounds/battle.mp3', gain: .4 });
});

test('무작위 대기 깜빡임도 정지·탐색·반복 그리기가 안정적이고 그리는 동안 난수를 만들지 않는다', async (t) => {
  const { draw, skin } = await animatedSkin(t, { idle: { file: 'sheet.png', columns: 3,
    blink: { period: 60, jitter: 10, doubleChance: 0 },
    frames: [{ frame: 0, duration: 10 }, { frame: 1, duration: 2 }, { frame: 2, duration: 2 },
      { frame: 1, duration: 2 }, { frame: 0, duration: 10 }] } });
  t.mock.method(Math, 'random', () => { throw new Error('random during render'); });
  t.mock.method(globalThis.crypto, 'getRandomValues', () => { throw new Error('seed during render'); });
  const motion = { instance: 'left', seed: 42 };
  const expected = Array.from({ length: 300 }, (_, time) => draw(time, 'idle', false, motion));
  assert.ok(expected.some((args) => args[0] === 200));
  assert.equal(expected[0][0], 0);
  for (let time = 299; time >= 0; time--) {
    assert.deepEqual(draw(time, 'idle', false, motion), expected[time]);
    assert.equal(draw(time, 'idle', true, motion)[0], 0);
  }
  const right = Array.from({ length: 300 }, (_, time) => draw(time, 'idle', false, { ...motion, instance: 'right' }));
  assert.notDeepEqual(expected, right);
  assert.deepEqual(draw(0, 'idle', false, { ...motion, blinkFrame: 123 }), expected[123]);
  skin.drawCharacter({ drawImage() {} }, 'char-1', 'idle', 0, 0, 100, { frame: 100 });
});

test('별도 시트의 컷이 누락되면 잘못된 이미지를 그리지 않고 기본 표정으로 대체한다', async (t) => {
  const { draw, draws } = await animatedSkin(t, { idle: 'idle.png',
    sad: { file: 'reaction.png', frames: [{ file: 'missing.png', frame: 0 }] } });
  draw(0, 'sad');
  assert.equal(draws.at(-1)[0].url, 'skin/idle.png');
});

test('연속 프레임을 지정 시간만큼 재생하고 그리기 횟수로 시간을 바꾸지 않는다', async (t) => {
  const { draw } = await animatedSkin(t, { idle: { file: 'sheet.png', columns: 3,
    frames: [{ frame: 0, duration: 3 }, { frame: 1, duration: 2 }, { frame: 2, duration: 4 }] } });
  for (const [time, x] of [[0, 0], [2, 0], [3, 100], [4, 100], [5, 200], [8, 200], [9, 0]]) {
    assert.equal(draw(time)[0], x);
    assert.equal(draw(time)[0], x);
  }
  assert.equal(draw(-1)[0], 0);
  assert.equal(draw(NaN)[0], 0);
});

test('한 번 재생은 마지막 컷을 유지하고 움직임 줄이기는 대표 컷을 그린다', async (t) => {
  const { draw } = await animatedSkin(t, { happy: { file: 'sheet.png', columns: 3,
    duration: 4, frames: [0, 1, 2], loop: false, poster: 1 } });
  assert.equal(draw(4, 'happy')[0], 100);
  assert.equal(draw(12, 'happy')[0], 200);
  assert.equal(draw(600, 'happy')[0], 200);
  assert.equal(draw(0, 'happy', true)[0], 100);
  assert.equal(draw(600, 'happy', true)[0], 100);
});

test('도입을 한 번 재생한 뒤 지정한 컷부터 반복하며 다시 서는 동작을 넣지 않는다', async (t) => {
  const { draw } = await animatedSkin(t, { lose: { file: 'sheet.png', columns: 3,
    loopFrom: 1, poster: 2,
    frames: [{ frame: 0, duration: 3 }, { frame: 1, duration: 2 }, { frame: 2, duration: 4 }] } });
  for (const [time, x] of [[0, 0], [2, 0], [3, 100], [4, 100], [5, 200], [8, 200],
    [9, 100], [10, 100], [11, 200], [14, 200], [15, 100], [27, 100]]) {
    assert.equal(draw(time, 'lose')[0], x);
  }
  assert.equal(draw(0, 'lose', true)[0], 200);
  assert.equal(draw(900, 'lose', true)[0], 200);
});

test('잘못된 반복 시작 컷은 기본 표정으로 대체하고 한 번 재생은 반복 시작 값을 무시한다', async (t) => {
  for (const loopFrom of [-1, 3, 0.5]) {
    const { draw } = await animatedSkin(t, { idle: { file: 'sheet.png', columns: 3, frame: 1 },
      lose: { file: 'sheet.png', columns: 3, loopFrom, frames: [0, 1, 2] } });
    assert.equal(draw(100, 'lose')[0], 100);
  }
  const { draw } = await animatedSkin(t, { lose: { file: 'sheet.png', columns: 3,
    loop: false, loopFrom: 1, frames: [0, 1, 2] } });
  assert.equal(draw(100, 'lose')[0], 200);
});

test('컷별 영역과 위치를 적용하고 캐릭터가 달라도 같은 시트는 한 번만 읽는다', async (t) => {
  const clip = { file: 'sheet.png', frames: [{ duration: 5,
    rect: { x: 100, y: 0, width: 50, height: 100 }, offsetX: -2, offsetY: 3 }] };
  const { draw, loads, skin, ctx } = await animatedSkin(t, { idle: clip, happy: clip },
    [{ id: 'char-2', moods: { idle: clip } }]);
  assert.deepEqual(draw(0), [100, 0, 50, 100, 23, 3, 50, 100]);
  skin.drawCharacter(ctx, 'char-2', 'idle', 0, 0, 100, { frame: 0 });
  assert.equal(loads.length, 1);
});

test('잘못된 연속 프레임은 기본 표정으로 대체한다', async (t) => {
  for (const frames of [[], [3], [{ frame: 0, duration: 0 }], [null], [{ rect: { x: 299, y: 0, width: 2, height: 2 } }]]) {
    const { draw } = await animatedSkin(t, { idle: { file: 'sheet.png', columns: 3, frame: 1 },
      happy: { file: 'sheet.png', columns: 3, frames } });
    assert.equal(draw(0, 'happy')[0], 100);
  }
});

test('시트 크기를 보정해도 인물의 가운데와 바닥 정렬을 유지한다', async (t) => {
  const { draw } = await animatedSkin(t, { idle: { file: 'sheet.png', columns: 3,
    scale: 0.5, frames: [0] } });
  assert.deepEqual(draw(0), [0, 0, 100, 100, 25, 50, 50, 50]);
});

test('아틀라스의 표정 프레임을 잘라 그리고 같은 파일은 한 번만 로드한다', async (t) => {
  const loads = [];
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({
    id: 'test', characters: [{ id: 'char-1', name: 'Character', moods: {
      idle: { file: 'sheet.png', columns: 3, rows: 2, frame: 0 },
      win: { file: 'sheet.png', columns: 3, rows: 2, frame: 3 },
    } }],
  }) }));
  const PreviousImage = globalThis.Image;
  globalThis.Image = class {
    width = 1536; height = 1024;
    set src(url) { loads.push(url); queueMicrotask(() => this.onload()); }
  };
  t.after(() => { globalThis.Image = PreviousImage; });
  const skin = await loadImageSkin('skin');
  const draws = [];
  skin.drawCharacter({ drawImage: (...args) => draws.push(args) }, 'char-1', 'win', 10, 20, 100);
  assert.equal(loads.length, 1);
  assert.deepEqual(draws[0].slice(1), [0, 512, 512, 512, 10, 20, 100, 100]);
  skin.drawCharacter({ drawImage: (...args) => draws.push(args) }, 'char-1', 'sad', 0, 0, 50);
  assert.deepEqual(draws[1].slice(1, 5), [0, 0, 512, 512]);
});

test('매니페스트가 없으면 자료 로딩 실패를 반환한다', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false }));
  assert.equal(await loadImageSkin('missing'), null);
});

test('여백 있는 시트의 지정 영역을 쓰고 세로 그림의 비율과 바닥 정렬을 유지한다', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({
    characters: [{ id: 'char-1', name: 'Character', moods: {
      idle: { file: 'sheet.png', rect: { x: 512, y: 280, width: 512, height: 512 } },
      happy: { file: 'sheet.png', rect: { x: 0, y: 0, width: 256, height: 512 } },
      sad: { file: 'sheet.png', rect: { x: 1500, y: 0, width: 512, height: 512 } },
    } }],
  }) }));
  const PreviousImage = globalThis.Image;
  globalThis.Image = class {
    width = 1536; height = 1024;
    set src(_) { queueMicrotask(() => this.onload()); }
  };
  t.after(() => { globalThis.Image = PreviousImage; });
  const skin = await loadImageSkin('skin');
  const draws = [];
  const ctx = { drawImage: (...args) => draws.push(args) };
  skin.drawCharacter(ctx, 'char-1', 'idle', 10, 20, 100);
  assert.deepEqual(draws[0].slice(1), [512, 280, 512, 512, 10, 20, 100, 100]);
  skin.drawCharacter(ctx, 'char-1', 'happy', 10, 20, 100);
  assert.deepEqual(draws[1].slice(1), [0, 0, 256, 512, 35, 20, 50, 100]);
  skin.drawCharacter(ctx, 'char-1', 'sad', 10, 20, 100);
  assert.deepEqual(draws[2].slice(1), draws[0].slice(1));
});

test('이미지가 빠진 캐릭터는 준비 중 안내를 표시하고 전용 피버 표정도 로드한다', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({
    characters: [{ id: 'char-1', name: 'Character', moods: { idle: 'idle.png', fever: 'fever.png' } }],
  }) }));
  const PreviousImage = globalThis.Image;
  globalThis.Image = class {
    width = 100; height = 100;
    set src(url) { this.url = url; queueMicrotask(() => this.onload()); }
  };
  t.after(() => { globalThis.Image = PreviousImage; });
  const skin = await loadImageSkin('skin');
  const draws = [];
  const labels = [];
  const ctx = { save() {}, restore() {}, fillText: (s) => labels.push(s), drawImage: (...args) => draws.push(args) };
  skin.drawCharacter(ctx, 'char-1', 'fever', 0, 0, 100);
  assert.equal(draws[0][0].url, 'skin/fever.png');
  skin.drawCharacter(ctx, 'unknown', 'sad', 0, 0, 100);
  assert.deepEqual(labels, ['이미지 준비 중']);
  assert.equal(draws.length, 1);
});

test('선택 불가 캐릭터도 전체 카드 목록에 남고 스프라이트는 실루엣으로 그릴 수 있다', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({
    characters: Array.from({ length: 4 }, (_, i) => ({ id: `char-${i}`, name: `Character ${i}`,
      selectable: i < 3, selectionVisible: i !== 3, voiceAvailable: i === 1 ? false : undefined, moods: { idle: `char-${i}.png` } })),
  }) }));
  const PreviousImage = globalThis.Image;
  globalThis.Image = class {
    width = 100; height = 100;
    set src(url) { this.url = url; queueMicrotask(() => this.onload()); }
  };
  t.after(() => { globalThis.Image = PreviousImage; });
  const skin = await loadImageSkin('skin');
  assert.deepEqual(skin.characters.map((character) => character.id), ['char-0', 'char-1', 'char-2']);
  assert.equal(skin.characterRoster.length, 4);
  assert.equal(skin.characterRoster[3].selectable, false);
  assert.equal(skin.characterRoster[3].selectionVisible, false);
  assert.equal(skin.characterRoster[1].voiceAvailable, false);
  const draws = [];
  skin.drawCharacter({ drawImage: (...args) => draws.push(args) }, 'char-3', 'idle', 0, 0, 100);
  assert.equal(draws[0][0].url, 'skin/char-3.png');
});


test('실루엣은 색·얼굴을 검게 숨기고 다음 캐릭터의 그리기 설정은 복원한다', async (t) => {
  const { skin } = await animatedSkin(t, { idle: 'idle.png' });
  const draws=[], stack=[];
  const ctx = { filter:'none',globalAlpha:1,
    save(){stack.push({filter:this.filter,globalAlpha:this.globalAlpha});},
    restore(){Object.assign(this,stack.pop());},
    drawImage(){draws.push({filter:this.filter,alpha:this.globalAlpha});},
  };
  skin.drawCharacter(ctx,'char-1','idle',0,0,100,{silhouette:true,reducedMotion:true});
  skin.drawCharacter(ctx,'char-1','idle',0,0,100,{silhouette:true,silhouetteOpacity:1,reducedMotion:true});
  skin.drawCharacter(ctx,'char-1','idle',0,0,100,{reducedMotion:true});
  assert.deepEqual(draws,[{filter:'brightness(0)',alpha:.55},{filter:'brightness(0)',alpha:1},{filter:'none',alpha:1}]);
});

test('준비 중 실루엣도 프레임에 따라 기존 스프라이트 애니메이션을 재생한다', async (t) => {
  const { skin } = await animatedSkin(t, { idle: { file:'idle.png',columns:3,rows:1,duration:4,frames:[0,1,2] } });
  const sourceX=[], stack=[];
  const ctx={filter:'none',globalAlpha:1,
    save(){stack.push({filter:this.filter,globalAlpha:this.globalAlpha});},
    restore(){Object.assign(this,stack.pop());},
    drawImage(...args){sourceX.push(args[1]);assert.equal(this.filter,'brightness(0)');},
  };
  for(const frame of [0,5]) skin.drawCharacter(ctx,'char-1','idle',0,0,100,{silhouette:true,frame});
  assert.notEqual(sourceX[0],sourceX[1]);
});

 test('필드 전용 동작은 별도 발걸음·이동 시간을 사용하고 초상·정지·누락 대체를 지킨다', async t => {
  const clip={file:'pose.png',columns:3,loop:false,frames:[{frame:1,duration:12}],
    fieldAction:{file:'pose.png',columns:3,loop:false,poster:1,
      frames:[{file:'feet.png',frame:0,duration:4},{frame:1,duration:8},{file:'feet.png',frame:2,duration:4}],
      fieldTravel:[{frame:0,x:0,y:0},{frame:4,x:.2,y:0},{frame:11,x:.2,y:0},{frame:15,x:0,y:0}]}};
  assert.deepEqual(new Set(skinImageFiles({characters:[{moods:{chain1:clip}}]})),new Set(['pose.png','feet.png']));
  const {draw,draws,skin}=await animatedSkin(t,{idle:'idle.png',chain1:clip,
    chain2:{...clip,fieldAction:{file:'missing.png',frames:[0]}}});
  assert.equal(skin.fieldChainFrames('char-1',1),16,'field choreography lifetime includes running in and out');
  draw(0,'happy',false,{chain:1});assert.equal(draws.at(-1)[0].url,'skin/pose.png');
  draw(0,'happy',false,{chain:1,presentation:'field'});assert.equal(draws.at(-1)[0].url,'skin/feet.png');
  assert.equal(draw(6,'happy',false,{chain:1,presentation:'field'})[4],20);
  assert.equal(draw(6,'happy',true,{chain:1,presentation:'field'})[4],0);
  draw(0,'happy',false,{chain:2,presentation:'field'});assert.equal(draws.at(-1)[0].url,'skin/pose.png');
});
