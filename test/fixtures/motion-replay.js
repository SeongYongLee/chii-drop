import { createMatch, stepMatch } from '../../src/engine/match.js';
import { createPiece } from '../../src/engine/control.js';
import { fieldFromRows } from '../../src/engine/field.js';
import { INPUT } from '../../src/engine/input.js';
import { createEffects, tickEffect } from '../../src/view/effects.js';

// 표시 검토 전용 초기 배치. 실제 경기 엔진과 효과 갱신을 그대로 진행한다.
// 일반 경기의 색 수·쌍 순서·난수를 변경하는 경로는 아니다.
export function createMotionReplay(color) {
  if (!Number.isInteger(color) || color < 1 || color > 5) throw new RangeError('color');
  const colors = [color, color % 5 + 1];
  const fields = colors.map(c => fieldFromRows([
    `${c % 5 + 1}.....`,
    `${c}${c}.${c % 5 + 1}${(c + 1) % 5 + 1}${(c + 2) % 5 + 1}`,
  ]));
  let match = createMatch({ seed: 23, colorCount: 5, fields });
  const effects = createEffects(2), frames = [];
  match.players.forEach((player, i) => {
    const pairIndex = match.table.findIndex(pair => pair.every(value => value === colors[i]));
    if (pairIndex < 0) throw new Error('missing replay pair');
    player.piece = createPiece(match.table[pairIndex]);
    player.nextIndex = pairIndex + 1;
  });
  for (let frame = 0; frame < 240; frame++) {
    match = stepMatch(match, [INPUT.DOWN, INPUT.DOWN]);
    effects.forEach((effect, i) => tickEffect(effect, match.players[i], {
      table: match.table, opponentSide: 1 - i, opponent: match.players[1 - i],
    }));
    frames.push({ match, effects: structuredClone(effects) });
    if (match.players.every(player => player.events.some(event => event.type === 'chainEnd'))) break;
  }
  return frames;
}
