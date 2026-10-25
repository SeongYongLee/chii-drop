import { screenHeight, isPortraitScreen } from '../app/screen.js';
import { FIELD_HEIGHT, FIELD_TOP, FIELD_WIDTH, SIDES, gameTransform, portraitGameLayout } from './layout.js';
import { PALETTE, UI_FONT, flower, paper } from './festival.js';
import { entranceProgress } from './ui-motion.js';
import { SET_WINS } from '../engine/rules.js';

export function resultFieldBoxes(height, portrait, count) {
  if (portrait) return portraitGameLayout(height, count).map(box => ({ ...box, height: FIELD_HEIGHT * box.scale }));
  const transform = gameTransform();
  return Array.from({ length: count }, (_, index) => ({
    x: transform.x + SIDES[index].fieldX * transform.scale,
    y: FIELD_TOP * transform.scale, width: FIELD_WIDTH * transform.scale,
    height: FIELD_HEIGHT * transform.scale, scale: transform.scale,
  }));
}

export function resultMenuLayout(height = 540, count = 2) {
  const row = 44, top = height - 18 - count * row;
  return Array.from({ length: count }, (_, index) => ({ x: 384, y: top + index * row, width: 192, height: 36 }));
}

export function drawFieldResults(ctx, { skin, match, characters, tally, mode, age = 0, quiet = false }) {
  const boxes = resultFieldBoxes(screenHeight(ctx), isPortraitScreen(ctx), match.players.length);
  const progress = entranceProgress(age, 18, quiet);
  boxes.forEach((box, index) => {
    const winner = mode !== 'solo' && match.winner === index, draw = match.winner === -1;
    const solo = mode === 'solo';
    const title = solo ? '게임 오버' : draw ? '무승부' : winner ? tally?.[index] >= SET_WINS ? '세트 승리!' : '승리!' : '패배';
    const player = match.players[index], character = characters[index];
    ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.width, box.height); ctx.clip();
    ctx.fillStyle = '#fffaf04d'; ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.translate(box.x, box.y + box.height / 2 - 118 * box.scale + (1 - progress) * 12);
    ctx.scale(box.scale, box.scale); ctx.globalAlpha = .55 + progress * .45;
    paper(ctx, 12, 0, 168, 236, { fill: '#fffdf5f5', edge: winner ? '#c4a36f' : '#b9b2a6', radius: 18 });
    ctx.fillStyle = PALETTE.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold 23px ${UI_FONT}`; ctx.fillText(title, 96, 27, 146);
    if (winner) { flower(ctx, 29, 26, 5, PALETTE.pink); flower(ctx, 163, 26, 5, PALETTE.blue); }
    if (character) skin.drawCharacter(ctx, character.id, winner ? 'win' : draw ? 'idle' : 'lose', 44, 51, 104,
      { frame: age, instance: `field-result-${index}`, presentation: 'selection' });
    ctx.fillStyle = PALETTE.ink; ctx.font = `bold 14px ${UI_FONT}`;
    ctx.fillText(character?.name ?? `${index + 1}P`, 96, 169, 148);
    ctx.font = `bold 17px ${UI_FONT}`;
    ctx.fillText(tally ? `${tally[index]}승` : `${player.maxChain}연쇄`, 96, 197, 146);
    ctx.font = `12px ${UI_FONT}`; ctx.fillStyle = PALETTE.muted;
    ctx.fillText(`${player.score.toLocaleString('ko-KR')}점`, 96, 219, 146);
    ctx.restore();
  });
}

export function drawResultActions(ctx, actions, selected = 0, ready = true) {
  const boxes = resultMenuLayout(screenHeight(ctx), actions.length);
  actions.forEach((label, index) => {
    const box = boxes[index];
    paper(ctx, box.x, box.y, box.width, box.height, {
      fill: index === selected ? '#f5dce3' : '#fffdf5', edge: index === selected ? '#bd8292' : '#cbb89e', radius: 11, shadow: false,
    });
    ctx.fillStyle = ready ? PALETTE.ink : PALETTE.muted;
    ctx.font = `${index === selected ? 'bold ' : ''}15px ${UI_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, box.x + box.width / 2, box.y + box.height / 2, box.width - 20);
  });
}
