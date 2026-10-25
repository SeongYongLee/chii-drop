// 스킨의 표시 전용 동선. 좌표는 캐릭터 표시 상자 크기에 대한 비율이다.
export function compileTravel(points, total) {
  if (!Array.isArray(points) || points.length < 2 || points.length > 256) return null;
  let previous = -1;
  for (const point of points) {
    if (!point || !Number.isInteger(point.frame) || point.frame <= previous || point.frame >= total ||
        ![point.x, point.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1)) return null;
    previous = point.frame;
  }
  if (points[0].frame !== 0) return null;
  return points.map(point => ({ ...point }));
}

export function travelAt(clip, frame, still = false, field = false) {
  const points = (field && clip.fieldTravel) || clip.travel;
  if (still || !points) return { x: 0, y: 0 };
  const elapsed = Number.isFinite(frame) ? Math.max(0, Math.floor(frame)) : 0;
  const time = clip.loop && elapsed >= clip.total
    ? clip.loopStart + (elapsed - clip.loopStart) % (clip.total - clip.loopStart)
    : Math.min(elapsed, clip.total - 1);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (time <= b.frame) {
      const t = (time - a.frame) / (b.frame - a.frame);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
  }
  const last = points.at(-1);
  return { x: last.x, y: last.y };
}
