import { GARBAGE } from '../../engine/field.js';
import { drawGrassGarbage, GRASS_COLOR } from './grass.js';

const BLOB_COLORS = {
  1: { fill: '#f6a5c0', edge: '#d9739a' },
  2: { fill: '#9fd3ef', edge: '#5fa8d3' },
  3: { fill: '#ffd97a', edge: '#e0ac34' },
  4: { fill: '#a8e0b8', edge: '#5fb07a' },
  5: { fill: '#cdb4f0', edge: '#9a7ad0' },
};

// 착지 눌림·늘어남과 소멸 단계의 크기 비율 [가로, 세로]. 아래 끝을 기준으로 그린다.
const SHAPE_SCALE = {
  normal: [1, 1],
  squash: [1.16, 0.78],
  stretch: [0.88, 1.12],
  pop0: [1.2, 0.74],
  pop1: [1, 1],
  pop2: [0.62, 0.62],
  pop3: [0.26, 0.26],
};

// 이어진 방향 비트: 1 위, 2 오른쪽, 4 아래, 8 왼쪽
const LINKS = [
  [1, 0, -1],
  [2, 1, 0],
  [4, 0, 1],
  [8, -1, 0],
];

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// 색마다 다른 무늬를 넣어 색을 구분하기 어려운 사람도 알아볼 수 있게 한다.
function drawMark(ctx, color, cx, cy, r) {
  ctx.beginPath();
  if (color === 1) {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  } else if (color === 2) {
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
  } else if (color === 3) {
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy + r * 0.8);
    ctx.lineTo(cx - r, cy + r * 0.8);
  } else if (color === 4) {
    ctx.rect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6);
  } else {
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.lineWidth = r * 0.6;
    ctx.stroke();
    return;
  }
  ctx.closePath();
  ctx.fill();
}

// style: { links: 방향 비트, shape: 'normal' | 'squash' | 'stretch' | 'pop0'~'pop3' | 'gpop0'~'gpop2', axis }
function drawBlob(ctx, color, x, y, size, style = {}) {
  const shape = style.shape ?? 'normal';
  if (color === GARBAGE) {
    drawGrassGarbage(ctx, x, y, size, shape);
    return;
  }
  const { fill, edge } = BLOB_COLORS[color] ?? BLOB_COLORS[1];
  const [sx, sy] = SHAPE_SCALE[shape] ?? SHAPE_SCALE.normal;
  const w = size * sx;
  const h = size * sy;
  const left = x + (size - w) / 2;
  const top = y + size - h;
  const pad = size * 0.06;
  const links = style.links ?? 0;

  ctx.fillStyle = edge;
  for (const [bit, dx, dy] of LINKS) {
    if (links & bit) {
      const bw = dx === 0 ? size * 0.64 : size / 2 + 1;
      const bh = dy === 0 ? size * 0.64 : size / 2 + 1;
      const bx = dx === 0 ? x + (size - bw) / 2 : dx > 0 ? x + size / 2 : x - 1;
      const by = dy === 0 ? y + (size - bh) / 2 : dy > 0 ? y + size / 2 : y - 1;
      ctx.fillRect(bx, by, bw, bh);
    }
  }
  roundRect(ctx, left + pad, top + pad, w - pad * 2, h - pad * 2, Math.min(w, h) * 0.36);
  ctx.fill();

  ctx.fillStyle = shape === 'pop1' ? '#ffffff' : fill;
  for (const [bit, dx, dy] of LINKS) {
    if (links & bit) {
      const bw = dx === 0 ? size * 0.5 : size / 2 + 1;
      const bh = dy === 0 ? size * 0.5 : size / 2 + 1;
      const bx = dx === 0 ? x + (size - bw) / 2 : dx > 0 ? x + size / 2 : x - 1;
      const by = dy === 0 ? y + (size - bh) / 2 : dy > 0 ? y + size / 2 : y - 1;
      ctx.fillRect(bx, by, bw, bh);
    }
  }
  roundRect(ctx, left + pad * 2, top + pad * 2, w - pad * 4, h - pad * 4.4, Math.min(w, h) * 0.3);
  ctx.fill();

  if (shape === 'normal' || shape === 'squash' || shape === 'stretch' || shape === 'pop0') {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.ellipse(left + w * 0.34, top + h * 0.3, w * 0.12, h * 0.08, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    drawMark(ctx, color, left + w / 2, top + h * 0.56, Math.min(w, h) * 0.14);
  }
  if (style.axis) {
    // 밝은 배경에서도 본래 색과 윤곽이 남도록 얇은 잉크색으로 축을 표시한다.
    ctx.strokeStyle = 'rgba(107, 78, 57, 0.85)';
    ctx.lineWidth = size * 0.04;
    roundRect(ctx, left + pad * 1.5, top + pad * 1.5, w - pad * 3, h - pad * 3, Math.min(w, h) * 0.34);
    ctx.stroke();
  }
}

function blobColor(color) {
  return color === GARBAGE ? GRASS_COLOR : (BLOB_COLORS[color] ?? BLOB_COLORS[1]).fill;
}

export { blobColor, drawBlob };
