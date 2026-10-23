import {
  CHAIN_BONUS,
  COLOR_BONUS,
  GARBAGE_RATE,
  GROUP_BONUS,
  MARGIN_FACTORS,
  MARGIN_START_SECONDS,
  MARGIN_STEP_SECONDS,
  MIN_GROUP,
} from './rules.js';

// 8.1절. (10 × 지운 색 블록 수) × 배율, 배율은 1~999.
function scoreStep(groups, chain, chainTable = CHAIN_BONUS) {
  const count = groups.reduce((sum, { cells }) => sum + cells.length, 0);
  const colors = new Set(groups.map(({ color }) => color)).size;
  const groupBonus = groups.reduce(
    (sum, { cells }) => sum + GROUP_BONUS[Math.min(cells.length - MIN_GROUP, GROUP_BONUS.length - 1)],
    0,
  );
  const chainBonus = chainTable[Math.min(chain, chainTable.length) - 1];
  const multiplier = Math.min(999, Math.max(1, chainBonus + COLOR_BONUS[colors] + groupBonus));
  return 10 * count * multiplier;
}

// 9.2절. 경과 초에 따른 방해 1개당 점수.
function garbageTarget(timerFrames, rate = GARBAGE_RATE, marginStart = MARGIN_START_SECONDS) {
  const seconds = Math.floor(timerFrames / 60);
  if (seconds < marginStart) {
    return rate;
  }
  const step = Math.min(Math.floor((seconds - marginStart) / MARGIN_STEP_SECONDS), MARGIN_FACTORS.length - 1);
  return Math.max(1, Math.floor((rate * MARGIN_FACTORS[step]) / 256));
}

export { garbageTarget, scoreStep };
