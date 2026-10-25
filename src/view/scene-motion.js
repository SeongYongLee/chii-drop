import { PALETTE, UI_FONT, flower, paper } from './festival.js';
import { entranceProgress, reducedUiMotion } from './ui-motion.js';
import { screenHeight, isPortraitScreen } from '../app/screen.js';

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

function resultCardLayout(height = 540, portrait = false) {
  const scale = portrait ? Math.min(1.5, Math.max(.6, (height - 32) / 414)) : 1;
  return { scale, x: 480 - 276 * scale, y: height / 2 - 207 * scale,
    actions: [{ x: 48, y: 354, width: 218, height: 44 }, { x: 286, y: 354, width: 218, height: 44 }] };
}

function drawResultPanel(ctx, title, sub, { age = 0, won = false, quiet = false,
  skin, character, mood, tally, players = [], level = '', headline, actions = [], touch = false } = {}) {
  const height = screenHeight(ctx), center = height / 2;
  const layout = resultCardLayout(height, isPortraitScreen(ctx));
  ctx.save(); ctx.fillStyle = '#59473736'; ctx.fillRect(0, 0, 960, height); ctx.restore();
  if (won && !quiet) { ctx.save(); ctx.translate(0, center - 270); drawVictoryPetals(ctx, age); ctx.restore(); }
  const t = entranceProgress(age, 18, quiet), zoom = .96 + .04 * t;
  ctx.save(); ctx.translate(480, center + 18 * (1 - t));
  ctx.scale(layout.scale * zoom, layout.scale * zoom); ctx.translate(-276, -207);
  ctx.globalAlpha = .45 + .55 * t;
  paper(ctx, 0, 0, 552, 414, { fill: '#fffdf6', edge: '#baa48b', radius: 28 });
  paper(ctx, 186, -14, 180, 34, { fill: won ? '#f5e6ad' : '#e8e4dc', radius: 12, shadow: false });
  ctx.fillStyle = PALETTE.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `bold 12px ${UI_FONT}`; ctx.fillText(won ? '축하해요!' : '경기 결과', 276, 3, 168);
  ctx.font = `bold 30px ${UI_FONT}`; ctx.fillText(headline ?? title, 276, 53, 492);
  flower(ctx, 63, 52, 8, PALETTE.pink); flower(ctx, 489, 52, 8, PALETTE.blue);
  if (character && skin) {
    skin.drawCharacter(ctx, character.id, mood ?? (won ? 'win' : 'sad'), 204, 80, 144,
      { frame: age, instance: 'result-card', presentation: 'selection' });
    ctx.font = `bold 18px ${UI_FONT}`; ctx.fillStyle = PALETTE.ink;
    ctx.fillText(character.name, 276, 237, 440);
  } else {
    flower(ctx, 276, 153, 40, won ? PALETTE.pink : PALETTE.blue);
  }
  paper(ctx, 56, 258, 440, 58, { fill: '#f8f0df', radius: 16, shadow: false });
  ctx.fillStyle = PALETTE.ink; ctx.font = `bold ${tally ? 38 : 17}px ${UI_FONT}`;
  ctx.fillText(tally ? `${tally[0]}  :  ${tally[1]}` : sub.split('\n')[0], 276, 287, 410);
  if (tally) {
    ctx.font = `bold 12px ${UI_FONT}`;
    ctx.fillText(players[0]?.name ?? '1P', 128, 287, 108);
    ctx.fillText(players[1]?.name ?? '2P', 424, 287, 108);
  }
  ctx.font = `13px ${UI_FONT}`; ctx.fillStyle = PALETTE.muted;
  ctx.fillText(level || (tally ? '세트 스코어' : ''), 276, 332, 440);
  if (actions.length && !touch) {
    actions.slice(0, 2).forEach((label, i) => {
      const box = layout.actions[i];
      paper(ctx, box.x, box.y, box.width, box.height, { fill: i ? '#fffdf6' : '#f5dce3', radius: 13, shadow: false });
      ctx.fillStyle = PALETTE.ink; ctx.font = `bold 14px ${UI_FONT}`;
      ctx.fillText(`${i ? 'Esc' : 'Enter'} · ${label}`, box.x + box.width / 2, box.y + 22, box.width - 18);
    });
  } else {
    ctx.font = `14px ${UI_FONT}`; ctx.fillStyle = PALETTE.muted;
    ctx.fillText(touch && actions.length ? '버튼을 눌러 계속하세요' : sub.split('\n').slice(1).join(' · '), 276, 376, 480);
  }
  ctx.restore();
}

export { drawFloorCompletion, drawResultPanel, resultCardLayout };
