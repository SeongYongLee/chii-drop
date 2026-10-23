const GRASS_COLOR = '#c5a17c';

// 표시 단계만 읽으며 판정과 소거 타이밍은 엔진 상태를 그대로 따른다.
function drawGrassGarbage(ctx, x, y, size, shape = 'normal') {
  const stage = { gpop0: 0, gpop1: 1, gpop2: 2 }[shape];
  const scale = [0.85, 0.6, 0.35][stage] ?? 1;
  const s = size * scale;
  const left = x + (size - s) / 2;
  const top = y + size - s;
  ctx.save();
  ctx.translate(left, top);
  ctx.scale(s / 32, s / 32);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 둥근 흙덩이와 새싹을 분리해 초록 색떡과 다른 실루엣을 만든다.
  outline(ctx, GRASS_COLOR, () => {
    ctx.moveTo(3, 22); ctx.quadraticCurveTo(3, 17, 9, 18);
    ctx.quadraticCurveTo(13, 15, 17, 18); ctx.quadraticCurveTo(23, 15, 26, 20);
    ctx.quadraticCurveTo(30, 21, 28, 26); ctx.quadraticCurveTo(25, 30, 16, 29);
    ctx.quadraticCurveTo(5, 31, 3, 26); ctx.closePath();
  }, '#916e57', 1.35);
  ctx.fillStyle = '#aa805e50';
  ctx.beginPath(); ctx.moveTo(5, 25); ctx.quadraticCurveTo(16, 31, 28, 23);
  ctx.quadraticCurveTo(29, 30, 16, 29); ctx.quadraticCurveTo(7, 30, 5, 25); ctx.fill();
  ctx.strokeStyle = '#edcfaa'; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.moveTo(6, 21); ctx.quadraticCurveTo(9, 19, 12, 20); ctx.stroke();
  for (const [cx, cy, r, fill] of [[8, 25, 1.15, '#a17b5c'], [22, 25.5, 1.3, '#f0d3a8'], [18, 27, .65, '#a17b5c']]) {
    ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(cx, cy, r, r * .7, -.25, 0, Math.PI * 2); ctx.fill();
  }

  const lift = stage === undefined ? 0 : [1.6, 4.16, 6.72][stage];
  ctx.translate(0, -lift);
  // 소거 단계에서는 풀과 뿌리가 흙 위로 들리며 뽑힌다.
  if (stage !== undefined) {
    ctx.strokeStyle = '#9c7958';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(16, 18); ctx.quadraticCurveTo(14, 22, 16, 26);
    ctx.moveTo(15, 21); ctx.lineTo(11, 24);
    ctx.moveTo(15, 22); ctx.lineTo(20, 25);
    ctx.stroke();
    ctx.strokeStyle = '#f0d8b2'; ctx.lineWidth = .75; ctx.stroke();
  }

  for (const [tx, ty, width, color] of [[5, 8, 4.2, CARGO.green], [18, 3.5, 4.1, CARGO.light],
    [27, 8, 4.6, CARGO.green], [8, 15, 3.5, '#adc997'], [23, 17, 3.3, CARGO.dark]]) {
    blade(ctx, 16, 20, tx, ty, width, color);
  }
  ctx.strokeStyle = '#63845b'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(16, 21); ctx.quadraticCurveTo(15, 16, 18, 10); ctx.stroke();
  ctx.restore();
}

export { drawGrassGarbage, GRASS_COLOR };

// 큰 예고는 32×32의 같은 칸 안에서 운반 형태와 적재량으로 구분한다.
// 경기 상태나 수량 계산은 읽지 않는 순수한 표시 함수다.
const CARGO = { edge: '#8d705a', green: '#96b982', light: '#c4d6a0', dark: '#729567',
  cloth: '#eddbb6', seam: '#b29775', wood: '#c6a17b', woodLight: '#e4c9a0' };

function outline(ctx, fill, draw, edge = CARGO.edge, width = 1.25) {
  ctx.fillStyle = fill; ctx.strokeStyle = edge; ctx.lineWidth = width;
  ctx.beginPath(); draw(); ctx.closePath(); ctx.fill(); ctx.stroke();
}

// 줄기 끝을 중심으로 길이와 방향이 다른 잎을 그린다.
function blade(ctx, bx, by, tx, ty, width, fill = CARGO.green) {
  const dx = tx - bx, dy = ty - by, length = Math.hypot(dx, dy);
  const nx = -dy / length * width, ny = dx / length * width;
  outline(ctx, fill, () => {
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx + dx * .35 + nx, by + dy * .35 + ny, tx, ty);
    ctx.quadraticCurveTo(bx + dx * .65 - nx * .35, by + dy * .65 - ny * .35, bx, by);
  }, CARGO.dark, .85);
  ctx.strokeStyle = '#e5edc5b0'; ctx.lineWidth = .65;
  ctx.beginPath(); ctx.moveTo(bx + dx * .22, by + dy * .22);
  ctx.quadraticCurveTo(bx + dx * .54 + nx * .15, by + dy * .54 + ny * .15, bx + dx * .79, by + dy * .79); ctx.stroke();
}

function cord(ctx, draw, width = 1.6) {
  ctx.strokeStyle = '#a18160'; ctx.lineWidth = width + .8;
  ctx.beginPath(); draw(); ctx.stroke();
  ctx.strokeStyle = '#f3dfb7'; ctx.lineWidth = width;
  ctx.beginPath(); draw(); ctx.stroke();
}

function cutBundle(ctx) {
  // 아래로 퍼지는 여러 줄기와 서로 다른 길이의 잎.
  ctx.strokeStyle = CARGO.dark; ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [a, b] of [[12, 7], [14, 12], [16, 17], [19, 23]]) {
    ctx.moveTo(a, 17); ctx.lineTo(b, 29);
  }
  ctx.stroke();
  for (const [tx, ty, w, color] of [
    [2, 9, 4, CARGO.dark], [6, 4, 4.5, CARGO.green], [13, 1.5, 4, CARGO.light],
    [19, 3, 4.3, CARGO.green], [28, 5, 4.8, CARGO.dark], [30, 12, 4, CARGO.green],
  ]) blade(ctx, 15, 23, tx, ty, w, color);
  cord(ctx, () => { ctx.moveTo(10, 22); ctx.quadraticCurveTo(16, 24, 22, 21); }, 1.7);
  cord(ctx, () => { ctx.moveTo(17, 23); ctx.quadraticCurveTo(24, 18, 22, 24); ctx.lineTo(18, 24); ctx.lineTo(20, 28); }, .85);
}

function sack(ctx) {
  // 좁은 입구·어깨·불룩한 배·눌린 바닥을 하나의 윤곽으로 그린다.
  for (const [tx, ty, w] of [[6, 5, 3], [12, 1.5, 3], [20, 2, 3.5], [27, 6, 3]]) {
    blade(ctx, 16, 14, tx, ty, w);
  }
  outline(ctx, CARGO.cloth, () => {
    ctx.moveTo(9, 10); ctx.quadraticCurveTo(16, 12, 23, 9.5);
    ctx.lineTo(22, 14); ctx.bezierCurveTo(28, 17, 31, 23, 27, 28);
    ctx.quadraticCurveTo(25, 31, 15, 30.5); ctx.quadraticCurveTo(4, 31, 3, 26);
    ctx.quadraticCurveTo(1, 20, 10, 14); ctx.closePath();
  });
  ctx.fillStyle = '#c7ac8566';
  ctx.beginPath(); ctx.moveTo(22, 15); ctx.quadraticCurveTo(31, 24, 25, 28);
  ctx.quadraticCurveTo(20, 30, 11, 29); ctx.quadraticCurveTo(28, 27, 22, 15); ctx.fill();
  ctx.strokeStyle = '#fff2d4'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(9, 18); ctx.quadraticCurveTo(5, 21, 6, 25); ctx.stroke();
  // 말린 입구와 힘을 받는 주름으로 천 재질을 표시한다.
  outline(ctx, '#f5e6c9', () => {
    ctx.moveTo(8.5, 10); ctx.quadraticCurveTo(16, 13, 23.5, 10);
    ctx.lineTo(23, 13); ctx.quadraticCurveTo(16, 16, 9, 13); ctx.closePath();
  }, CARGO.seam, 1);
  ctx.strokeStyle = CARGO.seam; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(12, 15); ctx.lineTo(10, 18); ctx.moveTo(20, 15); ctx.lineTo(22, 19);
  ctx.moveTo(9, 27); ctx.quadraticCurveTo(15, 29, 20, 27); ctx.stroke();
  // 바느질 자국은 작은 실제 크기에서도 천으로 읽힐 만큼만 남긴다.
  ctx.strokeStyle = '#b49a78'; ctx.lineWidth = .65;
  ctx.beginPath();
  for (const [x, y] of [[7, 23], [8, 25], [10, 27], [13, 28]]) {
    ctx.moveTo(x, y); ctx.lineTo(x + 1.2, y - .6);
  }
  ctx.stroke();
}

function wheel(ctx, x, y, radius) {
  outline(ctx, '#ad8a68', () => ctx.arc(x, y, radius, 0, Math.PI * 2), CARGO.edge, 1.1);
  ctx.strokeStyle = '#ecd4ac'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x - radius + 1, y); ctx.lineTo(x + radius - 1, y);
  ctx.moveTo(x, y - radius + 1); ctx.lineTo(x, y + radius - 1); ctx.stroke();
  ctx.fillStyle = CARGO.edge; ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill();
}

function barrow(ctx) {
  // 손잡이·받침다리 → 적재물 → 깊이 있는 적재함 → 앞바퀴 순서.
  ctx.strokeStyle = CARGO.edge; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(20, 18); ctx.lineTo(29, 10); ctx.lineTo(30, 10);
  ctx.moveTo(21, 23); ctx.lineTo(24, 29); ctx.lineTo(27, 29); ctx.stroke();
  ctx.strokeStyle = CARGO.woodLight; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(23, 15); ctx.lineTo(29, 10); ctx.stroke();
  // 넓은 더미 위에 서로 다른 방향의 풀단 두 개를 올린다.
  outline(ctx, CARGO.dark, () => {
    ctx.moveTo(1.5, 18); ctx.quadraticCurveTo(0, 8, 6, 7);
    ctx.quadraticCurveTo(12, 2, 18, 5); ctx.quadraticCurveTo(23, 3, 27, 12);
    ctx.lineTo(25, 17); ctx.closePath();
  }, CARGO.dark, .8);
  for (const [x, y, angle] of [[9.5, 14, -.22], [19.5, 12, .22]]) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(.5, .5);
    ctx.translate(-15, -23); cutBundle(ctx); ctx.restore();
  }
  outline(ctx, CARGO.wood, () => {
    ctx.moveTo(2, 17); ctx.quadraticCurveTo(12, 15, 21, 14);
    ctx.lineTo(26, 18); ctx.lineTo(22, 24.5);
    ctx.quadraticCurveTo(15, 27, 7, 26); ctx.closePath();
  });
  outline(ctx, '#af8b69', () => { ctx.moveTo(21, 14); ctx.lineTo(26, 18); ctx.lineTo(22, 24.5); ctx.lineTo(20, 18); }, CARGO.edge, 1);
  ctx.strokeStyle = '#f4dfb9'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(3, 17.5); ctx.lineTo(20, 15); ctx.stroke();
  ctx.strokeStyle = '#b08f6b'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(6, 21); ctx.lineTo(19, 19.5); ctx.stroke();
  wheel(ctx, 8, 27, 3.8);
}

function wagon(ctx) {
  // 풀단과 마대를 함께 적재해 가장 큰 단위의 실루엣을 만든다.
  ctx.strokeStyle = CARGO.edge; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(26, 24); ctx.lineTo(30, 17); ctx.stroke();
  outline(ctx, CARGO.dark, () => {
    ctx.moveTo(2, 19); ctx.quadraticCurveTo(1, 9, 8, 8);
    ctx.quadraticCurveTo(15, 3, 24, 7); ctx.quadraticCurveTo(30, 9, 29, 19); ctx.closePath();
  }, CARGO.dark, .9);
  ctx.save(); ctx.translate(12, .8); ctx.scale(.52, .52); sack(ctx); ctx.restore();
  ctx.save(); ctx.translate(22, 17); ctx.rotate(.25); ctx.scale(.46, .46);
  ctx.translate(-15, -23); cutBundle(ctx); ctx.restore();
  // 최상위 단계는 앞쪽에 작은 마대를 놓아 적재물 종류도 늘린다.
  outline(ctx, CARGO.cloth, () => {
    ctx.moveTo(6, 8); ctx.lineTo(13, 7); ctx.lineTo(12, 10);
    ctx.quadraticCurveTo(17, 14, 15, 19); ctx.lineTo(3, 20); ctx.quadraticCurveTo(1, 15, 7, 11); ctx.closePath();
  });
  ctx.strokeStyle = CARGO.seam; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(6, 10); ctx.lineTo(12, 9); ctx.moveTo(5, 15); ctx.lineTo(4, 18); ctx.stroke();
  cord(ctx, () => { ctx.moveTo(15, 3); ctx.quadraticCurveTo(20, 10, 24, 20); }, 1.3);
  outline(ctx, CARGO.wood, () => {
    ctx.moveTo(1, 19); ctx.lineTo(27, 17); ctx.lineTo(30, 20);
    ctx.lineTo(28, 26); ctx.lineTo(3, 27); ctx.closePath();
  });
  outline(ctx, '#af8b69', () => { ctx.moveTo(27, 17); ctx.lineTo(30, 20); ctx.lineTo(28, 26); ctx.lineTo(26, 23); }, CARGO.edge, .9);
  ctx.strokeStyle = '#a38263'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(3, 23); ctx.lineTo(26, 21.5); ctx.moveTo(7, 20); ctx.lineTo(7, 26); ctx.moveTo(23, 18.5); ctx.lineTo(23, 25); ctx.stroke();
  ctx.strokeStyle = '#f4dfb9'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(2, 19.5); ctx.lineTo(26, 17.8); ctx.stroke();
  wheel(ctx, 7, 27, 3.8); wheel(ctx, 25, 26, 4.2);
}

function drawGrassWarning(ctx, unit, x, y) {
  ctx.save(); ctx.translate(x, y); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (unit === 30) cutBundle(ctx);
  else if (unit === 200) sack(ctx);
  else if (unit === 300) barrow(ctx);
  else wagon(ctx);
  ctx.restore();
}

export { drawGrassWarning };
