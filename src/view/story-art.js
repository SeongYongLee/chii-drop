import { HIDDEN_IDS, SECRET_FINAL } from '../story/campaign.js';
import { characterOf } from '../story/script.js';
import { FONT } from './renderer.js';
import { poseAt, storyBackground } from './story-direction.js';

// 대본의 장면 표시는 경기 상태를 읽거나 바꾸지 않는 독립적인 그림이다.
function panel(ctx, x, y, w, h, color, radius = 12) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill();
}
function oval(ctx, x, y, rx, ry, color) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
}
function caption(ctx, text, y, color = '#6a5863') {
  ctx.fillStyle = color; ctx.font = `16px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 480, y);
}
function figure(ctx, app, script, id, x, y, size, mood = 'idle', shot = {}) {
  const cue = shot.cast?.[id] ?? {}, age = shot.ages?.[cue.at] ?? 0;
  const pose = poseAt(cue, age, shot.reducedMotion);
  ctx.save(); ctx.translate(x + size / 2 + pose.x, y + size + pose.y); ctx.rotate(pose.angle);
  const character = characterOf(script, id);
  if (character.storySilhouette && !app.skin.characterRoster?.some((entry) => entry.id === character.charId)) {
    ctx.save(); ctx.translate(-size / 2, -size); ctx.scale(size / 100, size / 100);
    const color = character.storySilhouette?.body ?? '#d7ccd7';
    oval(ctx, 50, 65, 34, 31, color);
    if (character.storySilhouette?.ear === 'long') { oval(ctx, 34, 26, 8, 25, color); oval(ctx, 66, 26, 8, 25, color); }
    else { oval(ctx, 28, 36, 12, 15, color); oval(ctx, 72, 36, 12, 15, color); }
    oval(ctx, 39, 61, 2, 2, '#6c5c68'); oval(ctx, 61, 61, 2, 2, '#6c5c68');
    if (id === SECRET_FINAL) { oval(ctx, 43, 83, 8, 5, '#ba8298'); oval(ctx, 57, 83, 8, 5, '#ba8298'); }
    else medal(ctx, 50, 86, .32);
    ctx.restore();
  } else app.skin.drawCharacter(ctx, character.charId, cue.mood ?? mood, -size / 2, -size, size,
    { frame: age, blinkFrame: shot.frame, reducedMotion: shot.reducedMotion || shot.quiet, instance: 'story-' + id });
  ctx.restore();
}
function medal(ctx, x, y, size = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size, size);
  ctx.fillStyle = '#c96d88'; ctx.fillRect(-8, -21, 5, 20); ctx.fillRect(3, -21, 5, 20);
  oval(ctx, 0, 0, 12, 12, '#edc66e'); ctx.restore();
}
function snack(ctx, x, y) {
  oval(ctx, x, y, 13, 8, '#d9b481'); oval(ctx, x - 4, y - 2, 1.5, 1.5, '#98734c'); oval(ctx, x + 5, y + 2, 1.5, 1.5, '#98734c');
}
function cup(ctx, x, y) {
  panel(ctx, x - 10, y, 20, 19, '#cbc3d1', 4); oval(ctx, x, y, 10, 3, '#817384');
}
// 전용 스프라이트가 없는 스킨도 색상 기반 큰 몸을 계속 그릴 수 있다.
function drawStoryForm(ctx, palette, x, y, size, reach = false, skin = null, motion = {}) {
  if (palette.charId && skin?.characterRoster?.some((entry) => entry.id === palette.charId)) {
    skin.drawCharacter(ctx, palette.charId, reach ? 'fever' : motion.mood ?? 'idle', x, y, size,
      { ...motion, silhouette: Boolean(palette.silhouette), silhouetteOpacity: 1,
        reducedMotion: reach || motion.reducedMotion, instance: 'story-revealed-form' });
    return;
  }
  if (palette.silhouette) {
    ctx.save(); ctx.translate(x, y); ctx.scale(size / 210, size / 210);
    for (const [cx, cy, rx, ry] of [[105,115,91,79],[53,52,29,35],[155,52,29,35],[57,165,35,18],[164,163,26,17],[reach ? -4 : 38,171,24,13]]) {
      oval(ctx, cx, cy, rx, ry, '#09090d');
    }
    ctx.restore(); return;
  }
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 210, size / 210);
  oval(ctx, 105, 185, 100, 13, '#16151f44');
  oval(ctx, 105, 115, 91, 79, palette.body ?? '#b7a6b3');
  oval(ctx, 53, 52, 29, 35, palette.body ?? '#b7a6b3'); oval(ctx, 155, 52, 29, 35, palette.body ?? '#b7a6b3');
  oval(ctx, 105, 100, 63, 47, palette.face ?? '#e9ded8');
  oval(ctx, 83, 100, 3, 3.4, '#51454f'); oval(ctx, 127, 100, 3, 3.4, '#51454f');
  ctx.strokeStyle = '#756370'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(100, 115); ctx.quadraticCurveTo(105, 118, 110, 115); ctx.stroke();
  oval(ctx, 57, 165, 35, 18, palette.body ?? '#b7a6b3'); oval(ctx, reach ? -4 : 38, 171, 24, 13, palette.face ?? '#e9ded8');
  oval(ctx, 164, 163, 26, 17, palette.body ?? '#b7a6b3');
  oval(ctx, 93, 148, 13, 7, palette.ribbon ?? '#b88397'); oval(ctx, 118, 148, 13, 7, palette.ribbon ?? '#b88397');
  ctx.restore();
}
function room(ctx) {
  panel(ctx, 80, 24, 800, 326, '#393646', 20);
  panel(ctx, 102, 43, 756, 280, '#494352', 12);
  panel(ctx, 102, 276, 756, 48, '#353240', 0);
  ctx.strokeStyle = '#756677'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(490, 45); ctx.lineTo(490, 276); ctx.stroke();
}
function reachingHand(ctx, x, y, color = '#f8eee9', length = 28, edge = null) {
  ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + length, y - 5);
  if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 11; ctx.stroke(); }
  ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.stroke();
}
function photo(ctx, app, script, visual, guests, shot) {
  const old = visual === 'oldPhoto', faded = visual === 'memory';
  panel(ctx, 120, 40, 720, 305, old ? '#ded1b9' : '#fffaf2');
  if (!old && app.skin.hasBackground?.(shot.background ?? (shot.hostForm === 'large' ? 'inside' : 'summit'))) {
    ctx.save(); ctx.translate(140, 58);
    app.skin.drawBackground(ctx, 680, 238, shot.background ?? (shot.hostForm === 'large' ? 'inside' : 'summit'));
    ctx.restore();
  } else panel(ctx, 140, 58, 680, 238, old ? '#c6b799' : '#e7dbe2');
  if (old) {
    // 옛 사진의 인물은 주역 두 사람이 아니다. 알 수 없는 옛 참가자들이다.
    for (const x of [195, 285]) { oval(ctx, x, 201, 29, 40, '#9c8c7255'); oval(ctx, x, 165, 23, 23, '#9c8c7255'); }
    ctx.strokeStyle = '#aa9a7d'; ctx.beginPath(); ctx.moveTo(467, 58); ctx.lineTo(480, 295); ctx.stroke();
  } else {
    const slots = ['companion', 'player', ...HIDDEN_IDS, SECRET_FINAL];
    slots.forEach((id, i) => {
      const x = 154 + i * 92, visitor = i >= 2;
      if (visitor && !guests.includes(id)) return;
      ctx.save();
      if (faded && visitor) ctx.globalAlpha *= shot.fadeGuests ? 1 - (shot.progress ?? 1) : 0;
      if (id === SECRET_FINAL && shot.hostForm === 'large') drawStoryForm(ctx, characterOf(script, SECRET_FINAL).storyForm ?? {}, x - 6, 105, 125, false, app.skin, { frame: shot.frame, reducedMotion: shot.reducedMotion });
      else figure(ctx, app, script, id, x, 152, 86, 'idle', shot);
      ctx.restore();
    });
    if (shot.reach || faded) reachingHand(ctx, 313, 206);
  }
  caption(ctx, old ? '언제 찍었는지 모르는 사진' : faded ? '함께 찍었던 사진' : '오늘의 참가자들', 318);
}
function drawStoryArt(ctx, app, script, visual, guests = [], shot = {}) {
  ctx.save();
  const painted = app.skin.hasBackground?.(storyBackground(visual, shot));
  if (['photo', 'memory', 'oldPhoto'].includes(visual)) photo(ctx, app, script, visual, guests, shot);
  else if (visual === 'table') {
    if (!painted) {
    panel(ctx, 95, 24, 770, 325, '#eee8df', 20);
    // 빈 의자와 접시의 간격은 사진 속 다섯 자리와 같은 리듬을 유지한다.
    for (let i = 0; i < 5; i++) panel(ctx, 178 + i * 125, 72, 59, 102, '#d6c9bd', 16);
    panel(ctx, 130, 153, 700, 147, '#c8ac98', 35);
    for (let i = 0; i < 5; i++) {
      const x = 207 + i * 125;
      oval(ctx, x, 215, 43, 20, '#fdf8ee'); oval(ctx, x, 215, 33, 13, '#eee6d9');
      if (i < (shot.snacks ?? 0)) snack(ctx, x, 212);
    }
    }
    if (shot.phase !== 'left') {
      figure(ctx, app, script, 'player', painted ? 245 : 56, painted ? 320 : 225, painted ? 108 : 102, 'idle', shot);
      figure(ctx, app, script, 'companion', painted ? 370 : 798, painted ? 310 : 225, painted ? 110 : 102, 'idle', shot);
    }
    if (!painted) caption(ctx, shot.phase === 'left' ? ' ' : '남아 있는 다섯 사람의 자리', 330);
  } else if (['inside', 'reveal', 'threshold'].includes(visual)) {
    if (!painted) room(ctx);
    else { ctx.fillStyle = '#302b481c'; ctx.fillRect(0, 0, 960, 540); }
    const big = shot.hostForm === 'large' || visual === 'reveal';
    if (visual === 'threshold') {
      if (!painted) {
      panel(ctx, 105, 44, 290, 280, '#dad2cb', 0);
      panel(ctx, 391, 44, 12, 280, '#96878a', 0);
      }
      const closeThreshold = app.skin.hasBackground?.('threshold');
      ctx.save(); if (painted && !closeThreshold) { ctx.translate(-178, 0); }
      figure(ctx, app, script, 'player', closeThreshold ? 130 : 228, 194, 120, 'idle', shot);
      figure(ctx, app, script, 'companion', closeThreshold ? 24 : 124, 184, 108, 'idle', shot);
      if (shot.hostForm === 'small') {
        figure(ctx, app, script, SECRET_FINAL, closeThreshold ? 340 : 411, 185, 132, 'idle', shot);
        reachingHand(ctx, closeThreshold ? 336 : 411, 292, '#f8eee9', 18);
      } else drawStoryForm(ctx, characterOf(script, SECRET_FINAL).storyForm ?? {}, closeThreshold ? 370 : 411, 91, 253, true, app.skin, { frame: shot.frame, reducedMotion: shot.reducedMotion });
      // 전용 배경의 문턱은 약 (320, 292). 작은 손끝 298과 큰 손끝 336 사이에 틈을 남긴다.
      reachingHand(ctx, closeThreshold ? 245 : 323, 292, '#f8eee9', closeThreshold ? 53 : 55, closeThreshold ? '#8a6e68' : null);
      ctx.restore();
      HIDDEN_IDS.forEach((id, i) => figure(ctx, app, script, id, 682 + (i % 2) * 76, 95 + Math.floor(i / 2) * 101, 72, 'idle', shot));
      // 문턱의 선과 두 손 사이의 틈을 끝까지 남긴다.
    } else if (big) {
      const t = visual === 'reveal' && shot.phase === 'unveil' ? (shot.progress ?? 1) : 1;
      HIDDEN_IDS.forEach((id, i) => figure(ctx, app, script, id, painted ? 372 + i * 148 : 560 + (i % 2) * 123, painted ? 176 : 63 + Math.floor(i / 2) * 118, 88, 'idle', shot));
      ctx.save(); ctx.globalAlpha *= 1 - t; figure(ctx, app, script, SECRET_FINAL, painted ? 224 : 339, painted ? 139 : 143, 132, 'idle', shot); ctx.restore();
      ctx.save(); ctx.globalAlpha *= t; drawStoryForm(ctx, characterOf(script, SECRET_FINAL).storyForm ?? {}, painted ? 170 : 294, painted ? 79 : 52, painted ? 240 : 285, shot.phase === 'reach', app.skin, { frame: shot.frame, reducedMotion: shot.reducedMotion }); ctx.restore();
      if (shot.phase !== 'alone') {
        figure(ctx, app, script, 'player', 132, 209, 106, 'idle', shot);
        figure(ctx, app, script, 'companion', 215, 221, 91, 'idle', shot);
      }
      if (shot.medal) medal(ctx, painted ? 218 : 399, 284, .8);
      if (shot.snacks && !painted) { for (let i = 0; i < 5; i++) { cup(ctx, 531 + i * 53, 295); snack(ctx, 531 + i * 53, 322); } }
    } else {
      HIDDEN_IDS.forEach((id, i) => figure(ctx, app, script, id, painted ? 362 + i * 148 : 218 + i * 135, painted ? 172 : 100, 105, 'idle', shot));
      if (shot.phase === 'restore') {
        ctx.save(); ctx.globalAlpha *= 1 - (shot.progress ?? 1);
        drawStoryForm(ctx, characterOf(script, SECRET_FINAL).storyForm ?? {}, painted ? 170 : 294, painted ? 79 : 52, painted ? 240 : 285, false, app.skin);
        ctx.restore();
        ctx.save(); ctx.globalAlpha *= shot.progress ?? 1;
      }
      figure(ctx, app, script, SECRET_FINAL, painted ? 235 : 414, shot.hostForm === 'small' ? 78 : 206, 132, 'idle', shot);
      if (shot.phase === 'restore') ctx.restore();
      if (shot.medal) medal(ctx, painted ? 301 : 480, shot.hostForm === 'small' ? 183 : 315, .6);
      if (shot.hostForm === 'small' && shot.phase !== 'alone') {
        figure(ctx, app, script, 'player', 132, 209, 106, 'idle', shot);
        figure(ctx, app, script, 'companion', 215, 221, 91, 'idle', shot);
      }
      if (shot.phase === 'gather' && !painted) for (let i = 0; i < 5; i++) cup(ctx, 550 + i * 50, 297);
    }
  } else if (visual === 'invitation' || visual === 'register') {
    panel(ctx, 240, 45, 480, 300, '#fff7df');
    caption(ctx, visual === 'invitation' ? '한 판 더.' : '참가 명부', 96);
    for (let i = 0; i < 5; i++) {
      const y = 147 + i * 35;
      ctx.strokeStyle = '#b4a994'; ctx.beginPath(); ctx.moveTo(300, y); ctx.lineTo(610, y); ctx.stroke();
      caption(ctx, visual === 'invitation' ? '·' : '· · ·', y - 11);
      if (visual === 'register') { ctx.fillStyle = '#a26c7e'; ctx.fillText('○', 650, y - 11); }
    }
  } else if (visual === 'tower') {
    if (!painted) for (let i = 0; i < 5; i++) { const w = 150 + i * 110; panel(ctx, 480 - w / 2, 50 + i * 54, w, 48, i % 2 ? '#e7d4c3' : '#f5e4d5'); }
    figure(ctx, app, script, 'player', 155, 222, 130, 'happy', shot);
    figure(ctx, app, script, 'companion', 670, 222, 130, 'happy', shot); medal(ctx, 480, 73);
  }
  ctx.restore();
}
export { drawStoryArt, drawStoryForm };
