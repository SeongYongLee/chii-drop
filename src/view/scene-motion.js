import { PALETTE, UI_FONT, flower } from './festival.js';
import { drawBanner } from './renderer.js';
import { entranceProgress, reducedUiMotion } from './ui-motion.js';

function drawFloorCompletion(ctx, x, y, age = 18, quiet = false) {
  const t = entranceProgress(age, 16, quiet);
  ctx.save(); ctx.translate(x, y); ctx.rotate(-.08);
  const scale = 1 + .45 * (1 - t);
  ctx.scale(scale, scale);
  ctx.globalAlpha = .45 + .55 * t;
  ctx.fillStyle = '#f5f8e9'; ctx.strokeStyle = '#67824d'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(-25, -11, 50, 22, 5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#526e3e'; ctx.font = `bold 12px ${UI_FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('완료', 0, 0);
  ctx.restore();
}

function drawVictoryPetals(ctx, age) {
  if (reducedUiMotion() || age < 0 || age >= 84) return;
  const t = age / 84;
  ctx.save(); ctx.globalAlpha = .85 * (1 - t);
  for (let i = 0; i < 22; i++) {
    // 표시 전용 고정 패턴. 경기 난수는 소비하지 않는다.
    const spread = (i * 137 % 710) - 355;
    const x = 480 + spread * (.55 + .45 * t) + Math.sin(i + t * 5) * 9;
    const y = 120 + (i * 31 % 68) - Math.sin(Math.PI * t) * 32 + 235 * t;
    ctx.save(); ctx.translate(x, y); ctx.rotate(i + t * (i % 2 ? 3 : -3));
    if (i % 3 === 0) flower(ctx, 0, 0, 5, PALETTE.pink);
    else {
      ctx.fillStyle = [PALETTE.blue, PALETTE.pink, '#e2ca7a', '#aabd89'][i % 4];
      ctx.beginPath(); ctx.ellipse(0, 0, 3, 5, .3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawResultPanel(ctx, title, sub, { age = 0, won = false, quiet = false } = {}) {
  if (won && !quiet) drawVictoryPetals(ctx, age);
  const t = entranceProgress(age, 18, quiet);
  ctx.save(); ctx.translate(480, 270 + 18 * (1 - t));
  ctx.scale(.96 + .04 * t, .78 + .22 * t);
  ctx.translate(-480, -270);
  ctx.globalAlpha = .45 + .55 * t;
  drawBanner(ctx, title, sub);
  ctx.restore();
}

export { drawFloorCompletion, drawResultPanel };
