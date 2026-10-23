import { GARBAGE } from '../engine/field.js';
import { fits, rowOf } from '../engine/control.js';
import { UNIT } from '../engine/rules.js';
import { warningCount } from '../engine/player.js';
import { playSfx } from './sfx.js';

function touchingGround(player) {
  const piece = player.piece;
  return player.phase === 'control' && piece && piece.h % UNIT === 0 &&
    !fits(player.board.cells, piece.x, rowOf(piece.h) - 1, piece.orient);
}

// 엔진에 소리 이벤트를 추가하지 않고, 확정된 전후 상태에서 실제 접촉을 읽는다.
function boardSoundEvents(before, after) {
  if (!before) return [];
  const events = [];
  const touched = touchingGround(after) && !touchingGround(before);
  const justPlaced = before.piece && !after.piece && touchingGround(before);
  let blocks = 0, weeds = 0;
  for (let i = 0; i < after.board.cells.length; i++) {
    if (!after.board.cells[i] || after.board.land[i] !== 1 ||
        (before.board.land[i] === 1 && before.board.cells[i] === after.board.cells[i])) continue;
    if (after.board.cells[i] === GARBAGE) weeds += 1;
    else if (!justPlaced) blocks += 1;
  }
  if (touched) blocks += 2;
  if (blocks) events.push({ type: 'land', amount: blocks });
  if (weeds) events.push({ type: 'garbageLand', amount: weeds });
  const oldWarning = warningCount(before), total = warningCount(after);
  if (total > oldWarning) events.push({ type: 'warning', amount: total - oldWarning, total });
  return events;
}

function playBoardSounds(sfx, before, after, channel) {
  for (const event of boardSoundEvents(before, after)) playSfx(sfx, event.type, { ...event, channel });
}

export { boardSoundEvents, playBoardSounds };
