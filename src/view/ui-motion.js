import { UI_FONT } from './festival.js';

const TRANSITION_FRAMES = 14;
const STAMP_FRAMES = 12;

function reducedUiMotion() {
  return Boolean(globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

// 마지막으로 보인 화면만 저장한다. 이전 장면의 update/draw를 다시 호출하지 않는다.
function captureUiScreen(canvas) {
  const snapshot = document.createElement('canvas');
  snapshot.width = canvas.width;
  snapshot.height = canvas.height;
  snapshot.getContext('2d').drawImage(canvas, 0, 0);
  return snapshot;
}

function drawConfirmationStamp(ctx, { x, y, player = 0 }, age = STAMP_FRAMES) {
  const still = reducedUiMotion();
  const t = still ? 1 : Math.min(1, Math.max(0, age / STAMP_FRAMES));
  const scale = 1 + .65 * (1 - t) ** 3 - .06 * Math.sin(Math.PI * t);
  ctx.save();
  ctx.translate(x, y); ctx.rotate(-.12); ctx.scale(scale, scale);
  ctx.globalAlpha *= still ? 1 : Math.min(1, (age + 1) / 3);
  const ink = player === 0 ? '#ad526b' : '#33748b';
  ctx.fillStyle = '#fffdf5f2'; ctx.strokeStyle = ink; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.roundRect(-39, -19, 78, 38, 7); ctx.fill(); ctx.stroke();
  ctx.lineWidth = .9;
  ctx.beginPath(); ctx.roundRect(-34, -14, 68, 28, 4); ctx.stroke();
  ctx.fillStyle = ink; ctx.font = `bold 18px ${UI_FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('결정!', 0, 1);
  ctx.restore();
}

// 표시만 겹쳐 그린다. 새 장면의 입력·업데이트·경기 준비 시간은 즉시 진행한다.
function createUiTransition() {
  let snapshot = null;
  let stamps = [];
  let age = TRANSITION_FRAMES;
  return {
    start(image, confirmations = []) {
      snapshot = reducedUiMotion() ? null : image;
      stamps = snapshot ? confirmations : [];
      age = snapshot ? 0 : TRANSITION_FRAMES;
    },
    update() {
      age = Math.min(TRANSITION_FRAMES, age + 1);
      if (age === TRANSITION_FRAMES) { snapshot = null; stamps = []; }
    },
    draw(ctx, width, height) {
      if (!snapshot || reducedUiMotion()) return;
      const t = age / TRANSITION_FRAMES;
      ctx.save();
      // 처음 몇 프레임은 결정 도장을 읽고, 나머지 구간에서 빠르게 사라진다.
      ctx.globalAlpha = 1 - t * t * (3 - 2 * t);
      // 메뉴와 경기의 세로 영역 높이가 달라도 이전 화면의 비율은 유지한다.
      const snapshotHeight = snapshot.width > 0 && snapshot.height > 0
        ? width * snapshot.height / snapshot.width : height;
      ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
      ctx.drawImage(snapshot, 0, 0, width, snapshotHeight);
      for (const stamp of stamps) drawConfirmationStamp(ctx, stamp, age);
      ctx.restore();
    },
  };
}

export { TRANSITION_FRAMES, captureUiScreen, createUiTransition, drawConfirmationStamp, reducedUiMotion };

function entranceProgress(age, duration = 18, quiet = false) {
  if (quiet || reducedUiMotion()) return 1;
  const t = Math.min(1, Math.max(0, age / duration));
  return 1 - (1 - t) ** 3;
}

export { entranceProgress };
