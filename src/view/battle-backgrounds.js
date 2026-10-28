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

// 온라인 프레임은 불투명하므로 Canvas 자체에 CSS 배경을 둔다.
// 타이틀·싱글 모드의 기존 배경 처리에는 이 최적화를 적용하지 않는다.
export function applyOnlineBackdrop(ctx, skin, scene, document = globalThis.document) {
  applyPageBackdrop(ctx, skin, scene, document);
  const surface = ctx.canvas?.style;
  ctx.canvasBackdrop = Boolean(ctx.pageBackdrop && surface);
  ctx.pageBackdrop = ctx.canvasBackdrop;
  if (surface) {
    const value = ctx.pageBackdropUrl ? `url(${JSON.stringify(ctx.pageBackdropUrl)})` : 'none';
    if (surface.backgroundImage !== value) {
      surface.backgroundImage = value;
      surface.backgroundSize = 'cover';
      surface.backgroundPosition = 'center';
    }
  }
}
