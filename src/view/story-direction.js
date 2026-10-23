// 표시용 시간만 사용한다. 경기 프레임·난수와 연결하지 않는다.
function compileDirections(lines) {
  let visual, stage = {}, stageAt = 0, cast = {};
  return lines.map((line, at) => {
    if (line.visual && line.visual !== visual) { visual = line.visual; stage = {}; }
    if (line.stage || line.visual) { stage = { ...stage, ...line.stage }; stageAt = at; }
    cast = { ...cast };
    if (line.who) cast[line.who] = { ...cast[line.who], mood: line.mood ?? 'idle', motion: 'still', at };
    for (const [id, cue] of Object.entries(line.cast ?? {})) cast[id] = { ...cast[id], ...cue, at };
    return { visual, stage, stageAt, cast };
  });
}
function progress(age, duration = 48, still = false) {
  const t = still ? 1 : Math.max(0, Math.min(1, age / duration));
  return t * t * (3 - 2 * t);
}
function poseAt(cue = {}, age = 0, still = false) {
  const t = progress(age, cue.duration ?? 36, still), pulse = still ? 0 : Math.sin(Math.PI * t);
  let x = 0, y = 0, angle = 0;
  switch (cue.motion) {
    case 'nod': y = 6 * pulse; break;
    case 'bow': y = 8 * t; angle = .08 * t; break;
    case 'hop': y = -16 * pulse; break;
    case 'shake': x = still ? 0 : 5 * Math.sin(t * Math.PI * 6) * (1 - t); break;
    case 'recoil': x = -18 * t; break;
    case 'approach': x = 18 * t; break;
    case 'offer': x = 10 * t; angle = .025 * t; break;
    case 'look': angle = -.045 * t; break;
    case 'settle': y = 7 * t; break;
  }
  return { x: x || 0, y: y || 0, angle: angle || 0 };
}
export { compileDirections, progress, poseAt };

function storyBackground(visual, stage = {}, scenery = 'dialogue') {
  if (stage.background) return stage.background;
  if (visual === 'reveal') return 'inside';
  if (visual === 'photo' && stage.hostForm === 'large') return 'inside';
  if (visual === 'table' && !stage.snacks) return 'tableEmpty';
  return visual ?? scenery;
}
export { storyBackground };
