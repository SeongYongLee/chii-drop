// 원작(통 규칙) 기준 수치. 근거는 docs/classic-rules.md의 절 번호로 적는다.
// 값을 바꾸면 RULES_VERSION을 올린다.
// 13: 같은 프레임의 공격을 필드 처리 순서대로 즉시 등록해 상쇄한다(9.3절).
const RULES_VERSION = 13;

// 1절. 필드는 6×14이고, 위에서부터 0행 = 14단(임시), 1행 = 13단(숨은 행), 2~13행 = 12~1단.
const COLS = 6;
const ROWS = 14;
const HIDDEN_ROWS = 2;
const TEMP_ROW = 0;

// 칸 하나는 32단위, 속도와 누적값은 16.16 고정소수.
const UNIT = 32;
const FIXED_ONE = 65536;

// 2절. 축은 3열, 아래 끝이 바닥에서 376단위 위(12단)에 나온다. 3열 12단이 막히면 패배.
const SPAWN_X = 2;
const SPAWN_HEIGHT = 376;
const DEATH_X = 2;
const DEATH_Y = 2;

// 3.7절. 표준 대전은 4색, 다음 쌍 이동 카운트 9.
const COLOR_COUNT = 4;
const NEXT_WAIT = 9;
const NEXT_COUNT = 2;

// 4.1·4.3절. 좌우는 1, 9, 11, 13…번째 프레임에 발동하고 한 칸을 2프레임에 움직인다.
const DAS_DELAY = 8;
const DAS_REPEAT = 2;
const MOVE_FRAMES = 2;

// 4.4절. 레벨별 속도 값 v. 매 프레임 v × 8192(1/65536 단위)만큼 내려간다.
const FALL_SPEED_TABLE = [16, 22, 26, 32, 37, 48, 52, 64, 32, 37, 48, 52, 64, 96, 128];
const FALL_SPEED_SCALE = 8192;
const LEVEL_UP_COUNT = 32;
const LEVEL_STOPS = [8, 15];

// 4.5절. 소프트 드롭은 16단위/프레임, 점수 카운터는 −2에서 시작해 1이 되면 1점.
const SOFT_DROP_SPEED = 16 * FIXED_ONE;
const SOFT_DROP_COUNTER_START = -2;

// 5·6절. 회전 표시 7프레임, 고정 지연 32프레임, 재시작 16회, 이동·회전 뒤 재접지 8회, 고정 뒤 3프레임에 배치.
const ROTATE_FRAMES = 7;
const LOCK_FRAMES = 32;
const LOCK_RESTARTS = 16;
const ROTATE_GROUND_ALLOWANCE = 8;
const PLACE_DELAY = 3;

// 6.4·7.1절. 연쇄 뒤 낙하는 16단위/프레임 고정, 분리 낙하는 2에서 시작해 0.375씩 가속, 착지 대기 16프레임.
const CHAIN_FALL_SPEED = 16 * FIXED_ONE;
const SPLIT_FALL_START = 2 * FIXED_ONE;
const SPLIT_FALL_ACCEL = 24576;
const MAX_FALL_SPEED = 16 * FIXED_ONE;
const LAND_FRAMES = 16;

// 7.2절. 깜박임 25프레임(25번째에 점수 계산), 소멸 25 + 1프레임.
const FLASH_FRAMES = 25;
const POP_FRAMES = 26;

// 8절. 점수.
const MIN_GROUP = 4;
const SCORE_CAP = 99999999;
const CHAIN_BONUS = [0, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 364, 416, 448, 480, 512, 544, 576, 608, 640, 672];
const COLOR_BONUS = [0, 0, 3, 6, 12, 24];
const GROUP_BONUS = [0, 2, 3, 4, 5, 6, 7, 10];

// 9절. 방해. 70점당 1개, 40초부터 16초마다 환산율 감소, 한 번에 최대 5줄.
const GARBAGE_RATE = 70;
const GARBAGE_CAP = 99999;
const MARGIN_START_SECONDS = 40;
const MARGIN_STEP_SECONDS = 16;
// 마진 단계 k별 계수(분모 256).
const MARGIN_FACTORS = [192, 192, 128, 128, 96, 96, 64, 64, 48, 48, 32, 32, 24, 16, 16, 16, 12, 8, 8, 8, 6, 6, 4, 4, 3, 3, 2];
const GARBAGE_MAX_ROWS = 5;
const ATTACK_ARRIVAL_FRAMES = 41;
const OFFSET_ARRIVAL_FRAMES = 64;
const GARBAGE_ACCEL = [20480, 17408, 21504, 16384, 19456, 18432];
const ALL_CLEAR_BONUS = 2100;

// 대전 규칙 묶음. 레벨별 "다음 레벨까지 지울 수"(0이면 정지).
const VERSUS_LEVEL_UP = FALL_SPEED_TABLE.map((_, level) =>
  LEVEL_STOPS.includes(level) || level === FALL_SPEED_TABLE.length - 1 ? 0 : LEVEL_UP_COUNT,
);

const VERSUS_RULES = Object.freeze({
  id: 'versus',
  chainBonus: CHAIN_BONUS,
  garbageRate: GARBAGE_RATE,
  allClearBonus: ALL_CLEAR_BONUS,
  marginStartSeconds: MARGIN_START_SECONDS,
  // 16.1절. 스토리 외 모든 모드: 사용자 요청으로 자연 낙하만 절반 속도.
  fallTable: FALL_SPEED_TABLE.map((value) => value / 2),
  levelUp: VERSUS_LEVEL_UP,
  nextWait: NEXT_WAIT,
});

// 14.4절·16.2절. 스토리 전용 낙하 속도와 레벨 상승 조건.
const STORY_FALL_TABLE = [4, 4, 5, 5, 6, 8, 10, 12, 16, 32, 48, 64, 72, 80, 96, 128, 128, 128, 128, 128, 160, 192, 224, 254];
const STORY_LEVEL_UP = STORY_FALL_TABLE.map((_, level) => {
  if (level <= 6) return 32;
  if (level <= 8) return 40;
  if (level <= 10) return 48;
  if (level <= 12) return 56;
  if (level <= 14) return 64;
  if (level <= 16) return 0;
  if (level <= 22) return 4;
  return 0;
});

const STORY_RULES = Object.freeze({
  id: 'story',
  // 16.3절. 점수·공격·마진은 일반 대전과 같은 값을 공유한다.
  chainBonus: CHAIN_BONUS,
  garbageRate: GARBAGE_RATE,
  allClearBonus: ALL_CLEAR_BONUS,
  marginStartSeconds: MARGIN_START_SECONDS,
  // 16.2절. 낮은 낙하 레벨일수록 완화하고 결승 시작 레벨 17부터 원래 속도를 쓴다.
  fallTable: STORY_FALL_TABLE.map((value, level) =>
    value * (level <= 8 ? 4 : level <= 12 ? 5 : level <= 16 ? 6 : 8) / 8),
  levelUp: STORY_LEVEL_UP,
  nextWait: 17,
});

// 14.2절. 스토리 누적 점수 상한.
const STORY_SCORE_CAP = 999999;

// 11절·13절 차. 패배 뒤 보드가 무너지는 연출은 쌓인 높이에 따라 65~81프레임이다. 세트는 2선승.
const LOSE_FRAMES = 81;
const SET_WINS = 2;

// 15절. 보스 피버(뿌요뿌요 피버 기준). 시간은 프레임(60 = 1초).
const REVIVE_FRAMES = 90;
const FEVER_START_FRAMES = 15 * 60;
const FEVER_MAX_FRAMES = 30 * 60;
const FEVER_CHAIN_BONUS_FRAMES = 30;
const FEVER_CHAIN_BONUS_MAX = 510;
const FEVER_ALL_CLEAR_FRAMES = 5 * 60;
const FEVER_FIRST_CHAIN = 5;
const FEVER_MIN_CHAIN = 3;
const FEVER_MAX_CHAIN = 15;
const FEVER_ALL_CLEAR_CHAIN = 2;

export {
  STORY_RULES,
  STORY_SCORE_CAP,
  VERSUS_RULES,
  ALL_CLEAR_BONUS,
  FEVER_ALL_CLEAR_CHAIN,
  FEVER_ALL_CLEAR_FRAMES,
  FEVER_CHAIN_BONUS_FRAMES,
  FEVER_CHAIN_BONUS_MAX,
  FEVER_FIRST_CHAIN,
  FEVER_MAX_CHAIN,
  FEVER_MAX_FRAMES,
  FEVER_MIN_CHAIN,
  FEVER_START_FRAMES,
  REVIVE_FRAMES,
  ATTACK_ARRIVAL_FRAMES,
  CHAIN_BONUS,
  CHAIN_FALL_SPEED,
  COLOR_BONUS,
  COLOR_COUNT,
  COLS,
  DAS_DELAY,
  DAS_REPEAT,
  DEATH_X,
  DEATH_Y,
  FALL_SPEED_SCALE,
  FALL_SPEED_TABLE,
  FIXED_ONE,
  FLASH_FRAMES,
  GARBAGE_ACCEL,
  GARBAGE_CAP,
  GARBAGE_MAX_ROWS,
  GARBAGE_RATE,
  GROUP_BONUS,
  HIDDEN_ROWS,
  LAND_FRAMES,
  LEVEL_STOPS,
  LEVEL_UP_COUNT,
  LOCK_FRAMES,
  LOCK_RESTARTS,
  LOSE_FRAMES,
  MARGIN_FACTORS,
  MARGIN_START_SECONDS,
  MARGIN_STEP_SECONDS,
  MAX_FALL_SPEED,
  MIN_GROUP,
  MOVE_FRAMES,
  NEXT_COUNT,
  NEXT_WAIT,
  OFFSET_ARRIVAL_FRAMES,
  PLACE_DELAY,
  POP_FRAMES,
  ROTATE_FRAMES,
  ROTATE_GROUND_ALLOWANCE,
  ROWS,
  RULES_VERSION,
  SCORE_CAP,
  SET_WINS,
  SOFT_DROP_COUNTER_START,
  SOFT_DROP_SPEED,
  SPAWN_HEIGHT,
  SPAWN_X,
  SPLIT_FALL_ACCEL,
  SPLIT_FALL_START,
  TEMP_ROW,
  UNIT,
};
