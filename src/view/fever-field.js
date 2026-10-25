import { FIELD_HEIGHT, FIELD_TOP, FIELD_WIDTH } from './layout.js';
import { reducedUiMotion } from './ui-motion.js';

// 해당 플레이어의 필드 안에만 그리는 자체 제작 색상·무늬.
export function drawFeverField(ctx, x, player, age = 0) {
  if (!player.fever || player.phase === 'revive') return;
  const drift = reducedUiMotion() ? 0 : (age % 240) / 240 * 96;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, FIELD_TOP, FIELD_WIDTH, FIELD_HEIGHT); ctx.clip();
  ctx.fillStyle = '#30264c'; ctx.fillRect(x, FIELD_TOP, FIELD_WIDTH, FIELD_HEIGHT);
  ctx.fillStyle = '#51406d';
  for (let y = -192; y < FIELD_HEIGHT + 96; y += 96) {
    ctx.beginPath();
    ctx.moveTo(x, FIELD_TOP + y + drift);
    ctx.lineTo(x + FIELD_WIDTH, FIELD_TOP + y + drift + 96);
    ctx.lineTo(x + FIELD_WIDTH, FIELD_TOP + y + drift + 128);
    ctx.lineTo(x, FIELD_TOP + y + drift + 32);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#b5def04d';
  for (let i = 0; i < 9; i++) {
    const sx = x + 18 + (i * 47) % (FIELD_WIDTH - 36);
    const sy = FIELD_TOP + ((i * 61 + drift) % FIELD_HEIGHT);
    ctx.beginPath(); ctx.moveTo(sx, sy - 5); ctx.lineTo(sx + 3, sy);
    ctx.lineTo(sx, sy + 5); ctx.lineTo(sx - 3, sy); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
