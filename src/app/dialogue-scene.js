import { playSfx } from '../audio/sfx.js';
import { blipFor, playVoiceBlip, voiceProfile } from '../audio/voice.js';
import { MENU_KEYS, wasPressed } from '../input/keyboard.js';
import { characterOf } from '../story/script.js';
import { PALETTE, paper } from '../view/festival.js';
import { entranceProgress, reducedUiMotion } from '../view/ui-motion.js';
import { FONT, INK } from '../view/renderer.js';
import { compileDirections, poseAt, progress, storyBackground } from '../view/story-direction.js';
import { drawStoryArt } from '../view/story-art.js';

import { SCREEN_HEIGHT, SCREEN_WIDTH } from './screen.js';

const CHARS_PER_FRAME = 0.6;
const LEFT_SPEAKERS = new Set(['player', 'companion']);

function wrapText(ctx, text, width) {
  const lines = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > width && line) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines;
}

// lines: [{ who, text, mood }], opponent: 오른쪽에 설 상대 ID
function createDialogueScene({ lines, script, opponent, onDone, guests = [], scenery = 'dialogue', musicScene = 'story', startLine = 0, skippable = true }) {
  let index = Math.max(0, Math.min(lines.length - 1, Math.trunc(startLine) || 0));
  const directions = compileDirections(lines);
  const ages = Array(lines.length).fill(0);
  let shotAge = 0;
  let previousShot = null;
  let shown = 0;
  const moods = {};
  const moodFrames = {};
  let previousLine = -1;
  let done = false;
  let frame = 0;
  let speakerAge = 0;

  function finish(app) {
    if (done) return;
    done = true;
    onDone(app);
  }

  return {
    musicScene,
    update(app) {
      const { keyboard } = app;
      if (lines.length === 0) {
        finish(app);
        return;
      }
      frame += 1;
      shotAge += 1;
      for (let i = 0; i <= index; i++) ages[i] += 1;
      speakerAge += 1;
      const line = lines[index];
      for (const id of Object.keys(moodFrames)) moodFrames[id] += 1;
      if (line.who) {
        moods[line.who] = line.mood ?? 'idle';
        if (previousLine !== index) moodFrames[line.who] = 0;
      }
      previousLine = index;
      const before = Math.floor(shown);
      const pause = reducedUiMotion() || directions[index].stageAt !== index ? 0 : (directions[index].stage.pauseFrames ?? 0);
      if (ages[index] > pause) shown = Math.min(line.text.length, shown + CHARS_PER_FRAME);
      // 화자가 있는 대사는 새로 보인 글자마다 캐릭터 목소리를 낸다. 지문은 조용히 나온다.
      if (line.who && app.sfx && app.settings?.voice !== false) {
        const character = characterOf(script, line.who);
        const profile = voiceProfile(character.charId, character.voice);
        for (let i = before; i < Math.floor(shown); i++) {
          playVoiceBlip(app.sfx, blipFor(profile, line.text, i, line.mood));
        }
      }
      if (skippable && wasPressed(keyboard, MENU_KEYS.back)) {
        playSfx(app.sfx, 'cancel');
        finish(app);
      } else if (wasPressed(keyboard, MENU_KEYS.confirm)) {
        if (shown < line.text.length) {
          shown = line.text.length;
          ages[index] = Math.max(ages[index], 240);
          ages[directions[index].stageAt] = Math.max(ages[directions[index].stageAt], 240);
          shotAge = 240;
        } else if (index + 1 < lines.length) {
          const old = directions[index];
          if (old.stageAt !== directions[index + 1].stageAt) {
            previousShot = { direction: old, ages: [...ages] };
            shotAge = 0;
          }
          index += 1;
          shown = 0;
          speakerAge = 0;
          if (!directions[index].stage.quiet) playSfx(app.sfx, 'cursor');
        } else {
          playSfx(app.sfx, 'confirm');
          finish(app);
        }
      }
    },
    draw(ctx, app) {
      const direction = directions[index];
      const sceneVisual = direction?.visual;
      const drawBackdrop = (d) => app.skin.drawBackground(ctx, SCREEN_WIDTH, SCREEN_HEIGHT, storyBackground(d?.visual, d?.stage, scenery));
      drawBackdrop(direction);
      if (lines.length === 0) {
        return;
      }
      const line = lines[index];
      const leftIds = ['player', 'companion'];
      const visual = sceneVisual;
      const still = reducedUiMotion();
      const rightIds = opponent ? [opponent] : [];
      const portrait = (id, x, size) => {
        const character = characterOf(script, id);
        const active = line.who === id;
        const cue = direction.cast[id] ?? {};
        const pose = poseAt(cue, ages[cue.at] ?? 0, still);
        ctx.save();
        ctx.translate(x + size / 2 + pose.x, 360 + pose.y);
        ctx.rotate(pose.angle);
        ctx.globalAlpha = line.who && !active ? 0.72 : 1;
        app.skin.drawCharacter(ctx, character.charId, cue.mood ?? moods[id] ?? 'idle', -size / 2, -size, size,
          { frame: ages[cue.at] ?? moodFrames[id] ?? 0, blinkFrame: app.animationFrame ?? frame, reducedMotion: still, instance: `dialogue-${id}` });
        ctx.restore();
      };
      if (visual) {
        const artwork = (d, a) => drawStoryArt(ctx, app, script, d.visual, guests, {
          ...d.stage, cast: d.cast, ages: a, frame, reducedMotion: still,
          progress: progress(a[d.stageAt] ?? 0, d.stage.duration ?? 72, still),
        });
        const mix = progress(shotAge, direction.stage.transitionFrames ?? 32, still);
        if (previousShot?.direction.visual && mix < 1) {
          drawBackdrop(previousShot.direction);
          artwork(previousShot.direction, previousShot.ages);
        }
        ctx.save();
        ctx.globalAlpha *= previousShot?.direction.visual ? mix : 1;
        drawBackdrop(direction);
        artwork(direction, ages);
        ctx.restore();
      } else {
        leftIds.forEach((id, i) => portrait(id, 60 + i * 150, i === 0 ? 200 : 160));
        rightIds.forEach((id) => portrait(id, SCREEN_WIDTH - 280, 220));
      }

      const quiet = direction.stage.quiet || ['reveal', 'threshold', 'inside', 'memory', 'oldPhoto', 'register', 'invitation'].includes(sceneVisual ?? scenery);
      const topCaption = direction.stage.layout === 'caption';
      const bubbleY = topCaption ? 22 : 370;
      ctx.save();
      ctx.translate(0, 24 * (1 - entranceProgress(frame, 18, quiet)));
      paper(ctx, 60, bubbleY, SCREEN_WIDTH - 120, topCaption ? 94 : 140, { fill: '#fffdf5f5', radius: 20 });
      ctx.fillStyle = '#fffdf5'; ctx.strokeStyle = PALETTE.edge; ctx.lineWidth = 2;
      if (line.who && !visual) {
        const tip = LEFT_SPEAKERS.has(line.who) ? 180 : 760;
        ctx.beginPath(); ctx.moveTo(tip - 12, 370); ctx.lineTo(tip, 355); ctx.lineTo(tip + 12, 370); ctx.fill();
      }

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      if (line.who) {
        const name = characterOf(script, line.who).name;
        ctx.save();
        const nameT = quiet || reducedUiMotion() ? 1 : Math.min(1, speakerAge / 12);
        ctx.translate(0, -5 * Math.sin(Math.PI * nameT));
        paper(ctx, 78, topCaption ? 10 : 358, Math.max(104, name.length * 19 + 28), 35, {
          fill: LEFT_SPEAKERS.has(line.who) ? PALETTE.pink : PALETTE.blue, radius: 10, shadow: false,
        });
        ctx.fillStyle = INK;
        ctx.font = `bold 18px ${FONT}`;
        ctx.fillText(name, 91, topCaption ? 18 : 366);
        ctx.restore();
      }
      ctx.fillStyle = INK;
      ctx.font = line.who ? `20px ${FONT}` : `italic 20px ${FONT}`;
      const visible = line.text.slice(0, Math.floor(shown));
      wrapText(ctx, visible, SCREEN_WIDTH - 180).forEach((text, i) => {
        ctx.fillText(text, 88, (topCaption ? (line.who ? 58 : 43) : 414) + i * 28);
      });
      if (shown >= line.text.length && (quiet || reducedUiMotion() || Math.floor(frame / 24) % 2 === 0)) {
        ctx.fillText('▼', SCREEN_WIDTH - 100, topCaption ? 85 : 480);
      }
      ctx.restore();
      ctx.fillStyle = '#9a8b7c';
      ctx.font = `13px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(skippable ? 'Enter 다음 · Esc 건너뛰기' : 'Enter 다음 · 장면 전체 건너뛰기 불가', SCREEN_WIDTH - 72, 518);
    },
  };
}

export { createDialogueScene };
