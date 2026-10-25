// 표시 전용. 메인 메뉴와 같은 배경·캐릭터 스킨을 읽으며 경기 상태는 변경하지 않는다.
export function createLobbyPresentation(skin, characters, root = document, shell = document.body) {
  const background = skin.backgroundUrl?.('menu');
  if (background) shell.style.setProperty('--online-background', `url(${JSON.stringify(background)})`);
  const avatar = root.getElementById('lobby-avatar');
  const mascots = root.getElementById('lobby-mascots');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let last = -Infinity, previous = '';
  const rendered = new WeakSet();
  function portrait(canvas, id, frame, instance) {
    rendered.add(canvas);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (id) skin.drawCharacter(ctx, id, 'idle', 8, 8, 176, { frame, instance, presentation: 'selection' });
    else {
      ctx.fillStyle = '#ac9c85'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold 100px system-ui'; ctx.fillText('?', 96, 101);
    }
  }
  return {
    tick(now, { playing, inRoom, charId }) {
      if (playing || document.hidden || now - last < 1000 / 24) return;
      const seats = [...root.querySelectorAll('.seat canvas')];
      const key = `${inRoom}:${charId}:${seats.map(c => c.dataset.charId).join(',')}`;
      if (reducedMotion.matches && key === previous && seats.every(c => rendered.has(c))) return;
      last = now; previous = key;
      const frame = reducedMotion.matches ? 0 : Math.floor(now * .06);
      if (!inRoom) {
        portrait(avatar, charId ?? characters[0]?.id, frame, 'online-profile');
        const ctx = mascots.getContext('2d'); ctx.clearRect(0, 0, 384, 160);
        characters.slice(0, 3).forEach((c, i) => skin.drawCharacter(ctx, c.id, 'idle', 10 + 126 * i, 8, 112,
          { frame, instance: `online-lobby-${i}`, presentation: 'selection' }));
      } else for (const canvas of seats) portrait(canvas, canvas.dataset.charId || null, frame, `online-seat-${canvas.dataset.side}`);
    },
  };
}
