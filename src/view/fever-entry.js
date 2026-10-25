import { FONT } from './renderer.js';
import { isPortraitScreen, screenHeight } from '../app/screen.js';
import { FIELD_HEIGHT, FIELD_TOP, FIELD_WIDTH, SIDES, gameTransform, portraitGameLayout } from './layout.js';
import { reducedUiMotion } from './ui-motion.js';

export const FEVER_ENTRY_FRAMES = 150;
export const FEVER_GO_FRAMES = 30;

export function feverEntryCue(remaining) {
  return remaining > FEVER_GO_FRAMES ? String(Math.ceil((remaining - FEVER_GO_FRAMES) / 40)) : '시작!';
}

// 진입 안내는 피버에 들어가는 쪽의 필드 안에만 표시한다.
export function drawFeverEntry(ctx, remaining, { side = 1, playerCount = 2 } = {}) {
  if (remaining <= 0) return;
  ctx.save();
  if (isPortraitScreen(ctx)) {
    const box = portraitGameLayout(screenHeight(ctx), playerCount)[side];
    if (!box) { ctx.restore(); return; }
    ctx.translate(box.x, box.y); ctx.scale(box.scale, box.scale);
  } else {
    const t = gameTransform();
    ctx.translate(t.x, t.y); ctx.scale(t.scale, t.scale);
    ctx.translate(SIDES[side].fieldX, FIELD_TOP);
  }
  ctx.beginPath(); ctx.rect(0, 0, FIELD_WIDTH, FIELD_HEIGHT); ctx.clip();
  ctx.fillStyle = '#21162e99'; ctx.fillRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT);
  if (!reducedUiMotion()) {
    const t = 1 - remaining / FEVER_ENTRY_FRAMES;
    ctx.strokeStyle = '#f6dca3'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(FIELD_WIDTH / 2, FIELD_HEIGHT / 2, 20 + t * 180, 20 + t * 240, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = '#38233eee'; ctx.fillRect(0, 100, FIELD_WIDTH, 180);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff0b8'; ctx.font = `bold 23px ${FONT}`;
  ctx.fillText('피버 모드!', FIELD_WIDTH / 2, 126);
  ctx.fillStyle = '#fff8ef'; ctx.font = `16px ${FONT}`;
  ctx.fillText('2차전 준비', FIELD_WIDTH / 2, 158);
  ctx.font = `bold 48px ${FONT}`;
  ctx.fillText(feverEntryCue(remaining), FIELD_WIDTH / 2, 217);
  ctx.font = `13px ${FONT}`;
  ctx.fillText('잠시 후 경기가 이어집니다', FIELD_WIDTH / 2, 259);
  ctx.restore();
}
