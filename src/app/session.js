import { createCpu, stepCpu } from '../cpu/cpu.js';
import { createMatch, stepMatch } from '../engine/match.js';
import { LOSE_FRAMES } from '../engine/rules.js';

const READY_FRAMES = 90;
const GO_FRAMES = 30;

// mode: 'solo' | 'cpu' | 'versus' | 'story'. 혼자하기도 1인 경기로 진행한다.
// 스토리 경기는 상대가 CPU이고, 1P 스토리 규칙과 상대별 시작 레벨·색 수(story)를 쓴다.
function createSession({ mode, seed, cpuLevel, cpuSeed, boss, story }) {
  const withCpu = mode === 'cpu' || mode === 'story';
  const storyRules = mode === 'story' && story ? { ruleset: 'story', startLevel: story.startLevel, colorCount: story.colors } : {};
  return {
    mode,
    phase: 'ready',
    readyTimer: READY_FRAMES,
    match: createMatch({ seed, playerCount: mode === 'solo' ? 1 : 2, boss: boss ? 1 : null, ...storyRules }),
    cpu: withCpu ? createCpu({ level: cpuLevel, seed: cpuSeed }) : null,
  };
}

function sessionPlayers(session) {
  return session.match.players;
}

// 진 쪽의 무너지는 연출이 끝나면 결과 화면으로 넘어간다.
function loseAnimationDone(match) {
  return match.players.every((p) => !p.lost || p.loseFrames >= LOSE_FRAMES);
}

function stepSession(session, humanInputs) {
  if (session.phase === 'ready') {
    const readyTimer = session.readyTimer - 1;
    return { ...session, readyTimer, phase: readyTimer > 0 ? 'ready' : 'playing' };
  }
  if (session.phase === 'result') {
    return session;
  }

  let { cpu } = session;
  const inputs = [humanInputs[0], humanInputs[1]];
  if (cpu && session.match.phase !== 'over') {
    const result = stepCpu(cpu, session.match.players[1], session.match.table, session.match.players[0]);
    cpu = result.cpu;
    inputs[1] = result.input;
  }
  const match = stepMatch(session.match, inputs);
  const finished = match.phase === 'over' && loseAnimationDone(match);
  return { ...session, cpu, match, phase: finished ? 'result' : 'playing' };
}

export { GO_FRAMES, READY_FRAMES, createSession, sessionPlayers, stepSession };
