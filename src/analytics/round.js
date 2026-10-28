import { analytics } from './client.js';
import { analyticsMode } from './events.js';

// IDはこの有限の記録にだけ使う。GAには送らない。再接続時に同じ記録を再利用する。
export function createRoundTracker({ track = (...args) => analytics.track(...args) } = {}) {
  const rounds = new Map();
  function begin(id, details) {
    if (rounds.has(id)) return;
    const context = { ...details, mode: analyticsMode(details.mode) };
    rounds.set(id, { context, ended: false, viewed: false });
    if (rounds.size > 64) rounds.delete(rounds.keys().next().value);
    track('round_started', context);
  }
  function end(id, { winner = -1, side = 0, player, playMs, reason = 'completed' } = {}) {
    const round = rounds.get(id);
    if (!round || round.ended) return;
    round.ended = true;
    const individual = round.context.role === 'player' && ['cpu', 'online'].includes(round.context.mode);
    round.outcome = individual && reason !== 'quit' ? winner < 0 ? 'draw' : winner === side ? 'win' : 'loss' : 'not_applicable';
    track('round_ended', { ...round.context, end_reason: reason, outcome: round.outcome,
      winner_side: winner >= 0 ? winner : undefined, play_ms: playMs,
      score: player?.score, max_chain: player?.maxChain });
  }
  function viewed(id) {
    const round = rounds.get(id);
    if (!round?.ended || round.viewed) return;
    round.viewed = true;
    track('result_viewed', { ...round.context, outcome: round.outcome });
  }
  function action(id, action) {
    const round = rounds.get(id);
    if (round?.viewed) track('result_action', { ...round.context, action });
  }
  return { begin, end, viewed, action };
}
