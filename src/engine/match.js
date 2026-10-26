import { buildNextTable } from './next-table.js';
import { createPlayer, isInChain, stepPlayer } from './player.js';
import { createRng } from './rng.js';
import {
  ATTACK_ARRIVAL_FRAMES,
  COLOR_COUNT,
  GARBAGE_CAP,
  OFFSET_ARRIVAL_FRAMES,
  RULES_VERSION,
  STORY_RULES,
  VERSUS_RULES,
} from './rules.js';

// 피버 배치용 난수는 쌍 순서·방해 배분 난수와 섞이지 않게 따로 둔다.
const FEVER_SEED_SALT = 0x2545f491;

// playerCount 1은 혼자하기다. 공격은 받을 상대가 없어 사라진다.
// boss는 부활·피버가 있는 플레이어 번호(없으면 null).
// ruleset 'story'는 1P 스토리 경기 규칙이며, 두 플레이어 모두 startLevel에서 시작한다.
function createMatch({ seed, playerCount = 2, colorCount = COLOR_COUNT, fields = [], boss = null, ruleset = 'versus', startLevel = 0 }) {
  const rules = ruleset === 'story' ? STORY_RULES : VERSUS_RULES;
  const { pairs, rng } = buildNextTable(createRng(seed), colorCount);
  return {
    rulesVersion: RULES_VERSION,
    ruleset: rules.id,
    seed,
    frame: 0,
    timer: 0,
    phase: 'playing',
    winner: null,
    table: pairs,
    rng,
    projectiles: [],
    players: Array.from({ length: playerCount }, (_, i) =>
      createPlayer({
        table: pairs,
        cells: fields[i],
        boss: boss === i,
        rules,
        level: startLevel,
        feverRng: createRng((seed ^ FEVER_SEED_SALT) + i),
      }),
    ),
  };
}

function confirmStock(player) {
  return { ...player, stocks: { ...player.stocks, a: player.stocks.a + player.stocks.b, b: 0 } };
}

function hasProjectileFrom(projectiles, from) {
  return projectiles.some((p) => p.from === from);
}

// 필드 계산 직후 등록해야 다음 플레이어가 같은 프레임의 공격도 상쇄한다.
function registerAttacks(players, flying, from) {
  if (players.length < 2) return;
  for (const event of players[from].events) {
    if (event.type !== 'attack') continue;
    const to = 1 - from;
    const target = players[to];
    players[to] = { ...target, stocks: { ...target.stocks, c: Math.min(GARBAGE_CAP, target.stocks.c + event.amount) } };
    flying.push({ from, to, framesLeft: event.afterOffset ? OFFSET_ARRIVAL_FRAMES : ATTACK_ARRIVAL_FRAMES, amount: event.amount });
  }
}

// 9.3절. 필드 계산 후 연출 도착(C → B), 확정(B → A).
function exchangeGarbage(players, projectiles) {
  let nextPlayers = players.slice();
  let flying = projectiles.slice();
  if (nextPlayers.length < 2) {
    return { players: nextPlayers, projectiles: [] };
  }

  nextPlayers.forEach((player, from) => {
    if (player.events.some((e) => e.type === 'chainEnd') && !hasProjectileFrom(flying, from)) {
      nextPlayers[1 - from] = confirmStock(nextPlayers[1 - from]);
    }
  });

  const arrived = [];
  flying = flying
    .map((p) => ({ ...p, framesLeft: p.framesLeft - 1 }))
    .filter((p) => {
      if (p.framesLeft > 0) {
        return true;
      }
      arrived.push(p);
      return false;
    });
  for (const { from, to } of arrived) {
    const target = nextPlayers[to];
    nextPlayers[to] = { ...target, stocks: { ...target.stocks, b: target.stocks.b + target.stocks.c, c: 0 } };
    if (nextPlayers[from].eraseCount === 0) {
      nextPlayers[to] = confirmStock(nextPlayers[to]);
    }
  }
  return { players: nextPlayers, projectiles: flying };
}

// 11절. 상대가 졌을 때 연쇄 중이 아니면 바로 이기고, 연쇄 중이면 끝날 때까지 진행한다.
function decideResult(players) {
  const lost = players.map((p) => p.lost);
  if (players.length === 1) {
    return lost[0] ? { phase: 'over', winner: -1 } : null;
  }
  if (lost[0] && lost[1]) {
    return { phase: 'over', winner: -1 };
  }
  const loser = lost.indexOf(true);
  if (loser === -1) {
    return null;
  }
  const winner = 1 - loser;
  return isInChain(players[winner]) ? null : { phase: 'over', winner };
}

function stepMatch(match, inputs) {
  let world = { table: match.table, rng: match.rng, timer: match.timer };
  const over = match.phase === 'over';
  // 경기가 끝나면 진 쪽의 무너지는 연출만 진행한다.
  const players = match.players.slice();
  const flying = match.projectiles.slice();
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (over && !player.lost) {
      continue;
    }
    const result = stepPlayer(player, over ? 0 : (inputs[i] ?? 0), world);
    world = result.world;
    players[i] = result.player;
    if (!over) registerAttacks(players, flying, i);
  }

  if (over) {
    return { ...match, frame: match.frame + 1, players, rng: world.rng };
  }

  const exchanged = exchangeGarbage(players, flying);
  const anyLost = exchanged.players.some((p) => p.lost);
  const result = decideResult(exchanged.players);
  return {
    ...match,
    frame: match.frame + 1,
    timer: anyLost ? match.timer : match.timer + 1,
    rng: world.rng,
    players: exchanged.players,
    projectiles: exchanged.projectiles,
    ...(result ?? {}),
  };
}

export { createMatch, stepMatch };
