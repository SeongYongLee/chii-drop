// 표시 시계만 읽는다. 경기 난수·입력·물리에 관여하지 않는 작은 관전 캐릭터다.
function mascotPose(frame = 0, reducedMotion = false) {
  if (reducedMotion) return { position: 0, direction: 1, mood: 'idle', frame: 0 };
  const time = Math.max(0, Math.floor(frame)) % 1800;
  if (time < 180) return { position: 0, direction: 1, mood: 'idle', frame: time };
  if (time < 360) return { position: (time-180)/180, direction: 1, mood: 'walk', frame: time-180 };
  if (time < 600) return { position: 1, direction: -1, mood: 'idle', frame: time-360 };
  if (time < 960) return { position: 1-(time-600)/180, direction: -1, mood: 'walk', frame: time-600 };
  if (time < 1260) return { position: -1, direction: 1, mood: 'idle', frame: time-960 };
  if (time < 1440) return { position: -1+(time-1260)/180, direction: 1, mood: 'walk', frame: time-1260 };
  return { position: 0, direction: 1, mood: 'idle', frame: time-1440 };
}

function drawMascot(ctx, view, portrait = false) {
  if (!view.skin.drawMascot) return;
  const reduced = view.reducedMotion ?? globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const frame = view.effects[0]?.blinkFrame ?? 0;
  const pose = mascotPose(frame, reduced);
  const reaction = pose.mood !== 'walk' && view.effects.find(effect => effect.mood === 'happy' && effect.characterChain > 0 && effect.characterFrame < 42);
  const size = portrait ? 38 : 32;
  const center = (portrait ? 480 : 320) + pose.position * (portrait ? 64 : 34);
  const y = portrait ? 330 : 308;
  ctx.save();
  ctx.translate(center, y);
  ctx.scale(pose.direction, 1);
  view.skin.drawMascot(ctx, reaction ? 'happy' : pose.mood, -size/2, 0, size,
    { frame: reaction ? reaction.characterFrame : pose.frame, blinkFrame: frame, reducedMotion: reduced });
  ctx.restore();
}

export { mascotPose, drawMascot };
