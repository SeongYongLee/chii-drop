import { prefersReducedMotion } from '../motion-preference.js';
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
import { compileTravel, travelAt } from '../character-travel.js';
import { createImageLoader } from './image-loader.js';
import { fetchAssetJson } from '../../app/asset-request.js';

const MOODS = ['menuRest1', 'menuRest2', 'walk', 'idle', 'happy', 'sad', 'win', 'lose', 'fever', 'chain1', 'chain2', 'chain3', 'chain4', 'chain5', 'chain6', 'chain7', 'idleMove1', 'idleMove2', 'leading', 'trailing'];
const MENU_MOODS = ['idle', 'walk', 'happy', 'idleMove1', 'idleMove2', 'menuRest1', 'menuRest2'];

// 선택창과 메뉴 산책에 필요한 동작만 먼저 준비한다. 필드 전용 연출은 경기 자료다.
export function menuSkinManifest(manifest) {
  const menuEntry = entry => entry && typeof entry === 'object' ? { ...entry, fieldAction: undefined } : entry;
  return { ...manifest, blobs: {}, background: undefined,
    backgrounds: Object.fromEntries(Object.entries(manifest.backgrounds ?? {}).filter(([scene]) => ['title', 'menu'].includes(scene))),
    characters: (manifest.characters ?? []).filter(c => c.selectionVisible !== false).map(character => ({ ...character,
      moods: Object.fromEntries(MENU_MOODS.map(mood => [mood, menuEntry(character.moods?.[mood])])),
    })),
  };
}

function chainClip(moods, chain) {
  if (!Number.isFinite(chain) || chain < 1) return null;
  for (let tier = Math.min(7, Math.floor(chain)); tier >= 1; tier--) {
    if (moods?.[`chain${tier}`]) return moods[`chain${tier}`];
  }
  return null;
}
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
  return { ...sprite, offsetX, offsetY, scale, flipX: entry.flipX === true };
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
  const total = frames.reduce((sum, frame) => sum + frame.duration, 0);
  const travel = entry.travel === undefined ? null : compileTravel(entry.travel, total);
  if (entry.travel !== undefined && !travel) return null;
  const fieldTravel = entry.fieldTravel === undefined ? null : compileTravel(entry.fieldTravel, total);
  if (entry.fieldTravel !== undefined && !fieldTravel) return null;
  const fieldScale = entry.fieldScale ?? 1;
  if (!Number.isFinite(fieldScale) || fieldScale < .25 || fieldScale > 1) return null;
  return { frames, total, travel, fieldTravel, fieldScale,
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

export function skinImageFiles(manifest) {
  const entries = [...Object.values(manifest.blobs ?? {}), manifest.background, manifest.titleArt, ...Object.values(manifest.titleParts ?? {}), ...Object.values(manifest.backgrounds ?? {}), ...Object.values(manifest.mascot?.moods ?? {}),
    ...(manifest.characters ?? []).flatMap(character => MOODS.map(mood => character.moods?.[mood]))];
  const files = entry => !entry ? [] : typeof entry === 'string' ? [entry]
    : [...(entry.file ? [entry.file] : []), ...(entry.frames ?? []).map(part => part?.file).filter(Boolean), ...files(entry.fieldAction)];
  return [...new Set(entries.flatMap(files))];
}

async function loadImageMap(entries, loadFile, priority = 0) {
  const loadEntry = async (entry, allowField = true) => {
    if (!entry) return null;
    const file = typeof entry === 'string' ? entry : entry.file;
    if (!file) return null;
    const image = await loadFile(file, priority);
    if (!image) return null;
    const images = Array.isArray(entry.frames) ? await Promise.all(entry.frames.map(part =>
      part && typeof part === 'object' && part.file ? loadFile(part.file, priority) : image)) : [];
    if (images.some(image => !image)) return null;
    const clip = spriteClip(image, entry, images);
    if (!clip) return null;
    if (allowField && entry.fieldAction) {
      clip.fieldAction = await loadEntry(entry.fieldAction, false);
    }
    return clip;
  };
  const loaded = await Promise.all(entries.map(async ([key, entry]) => [key, await loadEntry(entry)]));
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
async function loadImageSkin(baseUrl, { onManifest, onImage, progressive = false } = {}) {
  let manifest;
  try {
    manifest = await fetchAssetJson(`${baseUrl}/manifest.json`, { cache: 'no-store' });
  } catch {
    return null;
  }

  const initial = progressive ? menuSkinManifest(manifest) : manifest;
  onManifest?.(manifest, initial);
  const loadFile = createImageLoader(baseUrl, onImage);
  const blobs = {}, backgrounds = {}, mascot = {}, titleParts = {};
  let background, titleArt;
  const characters = (manifest.characters ?? []).map(character => ({ ...character,
    selectable: character.selectable !== false, moods: {}, idleMotion: null,
  }));
  async function loadCharacter(character, priority) {
    const target = characters.find(c => c.id === character.id);
    const moods = await loadImageMap(MOODS.map(mood => [mood, character.moods?.[mood]]), loadFile, priority);
    Object.assign(target.moods, moods);
    target.idleMotion = compileIdleMotion(character.idleMotion,
      [target.moods.idleMove1, target.moods.idleMove2].filter(clip => clip?.frames));
  }
  async function loadShared(source, priority) {
    const [loadedBlobs, loadedBackgrounds, loadedMascot, art, loadedTitleParts] = await Promise.all([
      loadImageMap(Object.entries(source.blobs ?? {}), loadFile, priority),
      loadImageMap(Object.entries(source.backgrounds ?? {}), loadFile, priority),
      loadImageMap(Object.entries(source.mascot?.moods ?? {}), loadFile, priority),
      loadImageMap([['background', source.background], ['titleArt', source.titleArt]], loadFile, priority),
      loadImageMap(Object.entries(source.titleParts ?? {}), loadFile, priority),
    ]);
    Object.assign(blobs, loadedBlobs); Object.assign(backgrounds, loadedBackgrounds); Object.assign(mascot, loadedMascot);
    background = art.background ?? background; titleArt = art.titleArt ?? titleArt;
    Object.assign(titleParts, loadedTitleParts);
  }
  await Promise.all([loadShared(initial, 0), ...(initial.characters ?? []).map(c => loadCharacter(c, 0))]);
  if (progressive && loadFile.failed(skinImageFiles(initial))) return null;
  const gameManifest = (ids, all = false) => ({ ...manifest,
    characters: (manifest.characters ?? []).filter(c => ids.includes(c.id)),
    backgrounds: all ? manifest.backgrounds : Object.fromEntries(Object.entries(manifest.backgrounds ?? {})
      .filter(([scene]) => scene === 'game' || scene.startsWith('game:'))),
  });
  async function preloadCharacters(ids, { background = false, all = false } = {}) {
    loadFile.retryFailures();
    const source = gameManifest(ids, all);
    await Promise.all([loadShared(source, background ? 10 : 0), ...source.characters.map(c => loadCharacter(c, background ? 10 : 0))]);
    if (loadFile.failed(skinImageFiles(source))) throw new Error('경기 이미지를 불러오지 못했습니다.');
  }

  const grassGarbage = manifest.garbageStyle === 'grass';
  const props = createPropBlobs(manifest.blobArt);
  if (Object.keys(blobs).length === 0 && !background && Object.keys(backgrounds).length === 0 && characters.length === 0 && !grassGarbage && !props && !titleArt) {
    return null;
  }

  const blobImage = (color) => blobs[color === GARBAGE ? 'garbage' : String(color)];
  const entranceReady = () => manifest.titleEntrance &&
    [manifest.titleEntrance.lettering, ...manifest.titleEntrance.actors].every(layer =>
      [layer.part, ...Object.values(layer.poses ?? {})].every(key => titleParts[key]));
  function drawTitlePart(ctx, key, box) {
    const sprite = titleParts[key];
    if (!sprite) return null;
    const scale = Math.min(box.width / sprite.width, box.height / sprite.height);
    const width = sprite.width * scale, height = sprite.height * scale;
    const fitted = { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
    drawSprite(ctx, sprite, fitted.x, fitted.y, width, height);
    return fitted;
  }
  const drawBaseBlob = props?.drawBlob ?? (manifest.blobStyle === 'soft' ? drawSoftBlob : drawBlob);
  const selectableCharacters = characters.filter((character) => character.selectable && (progressive || Object.keys(character.moods).length))
    .map(({ id, name, menuCompanion }) => ({ id, name, ...(menuCompanion ? {menuCompanion} : {}) }));
  // 스킨을 준비할 때 한 번만 만드는 표시 전용 시드다.
  const visualSeed = globalThis.crypto?.getRandomValues?.(new Uint32Array(1))[0] ?? 0;

  return {
    preloadCharacters,
    preloadAll: () => preloadCharacters(characters.map(c => c.id), { background: true, all: true }),
    gameAssetProgress: ids => loadFile.progress(skinImageFiles(gameManifest(ids))),
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
    titleInteractions: manifest.titleArt?.interactions ?? [],
    get titleEntrance() { return entranceReady() ? manifest.titleEntrance : null; },
    drawTitlePart,
    titlePartAspect(key) { const part=titleParts[key]; return part ? part.width/part.height : null; },
    drawMascot: mascot.idle ? (ctx, mood, x, y, size, motion = {}) => {
      const clip = mascot[mood] ?? mascot.idle;
      const sprite = spriteAt(clip, motion.frame, motion.reducedMotion, clip === mascot.idle ? {
        frame: motion.blinkFrame ?? motion.frame ?? 0, seed: blinkSeed('ambient-mascot', visualSeed),
      } : null);
      const scale = size / Math.max(sprite.width, sprite.height) * sprite.scale;
      const w = sprite.width * scale, h = sprite.height * scale;
      drawSprite(ctx, sprite, x + (size-w)/2, y + size-h, w, h);
    } : undefined,
    drawTitleArt: titleArt ? (ctx,x,y,width,height,motion={}) => {
      const sprite=spriteAt(titleArt,motion.frame,motion.reducedMotion);
      const scale=Math.min(width/sprite.width,height/sprite.height)*sprite.scale;
      const box={x:x+(width-sprite.width*scale)/2,y:y+(height-sprite.height*scale)/2,width:sprite.width*scale,height:sprite.height*scale};
      if (entranceReady()) {
        for (const layer of [...manifest.titleEntrance.actors, manifest.titleEntrance.lettering]) {
          const b = layer.box;
          drawTitlePart(ctx, layer.part, { x: box.x + b.x * box.width, y: box.y + b.y * box.height,
            width: b.width * box.width, height: b.height * box.height });
        }
        return box;
      }
      drawSprite(ctx,sprite,box.x,box.y,box.width,box.height);
      return box;
    } : undefined,
    fieldChainCharacters: (manifest.characters ?? []).filter(c => c.fieldChainReaction === true).map(c => c.id),
    fieldChainFrames(id, chain) {
      const character = characters.find(c => c.id === id);
      const clip = chainClip(character?.moods, chain);
      return (clip?.fieldAction ?? clip)?.total ?? 80;
    },
    characterRoster: characters.map(({ id, name, selectable, selectionVisible, voiceAvailable }) => ({ id, name, selectable, selectionVisible, voiceAvailable })),
    hasBackground(scene) { return Boolean(backgrounds[scene]); },
    battleSceneries: (manifest.battleSceneries ?? []).filter(scene => manifest.backgrounds?.[`game:${scene}`]),
    backgroundUrl(scene) {
      const clip = backgrounds[scene] ?? background;
      return clip ? spriteAt(clip).image.src : null;
    },
    drawBackground(ctx, width, height, scene) {
      const sceneBackground = backgrounds[scene] ?? background;
      if (sceneBackground && ctx.canvasBackdrop && ctx.pageBackdropUrl === spriteAt(sceneBackground).image.src) {
        // 같은 이미지를 CSS가 이미 표시한다. 투명 캔버스의 이전 프레임만 지운다.
        ctx.clearRect(0, 0, width, height);
      } else if (sceneBackground) {
        drawImageCover(ctx, spriteAt(sceneBackground), width, height);
      } else if (manifest.backgroundStyle === 'festival') {
        drawFestivalBackground(ctx, width, height, scene);
      } else {
        drawFestivalBackground(ctx, width, height, scene);
      }
    },
    drawBlobShadowPass: Boolean(props || grassGarbage),
    blobColor: props?.blobColor ?? (manifest.blobStyle === 'soft' ? softBlobColor : blobColor),
    drawBlob(ctx, color, x, y, size, style = {}) {
      if (style.shadowOnly && !(color === GARBAGE ? grassGarbage : props)) return;
      if (color === GARBAGE && grassGarbage) {
        drawGrassGarbage(ctx, x, y, size, style.shape, style);
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
      if (!character || !Object.keys(character.moods).length) {
        ctx.save();
        ctx.fillStyle = '#9a8b7c';
        ctx.font = `${Math.max(10, Math.min(16, size * .1))}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('이미지 준비 중', x + size / 2, y + size * .65);
        ctx.restore();
        return;
      }
      const reaction = mood === 'happy' ? chainClip(character.moods, motion.chain) : null;
      const situationFallback = mood === 'leading' ? character.moods.happy : mood === 'trailing' ? character.moods.sad : null;
      const selected = reaction ?? character.moods[mood] ?? situationFallback ?? character.moods.idle ?? Object.values(character.moods)[0];
      const clip = motion.presentation === 'field' ? selected.fieldAction ?? selected : selected;
      const still = motion.reducedMotion ?? prefersReducedMotion();
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
      const portrait = character.portraitSizing ?? (['selection', 'battle', 'field'].includes(motion.presentation) ? character.selectionPortrait : null);
      const portraitScale = Number.isFinite(portrait?.scale) && portrait.scale > 0 ? portrait.scale : 1;
      const baseline = Number.isFinite(portrait?.baseline) && portrait.baseline >= 0 && portrait.baseline <= 1 ? portrait.baseline : 1;
      const boxSize = size * portraitScale * (motion.presentation === 'field' ? clip.fieldScale ?? 1 : 1);
      const boxX = x + (size - boxSize) / 2;
      const boxY = y + (size - boxSize) * baseline;
      const scale = Math.min(boxSize / image.width, boxSize / image.height) * image.scale;
      const movement = situationMotionAt(mood, motion.frame, still);
      const travel = idleAction ? travelAt(idleAction.clip, idleAction.frame, still)
        : travelAt(clip, motion.frame, still || situation, motion.presentation === 'field');
      const w = image.width * scale * movement.sx;
      const h = image.height * scale * movement.sy;
      if (motion.silhouette) {
        ctx.save(); ctx.filter = 'brightness(0)';
        ctx.globalAlpha *= Number.isFinite(motion.silhouetteOpacity) ? Math.max(0, Math.min(1, motion.silhouetteOpacity)) : 0.55;
      }
      const offsetX = image.offsetX * (image.width * scale - w) / image.width;
      const offsetY = image.offsetY * (image.height * scale - h) / image.height;
      const center = boxX + boxSize / 2 + boxSize * (movement.x + travel.x);
      if (image.flipX) { ctx.save(); ctx.translate(center * 2, 0); ctx.scale(-1, 1); }
      drawSprite(ctx, image, center - w / 2 + offsetX,
        boxY + boxSize - h + offsetY + boxSize * travel.y, w, h);
      if (image.flipX) ctx.restore();
      if (motion.silhouette) ctx.restore();
      return { x: center - w / 2 + offsetX + image.offsetX * w / image.width,
        y: boxY + boxSize - h + offsetY + boxSize * travel.y + image.offsetY * h / image.height,
        width: w, height: h };
    },
  };
}

export { loadImageSkin };
