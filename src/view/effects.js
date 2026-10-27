import { pieceCells } from '../engine/control.js';
import { GARBAGE, isColor } from '../engine/field.js';
import { nextPairs, warningCount } from '../engine/player.js';
import { COLS, HIDDEN_ROWS, NEXT_WAIT, POP_FRAMES, ROWS } from '../engine/rules.js';

import { CELL, FIELD_TOP, NEXT_START, SIDES } from './layout.js';
import { tickSituation } from './character-situation.js';
import { FIELD_CHAIN_FRAMES, FIELD_CHAIN_FADE } from './field-chain.js';

// 13절의 연출 상태. 표현 전용이며 엔진 상태와 경기 난수에 영향을 주지 않는다.
const MOOD_FRAMES = 80;
const CHAIN_LABEL_FRAMES = 30;
const WARNING_SPREAD_FRAMES = 12;
const WARNING_UNITS = [400, 300, 200, 30, 6, 1];
const POP_DELAYS = [1, 4, 8, 12];
const SHADOW_START = 34;
const ORB_WAIT = 9;
const ATTACK_TRAVEL = 32;
const OFFSET_TRAVEL = 16;
const OFFSET_HOLD = 7;
const ORB_BURST_FRAMES = 14;
const OFFSET_LABEL_FRAMES = 90;
const ALL_CLEAR_TOP = 88;
const QUAKE_STEP = 768;
const QUAKE_DECAY = 128;

// 다음 쌍 이동이 멈추는 단계(연결 검사·제거 준비·깜박임·소멸).
const NEXT_PAUSE_PHASES = new Set(['check', 'decide', 'erase-start', 'flash', 'pop-start', 'pop']);

// 반주기 128단계 사인 표(0~65536).
const SINE = Array.from({ length: 128 }, (_, i) => Math.round(Math.sin((Math.PI * i) / 128) * 65536));

function createEffect(side) {
  return {
    side,
    mood: 'idle',
    moodTimer: 0,
    characterFrame: 0,
    characterChain: 0,
    fieldChain: null,
    blinkFrame: 0,
    situation: 'neutral',
    situationCandidate: 'neutral',
    situationTicks: 0,
    situationFrame: 0,
    connections: null,
    particles: [],
    chainLabels: [],
    warning: { value: 0, icons: [], frame: WARNING_SPREAD_FRAMES },
    warningChange: null,
    arrivalSounds: [],
    quake: { amplitude: 0, phase: 0, columns: 0, landed: new Set(), offsets: new Array(COLS).fill(0) },
    orbs: [],
    offsetLabels: [],
    allClear: null,
    next: null,
    lastNextIndex: null,
    shadows: [],
    displayScore: 0,
    formula: null,
    popDelays: null,
  };
}

function createEffects(count) {
  return Array.from({ length: count }, (_, i) => createEffect(i));
}

function setMood(effect, mood, frames = MOOD_FRAMES) {
  effect.mood = mood;
  effect.moodTimer = frames;
  effect.characterFrame = 0;
  effect.characterChain = 0;
}

// 경기 결과 화면에서도 재생하고, 일시정지에는 멈추는 표시 전용 시계.
function tickCharacters(effects) {
  for (const effect of effects) {
    effect.characterFrame += 1;
    effect.blinkFrame += 1;
    effect.situationFrame += 1;
    if (effect.fieldChain) {
      const reaction = effect.fieldChain;
      reaction.frame += 1;
      if (reaction.age !== undefined) reaction.age += 1;
      if (reaction.endFrame !== null && reaction.frame >=
          Math.max(FIELD_CHAIN_FRAMES + FIELD_CHAIN_FADE*2, reaction.endFrame ?? 0) + FIELD_CHAIN_FADE*2) effect.fieldChain = null;
    }
  }
}

function fieldX(effect) {
  return SIDES[effect.side].fieldX;
}

function cellCenter(effect, x, y) {
  return { x: fieldX(effect) + x * CELL + CELL / 2, y: FIELD_TOP + (y - HIDDEN_ROWS) * CELL + CELL / 2 };
}

// 13절 나. 연결 모양은 연결 검사 때의 보드로만 다시 계산한다.
function snapshotConnections(cells) {
  return cells.map((color, i) => {
    const x = i % COLS;
    const y = Math.floor(i / COLS);
    if (!isColor(color) || y < HIDDEN_ROWS) {
      return 0;
    }
    let bits = 0;
    if (y > HIDDEN_ROWS && cells[i - COLS] === color) bits |= 1;
    if (x < COLS - 1 && cells[i + 1] === color) bits |= 2;
    if (y < ROWS - 1 && cells[i + COLS] === color) bits |= 4;
    if (x > 0 && cells[i - 1] === color) bits |= 8;
    return bits;
  });
}

function decomposeWarning(value) {
  const icons = [];
  let rest = value;
  for (let slot = 0; slot < 6 && rest > 0; slot++) {
    const unit = WARNING_UNITS.find((u) => u <= rest) ?? WARNING_UNITS[WARNING_UNITS.length - 1];
    icons.push(unit);
    rest = Math.max(0, rest - unit);
  }
  return icons;
}

function clearCenter(effect, groups) {
  const cells = groups.flatMap((g) => g.cells);
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs) + 1;
  const top = Math.min(...ys) - HIDDEN_ROWS;
  const bottom = Math.max(...ys) - HIDDEN_ROWS + 1;
  return { x: fieldX(effect) + ((left + right) / 2) * CELL, y: FIELD_TOP + ((top + bottom) / 2) * CELL };
}

// 소멸 시작 지연: 보이는 12단부터 아래로, 왼쪽부터 1, 4, 8, 12를 차례로 준다.
function assignPopDelays(clearing) {
  const colored = clearing
    .filter((c) => c.color !== GARBAGE)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const delays = new Map();
  colored.forEach((c, i) => delays.set(c.y * COLS + c.x, POP_DELAYS[i % POP_DELAYS.length]));
  return delays;
}

function spawnPopParticles(effect, cell) {
  const center = cellCenter(effect, cell.x, cell.y);
  const ranges = [
    [-38, -28],
    [-15, -6],
    [7, 17],
    [29, 39],
  ];
  for (const [low, high] of ranges) {
    const degrees = low + Math.floor(Math.random() * 8) * ((high - low) / 7);
    const radians = (degrees * Math.PI) / 180;
    effect.particles.push({
      x: center.x,
      y: center.y,
      vx: 8 * Math.sin(radians),
      vy: -8 * Math.cos(radians),
      gravity: 0.5,
      age: 0,
      still: 4,
      life: 19,
      color: cell.color,
    });
  }
}

function startOrb(effect, event, opponentSide, origin, chain) {
  const ownBand = { x: fieldX(effect) + 96, y: 16 };
  const enemyBand = { x: SIDES[opponentSide].fieldX + 96, y: 16 };
  effect.orbs.push({
    kind: event.type,
    chain: chain ?? 1,
    from: origin,
    ownBand,
    enemyBand,
    frame: 0,
    sway: effect.side === 0 ? -1 : 1,
    continues: false,
  });
}

function orbPosition(orb) {
  const t = orb.frame;
  if (t <= ORB_WAIT) {
    return orb.from;
  }
  if (orb.kind === 'attack') {
    const p = Math.min(1, (t - ORB_WAIT) / ATTACK_TRAVEL);
    return {
      x: orb.from.x + (orb.enemyBand.x - orb.from.x) * p + orb.sway * 192 * Math.sin(Math.PI * p),
      y: orb.from.y + (orb.enemyBand.y - orb.from.y) * p,
    };
  }
  const reach = ORB_WAIT + OFFSET_TRAVEL;
  if (t <= reach) {
    const p = (t - ORB_WAIT) / OFFSET_TRAVEL;
    return {
      x: orb.from.x + (orb.ownBand.x - orb.from.x) * p + orb.sway * 128 * Math.sin(Math.PI * p),
      y: orb.from.y + (orb.ownBand.y - orb.from.y) * p,
    };
  }
  if (!orb.continues || t <= reach + OFFSET_HOLD) {
    return orb.ownBand;
  }
  const p = Math.min(1, (t - reach - OFFSET_HOLD) / ATTACK_TRAVEL);
  return {
    x: orb.ownBand.x + (orb.enemyBand.x - orb.ownBand.x) * p,
    y: orb.ownBand.y + 64 * Math.sin(Math.PI * p),
  };
}

function orbArrival(orb) {
  if (orb.kind === 'attack') {
    return ORB_WAIT + ATTACK_TRAVEL;
  }
  return orb.continues ? ORB_WAIT + OFFSET_TRAVEL + OFFSET_HOLD + ATTACK_TRAVEL : ORB_WAIT + OFFSET_TRAVEL;
}

function handleEvents(effect, player, opponentSide) {
  for (const event of player.events) {
    if (event.type === 'clear') {
      effect.fieldChain = event.chain >= 1 ? { chain: event.chain, frame: 0,
        age: effect.fieldChain?.age ?? 0, endFrame: null } : null;
      const center = clearCenter(effect, event.groups);
      effect.chainLabels.push({ chain: event.chain, x: center.x, y: center.y, vy: 8, age: 0 });
      const base = 10 * event.groups.reduce((sum, g) => sum + g.cells.length, 0);
      effect.formula = { base, multiplier: Math.round(event.points / base) };
      if (event.chain >= 1) {
        setMood(effect, 'happy');
        effect.characterChain = event.chain;
      }
      if (effect.allClear && effect.allClear.leaving === null) {
        effect.allClear.leaving = 0;
      }
      effect.lastClearCenter = center;
    } else if (event.type === 'chainEnd') {
      if (effect.fieldChain) effect.fieldChain.endFrame = effect.fieldChain.frame;
    } else if (event.type === 'attack' && opponentSide !== null) {
      const offsetOrb = effect.orbs.find((o) => o.kind === 'offset' && o.frame === 0);
      if (offsetOrb) {
        offsetOrb.continues = true;
      } else {
        startOrb(effect, event, opponentSide, effect.lastClearCenter, player.chain);
      }
    } else if (event.type === 'offset' && opponentSide !== null) {
      startOrb(effect, event, opponentSide, effect.lastClearCenter, player.chain);
    } else if (event.type === 'allClear') {
      effect.allClear = { y: 448 + 24, age: 0, leaving: null };
    } else if (event.type === 'garbage') {
      effect.quake.columns = player.garbagePending.filter((n) => n > 0).length;
      effect.quake.landed = new Set();
      setMood(effect, 'sad');
    } else if (event.type === 'revive') {
      setMood(effect, 'sad', Infinity);
    } else if (event.type === 'feverStart') {
      setMood(effect, 'fever', Infinity);
    } else if (event.type === 'feverEnd') {
      setMood(effect, 'idle');
    } else if (event.type === 'over') {
      setMood(effect, 'lose', Infinity);
    }
  }
}

// 13절 타. 막 놓인 쌍에만 그림자를 붙인다. 각 열 위에서부터의 순서로 블록을 따라간다.
function trackShadows(effect, player) {
  if (player.events.some((e) => e.type === 'lock') && effect.lastPiece) {
    const cells = pieceCells(effect.lastPiece).filter((c) => c.y >= 1);
    const sameColumn = cells.length === 2 && cells[0].x === cells[1].x;
    const topY = Math.min(...cells.map((c) => c.y));
    effect.shadows = cells.map((cell) => ({
      column: cell.x,
      rank: sameColumn && cell.y !== topY ? 1 : 0,
      timer: null,
    }));
  }
  effect.lastPiece = player.piece;
  const { board } = player;
  effect.shadows = effect.shadows.filter((shadow) => {
    const index = findRankedCell(board.cells, shadow.column, shadow.rank);
    if (index < 0) {
      return false;
    }
    shadow.index = index;
    if (board.offset[index] < 0) {
      shadow.timer = null;
      return true;
    }
    shadow.timer = (shadow.timer ?? SHADOW_START) - 1;
    return shadow.timer > 0;
  });
}

function findRankedCell(cells, column, rank) {
  let seen = 0;
  for (let y = 1; y < ROWS; y++) {
    const i = y * COLS + column;
    if (cells[i] !== 0) {
      if (seen === rank) {
        return i;
      }
      seen += 1;
    }
  }
  return -1;
}

function tickNext(effect, player, table, advance = true) {
  if (effect.lastNextIndex !== player.nextIndex) {
    effect.lastNextIndex = player.nextIndex;
    effect.nextFresh = !advance;
    effect.next = {
      frame: 0,
      waiting: player.frame === 0,
      outgoing: player.piece ? [player.piece.pivot, player.piece.child] : null,
      pairs: nextPairs(player, table),
      v1: -7,
      y1: SIDES[effect.side].next2.y,
      v2: -6,
      y2: NEXT_START.y,
    };
    return;
  }
  const anim = effect.next;
  // 준비 카운트다운은 엔진 프레임 0에 머문다. 첫 쌍을 NEXT에서 미리 내보내지 않는다.
  // 첫 출현의 추가 대기 4프레임도 마친 뒤 NEXT 이동을 시작한다.
  if (anim) anim.waiting = player.frame === 0 || (player.phase === 'next' && anim.frame === 0 && player.phaseTimer > NEXT_WAIT);
  if (!advance || anim?.waiting) return;
  if (effect.nextFresh) { effect.nextFresh = false; return; }
  if (!anim || NEXT_PAUSE_PHASES.has(player.phase) || anim.frame >= NEXT_WAIT + 16) {
    return;
  }
  anim.frame += 1;
  if (anim.frame > NEXT_WAIT) {
    const side = SIDES[effect.side];
    anim.y1 += anim.v1;
    anim.v1 += 0.75;
    if (anim.v1 > 0 && anim.y1 > side.next1.y) {
      anim.y1 = side.next1.y;
    }
    anim.y2 += anim.v2;
    anim.v2 += 0.75;
    if (anim.v2 > 0 && anim.y2 > side.next2.y) {
      anim.y2 = side.next2.y;
    }
  }
}

function tickQuake(effect, player) {
  const { quake } = effect;
  // 13절 바. 화면에는 한 프레임 전에 계산한 변위를 쓴다.
  quake.offsets = Array.from({ length: COLS }, (_, c) =>
    quake.amplitude > 0 ? Math.trunc(Math.trunc((quake.amplitude * SINE[(quake.phase + 32 * c) % 128]) / 256) / 65536) : 0,
  );
  if (player.phase === 'garbage-fall') {
    for (let c = 0; c < COLS; c++) {
      if (quake.landed.has(c)) {
        continue;
      }
      for (let y = 1; y < ROWS; y++) {
        const i = y * COLS + c;
        if (player.board.cells[i] === GARBAGE && player.board.land[i] === 1) {
          quake.landed.add(c);
          quake.amplitude = quake.columns * QUAKE_STEP;
          break;
        }
      }
    }
  }
  if (quake.amplitude > 0) {
    quake.amplitude = Math.max(0, quake.amplitude - QUAKE_DECAY);
    quake.phase = (quake.phase + 24) % 128;
  }
}

function tickPop(effect, player) {
  if (player.phase === 'pop-start' || (player.phase === 'pop' && !effect.popDelays)) {
    effect.popDelays = assignPopDelays(player.clearing);
  }
  if (player.phase === 'pop' && effect.popDelays) {
    const frame = POP_FRAMES - player.phaseTimer;
    for (const cell of player.clearing) {
      if (cell.color !== GARBAGE && effect.popDelays.get(cell.y * COLS + cell.x) === frame) {
        spawnPopParticles(effect, cell);
      }
    }
  }
  if (player.phase !== 'pop' && player.phase !== 'pop-start') {
    effect.popDelays = null;
  }
}

function tickScore(effect, player) {
  const diff = player.score - effect.displayScore;
  if (diff > 0) {
    let step = 1;
    while (diff / step >= 100) {
      step *= 10;
    }
    effect.displayScore = Math.min(player.score, effect.displayScore + step);
  }
}

// 매 프레임 한 번 호출한다. opponentSide는 혼자하기면 null.
function observeEffect(effect, player, { table, opponentSide, opponent = null }, animateTogether = false) {
  effect.arrivalSounds = [];
  tickSituation(effect, player, opponent);
  handleEvents(effect, player, opponentSide);
  if (player.phase === 'check') {
    effect.connections = { cells: player.board.cells.slice(), bits: snapshotConnections(player.board.cells) };
    effect.formula = null;
  }
  trackShadows(effect, player);
  tickNext(effect, player, table, animateTogether);
  tickQuake(effect, player);
  tickPop(effect, player);
  if (animateTogether) tickScore(effect, player);

  // 공격 예고와 같은 프레임에 상쇄 결과를 반영한다. 구슬 연출은 독립적으로 계속한다.
  const visibleOffset = player.events.some(event => event.type === 'offset' && event.visibleAmount > 0);
  const warning = warningCount(player);
  effect.warningChange = null;
  if (warning !== effect.warning.value) {
    const difference = warning - effect.warning.value;
    if (difference > 0 || visibleOffset) effect.warningChange = {
      type: difference > 0 ? 'warning' : 'offset', amount: Math.abs(difference), total: warning,
    };
    effect.warning = { value: warning, icons: decomposeWarning(warning), frame: 0 };
    effect.warningFresh = !animateTogether;
  } else if (animateTogether && effect.warning.frame < WARNING_SPREAD_FRAMES) {
    effect.warning.frame += 1;
  }

}

// 통신 도착 횟수 대신 화면의 고정 프레임마다 한 번씩 진행한다.
function animateEffect(effect, player, table, animateTogether = false) {
  if (!animateTogether) {
    effect.arrivalSounds = [];
    tickNext(effect, player, table);
    tickScore(effect, player);
    if (effect.warningFresh) effect.warningFresh = false;
    else if (effect.warning.frame < WARNING_SPREAD_FRAMES) effect.warning.frame++;
  }
  effect.particles = effect.particles
    .map((p) => {
      const age = p.age + 1;
      if (age <= p.still) {
        return { ...p, age };
      }
      return { ...p, age, x: p.x + p.vx, y: p.y + p.vy, vy: p.vy + p.gravity };
    })
    .filter((p) => p.age < p.life && p.y < 480 && p.x > -32 && p.x < 672);

  effect.chainLabels = effect.chainLabels
    .map((label) => {
      const vy = Math.max(0, label.vy - 0.5);
      return { ...label, age: label.age + 1, y: label.y - label.vy, vy };
    })
    .filter((label) => label.age < CHAIN_LABEL_FRAMES);

  effect.orbs = effect.orbs
    .map((orb) => {
      const frame = orb.frame + 1;
      if (orb.kind === 'offset' && frame === ORB_WAIT + OFFSET_TRAVEL) {
        effect.offsetLabels.push({ x: orb.ownBand.x, y: orb.ownBand.y + 32, vy: -1, age: 0 });
        effect.arrivalSounds.push({ type: 'offsetImpact', chain: orb.chain });
      }
      if (frame === orbArrival(orb) && (orb.kind === 'attack' || orb.continues)) {
        effect.arrivalSounds.push({ type: 'attackImpact', chain: orb.chain });
      }
      return { ...orb, frame };
    })
    .filter((orb) => orb.frame < orbArrival(orb) + ORB_BURST_FRAMES);

  effect.offsetLabels = effect.offsetLabels
    .map((label) => ({
      ...label,
      age: label.age + 1,
      x: label.x + (label.x < 320 ? 2 : -2),
      y: label.y + label.vy,
      vy: label.vy + 1 / 16,
    }))
    .filter((label) => label.age < OFFSET_LABEL_FRAMES);

  if (effect.allClear) {
    const ac = effect.allClear;
    ac.age += 1;
    ac.y = Math.max(ALL_CLEAR_TOP, ac.y - 4);
    if (ac.leaving !== null) {
      ac.leaving += 1;
      if (ac.leaving >= 30) {
        effect.allClear = null;
      }
    }
  }

  if (effect.moodTimer > 0 && effect.moodTimer !== Infinity) {
    effect.moodTimer -= 1;
    if (effect.moodTimer === 0) {
      effect.mood = 'idle';
      effect.characterFrame = 0;
      effect.characterChain = 0;
    }
  }
}

// 싱글 모드의 기존 순서와 타이밍은 그대로 유지한다.
function tickEffect(effect, player, options) {
  observeEffect(effect, player, options, true);
  animateEffect(effect, player, options.table, true);
}

// 온라인에서는 확정된 사건 수신과 표시 시계를 분리한다.
function observeMatchEffects(effects, match) {
  match.players.forEach((player, side) => observeEffect(effects[side], player, {
    table: match.table, opponentSide: 1 - side, opponent: match.players[1 - side],
  }));
}
function animateMatchEffects(effects, match) {
  match.players.forEach((player, side) => animateEffect(effects[side], player, match.table));
}

// 확정 프레임과 표시 프레임이 일치하는 기존 호출용.
function tickMatchEffects(effects, match) {
  match.players.forEach((player, side) => tickEffect(effects[side], player, {
    table: match.table, opponentSide: 1 - side, opponent: match.players[1 - side],
  }));
}

export { createEffects, orbArrival, orbPosition, setMood, tickCharacters, tickEffect, tickMatchEffects, observeMatchEffects, animateMatchEffects };
