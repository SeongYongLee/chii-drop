export const INITIAL_RATING = 1500;
export const RATING_K = 32;
export const RATING_VERSION = 1;

// 낮은 place가 상위. 2~4인 순위를 모든 상대와 비교하며 총 변동 폭을 K로 유지한다.
// 반올림 잔여를 배분해 항상 합계 0인 정수 레이트를 만든다.
export function ratingChanges(entries) {
  if (entries.length < 2 || entries.length > 4 || new Set(entries.map((e) => e.id)).size !== entries.length
    || entries.some((e) => !Number.isFinite(e.rating) || !Number.isInteger(e.place) || e.place < 1 || e.place > entries.length)) {
    throw new Error('invalid standings');
  }
  const raw = entries.map((player, i) => entries.reduce((sum, opponent, j) => {
    if (i === j) return sum;
    const score = player.place === opponent.place ? 0.5 : player.place < opponent.place ? 1 : 0;
    const expected = 1 / (1 + 10 ** ((opponent.rating - player.rating) / 400));
    return sum + RATING_K / (entries.length - 1) * (score - expected);
  }, 0));
  const deltas = raw.map(Math.floor);
  const order = raw.map((value, i) => ({ i, fraction: value - deltas[i] }))
    .sort((a, b) => b.fraction - a.fraction || entries[a.i].id.localeCompare(entries[b.i].id));
  const remainder = -deltas.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < remainder; i++) deltas[order[i].i]++;
  return entries.map((entry, i) => ({ ...entry, delta: deltas[i], after: entry.rating + deltas[i] }));
}
