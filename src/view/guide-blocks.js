import { createMatch, stepMatch } from '../engine/match.js';
import { COLS, ROWS, ATTACK_ARRIVAL_FRAMES } from '../engine/rules.js';
import { GARBAGE } from '../engine/field.js';
import { drawBoard, drawWarning } from './renderer.js';
import { createEffects, observeMatchEffects, animateMatchEffects } from './effects.js';
import { CELL, FIELD_BOTTOM } from './layout.js';
import { drawBlob } from './skins/blobs.js';
import { prefersReducedMotion } from './motion-preference.js';

const cache = new Map();
const WIDTH = 240, HEIGHT = 152;
const fallback = { drawBlob };

// Fixed, isolated examples use the same simulation and board renderer as a match.
export function guideDemo(kind) {
  if (cache.has(kind)) return cache.get(kind);
  const cells = new Array(COLS * ROWS).fill(0);
  const put = (x, y, color) => { cells[y * COLS + x] = color; };
  if (kind === 'connect') {
    for (let x = 1; x <= 3; x++) put(x, ROWS - 1, 1);
    put(4, ROWS - 4, 1);
  } else {
    for (let y = ROWS - 2; y < ROWS; y++) for (let x = 1; x < 3; x++) put(x, y, 1);
    put(1, ROWS - 3, 4); put(2, ROWS - 3, 4);
    put(3, ROWS - 1, 4); put(4, ROWS - 1, 4);
  }
  const attack = kind === 'attack';
  if (attack) { put(0, ROWS - 1, 1); put(5, ROWS - 1, 4); }
  let match = createMatch({ seed: 0x6174, playerCount: attack ? 2 : 1, fields: [cells] });
  match.players[0] = { ...match.players[0], phase: kind === 'connect' ? 'fall' : 'check', piece: null };
  const effects = createEffects(match.players.length), frames = [];
  // Initial settled neighbors must already be joined while the fourth block falls.
  observeMatchEffects(effects, { ...match, players: match.players.map(player => ({ ...player, phase: 'check' })) });
  let receiving = false, warningHold = 0;
  for (let frame = 0; frame < 480; frame++) {
    observeMatchEffects(effects, match); animateMatchEffects(effects, match);
    frames.push({ players: match.players, projectiles: match.projectiles,
      effects: effects.map(effect => ({ warning: { ...effect.warning, icons: [...effect.warning.icons] }, connections: effect.connections, popDelays: effect.popDelays,
        quake: { offsets: effect.quake.offsets.slice() } })) });
    if (!attack && match.players[0].phase === 'end-decide') break;
    if (attack && receiving && match.players[1].phase === 'turn-start') break;
    if (attack && !receiving && match.players[1].stocks.a > 0 && ++warningHold >= 72) {
      // The receiving side finishes its turn, then receives confirmed garbage normally.
      match = { ...match, players: [match.players[0], { ...match.players[1], phase: 'garbage-decide', piece: null }] };
      receiving = true;
    }
    match = stepMatch(match, match.players.map(() => 0));
  }
  cache.set(kind, frames); return frames;
}

export function drawGuideBlocks(ctx, skin, kind, age = 0, still = false) {
  const frames = guideDemo(kind);
  const at = still ? 0 : Math.max(0, Math.min(frames.length - 1, Math.floor(age / (1000 / 60)) % (frames.length + 90) - 40));
  const frame = frames[at], renderer = skin?.drawBlob ? skin : fallback;
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  const board = (player, effect, x, baseline, size) => {
    ctx.save();
    ctx.beginPath(); ctx.rect(x - 4, kind === 'attack' ? 24 : 0, COLS * size + 8, baseline - (kind === 'attack' ? 23 : -1)); ctx.clip();
    ctx.translate(x, baseline - FIELD_BOTTOM * size / CELL); ctx.scale(size / CELL, size / CELL);
    drawBoard(ctx, renderer, 0, player, effect); ctx.restore();
    ctx.strokeStyle = '#cbb59d'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x - 1, baseline + 1); ctx.lineTo(x + COLS * size + 1, baseline + 1); ctx.stroke();
  };
  if (kind === 'attack') {
    for (const x of [12, 140]) {
      ctx.fillStyle = '#fffdf6'; ctx.strokeStyle = '#dccbb4'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(x - 5, 24, 94, 118, 10); ctx.fill(); ctx.stroke();
    }
    board(frame.players[0], frame.effects[0], 12, 138, 14);
    board(frame.players[1], frame.effects[1], 140, 138, 14);
    // Use the game's actual small/large warning icons and spreading animation.
    ctx.save(); ctx.translate(140, 0); ctx.scale(.55, .55);
    drawWarning(ctx, renderer, 0, frame.effects[1]); ctx.restore();
    ctx.fillStyle = '#806654'; ctx.font = '600 11px system-ui,sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(String(frame.effects[1].warning.value), 224, 12);
    ctx.strokeStyle = '#ad8b7a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(108, 75); ctx.lineTo(131, 75); ctx.lineTo(125, 69); ctx.moveTo(131, 75); ctx.lineTo(125, 81); ctx.stroke();
    if (frame.projectiles.length) {
      const t = 1 - frame.projectiles[0].framesLeft / ATTACK_ARRIVAL_FRAMES;
      ctx.fillStyle = '#d79aaf'; ctx.beginPath(); ctx.arc(99 + t * 42, 55 - Math.sin(t * Math.PI) * 14, 5, 0, Math.PI * 2); ctx.fill();
    }
  } else board(frame.players[0], frame.effects[0], 24, 138, 32);
  const player = frame.players[0];
  const label = kind === 'connect' ? (player.chain ? '4개 연결 → 소거' : '같은 색을 모아요')
    : kind === 'chain' ? (player.chain ? `${player.chain}연쇄${player.phase === 'chain-fall' ? ' → 낙하' : ''}` : '빈자리로 떨어지면…')
      : frame.players[1].board.cells.includes(GARBAGE)
        ? (frame.players[1].phase === 'garbage-fall' ? '쌓인 예고 방해 → 낙하' : '상대 필드에 방해 도착')
        : frame.effects[1].warning.value > 1 ? `2연쇄 · 예고 ${frame.effects[1].warning.value}개`
          : frame.effects[1].warning.value === 1 ? '1연쇄 · 예고 1개'
            : player.chain ? `${player.chain}연쇄 → 상대에게` : '연쇄로 방해 보내기';
  return label;
}

export function createGuideBlocks(view, skin, pictures) {
  const doc = view.document, targets = [];
  for (const { element, kind } of pictures) {
    const canvas = doc.createElement('canvas'), ctx = canvas.getContext?.('2d');
    if (!ctx) continue;
    const scale = Math.min(3, Math.max(2, view.devicePixelRatio || 1));
    canvas.width = WIDTH * scale; canvas.height = HEIGHT * scale;
    canvas.setAttribute('aria-hidden', 'true'); element.append(canvas);
    const caption = doc.createElement('span'); caption.className = 'game-guide-phase'; element.append(caption);
    ctx.scale(scale, scale); targets.push({ ctx, kind, caption });
  }
  let active = false, disposed = false, raf, age = 0, previous;
  const media = view.matchMedia?.('(prefers-reduced-motion: reduce)');
  const quiet = () => media?.matches ?? prefersReducedMotion();
  const draw = () => targets.forEach(({ ctx, kind, caption }) => {
    const label = drawGuideBlocks(ctx, skin, kind, age, quiet());
    if (caption.textContent !== label) caption.textContent = label;
  });
  const stop = () => { if (raf !== undefined) view.cancelAnimationFrame?.(raf); raf = undefined; previous = undefined; };
  function tick(now) {
    raf = undefined;
    if (!active || disposed || doc.hidden || quiet()) return;
    if (previous !== undefined) age += Math.max(0, Math.min(100, now - previous));
    previous = now; draw(); raf = view.requestAnimationFrame(tick);
  }
  function refresh() {
    stop();
    if (disposed || !active) return;
    draw();
    if (!quiet() && !doc.hidden && targets.length && view.requestAnimationFrame) raf = view.requestAnimationFrame(tick);
  }
  doc.addEventListener?.('visibilitychange', refresh); media?.addEventListener?.('change', refresh);
  return {
    show(value) { active = value; refresh(); },
    restart() { age = 0; refresh(); },
    dispose() { disposed = true; stop(); doc.removeEventListener?.('visibilitychange', refresh); media?.removeEventListener?.('change', refresh); },
  };
}
