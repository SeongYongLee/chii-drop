// 직접 그린 도형으로 구성한 대회장과 종이 UI. 캐릭터·경기 상태와 독립적이다.
const PALETTE = {
  ink: '#59473e', paper: '#fffdf5', edge: '#bca58a', pink: '#f4c9d2',
  blue: '#c8e4ec', green: '#dbe8b9', cream: '#f8e8ae', muted: '#806e60',
};
const UI_FONT = '"Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", system-ui, sans-serif';

function paper(ctx, x, y, w, h, { fill = PALETTE.paper, edge = PALETTE.edge, radius = 16, shadow = true } = {}) {
  if (shadow) {
    ctx.fillStyle = '#79634418';
    ctx.beginPath(); ctx.roundRect(x + 3, y + 5, w, h, radius); ctx.fill();
  }
  ctx.fillStyle = fill; ctx.strokeStyle = edge; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill(); ctx.stroke();
}

function flower(ctx, x, y, size, color = PALETTE.pink) {
  ctx.fillStyle = color;
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * 2 * i / 5;
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * size * .55, y + Math.sin(a) * size * .55, size * .45, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = PALETTE.cream; ctx.beginPath(); ctx.arc(x, y, size * .28, 0, Math.PI * 2); ctx.fill();
}

function bunting(ctx, width, y) {
  ctx.strokeStyle = '#a08a74'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, y); ctx.quadraticCurveTo(width / 2, y + 48, width, y); ctx.stroke();
  for (let i = 0; i < 15; i++) {
    const t = (i + .5) / 15, x = width * t, top = y + 96 * t * (1 - t);
    ctx.fillStyle = [PALETTE.pink, PALETTE.blue, PALETTE.cream, PALETTE.green][i % 4];
    ctx.beginPath(); ctx.moveTo(x - 12, top); ctx.lineTo(x + 12, top); ctx.lineTo(x, top + 24); ctx.closePath(); ctx.fill();
  }
}

function drawFestivalBackground(ctx, width, height, scene = 'menu') {
  ctx.save(); ctx.scale(width / 960, height / 540);
  const game = scene.startsWith('game');
  const place = scene.split(':').at(-1);
  const inside = ['inside', 'oldPhoto', 'memory', 'register', 'invitation'].includes(place);
  ctx.fillStyle = inside ? '#e8dfd0' : '#fbf7e9'; ctx.fillRect(0, 0, 960, 540);
  if (inside) {
    ctx.strokeStyle = '#c9bdac'; ctx.lineWidth = 1;
    for (let x = 0; x < 960; x += 96) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 540); ctx.stroke(); }
    ctx.fillStyle = '#d4c4ac'; ctx.fillRect(0, 350, 960, 190);
  } else {
    // 플레이 필드를 방해하지 않는 낮은 대비의 하늘과 풀밭.
    ctx.fillStyle = '#e9f1e7';
    ctx.beginPath(); ctx.moveTo(0, 375); ctx.bezierCurveTo(220, 290, 400, 445, 650, 350); ctx.quadraticCurveTo(830, 300, 960, 380); ctx.lineTo(960, 540); ctx.lineTo(0, 540); ctx.fill();
    ctx.fillStyle = '#dce8c9';
    ctx.beginPath(); ctx.moveTo(0, 465); ctx.quadraticCurveTo(240, 385, 510, 470); ctx.quadraticCurveTo(750, 400, 960, 445); ctx.lineTo(960, 540); ctx.lineTo(0, 540); ctx.fill();
    ctx.fillStyle = '#ffffffb0';
    for (const [x, y] of [[75, 95], [820, 122], [690, 53]]) {
      ctx.beginPath(); ctx.ellipse(x, y, 52, 15, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (!game && scene !== 'tower') bunting(ctx, 960, 8);
    if (place === 'grove') {
      for (const x of [42, 918]) {
        ctx.fillStyle = '#c8b99e'; ctx.fillRect(x - 8, 245, 16, 184);
        ctx.fillStyle = '#dce6c8'; ctx.beginPath(); ctx.ellipse(x, 235, 59, 100, 0, 0, Math.PI * 2); ctx.fill();
      }
    } else if (place === 'market') {
      for (const x of [2, 874]) {
        paper(ctx, x, 325, 84, 90, { fill: '#f2e5c6', shadow: false, radius: 4 });
        ctx.fillStyle = PALETTE.pink; ctx.beginPath(); ctx.moveTo(x - 7, 325); ctx.lineTo(x + 42, 292); ctx.lineTo(x + 91, 325); ctx.closePath(); ctx.fill();
      }
    } else if (place === 'hill' || place === 'summit') {
      ctx.fillStyle = '#d5e0df';
      for (const x of [10, 836]) { ctx.beginPath(); ctx.moveTo(x, 375); ctx.lineTo(x + 55, 240); ctx.lineTo(x + 114, 375); ctx.closePath(); ctx.fill(); }
    }
    ctx.strokeStyle = '#9bac7c'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let i = 0; i < 17; i++) {
      const x = 18 + i * 58, y = 508 + (i % 3) * 9;
      ctx.beginPath(); ctx.moveTo(x - 4, y - 6); ctx.lineTo(x, y); ctx.lineTo(x + 3, y - 9); ctx.stroke();
    }
    flower(ctx, 64, 475, 9); flower(ctx, 890, 490, 8, PALETTE.blue);
  }
  ctx.restore();
}

export { PALETTE, UI_FONT, drawFestivalBackground, flower, paper };
