import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPiece, stepPiece } from '../src/engine/control.js';
import { fieldFromRows } from '../src/engine/field.js';
import { INPUT } from '../src/engine/input.js';

function advance(piece, cells, input = 0, fallSpeed = 128) {
  return stepPiece(piece, { cells, input, pressed: input, heldFrames: 1, fallSpeed, softCounter: -2 }).piece;
}

test('좌우 걸치기는 꼭대기 높이에서 성공하고 1단위 아래에서는 벽차기를 한다', () => {
  for (const [turn, row, shifted] of [
    [INPUT.ROTATE_CW, '...1..', 1], [INPUT.ROTATE_CCW, '.1....', 3],
  ]) {
    const cells = fieldFromRows([row]);
    for (const h of [32, 33]) {
      const piece = advance({ ...createPiece([1, 2]), h }, cells, turn, 0);
      assert.equal(piece.x, 2);
      assert.equal(piece.h, h);
    }
    for (const h of [31, 24, 17, 16]) {
      const piece = advance({ ...createPiece([1, 2]), h }, cells, turn, 0);
      assert.equal(piece.x, shifted);
      assert.equal(piece.h, h, '원작 근거 없는 상향 보정은 하지 않는다');
    }
  }
});

const ledge = fieldFromRows(['...1..']);
const horizontal = h => ({ ...createPiece([1, 2]), h, orient: 1 });

test('칸 내 1~15에서 자연 낙하가 막히면 경계에서 접지 소비를 한 프레임 미룬다', () => {
  for (const remainder of [1, 8, 15]) {
    const waiting = advance(horizontal(32 + remainder), ledge);
    assert.equal(waiting.h, 32);
    assert.equal(waiting.groundCount, 0);
    assert.equal(waiting.restartsLeft, 16);
    assert.equal(waiting.rotateGroundLeft, 8);
    assert.deepEqual(waiting.contactWait, { h: 16 + remainder, acc: 0 });
    const grounded = advance(waiting, ledge);
    assert.equal(grounded.contactWait, null);
    assert.equal(grounded.groundCount, 32);
    assert.equal(grounded.restartsLeft, 15);
    assert.equal(grounded.rotateGroundLeft, 7);
  }
});

test('경계에서는 즉시 접지하고 반 칸 이상 남으면 실제 높이만 내려간다', () => {
  assert.equal(advance(horizontal(32), ledge).groundCount, 32);
  for (const h of [48, 63]) {
    const falling = advance(horizontal(h), ledge);
    assert.equal(falling.h, h - 16);
    assert.equal(falling.contactWait, null);
  }
});

test('지연 접지 중 아래 입력은 즉시 접지하고 다음 아래 입력에서 고정된다', () => {
  const waiting = advance(horizontal(33), ledge);
  const grounded = advance(waiting, ledge, INPUT.DOWN);
  assert.equal(grounded.contactWait, null);
  assert.equal(grounded.groundCount, 32);
  assert.equal(advance(grounded, ledge, INPUT.DOWN).locked, true);
  assert.equal(advance(horizontal(33), ledge, INPUT.DOWN).groundCount, 32);
});

test('지연 중 회전·이동으로 지지가 없어지면 같은 프레임에 자연 낙하로 돌아간다', () => {
  const waiting = advance(horizontal(33), ledge);
  for (const input of [INPUT.ROTATE_CCW, INPUT.LEFT]) {
    const escaped = advance(waiting, ledge, input);
    assert.equal(escaped.contactWait, null);
    assert.equal(escaped.h, 16);
    assert.equal(escaped.groundCount, 0);
    assert.equal(escaped.restartsLeft, 16);
    assert.equal(escaped.rotateGroundLeft, 8);
    assert.equal(escaped.locked, false);
  }
  assert.equal(advance(waiting, fieldFromRows([])).contactWait, null);
});

test('가상 높이의 1~15만 지연하고 소수 낙하량을 보존한다', () => {
  for (const h of [0, 16, 31]) {
    const piece = advance({ ...horizontal(32), contactWait: { h, acc: 0 } }, ledge, 0, 1);
    assert.equal(piece.groundCount, 32);
    assert.equal(piece.contactWait, null);
  }
  let piece = { ...horizontal(32), contactWait: { h: 1, acc: 0 } };
  for (let frame = 1; frame <= 8; frame++) {
    piece = advance(piece, ledge, 0, 1);
    assert.equal(piece.h, 32);
    assert.equal(piece.groundCount, 0);
    assert.deepEqual(piece.contactWait, { h: frame === 8 ? 0 : 1, acc: (frame % 8) * 8192 });
  }
  assert.equal(advance(piece, ledge, 0, 1).groundCount, 32);
});
