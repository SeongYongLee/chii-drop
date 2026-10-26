import { screenHeight, isPortraitScreen } from '../app/screen.js';
import { GO_FRAMES, READY_FRAMES } from '../app/session.js';
import { FIELD_HEIGHT, SIDES, gameTransform, portraitGameLayout } from './layout.js';
import { PALETTE, UI_FONT, flower, paper } from './festival.js';
import { entranceProgress, reducedUiMotion } from './ui-motion.js';

export function roundIntroCue(remaining) {
  const starting = remaining <= GO_FRAMES;
  return { starting, title: starting ? '시작!' : '준비' };
}

export function roundIntroLayout(height, portrait, count = 2) {
  if (portrait) {
    const box = portraitGameLayout(height, count)[0];
    return { x: 480, y: box.y + FIELD_HEIGHT * box.scale / 2, scale: 1.35 };
  }
  const transform = gameTransform();
  // Next 아래에서 캐릭터 일부와 겹치도록 두고 점수판 위 공간까지 활용한다.
  const portraitBottom = Math.max(...SIDES.map(side => side.portrait.y + side.portrait.size)) * transform.scale;
  const scoreTop = Math.min(...SIDES.map(side => side.score.y - 3)) * transform.scale;
  return { x: 480, y: (portraitBottom + scoreTop) / 2 - 18, scale: 1 };
}

// 시뮬레이션의 남은 프레임만 읽는다. 준비 시간·입력·효과음은 기존 세션이 관리한다.
export function drawRoundIntro(ctx, remaining, { playerCount = 2 } = {}) {
  if (remaining <= 0) return;
  const cue = roundIntroCue(remaining);
  const layout = roundIntroLayout(screenHeight(ctx), isPortraitScreen(ctx), playerCount);
  const age = cue.starting ? GO_FRAMES - remaining : READY_FRAMES - remaining;
  const progress = entranceProgress(age, 8);
  const quiet = reducedUiMotion();
  const zoom = quiet ? 1 : .94 + .06 * progress;
  ctx.save(); ctx.translate(layout.x, layout.y);
  ctx.scale(layout.scale * zoom, layout.scale * zoom);
  ctx.globalAlpha *= quiet || !cue.starting ? 1 : Math.min(1, remaining / 5);

  paper(ctx, -160, -48, 320, 96, {
    fill: cue.starting ? '#fff4e6' : '#fffdf5',
    edge: cue.starting ? '#bf9996' : '#bca58a', radius: 28,
  });
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  flower(ctx, -128, 0, 8, cue.starting ? PALETTE.pink : PALETTE.blue);
  flower(ctx, 128, 0, 8, cue.starting ? PALETTE.blue : PALETTE.pink);
  ctx.font = `bold ${cue.starting ? 46 : 44}px ${UI_FONT}`;
  ctx.fillStyle = PALETTE.ink;
  ctx.fillText(cue.title, 0, 0, 210);
  ctx.restore();
}
