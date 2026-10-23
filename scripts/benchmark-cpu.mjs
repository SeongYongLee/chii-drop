// 실제 프레임 입력으로 CPU의 연쇄·생존·계산 시간을 비교한다. 경기·저장 기록은 쓰지 않는다.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createMatch, stepMatch } from '../src/engine/match.js';
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const modulePath = option('--module', '../src/cpu/cpu.js');
const { createCpu, stepCpu } = await import(modulePath.startsWith('.') ? new URL(modulePath, import.meta.url) : pathToFileURL(resolve(modulePath)));
const level = option('--level', 'expert');
const seeds = Number(option('--seeds', '12')), pieces = Number(option('--pieces', '120'));
const runs = [], times = [], histogram = {};
for (let seed = 1; seed <= seeds; seed++) {
  let match = createMatch({ seed, playerCount: 1 }), cpu = createCpu({ level, seed: seed * 31 });
  let locks = 0;
  while (match.phase !== 'over' && match.frame < 30000 && locks < pieces) {
    const planning = !cpu.planned && ['next', 'control'].includes(match.players[0].phase) && match.players[0].piece && !match.players[0].piece.locked;
    const start = performance.now();
    const result = stepCpu(cpu, match.players[0], match.table); cpu = result.cpu;
    if (planning) times.push(performance.now() - start);
    match = stepMatch(match, [result.input]);
    for (const event of match.players[0].events) {
      if (event.type === 'lock') locks++;
      if (event.type === 'chainEnd' && event.chain > 0) histogram[event.chain] = (histogram[event.chain] ?? 0) + 1;
    }
  }
  // 마지막 쌍의 연쇄까지 포함한다.
  for (let f = 0; f < 1200 && !['next', 'lost'].includes(match.players[0].phase) && match.phase !== 'over'; f++) {
    match = stepMatch(match, [0]);
    for (const event of match.players[0].events) if (event.type === 'chainEnd' && event.chain > 0) histogram[event.chain] = (histogram[event.chain] ?? 0) + 1;
  }
  runs.push({ seed, locks, maxChain: match.players[0].maxChain, lost: match.players[0].lost, score: match.players[0].score });
}
times.sort((a,b) => a-b);
console.log(JSON.stringify({level,seeds,pieces,averageMaxChain:runs.reduce((s,r)=>s+r.maxChain,0)/seeds,
 maxChain:Math.max(...runs.map(r=>r.maxChain)),survived:runs.filter(r=>!r.lost).length,histogram,
 planMs:{median:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],max:times.at(-1)},runs},null,2));
