import { prefersReducedMotion } from '../view/motion-preference.js';

// Presentation only: reuse the actual menu canvases so landing never swaps actors.
export function titleFlight(source, rect, actor, destination, facing = 1) {
  const bounds = source.interactions?.find(item => item.charId === actor)?.bounds;
  if (!bounds || !source.box || !rect.width || !rect.height || !destination.width) return null;
  const box = source.box;
  const x = rect.left + (box.x + (bounds.x + bounds.width / 2) * box.width) / source.width * rect.width;
  const y = rect.top + (box.y + (bounds.y + bounds.height / 2) * box.height) / source.height * rect.height;
  const scale = Math.max(.8, Math.min(2.8, bounds.width * box.width / source.width * rect.width / destination.width));
  return { x: (x - destination.left - destination.width / 2) * facing,
    y: y - (destination.top + destination.height - destination.height * .42 * scale), scale };
}

export function createTitleTransition({ document, canvas, menu, onComplete = () => {} }) {
  let run = 0, overlay, animations = [], cast;
  const animate = (node, frames, options) => {
    const animation = node.animate(frames, { fill: 'both', ...options });
    animations.push(animation); return animation;
  };
  function cancel() {
    if (!overlay && !animations.length) return;
    run++;
    for (const animation of animations) animation.cancel();
    animations = []; overlay?.remove(); overlay = null;
    if (cast) cast.inert = false;
    cast = null; menu.inert = false;
    if (document.body?.dataset) delete document.body.dataset.titleTransition;
    onComplete();
  }
  return {
    get active() { return Boolean(overlay); }, cancel,
    prepare(source) {
      if (!source?.box || !document.body || typeof menu.animate !== 'function' || prefersReducedMotion()) return null;
      cancel();
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      overlay = document.createElement('div'); overlay.className = 'title-departure';
      overlay.setAttribute('aria-hidden', 'true');
      const picture = document.createElement('canvas');
      picture.width = canvas.width; picture.height = canvas.height;
      picture.getContext('2d').drawImage(canvas, 0, 0);
      Object.assign(picture.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
      overlay.append(picture); document.body.append(overlay);
      return { source, rect, picture };
    },
    start(prepared, entries) {
      if (!prepared || !overlay) return;
      const token = run;
      cast = document.querySelector('.menu-companions');
      const sprites = [...(cast?.querySelectorAll('.menu-companion canvas') ?? [])];
      if (!sprites.length) { cancel(); return; }
      menu.inert = true; cast.inert = true; document.body.dataset.titleTransition = 'true';
      const { source, rect, picture } = prepared;
      animate(picture, [
        { transform: 'scale(1)', opacity: 1, offset: 0 },
        { transform: 'scale(.94)', opacity: 1, offset: .25 },
        { transform: 'scale(1.18)', opacity: 0, offset: 1 },
      ], { duration: 280, easing: 'cubic-bezier(.2,.7,.2,1)' });
      animate(menu, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 180 });
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height * .7;
      for (let i = 0; i < 18; i++) {
        const particle = document.createElement('i'); particle.className = 'title-burst-piece';
        const angle = i * Math.PI * 2 / 18, radius = Math.min(rect.width * .48, 210) * (i % 2 ? 1 : .65);
        Object.assign(particle.style, { left: `${cx}px`, top: `${cy}px`, background: ['#e8a7b7','#f1d476','#9fcbd5','#f6e6c3'][i % 4] });
        overlay.append(particle);
        animate(particle, [{ opacity: 0, transform: 'scale(.2)', offset: 0 },
          { opacity: 1, transform: 'scale(1)', offset: .1 },
          { opacity: 0, transform: `translate(${Math.cos(angle) * radius}px,${Math.sin(angle) * radius + 36}px) rotate(${i * 47}deg) scale(.5)`, offset: 1 }],
        { duration: 640, delay: 90, easing: 'cubic-bezier(.15,.6,.3,1)' });
      }
      sprites.forEach((sprite, i) => {
        const flight = titleFlight(source, rect, entries[i]?.id, sprite.getBoundingClientRect(), entries[i]?.facing ?? 1);
        if (!flight) return;
        const { x, y, scale } = flight;
        animate(sprite, [
          { transform: `translate(${x}px,${y}px) scale(${scale})`, opacity: 0, offset: 0 },
          { transform: `translate(${x}px,${y - 22}px) scale(${scale})`, opacity: 1, offset: .14 },
          { transform: 'translateY(-9px) scale(1)', opacity: 1, offset: .72 },
          { transform: 'translateY(0) scale(1.1,.87)', offset: .8 },
          { transform: 'translateY(-7px) scale(.97,1.03)', offset: .9 },
          { transform: 'translateY(0) scale(1)', offset: 1 },
        ], { duration: 780, delay: 80 + i * 70, easing: 'ease-in-out' });
      });
      Promise.allSettled(animations.map(animation => animation.finished)).then(() => { if (token === run) cancel(); });
    },
  };
}
