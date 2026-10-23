// 양쪽 자리를 번갈아 실제 프레임 입력으로 대전한다. 개인 기록은 쓰지 않는다.
import { createCpu, stepCpu } from '../src/cpu/cpu.js';
import { createMatch, stepMatch } from '../src/engine/match.js';

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const level = option('--level', 'master'), opponent = option('--opponent', 'expert');
const seeds = Number(option('--seeds', '24'));
const runs = [];
let wins = 0, losses = 0, draws = 0;
for (let seed = 1; seed <= seeds; seed++) {
  const side = seed % 2;
  let match = createMatch({ seed });
  let cpus = [0, 1].map((i) => createCpu({ level: i === side ? level : opponent, seed: seed * 31 + i }));
  while (match.phase !== 'over' && match.frame < 30000) {
    const results = cpus.map((cpu, i) => stepCpu(cpu, match.players[i], match.table, match.players[1 - i]));
    cpus = results.map((result) => result.cpu);
    match = stepMatch(match, results.map((result) => result.input));
  }
  if (match.phase !== 'over' || match.winner === -1) draws++;
  else if (match.winner === side) wins++;
  else losses++;
  runs.push({ seed, side, winner: match.winner, frame: match.frame });
}
console.log(JSON.stringify({ level, opponent, seeds, wins, losses, draws, runs }, null, 2));
