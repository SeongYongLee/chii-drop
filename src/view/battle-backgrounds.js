// 후보는 스킨이 명시적으로 공개 대전용으로 허용한 배경만 사용한다.
export function chooseBattleScenery(skin, previous, random = Math.random) {
  const available = [...new Set(skin?.battleSceneries ?? [])];
  const choices = available.filter(scene => scene !== previous);
  const pool = choices.length ? choices : available;
  return pool.length ? pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] : undefined;
}

export function applyPageBackdrop(ctx, skin, scene, document = globalThis.document) {
  const background = skin?.backgroundUrl?.(scene) ?? null;
  const value = background ? `url(${JSON.stringify(background)})` : 'none';
  ctx.pageBackdrop = Boolean(background);
  if (ctx.pageBackdropUrl === background && (!document?.body?.style
    || document.body.style.getPropertyValue('--page-backdrop') === value)) return;
  ctx.pageBackdropUrl = background;
  if (document?.body?.style) {
    document.body.dataset.pageBackdrop = String(Boolean(background));
    document.body.style.setProperty('--page-backdrop', value);
  }
}
