import { prefersReducedMotion } from './motion-preference.js';
import { FIELD_TOP, FIELD_WIDTH, FIELD_HEIGHT } from './layout.js';

const FIELD_CHAIN_FRAMES = 132;
const FIELD_CHAIN_FADE = 6;

const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t*t*(3-2*t); };

function fieldChainPresentation(skin, character, effect, player,
  reduced = prefersReducedMotion()) {
  const reaction = effect.fieldChain;
  if (!character || player?.lost || !skin.fieldChainCharacters?.includes(character.id) || !reaction || reaction.chain < 1) {
    return { fieldAlpha: 0, portraitAlpha: 1, frame: 0 };
  }
  const duration = Math.min(FIELD_CHAIN_FRAMES, skin.fieldChainFrames?.(character.id, reaction.chain) ?? 80);
  const age = reaction.age ?? reaction.frame;
  const intro = reduced ? 0 : FIELD_CHAIN_FADE * 2;
  const delay = Math.max(0, intro - (age - reaction.frame));
  const frame = Math.max(0, reaction.frame - delay);
  // 다음 소거를 기다릴 때는 마지막 컷을 유지하고 중앙으로 되돌아가지 않는다.
  const end = reaction.endFrame === null ? Infinity : Math.max(duration + delay, reaction.endFrame ?? 0);
  if (reduced) return { fieldAlpha: reaction.frame < end ? 1 : 0, portraitAlpha: reaction.frame < end ? 0 : 1, frame };
  if (reaction.frame >= end) {
    const exit = reaction.frame - end;
    return { fieldAlpha: 1 - smooth(exit / FIELD_CHAIN_FADE),
      portraitAlpha: smooth((exit - FIELD_CHAIN_FADE) / FIELD_CHAIN_FADE), frame };
  }
  return { fieldAlpha: smooth((age - FIELD_CHAIN_FADE) / FIELD_CHAIN_FADE),
    portraitAlpha: 1 - smooth(age / FIELD_CHAIN_FADE), frame };
}

function drawFieldChain(ctx, skin, character, effect, player, x) {
  const reaction = effect.fieldChain;
  const presentation = fieldChainPresentation(skin, character, effect, player);
  if (presentation.fieldAlpha <= 0) return;
  const size = FIELD_WIDTH * .9;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, FIELD_TOP, FIELD_WIDTH, FIELD_HEIGHT); ctx.clip();
  ctx.globalAlpha *= presentation.fieldAlpha;
  skin.drawCharacter(ctx, character.id, 'happy', x + (FIELD_WIDTH - size) / 2,
    FIELD_TOP + (FIELD_HEIGHT - size) / 2, size, { frame: presentation.frame, chain: reaction.chain,
      instance: `field-chain-${effect.side}`, presentation: 'field' });
  ctx.restore();
}

export { FIELD_CHAIN_FRAMES, FIELD_CHAIN_FADE, fieldChainPresentation, drawFieldChain };
