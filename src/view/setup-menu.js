import { isPortraitScreen } from '../app/screen.js';
import { PALETTE, UI_FONT, paper } from './festival.js';
import { drawPortraitHero } from './portrait-ui.js';

function setupBoxes({ players, startIndex }) {
  const boxes = Array(startIndex + 1);
  players.forEach((player, side) => {
    const x = players.length === 1 ? 350 : side === 0 ? 180 : 520;
    boxes[player.characterIndex] = { x, y: 118, width: 260, height: 240 };
    if (player.levelIndex !== undefined) boxes[player.levelIndex] = { x, y: 374, width: 260, height: 48 };
  });
  boxes[startIndex] = { x: 300, y: 444, width: 360, height: 48 };
  return boxes;
}

function drawSetupMenu(ctx, app, setup) {
  const { title, players, characters, levels, selected, startIndex, startLabel } = setup;
  if (isPortraitScreen(ctx)) {
    const visible = characters.filter(character => character && !character.random);
    drawPortraitHero(ctx, app, title, visible.length === 1 ? { character: visible[0] } : { characters: visible });
    return;
  }
  app.skin.drawBackground(ctx, 960, 540, 'menu');
  paper(ctx, 317, 30, 326, 66, { fill: PALETTE.cream, radius: 12 });
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = PALETTE.ink;
  ctx.font = `bold 29px ${UI_FONT}`; ctx.fillText(title, 480, 63);
  const boxes = setupBoxes(setup);
  boxes.forEach((box, index) => {
    paper(ctx, box.x, box.y, box.width, box.height, {
      fill: selected === index ? PALETTE.pink : '#fffdf8',
      edge: selected === index ? '#bd7c88' : '#e4d9c8', radius: 18, shadow: selected === index,
    });
    ctx.fillStyle = PALETTE.ink;
    const center = box.x + box.width / 2;
    const side = players.findIndex(player => player.characterIndex === index);
    if (side >= 0) {
      const character = characters[side];
      ctx.font = `bold 16px ${UI_FONT}`; ctx.fillText(players[side].label, center, box.y + 22);
      if (character?.random) { ctx.font = `bold 110px ${UI_FONT}`; ctx.fillText('?', center, box.y + 124); }
      else if (character) app.skin.drawCharacter(ctx, character.id, 'idle', center - 82, box.y + 42, 164,
        { frame: app.animationFrame ?? 0, instance: `setup-${side}`, presentation: 'selection' });
      ctx.font = `bold 20px ${UI_FONT}`;
      ctx.fillText(character?.name ?? '준비 중', center, box.y + 218, 208);
      ctx.font = `20px ${UI_FONT}`;
      ctx.fillText('◀', box.x + 20, box.y + 124); ctx.fillText('▶', box.x + box.width - 20, box.y + 124);
    } else {
      const cpu = players.findIndex(player => player.levelIndex === index);
      ctx.font = `${selected === index ? 'bold ' : ''}20px ${UI_FONT}`;
      ctx.fillText(index === startIndex ? startLabel : `◀ ${levels[cpu]} ▶`, center, box.y + box.height / 2, box.width - 24);
    }
  });
  ctx.font = `14px ${UI_FONT}`; ctx.fillStyle = PALETTE.muted;
  ctx.fillText('↑↓ 항목 이동 · ←→ 변경 · Enter 결정 · Esc 뒤로', 480, 518);
}

export { setupBoxes, drawSetupMenu };
