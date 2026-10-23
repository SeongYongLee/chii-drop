import { mapMusicFiles } from '../../audio/music-config.js';
import { drawFestivalBackground } from '../festival.js';
import { GARBAGE } from '../../engine/field.js';
import { drawGrassGarbage, drawGrassWarning } from './grass.js';
import { blobColor, drawBlob } from './blobs.js';
import { softBlobColor, drawSoftBlob } from './soft-blobs.js';
import { createPropBlobs } from './prop-blobs.js';
import { blinkSeed, blinkTime, compileBlink } from '../character-blink.js';
import { compileIdleMotion, idleMotionAt } from '../character-idle.js';
import { situationMotionAt } from '../character-situation.js';

const MOODS = ['idle', 'happy', 'sad', 'win', 'lose', 'fever', 'chain1', 'chain3', 'chain5', 'chain7', 'idleMove1', 'idleMove2', 'leading', 'trailing'];
const SHAPE_SCALE = {
  squash: [1.16, 0.78],
  stretch: [0.88, 1.12],
  pop0: [1.2, 0.74],
  pop2: [0.62, 0.62],
  pop3: [0.26, 0.26],
  gpop0: [0.85, 0.85],
  gpop1: [0.6, 0.6],
  gpop2: [0.35, 0.35],
};

function loadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function spriteRegion(image, entry, frame) {
  const columns = entry.columns ?? 1;
  const rows = entry.rows ?? 1;
  if (![columns, rows].every((n) => Number.isInteger(n) && n > 0) ||
      !Number.isInteger(frame) || frame < 0 || frame >= columns * rows) return null;
  const sprite = { image, x: (frame % columns) * image.width / columns,
    y: Math.floor(frame / columns) * image.height / rows,
    width: image.width / columns, height: image.height / rows };
  if (entry.rect) {
    const { x, y, width, height } = entry.rect;
    if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 ||
        x + width > image.width || y + height > image.height) return null;
    Object.assign(sprite, { x, y, width, height });
  }
  const offsetX = entry.offsetX ?? 0;
  const offsetY = entry.offsetY ?? 0;
  const scale = entry.scale ?? 1;
  if (![offsetX, offsetY, scale].every(Number.isFinite) || scale <= 0) return null;
  return { ...sprite, offsetX, offsetY, scale };
}

function spriteClip(image, entry, images = []) {
  if (!Array.isArray(entry.frames)) return spriteRegion(image, entry, entry.frame ?? 0);
  if (entry.frames.length === 0 || entry.frames.length > 256) return null;
  const frames = entry.frames.map((value, index) => {
    const part = typeof value === 'number' ? { frame: value } : value;
    if (!part || typeof part !== 'object') return null;
    const sprite = spriteRegion(images[index] ?? image, { ...entry, ...part }, part.frame ?? 0);
    const duration = part.duration ?? entry.duration ?? 6;
    return sprite && Number.isInteger(duration) && duration > 0 ? { ...sprite, duration } : null;
  });
  if (frames.some((frame) => !frame)) return null;
  const poster = entry.poster ?? 0;
  if (!Number.isInteger(poster) || poster < 0 || poster >= frames.length) return null;
  const loopFrom = entry.loopFrom ?? 0;
  if (!Number.isInteger(loopFrom) || loopFrom < 0 || loopFrom >= frames.length) return null;
  const blink = entry.blink === undefined ? null : compileBlink(entry.blink, frames, poster);
  if (entry.blink !== undefined && !blink) return null;
  return { frames, total: frames.reduce((sum, frame) => sum + frame.duration, 0),
    loopStart: frames.slice(0, loopFrom).reduce((sum, frame) => sum + frame.duration, 0),
    loop: entry.loop !== false, poster, blink };
}

// 시간은 표시 계층의 60Hz 카운터다. 그리기 중에는 재생 상태를 바꾸지 않는다.
function spriteAt(clip, frame = 0, still = false, blink = null) {
  if (!clip.frames) return clip;
  if (still) return clip.frames[clip.poster];
  if (clip.blink && blink) {
    let time = blinkTime(blink.frame, blink.seed, clip.blink);
    if (time < 0) return clip.frames[clip.poster];
    for (let i = clip.blink.from; i <= clip.blink.to; i++) {
      if (time < clip.frames[i].duration) return clip.frames[i];
      time -= clip.frames[i].duration;
    }
  }
  const elapsed = Number.isFinite(frame) ? Math.max(0, Math.floor(frame)) : 0;
  let time = Math.min(elapsed, clip.total - 1);
  if (clip.loop) {
    time = elapsed < clip.total ? elapsed : clip.loopStart + (elapsed - clip.loopStart) % (clip.total - clip.loopStart);
  }
  for (const sprite of clip.frames) {
    if (time < sprite.duration) return sprite;
    time -= sprite.duration;
  }
}

async function loadImageMap(baseUrl, entries, pending) {
  const loadFile = (file) => {
    if (!pending.has(file)) pending.set(file, loadImage(`${baseUrl}/${file}`));
    return pending.get(file);
  };
  const loaded = await Promise.all(
    entries.map(async ([key, entry]) => {
      if (!entry) return [key, null];
      const file = typeof entry === 'string' ? entry : entry.file;
      if (!file) return [key, null];
      const image = await loadFile(file);
      if (!image) return [key, null];
      const images = Array.isArray(entry.frames) ? await Promise.all(entry.frames.map((part) =>
        part && typeof part === 'object' && part.file ? loadFile(part.file) : image)) : [];
      if (images.some((image) => !image)) return [key, null];
      return [key, spriteClip(image, entry, images)];
    }),
  );
  return Object.fromEntries(loaded.filter(([, image]) => image !== null));
}

function drawSprite(ctx, sprite, x, y, width, height) {
  ctx.drawImage(sprite.image, sprite.x, sprite.y, sprite.width, sprite.height,
    x + sprite.offsetX * width / sprite.width, y + sprite.offsetY * height / sprite.height, width, height);
}

function drawImageCover(ctx, sprite, width, height) {
  const scale = Math.max(width / sprite.width, height / sprite.height);
  const w = sprite.width * scale;
  const h = sprite.height * scale;
  drawSprite(ctx, sprite, (width - w) / 2, (height - h) / 2, w, h);
}

// 매니페스트의 이미지를 불러온다. 캐릭터 이미지는 다른 외형으로 대체하지 않는다.
// 사용할 이미지나 절차적 방해 블록 스타일이 없으면 null을 돌려준다.
async function loadImageSkin(baseUrl) {
  let manifest;
  try {
    const response = await fetch(`${baseUrl}/manifest.json`, { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }
    manifest = await response.json();
  } catch {
    return null;
  }

  const pending = new Map();
  const blobs = await loadImageMap(baseUrl, Object.entries(manifest.blobs ?? {}), pending);
  const [background] = Object.values(await loadImageMap(baseUrl, [['background', manifest.background]], pending));
  const backgrounds = await loadImageMap(baseUrl, Object.entries(manifest.backgrounds ?? {}), pending);
  const characters = [];
  for (const character of manifest.characters ?? []) {
    const moods = await loadImageMap(
      baseUrl,
      MOODS.map((mood) => [mood, character.moods?.[mood]]),
      pending,
    );
    if (Object.keys(moods).length > 0) {
      const idleMotion = compileIdleMotion(character.idleMotion,
        [moods.idleMove1, moods.idleMove2].filter((clip) => clip?.frames));
      characters.push({ id: character.id, name: character.name, selectable: character.selectable !== false,
        selectionVisible: character.selectionVisible, selectionPortrait: character.selectionPortrait,
        portraitSizing: character.portraitSizing,
        voiceAvailable: character.voiceAvailable, moods, idleMotion });
    }
  }

  const grassGarbage = manifest.garbageStyle === 'grass';
  const props = createPropBlobs(manifest.blobArt);
  if (Object.keys(blobs).length === 0 && !background && Object.keys(backgrounds).length === 0 && characters.length === 0 && !grassGarbage && !props) {
    return null;
  }

  const blobImage = (color) => blobs[color === GARBAGE ? 'garbage' : String(color)];
  const drawBaseBlob = props?.drawBlob ?? (manifest.blobStyle === 'soft' ? drawSoftBlob : drawBlob);
  const selectableCharacters = characters.filter((character) => character.selectable)
    .map(({ id, name }) => ({ id, name }));
  // 스킨을 준비할 때 한 번만 만드는 표시 전용 시드다.
  const visualSeed = globalThis.crypto?.getRandomValues?.(new Uint32Array(1))[0] ?? 0;

  return {
    id: manifest.id,
    name: manifest.name,
    branding: manifest.branding ?? {},
    music: mapMusicFiles(manifest.music, file => `${baseUrl}/${file}`),
    voices: Object.fromEntries((manifest.characters ?? []).filter((c) => c.voices).map((c) => [c.id,
      Object.fromEntries(Object.entries(c.voices).map(([event, files]) => [event,
        files.map((file) => `${baseUrl}/${file}`)]))])),
    landingShadow: manifest.landingShadowStyle === 'earth'
      ? { filter: 'brightness(0) invert(0.3) sepia(1) saturate(1.5)', alpha: 0.22 }
      : undefined,
    drawWarningIcon: drawGrassWarning,
    characters: selectableCharacters,
    characterRoster: characters.map(({ id, name, selectable, selectionVisible, voiceAvailable }) => ({ id, name, selectable, selectionVisible, voiceAvailable })),
    hasBackground(scene) { return Boolean(backgrounds[scene]); },
    drawBackground(ctx, width, height, scene) {
      const sceneBackground = backgrounds[scene] ?? background;
      if (sceneBackground) {
        drawImageCover(ctx, spriteAt(sceneBackground), width, height);
      } else if (manifest.backgroundStyle === 'festival') {
        drawFestivalBackground(ctx, width, height, scene);
      } else {
        drawFestivalBackground(ctx, width, height, scene);
      }
    },
    blobColor: props?.blobColor ?? (manifest.blobStyle === 'soft' ? softBlobColor : blobColor),
    drawBlob(ctx, color, x, y, size, style = {}) {
      if (color === GARBAGE && grassGarbage) {
        drawGrassGarbage(ctx, x, y, size, style.shape);
        return;
      }
      // 한 도안으로 낙하·착지·연결·소거를 모두 그려 이전 스프라이트와 섞이지 않게 한다.
      if (props && color !== GARBAGE) {
        props.drawBlob(ctx, color, x, y, size, style);
        return;
      }
      const image = blobImage(color) && spriteAt(blobImage(color));
      if (!image) {
        drawBaseBlob(ctx, color, x, y, size, style);
        return;
      }
      const [sx, sy] = SHAPE_SCALE[style.shape] ?? [1, 1];
      // 연결과 소거 효과는 공통 블록 렌더러로 그린다.
      if (style.links || style.shape === 'pop1') {
        drawBaseBlob(ctx, color, x, y, size, style);
        if (style.shape === 'pop1') return;
      }
      const w = size * sx;
      const h = size * sy;
      drawSprite(ctx, image, x + (size - w) / 2, y + size - h, w, h);
      if (style.axis) {
        ctx.strokeStyle = 'rgba(107, 78, 57, 0.85)';
        ctx.lineWidth = size * 0.04;
        ctx.beginPath();
        ctx.roundRect(x + 3, y + 3, size - 6, size - 6, size * 0.3);
        ctx.stroke();
      }
    },
    drawCharacter(ctx, charId, mood, x, y, size, motion = {}) {
      const character = characters.find((c) => c.id === charId);
      if (!character) {
        ctx.save();
        ctx.fillStyle = '#9a8b7c';
        ctx.font = `${Math.max(10, Math.min(16, size * .1))}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('이미지 준비 중', x + size / 2, y + size * .65);
        ctx.restore();
        return;
      }
      const chainTier = Number.isFinite(motion.chain) && motion.chain >= 1
        ? motion.chain >= 7 ? 7 : motion.chain >= 5 ? 5 : motion.chain >= 3 ? 3 : 1 : 0;
      const reaction = mood === 'happy' && chainTier ? character.moods[`chain${chainTier}`] : null;
      const situationFallback = mood === 'leading' ? character.moods.happy : mood === 'trailing' ? character.moods.sad : null;
      const clip = reaction ?? character.moods[mood] ?? situationFallback ?? character.moods.idle ?? Object.values(character.moods)[0];
      const still = motion.reducedMotion ?? globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      const instance = motion.instance ?? `${x}:${y}:${size}`;
      const visualFrame = motion.blinkFrame ?? motion.frame ?? 0;
      const seed = blinkSeed(`${charId}/${instance}`, motion.seed ?? visualSeed);
      const idleAction = mood === 'idle' && !still
        ? idleMotionAt(visualFrame, motion.frame ?? 0, seed, character.idleMotion) : null;
      const situation = mood === 'leading' || mood === 'trailing';
      const image = idleAction ? spriteAt(idleAction.clip, idleAction.frame) : spriteAt(clip, motion.frame, still || situation, clip === character.moods.idle ? {
        frame: visualFrame,
        seed,
      } : null);
      const portrait = character.portraitSizing ?? (['selection', 'battle'].includes(motion.presentation) ? character.selectionPortrait : null);
      const portraitScale = Number.isFinite(portrait?.scale) && portrait.scale > 0 ? portrait.scale : 1;
      const baseline = Number.isFinite(portrait?.baseline) && portrait.baseline >= 0 && portrait.baseline <= 1 ? portrait.baseline : 1;
      const boxSize = size * portraitScale;
      const boxX = x + (size - boxSize) / 2;
      const boxY = y + (size - boxSize) * baseline;
      const scale = Math.min(boxSize / image.width, boxSize / image.height) * image.scale;
      const movement = situationMotionAt(mood, motion.frame, still);
      const w = image.width * scale * movement.sx;
      const h = image.height * scale * movement.sy;
      if (motion.silhouette) { ctx.save(); ctx.filter = 'brightness(0)'; ctx.globalAlpha *= 0.55; }
      const offsetX = image.offsetX * (image.width * scale - w) / image.width;
      const offsetY = image.offsetY * (image.height * scale - h) / image.height;
      drawSprite(ctx, image, boxX + (boxSize - w) / 2 + boxSize * movement.x + offsetX,
        boxY + boxSize - h + offsetY, w, h);
      if (motion.silhouette) ctx.restore();
    },
  };
}

export { loadImageSkin };
