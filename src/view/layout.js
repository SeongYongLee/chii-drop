import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../app/screen.js';

// 13절 카. 경기 화면은 원작 640×448 좌표로 그린다. 칸은 32픽셀.
const GAME_WIDTH = 640;
const GAME_HEIGHT = 448;
const CELL = 32;
const FIELD_TOP = 32;
const FIELD_WIDTH = 6 * CELL;
const FIELD_HEIGHT = 12 * CELL;
const FIELD_BOTTOM = FIELD_TOP + FIELD_HEIGHT;

const SIDES = [
  {
    fieldX: 32,
    next1: { x: 256, y: 128 },
    next2: { x: 288, y: 144 },
    score: { x: 240, y: 352 },
    portrait: { x: 230, y: 196, size: 84 },
  },
  {
    fieldX: 416,
    next1: { x: 352, y: 128 },
    next2: { x: 320, y: 144 },
    score: { x: 272, y: 384 },
    portrait: { x: 326, y: 196, size: 84 },
  },
];

const NEXT_START = { x: 304, y: 144 };
const NEXT_BOX = { x: 248, y: 88, width: 144, height: 96 };
// 한 사람의 두 쌍과 새 쌍의 진입 공간만 포함한다. 쌍 좌표와 이동 경로는 유지한다.
const SOLO_NEXT_BOX = { ...NEXT_BOX, y: 72, width: 96, height: 112 };

// 경기 화면을 960×540 캔버스 가운데에 맞춰 키운다.
function gameTransform() {
  const scale = SCREEN_HEIGHT / GAME_HEIGHT;
  return { scale, x: (SCREEN_WIDTH - GAME_WIDTH * scale) / 2, y: 0 };
}

export {
  CELL,
  FIELD_BOTTOM,
  FIELD_HEIGHT,
  FIELD_TOP,
  FIELD_WIDTH,
  GAME_HEIGHT,
  GAME_WIDTH,
  NEXT_BOX,
  SOLO_NEXT_BOX,
  NEXT_START,
  SIDES,
  gameTransform,
};
