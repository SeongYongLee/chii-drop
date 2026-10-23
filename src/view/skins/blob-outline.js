const DIRECTIONS = [1, 2, 4, 8];

function rotate(x, y, turns) {
  for (let i = 0; i < turns; i++) [x, y] = [1 - y, x];
  return [x, y];
}

// 각 사분면의 곡선을 만들고 연결된 칸 경계의 직선은 윤곽에서 제외한다.
// 위·오른쪽·아래·왼쪽 16가지 연결을 같은 곡선 규칙으로 그린다.
function connectedBlobCurves(links, sx = 1, sy = 1) {
  return DIRECTIONS.map((bit, turn) => {
    const a = Boolean(links & bit), b = Boolean(links & DIRECTIONS[(turn + 1) % 4]);
    const points = a && b
      ? [[.76, 0], [.76, .16], [.84, .24], [1, .24]]
      : a ? [[.76, 0], [.76, .17], [.91, .22], [.91, .5]]
      : b ? [[.5, .09], [.78, .09], [.83, .24], [1, .24]]
      : [[.5, .09], [.765, .075], [.925, .25], [.91, .5]];
    return points.map(([x, y]) => rotate(x, y, turn)).map(([px, py]) => [
      (px === 0 && (links & 8)) || (px === 1 && (links & 2)) ? px : .5 + (px - .5) * sx,
      (py === 0 && (links & 1)) || (py === 1 && (links & 4)) ? py : 1 + (py - 1) * sy,
    ]);
  });
}

function curve(ctx, points, move = true) {
  if (move) ctx.moveTo(...points[0]); else ctx.lineTo(...points[0]);
  ctx.bezierCurveTo(...points[1], ...points[2], ...points[3]);
}
function silhouette(ctx, curves) {
  ctx.beginPath();
  curves.forEach((points, i) => curve(ctx, points, i === 0));
  ctx.closePath();
}

export { connectedBlobCurves, curve, silhouette };
