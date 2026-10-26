import { createPiece } from '../engine/control.js';
import { columnHeight } from '../engine/field.js';
import { nextPairs, warningCount } from '../engine/player.js';
import { COLS, DEATH_X, DEATH_Y, GARBAGE_MAX_ROWS, GARBAGE_RATE, ROWS } from '../engine/rules.js';
import { chainPotential, fieldScore, isLethal, reachablePlacements, resolveChains } from './evaluate.js';

function pressure(field, incoming) {
  const heights = Array.from({ length: COLS }, (_, x) => columnHeight(field, x));
  return incoming >= COLS || heights[DEATH_X] >= 8 || Math.max(...heights) >= 10 || heights.reduce((a,b) => a+b,0) >= 48;
}

// 다음 낙하에서 최대 5줄을 받는다고 가정하고, 나머지도 각 열에 올 여유를 확보한다.
function canAbsorb(field, incoming, headroom = 0) {
  const rows = Math.ceil(Math.min(incoming, GARBAGE_MAX_ROWS * COLS) / COLS);
  const heights = Array.from({ length: COLS }, (_, x) => columnHeight(field, x));
  return heights[DEATH_X] + rows + headroom < ROWS - DEATH_Y
    && heights.every(height => height + rows + headroom < ROWS);
}

function moves(field, piece, incoming, params, previousReward = 0, discount = 1) {
  const urgent = pressure(field, incoming);
  return reachablePlacements(field, piece).map((move) => {
    const sim = resolveChains(move.field), lethal = isLethal(sim.field);
    const quick = lethal ? -1e9 : fieldScore(sim.field, { potential: false });
    let firing = 0;
    if (sim.chains) {
      const target = params.targetChain;
      // 회복 판단이 있는 난이도는 공간이 남으면 기반을 보존하고 반격을 준비한다.
      const defendNow = urgent && (!params.recoverUnderPressure || sim.chains >= 2
        || (incoming > 0 && sim.score >= incoming * GARBAGE_RATE) || !canAbsorb(field, incoming, params.recoveryHeadroom));
      firing = defendNow || sim.chains >= target
        ? sim.score * .3 + sim.chains ** 2 * 35
        : sim.score * .025 + sim.chains ** 2 * 5 - (target - sim.chains) * 35;
      if (incoming) firing += Math.min(incoming, Math.floor(sim.score / GARBAGE_RATE)) * 45;
    }
    const reward = previousReward + firing * discount;
    const remaining = params.recoverUnderPressure ? Math.max(0, incoming - Math.floor(sim.score / GARBAGE_RATE)) : incoming;
    return { ...move, field: sim.field, chains: sim.chains, lethal, reward, quick, incoming: remaining,
      value: quick * discount + reward, root: null };
  }).filter((move) => !move.lethal);
}

function shortlist(options, width, params, incoming, discount = 1) {
  const seen = new Set();
  const candidates = options.sort((a,b) => b.value-a.value).filter((option) => {
    const key = option.field.join('');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, Math.max(10, width * 3));
  for (const option of candidates) {
    if (pressure(option.field, incoming) && !params.recoverUnderPressure) continue;
    const heights = Array.from({ length: COLS }, (_, x) => columnHeight(option.field, x));
    // 실제로 위에서 넣을 수 있는 발화점만 평가한다. 미래 난수·숨겨진 쌍은 보지 않는다.
    option.value += chainPotential(option.field, heights) * params.buildWeight * discount;
  }
  return candidates.sort((a,b) => b.value-a.value).slice(0, width);
}

function createBuildSearch(player, table, params, opponent) {
  let incoming = warningCount(player);
  // 상대의 공개된 판에서 이미 시작한 연쇄만 예측해 방해가 도착하기 전 상쇄를 준비한다.
  if (params.watchOpponent && opponent && ['decide', 'erase-start', 'flash', 'pop-start', 'pop', 'chain-fall', 'check'].includes(opponent.phase)) {
    incoming = Math.max(incoming, Math.floor(resolveChains(opponent.board.cells).score / GARBAGE_RATE));
  }
  // 보통~아주 어려움은 이번 변경을 예고 대응에 한정해 평상시 쌓기 성향을 유지한다.
  if (params.recoverUnderPressure && incoming < COLS && !params.recoverCrowdedField) {
    params = { ...params, recoverUnderPressure: false };
  }
  // 상대가 높게 쌓았으면 큰 연쇄를 기다리기보다 중간 연쇄 공격도 선택한다.
  // 발화 목표만 바꾸며 상대의 쌍·난수·숨겨진 NEXT는 읽지 않는다.
  if (params.attackCrowdedOpponent && opponent) {
    const heights = Array.from({ length: COLS }, (_, x) => columnHeight(opponent.board.cells, x));
    if (heights.reduce((a, b) => a + b, 0) >= 30 && Math.max(...heights) >= 7) {
      params = { ...params, targetChain: Math.min(params.targetChain, 4) };
    }
  }
  let roots = moves(player.board.cells, player.piece, incoming, params);
  // 회복 판단이 있는 난이도는 2연쇄 이상의 반격이 이미 있으면 활용하고, 1연쇄뿐일 때만
  // 방해를 견딜 공간을 확인해 기반을 보존하는 선택도 남긴다.
  if (params.recoverUnderPressure && incoming >= COLS && roots.some(move => move.chains >= 2)) {
    roots = roots.filter(move => move.chains >= 2);
  } else if (incoming >= COLS && roots.some(move => move.chains > 0)
    && (!params.recoverUnderPressure || !roots.some(move => move.chains === 0 && canAbsorb(move.field, incoming, params.recoveryHeadroom)))) {
    roots = roots.filter(move => move.chains > 0);
  } else if (params.recoverUnderPressure && incoming >= COLS) {
    const surviving = roots.filter(move => move.chains > 0 || canAbsorb(move.field, incoming, params.recoveryHeadroom));
    if (surviving.length) roots = surviving;
  }
  for (const move of roots) move.root = { x: move.x, orient: move.orient, field: move.field, chains: move.chains, lethal: move.lethal };
  const beam = shortlist(roots, params.beamWidth, params, incoming);
  // 화면에 보이는 NEXT만 사용하며 현재 쌍과 다음 두 쌍까지만 계산한다.
  const future = table ? nextPairs(player, table).slice(0, params.depth) : [];
  return { beam, future, params, incoming, depth: 0, cursor: 0, children: [], done: !future.length || !beam.length };
}

// 한 프레임에는 부모 후보 두 개만 확장한다. 출현 대기 동안 여러 프레임에 나눠 계산한다.
function advanceBuildSearch(search) {
  if (search.done) return search;
  const { beam, future, params, incoming, depth, cursor } = search;
  const discount = .88 ** (depth + 1);
  const children = [...search.children];
  for (const parent of beam.slice(cursor, cursor + 2)) {
    children.push(...moves(parent.field, createPiece(future[depth]), parent.incoming ?? incoming, params, parent.reward, discount)
      .map((child) => ({ ...child, root: parent.root })));
  }
  if (cursor + 2 < beam.length) return { ...search, children, cursor: cursor + 2 };
  if (!children.length) return { ...search, done: true };
  return { ...search, beam: shortlist(children, params.beamWidth, params, incoming, discount),
    depth: depth + 1, cursor: 0, children: [], done: depth + 1 >= future.length };
}

function buildSearchResults(search) {
  const ranked = new Map();
  for (const leaf of search.beam) {
    const key = `${leaf.root.x}:${leaf.root.orient}`;
    if (!ranked.has(key)) ranked.set(key, { ...leaf.root, value: leaf.value });
  }
  // 첫 수만 실행하고 다음 쌍이 나오면 실제 판을 바탕으로 다시 계획한다.
  return [...ranked.values()].sort((a,b) => b.value-a.value);
}

export { canAbsorb, createBuildSearch, advanceBuildSearch, buildSearchResults };
