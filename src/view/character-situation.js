import { COLS, HIDDEN_ROWS, ROWS } from '../engine/rules.js';

function pressure(player) {
  if (!player) return 0;
  let height = 0;
  for (let y = HIDDEN_ROWS; y < ROWS; y++) {
    if (player.board.cells.slice(y * COLS, (y + 1) * COLS).some(Boolean)) {
      height = ROWS - y; break;
    }
  }
  const pending = Object.values(player.stocks).reduce((sum, count) => sum + count, 0);
  return height + Math.min(6, pending / COLS);
}

// 필드의 여유를 읽는 표시용 판단이다. 점수·승률이나 엔진 규칙으로 쓰지 않는다.
function tickSituation(effect, player, opponent) {
  const own = pressure(player), other = pressure(opponent);
  const next = own >= 10 || (own >= 8 && own - other >= 3) ? 'trailing'
    : opponent && own < 8 && other >= 8 && other - own >= 4 ? 'leading' : 'neutral';
  if (effect.situationCandidate !== next) {
    effect.situationCandidate = next;
    effect.situationTicks = 0;
  }
  effect.situationTicks += 1;
  const delay = next === 'neutral' ? 90 : 60;
  if (effect.situation !== next && effect.situationTicks >= delay) {
    effect.situation = next;
    effect.situationFrame = 0;
  }
}

function characterPresentation(effect) {
  const situation = effect.mood === 'idle' && effect.situation && effect.situation !== 'neutral';
  return { mood: situation ? effect.situation : effect.mood,
    frame: situation ? effect.situationFrame : effect.characterFrame };
}

// 대표 표정은 유지하고 발 위치를 고정한 채 작은 호흡·흔들림만 반복한다.
function situationMotionAt(mood, frame = 0, reducedMotion = false) {
  if (reducedMotion || !['leading', 'trailing'].includes(mood)) return { x: 0, sx: 1, sy: 1 };
  const time = Number.isFinite(frame) ? Math.max(0, frame) : 0;
  const fade = Math.min(1, time / 24);
  const breath = Math.sin(time * Math.PI * 2 / (mood === 'leading' ? 180 : 132)) * fade;
  const sway = Math.sin(time * Math.PI * 2 / (mood === 'leading' ? 240 : 48)) * fade;
  return { x: sway * (mood === 'leading' ? .004 : .0025),
    sx: 1 - breath * .003, sy: 1 + breath * .008 };
}

export { pressure, tickSituation, characterPresentation, situationMotionAt };
