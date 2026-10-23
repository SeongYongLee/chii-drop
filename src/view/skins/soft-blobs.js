import { connectedBlobCurves, curve, silhouette } from './blob-outline.js';
import { GARBAGE } from '../../engine/field.js';
import { drawGrassGarbage, GRASS_COLOR } from './grass.js';

// 표시용 팔레트와 문양. 경기 색 ID·판정·프레임·난수는 읽거나 바꾸지 않는다.
const COLORS = {
  1: { fill: '#ee9eaf', shade: '#d97d94', edge: '#9c5b6b', ink: '#a65d74' },
  2: { fill: '#8bc7e5', shade: '#68accf', edge: '#527f9d', ink: '#4e88ab' },
  3: { fill: '#f4d16c', shade: '#ddb14c', edge: '#aa833f', ink: '#af853a' },
  4: { fill: '#9bcd96', shade: '#7ab578', edge: '#638c58', ink: '#5e915c' },
  5: { fill: '#baa2db', shade: '#9e85c7', edge: '#7c659e', ink: '#8060a1' },
};
const SCALE = { normal: [1, 1], squash: [1.16, .78], stretch: [.88, 1.12],
  pop0: [1.2, .74], pop1: [1, 1], pop2: [.62, .62], pop3: [.26, .26] };
function oval(ctx, x, y, rx, ry, angle = 0) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2); ctx.fill();
}

function motif(ctx, color, ink) {
  ctx.fillStyle = '#fff6dfee'; ctx.strokeStyle = ink;
  ctx.lineWidth = .02; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (color === 1) {
    // 다섯 잎의 꽃: 점 하나짜리 테스트 마크 대신 둥근 꽃잎을 남긴다.
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
      ctx.beginPath(); ctx.ellipse(Math.cos(a) * .067, Math.sin(a) * .067, .043, .053, a + Math.PI / 2, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#f5d77f'; oval(ctx, 0, 0, .031, .031);
  } else if (color === 2) {
    // 눈 달린 블록 얼굴과 구분되는 작은 물고기 실루엣.
    ctx.beginPath(); ctx.moveTo(.075, 0);
    ctx.bezierCurveTo(.025, -.085, -.07, -.077, -.085, -.015);
    ctx.lineTo(-.137, -.061); ctx.quadraticCurveTo(-.116, 0, -.137, .061);
    ctx.lineTo(-.085, .015); ctx.bezierCurveTo(-.05, .078, .037, .065, .075, 0);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-.025, -.025); ctx.quadraticCurveTo(.006, 0, -.025, .025); ctx.stroke();
  } else if (color === 3) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? .05 : .118;
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (color === 4) {
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      ctx.beginPath(); ctx.ellipse(Math.cos(a) * .05, Math.sin(a) * .05, .045, .06, a - Math.PI / 2, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, .018); ctx.quadraticCurveTo(.016, .086, -.02, .12); ctx.stroke();
  } else {
    for (const sign of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.bezierCurveTo(sign * .04, -.043, sign * .123, -.095, sign * .122, -.034);
      ctx.bezierCurveTo(sign * .147, .038, sign * .076, .068, 0, 0);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sign * .025, .015); ctx.lineTo(sign * .072, .105);
      ctx.lineTo(sign * .04, .09); ctx.lineTo(sign * .015, .108); ctx.lineTo(0, .022);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#fff3d6'; oval(ctx, 0, 0, .027, .034);
  }
}

function softBlobColor(color) {
  return color === GARBAGE ? GRASS_COLOR : (COLORS[color] ?? COLORS[1]).fill;
}

function drawSoftBlob(ctx, color, x, y, size, style = {}) {
  const shape = style.shape ?? 'normal';
  if (color === GARBAGE) { drawGrassGarbage(ctx, x, y, size, shape); return; }
  const palette = COLORS[color] ?? COLORS[1], [sx, sy] = SCALE[shape] ?? SCALE.normal;
  const links = (style.links ?? 0) & 15;
  const curves = connectedBlobCurves(links, sx, sy);
  ctx.save(); ctx.translate(x, y); ctx.scale(size, size);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  silhouette(ctx, curves);
  ctx.fillStyle = shape === 'pop1' ? '#fffdf1' : palette.fill; ctx.fill();

  if (shape !== 'pop1') {
    ctx.save(); silhouette(ctx, curves); ctx.clip();
    // 유리 구슬 같은 강한 광택 대신 넓은 우윳빛 면과 아랫면의 옅은 음영.
    ctx.fillStyle = palette.shade + '65'; oval(ctx, .55, 1 + (.75 - 1) * sy, .44 * sx, .18 * sy, -.08);
    ctx.fillStyle = '#fff7e343'; oval(ctx, .37, 1 + (.29 - 1) * sy, .31 * sx, .16 * sy, -.16);
    ctx.fillStyle = '#fff8e580';
    oval(ctx, .29, 1 + (.28 - 1) * sy, .043 * sx, .022 * sy, -.4);
    oval(ctx, .37, 1 + (.225 - 1) * sy, .018 * sx, .013 * sy);
    ctx.restore();
  }
  // 칸을 가로지르는 연결부에는 선을 긋지 않아 안쪽 격자 이음매가 생기지 않는다.
  ctx.strokeStyle = palette.edge; ctx.lineWidth = .043;
  for (const points of curves) { ctx.beginPath(); curve(ctx, points); ctx.stroke(); }
  if (shape !== 'pop1' && shape !== 'pop3') {
    ctx.save(); ctx.translate(.5, 1 + (.53 - 1) * sy); ctx.scale(sx * 1.2, sy * 1.2);
    motif(ctx, color, palette.ink); ctx.restore();
    // 가장자리의 짧은 주름과 쌀가루 점은 모양을 해치지 않는 고정 장식이다.
    ctx.strokeStyle = palette.edge + '70'; ctx.lineWidth = .018;
    if (!(links & 8)) { ctx.beginPath(); ctx.moveTo(.16, 1 + (.63 - 1) * sy); ctx.quadraticCurveTo(.17, 1 + (.69 - 1) * sy, .20, 1 + (.71 - 1) * sy); ctx.stroke(); }
  }
  if (style.axis) {
    ctx.fillStyle = '#fff8e6'; ctx.strokeStyle = '#795c4b'; ctx.lineWidth = .023;
    oval(ctx, .5, 1 + (.79 - 1) * sy, .035 * sx, .024 * sy);
    ctx.stroke();
  }
  ctx.restore();
}

export { drawSoftBlob, softBlobColor };
