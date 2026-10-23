// 양쪽 자리를 번갈아 실제 프레임 입력으로 대전한다. 개인 기록은 쓰지 않는다.
import { CPU_LEVELS, createCpu, stepCpu } from '../src/cpu/cpu.js';
import { createMatch, stepMatch } from '../src/engine/match.js';
import { RULES_VERSION } from '../src/engine/rules.js';

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const level = option('--level', 'master'), opponent = option('--opponent', 'expert');
const seeds = Number(option('--seeds', '24')), limit = Number(option('--frames', '30000'));
const startSeed = Number(option('--start-seed', '1'));
const paired = args.includes('--paired');
const pairs = args.includes('--all-adjacent')
  ? CPU_LEVELS.slice(1).map(({ id }, i) => [id, CPU_LEVELS[i].id]) : [[level, opponent]];
if (!Number.isInteger(seeds) || seeds < 1 || !Number.isInteger(startSeed) || startSeed < 1 || !Number.isInteger(limit) || limit < 1 ||
    pairs.flat().some(id => !CPU_LEVELS.some(entry => entry.id === id))) throw new Error('Invalid benchmark arguments');

function duel(seed, side, level, opponent) {
  let match = createMatch({ seed });
  // 짝 비교에서는 자리를 바꿔도 각 CPU의 난수 시드를 유지한다.
  let cpus = [0, 1].map((i) => createCpu({ level: i === side ? level : opponent, seed: seed * 31 + (paired ? 0 : i) }));
  const stats = [0, 1].map(() => ({ locks: 0, chains: 0, chainTotal: 0, attacks: 0 }));
  while (match.phase !== 'over' && match.frame < limit) {
    const results = cpus.map((cpu, i) => stepCpu(cpu, match.players[i], match.table, match.players[1 - i]));
    cpus = results.map((result) => result.cpu);
    match = stepMatch(match, results.map((result) => result.input));
    match.players.forEach((player, i) => {
      for (const event of player.events) {
        if (event.type === 'lock') stats[i].locks++;
        if (event.type === 'chainEnd' && event.chain > 0) { stats[i].chains++; stats[i].chainTotal += event.chain; }
        if (event.type === 'attack') stats[i].attacks += event.amount;
      }
    });
  }
  return { seed, side, winner: match.winner, frame: match.frame,
    timeout: match.phase !== 'over',
    players: match.players.map((player, i) => ({ level: i === side ? level : opponent,
      ...stats[i], maxChain: player.maxChain, score: player.score })) };
}

const comparisons = [];
for (const [level, opponent] of pairs) {
  const runs = [];
  for (let seed = startSeed; seed < startSeed + seeds; seed++) {
    for (const side of paired ? [0, 1] : [seed % 2]) runs.push(duel(seed, side, level, opponent));
    if ((seed - startSeed + 1) % 8 === 0) console.error(`${level} vs ${opponent}: ${seed - startSeed + 1}/${seeds} seeds`);
  }
  const wins = runs.filter(run => !run.timeout && run.winner === run.side).length;
  const losses = runs.filter(run => !run.timeout && run.winner === 1 - run.side).length;
  const draws = runs.filter(run => !run.timeout && run.winner === -1).length;
  const timeouts = runs.filter(run => run.timeout).length;
  const metrics = Object.fromEntries([level, opponent].map(id => {
    const players = runs.flatMap(run => run.players.filter(player => player.level === id));
    const chainCount = players.reduce((n, p) => n + p.chains, 0);
    return [id, { averageMaxChain: players.reduce((n, p) => n + p.maxChain, 0) / players.length,
      averageCompletedChain: chainCount ? players.reduce((n, p) => n + p.chainTotal, 0) / chainCount : 0,
      averageAttack: players.reduce((n, p) => n + p.attacks, 0) / players.length,
      maxChain: Math.max(...players.map(p => p.maxChain)) }];
  }));
  comparisons.push({ level, opponent, startSeed, seeds, games: runs.length, wins, losses, draws, timeouts, metrics, runs });
  console.error(`${level} vs ${opponent}: ${wins}W ${losses}L ${draws}D ${timeouts} timeout`);
}
console.log(JSON.stringify({ rulesVersion: RULES_VERSION, paired, frameLimit: limit,
  ruleset: 'versus', colorCount: 4, startLevel: 0, comparisons }, null, 2));
