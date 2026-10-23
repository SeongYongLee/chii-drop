// 스토리 모드의 층·상대 구성. 표시 이름과 대사는 스토리 대본(기본 대본 또는 스킨 대본)에서 읽는다.
// 수치는 원작 탑(로컬 명세 14절)의 층 0~3과 최종층을 이 게임의 1~4층과 결승에 대응시킨 값이다.
//   threshold: 고정 상대가 나오는 누적 점수(원작 승급 기준). 고정 상대가 나오는 방식은 이 게임의 변형 규칙이다.
//   hiddenThreshold: 원작 히든 조건(누적 230,000 / 최종층 진입 190,000)의 비율을 각 층 기준에 적용한 값.
//   level: 원작 기본 난이도의 시작 레벨, colors: 색 수(원작 층 2부터 5색).

function ordinary(floor, count) {
  return Array.from({ length: count }, (_, i) => `f${floor}-o${String(i + 1).padStart(2, '0')}`);
}

const FLOORS = [
  {
    id: 'floor01',
    ordinary: ordinary(1, 8),
    fixed: 'fixed01',
    hidden: 'secret01',
    threshold: 25000,
    hiddenThreshold: 30000,
    colors: 4,
    level: { ordinary: 5, fixed: 10 },
  },
  {
    id: 'floor02',
    ordinary: ordinary(2, 6),
    fixed: 'fixed02',
    hidden: 'secret02',
    threshold: 70000,
    hiddenThreshold: 85000,
    colors: 4,
    level: { ordinary: 9, fixed: 11 },
  },
  {
    id: 'floor03',
    ordinary: ordinary(3, 4),
    fixed: 'fixed03',
    hidden: 'secret03',
    threshold: 115000,
    hiddenThreshold: 140000,
    colors: 5,
    level: { ordinary: 12, fixed: 14 },
  },
  {
    id: 'floor04',
    ordinary: ordinary(4, 3),
    fixed: 'fixed04',
    hidden: 'secret04',
    threshold: 160000,
    hiddenThreshold: 195000,
    colors: 5,
    level: { ordinary: 14, fixed: 15 },
  },
];

const FINAL = 'final';
const SECRET_FINAL = 'secretFinal';
const HIDDEN_IDS = FLOORS.map((floor) => floor.hidden);
const FINAL_LEVEL = 17;
const FINAL_COLORS = 5;

// CPU 강도는 층이 오를수록 높인다. 고정·히든 상대는 한 단계 위다.
const CPU_BY_FLOOR = ['easy', 'normal', 'normal', 'hard'];

function opponentProfile(id) {
  if (id === SECRET_FINAL || id === FINAL) {
    return { cpuLevel: 'hard', boss: id === SECRET_FINAL, startLevel: FINAL_LEVEL, colors: FINAL_COLORS };
  }
  const floorIndex = FLOORS.findIndex(
    (floor) => floor.ordinary.includes(id) || floor.fixed === id || floor.hidden === id,
  );
  const floor = FLOORS[floorIndex];
  const strong = id === floor.fixed || id === floor.hidden;
  return {
    cpuLevel: CPU_BY_FLOOR[Math.min(CPU_BY_FLOOR.length - 1, floorIndex + (strong ? 1 : 0))],
    boss: false,
    startLevel: strong ? floor.level.fixed : floor.level.ordinary,
    colors: floor.colors,
  };
}

export { FINAL, FLOORS, HIDDEN_IDS, SECRET_FINAL, opponentProfile };
