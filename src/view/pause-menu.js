import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../app/screen.js';
import { PALETTE, UI_FONT, flower, paper } from './festival.js';

function drawPauseMenu(ctx, items, selected) {
  const width = 420, height = 350;
  const x = (SCREEN_WIDTH - width) / 2, y = (SCREEN_HEIGHT - height) / 2;
  ctx.save();
  ctx.fillStyle = '#493b3252';
  ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  paper(ctx, x, y, width, height, { radius: 22 });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PALETTE.ink;
  ctx.font = `bold 34px ${UI_FONT}`;
  ctx.fillText('일시정지', SCREEN_WIDTH / 2, y + 48);
  flower(ctx, x + 56, y + 48, 9, PALETTE.blue);
  flower(ctx, x + width - 56, y + 48, 9);

  items.forEach((label, index) => {
    const top = y + 104 + index * 56;
    const active = index === selected;
    paper(ctx, x + 36, top, width - 72, 44, {
      fill: active ? PALETTE.pink : '#fffdf8',
      edge: active ? '#bd7c88' : '#e4d9c8', radius: 11, shadow: false,
    });
    if (active) flower(ctx, x + 58, top + 22, 6, '#fffdf5');
    ctx.fillStyle = PALETTE.ink;
    ctx.font = `${active ? 'bold ' : ''}22px ${UI_FONT}`;
    ctx.fillText(label, SCREEN_WIDTH / 2, top + 22, width - 130);
  });
  ctx.fillStyle = PALETTE.muted;
  ctx.font = `13px ${UI_FONT}`;
  ctx.fillText('↑↓ 선택 · Enter 결정 · Esc / P 계속', SCREEN_WIDTH / 2, y + height - 32, width - 48);
  ctx.restore();
}

export { drawPauseMenu };
