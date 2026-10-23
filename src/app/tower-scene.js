import { playSfx } from '../audio/sfx.js';
import { MENU_KEYS, wasPressed } from '../input/keyboard.js';
import { FINAL, FLOORS, HIDDEN_IDS, SECRET_FINAL } from '../story/campaign.js';
import { nextOpponents } from '../story/progress.js';
import { characterOf } from '../story/script.js';
import { PALETTE, flower, paper } from '../view/festival.js';
import { FONT, INK } from '../view/renderer.js';
import { drawFloorCompletion } from '../view/scene-motion.js';
import { entranceProgress } from '../view/ui-motion.js';

import { SCREEN_HEIGHT, SCREEN_WIDTH } from './screen.js';

// 14.3절. 시작 위치는 무작위, 커서 간격은 2프레임에서 시작해 4칸마다 2프레임씩 늘어난다.
// 480 + (0~29)프레임에 자동으로 정해지고, 결정 입력으로 바로 정할 수 있다.
// 후보가 하나뿐이면 60프레임 뒤 또는 결정 입력으로 정한다.
const ROULETTE_START_INTERVAL = 2;
const ROULETTE_STEPS_PER_SLOWDOWN = 4;
const ROULETTE_TIMEOUT = 480;
const ROULETTE_TIMEOUT_JITTER = 30;
const SINGLE_PICK_FRAMES = 60;
const PICK_HOLD_FRAMES = 40;

const PYRAMID_TOP = 93;
const LEVEL_HEIGHT = 51;

function floorLabel(run) {
  if (run.stage === 'final') {
    return '꼭대기 · 결승';
  }
  if (run.stage === 'secretFinal') {
    return '탑 안쪽 · 추가 경기';
  }
  return `${run.floorIndex + 1}층`;
}

function drawPyramid(ctx, run, frame, fromFloor) {
  const levels = FLOORS.length + 1;
  const quiet = run.stage === 'secretFinal';
  ctx.strokeStyle = '#a88c69'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(480, 93); ctx.lineTo(480, 69); ctx.stroke();
  ctx.fillStyle = PALETTE.pink; ctx.beginPath(); ctx.moveTo(482, 69); ctx.lineTo(520, 78); ctx.lineTo(482, 87); ctx.closePath(); ctx.fill();
  for (let level = 0; level < levels; level++) {
    const fromTop = level;
    const width = 160 + fromTop * 110;
    const x = SCREEN_WIDTH / 2 - width / 2;
    const y = PYRAMID_TOP + fromTop * LEVEL_HEIGHT;
    const floorIndex = levels - 1 - level;
    const current =
      (level === 0 && (run.stage === 'final' || run.stage === 'secretFinal')) ||
      (floorIndex === run.floorIndex && run.stage !== 'final' && run.stage !== 'secretFinal');
    const cleared = level === 0 ? false : floorIndex < run.floorIndex;
    paper(ctx, x, y, width, LEVEL_HEIGHT - 3, {
      fill: current ? PALETTE.pink : cleared ? '#dce6c8' : '#eee1c6', edge: '#b69c7b', radius: 6,
    });
    ctx.strokeStyle = '#b69c7b45'; ctx.lineWidth = 1;
    for (let bx = x + 58; bx < x + width - 10; bx += 68) {
      ctx.beginPath(); ctx.moveTo(bx, y + 5); ctx.lineTo(bx, y + LEVEL_HEIGHT - 9); ctx.stroke();
    }
    if (cleared) {
      const newlyCleared = fromFloor < run.floorIndex && floorIndex === run.floorIndex - 1;
      drawFloorCompletion(ctx, x + width - 37, y + 23,
        newlyCleared ? Math.max(0, frame - 7) : 18, quiet);
    }
    ctx.fillStyle = '#b69c7b';
    ctx.fillRect(x + 6, y + LEVEL_HEIGHT - 4, width - 12, 4);
    ctx.fillStyle = INK;
    ctx.font = `bold 15px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(level === 0 ? '결승' : `${floorIndex + 1}층`, x + 14, y + (LEVEL_HEIGHT - 6) / 2);
  }
  const target = Math.min(run.floorIndex, levels - 1);
  const from = Math.min(fromFloor, levels - 1);
  const t = entranceProgress(frame, 22, quiet);
  const movingFloor = from + (target - from) * t;
  const level = levels - 1 - movingFloor;
  const width = 160 + level * 110;
  const markerX = SCREEN_WIDTH / 2 - width / 2 - 19;
  const markerY = PYRAMID_TOP + level * LEVEL_HEIGHT + 23;
  paper(ctx, markerX - 13, markerY - 13, 26, 26, { fill: PALETTE.pink, radius: 13, shadow: false });
  flower(ctx, markerX, markerY, 8, '#fffdf5');
}

// 상대 선정은 경기 결과(엔진)와 별개인 화면 흐름이라 브라우저 난수를 쓴다.
function randomBelow(n) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % n;
}

function createTowerScene({ run, records, script, onPick, onBack, fromFloor = run.floorIndex }) {
  const candidates = nextOpponents(run);
  const single = candidates.length === 1;
  const timeout = ROULETTE_TIMEOUT + randomBelow(ROULETTE_TIMEOUT_JITTER);
  let cursor = randomBelow(candidates.length);
  let frame = 0;
  let steps = 0;
  let sinceStep = 0;
  let picked = null;
  let hold = 0;

  return {
    musicScene: 'story',
    update(app) {
      if (wasPressed(app.keyboard, MENU_KEYS.back) && onBack) {
        onBack(app);
        return;
      }
      frame += 1;
      if (picked) {
        hold += 1;
        if (hold > PICK_HOLD_FRAMES) {
          onPick(app, picked);
        }
        return;
      }
      if (single) {
        if (frame >= SINGLE_PICK_FRAMES || wasPressed(app.keyboard, MENU_KEYS.confirm)) {
          picked = candidates[0];
          playSfx(app.sfx, 'confirm');
        }
        return;
      }
      sinceStep += 1;
      const interval = ROULETTE_START_INTERVAL + 2 * Math.floor(steps / ROULETTE_STEPS_PER_SLOWDOWN);
      if (sinceStep >= interval) {
        sinceStep = 0;
        steps += 1;
        cursor = (cursor + 1) % candidates.length;
        playSfx(app.sfx, 'cursor');
      }
      if (wasPressed(app.keyboard, MENU_KEYS.confirm) || frame >= timeout) {
        picked = candidates[cursor];
        playSfx(app.sfx, 'confirm');
      }
    },
    draw(ctx, app) {
      app.skin.drawBackground(ctx, SCREEN_WIDTH, SCREEN_HEIGHT, run.stage === 'secretFinal' ? 'inside' : 'tower');
      drawPyramid(ctx, run, frame, fromFloor);

      const floor = FLOORS[run.floorIndex];
      ctx.fillStyle = INK;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = `bold 26px ${FONT}`;
      ctx.fillText(floorLabel(run), SCREEN_WIDTH / 2, 20);
      ctx.font = `15px ${FONT}`;
      const goal = run.stage === 'ordinary' && floor ? ` / 다음 단계 ${floor.threshold}` : '';
      ctx.fillText(`누적 점수 ${run.score}${goal}`, SCREEN_WIDTH / 2, 50);

      const size = candidates.length > 4 ? 72 : 96;
      const perRow = Math.min(candidates.length, 8);
      const rowWidth = perRow * (size + 12);
      candidates.forEach((id, i) => {
        const x = SCREEN_WIDTH / 2 - rowWidth / 2 + (i % perRow) * (size + 12);
        const y = 410 + Math.floor(i / perRow) * (size + 12);
        const active = picked ? id === picked : single || i === cursor;
        ctx.fillStyle = active ? 'rgba(255, 214, 226, 0.95)' : 'rgba(255, 255, 255, 0.7)';
        ctx.beginPath();
        ctx.roundRect(x - 4, y - 4, size + 8, size + 8, 12);
        ctx.fill();
        ctx.globalAlpha = active ? 1 : 0.5;
        const unknown = id === SECRET_FINAL || (id.startsWith('secret') && !picked);
        app.skin.drawCharacter(ctx, characterOf(script, id).charId, unknown ? 'sad' : 'idle', x, y, size, { frame, instance: `tower-${id}` });
        ctx.globalAlpha = 1;
      });

      const victories = records?.hiddenWon ?? run.hiddenWonThisRun;
      const labels = HIDDEN_IDS.map((id, i) => `${i + 1}층 ${victories.includes(id) ? '●' : '○'}`).join('   ');
      ctx.font = `14px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = INK;
      ctx.fillText(`낯선 손님   ${labels}     Esc 저장하고 메뉴로`, SCREEN_WIDTH / 2, 526);

      ctx.textAlign = 'center';
      ctx.fillStyle = INK;
      if (picked) {
        const name = characterOf(script, picked).name;
        const special = picked === FINAL || picked === SECRET_FINAL || picked.startsWith('secret') || picked.startsWith('fixed');
        ctx.font = `bold 24px ${FONT}`;
        ctx.fillText(`${special ? '등장! ' : ''}${name}`, SCREEN_WIDTH / 2, 372);
      } else if (single) {
        ctx.font = `bold 24px ${FONT}`;
        ctx.fillText(`등장! ${characterOf(script, candidates[0]).name}`, SCREEN_WIDTH / 2, 372);
      } else {
        ctx.font = `16px ${FONT}`;
        ctx.fillText('Enter로 멈추기', SCREEN_WIDTH / 2, 376);
      }
    },
  };
}

export { createTowerScene };
