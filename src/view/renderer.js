import { drawFieldBase } from './field-base.js';
import { drawFeverField } from './fever-field.js';
import { drawFieldChain, fieldChainPresentation } from './field-chain.js';
import { drawMascot } from './mascot.js';
import { PALETTE, UI_FONT, paper } from './festival.js';
import { characterPresentation } from './character-situation.js';
import { SCREEN_HEIGHT, SCREEN_WIDTH, screenHeight, isPortraitScreen } from '../app/screen.js';
import { drawPortraitSurface } from './portrait-ui.js';
import { CHILD_OFFSETS, fits, rowOf } from '../engine/control.js';
import { GARBAGE, isFree } from '../engine/field.js';
import { COLS, FLASH_FRAMES, HIDDEN_ROWS, NEXT_WAIT, POP_FRAMES, ROWS } from '../engine/rules.js';

import { orbArrival, orbPosition } from './effects.js';
import {
  CELL,
  FIELD_BOTTOM,
  FIELD_HEIGHT,
  FIELD_TOP,
  FIELD_WIDTH,
  GAME_HEIGHT,
  NEXT_BOX,
  SOLO_NEXT_BOX,
  NEXT_START,
  SIDES,
  gameTransform,
  portraitGameLayout,
} from './layout.js';

const INK = PALETTE.ink;
const FONT = UI_FONT;
const LOSE_DELAYS = [16, 8, 0, 0, 8, 16];
const POP_SHAPES = ['pop1', 'pop1', 'pop2', 'pop2', 'pop3', 'pop3'];

function cellTop(y) {
  return FIELD_TOP + (y - HIDDEN_ROWS) * CELL;
}

// 13절 가. 착지 대기 카운트의 하위 3비트로 눌림 → 기본 → 늘어남 → 기본.
function landingShape(land) {
  const step = land & 7;
  if (step < 2) {
    return 'squash';
  }
  if (step >= 4 && step < 6) {
    return 'stretch';
  }
  return 'normal';
}

// 13절 다. 소멸 진행: s+6까지 넓적한 모양, 이후 2프레임씩 큰 공·작은 공·점, s+13에 사라진다.
function popShape(frame, delay) {
  if (frame <= delay + 6) {
    return 'pop0';
  }
  const step = frame - delay - 7;
  return step < POP_SHAPES.length ? POP_SHAPES[step] : null;
}

function garbagePopShape(frame) {
  if (frame >= 18) {
    return null;
  }
  return ['gpop0', 'gpop1', 'gpop2'][Math.floor(frame / 6)];
}

function linksAt(effect, cells, index) {
  const snapshot = effect.connections;
  if (!snapshot || snapshot.cells[index] !== cells[index]) {
    return 0;
  }
  let bits = snapshot.bits[index];
  const neighbors = [
    [1, index - COLS],
    [2, index + 1],
    [4, index + COLS],
    [8, index - 1],
  ];
  for (const [bit, other] of neighbors) {
    if (bits & bit && cells[other] !== snapshot.cells[other]) {
      bits &= ~bit;
    }
  }
  return bits;
}

function drawFieldBack(ctx, x, effect, player) {
  const fever = Boolean(player.fever) && player.phase !== 'revive';
  paper(ctx, x - 4, FIELD_TOP - 3, FIELD_WIDTH + 8, FIELD_HEIGHT + 7, { fill: fever ? '#a4cce4' : '#fffdf4', radius: 9 });
  drawFeverField(ctx, x, player, effect.blinkFrame ?? 0);
  ctx.save();
  ctx.strokeStyle = fever ? '#d6e8ff16' : '#b8a78e0c'; ctx.lineWidth = 1;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath(); ctx.moveTo(x + c * CELL, FIELD_TOP); ctx.lineTo(x + c * CELL, FIELD_BOTTOM); ctx.stroke();
  }
  ctx.restore();
  const offsets = Array.from({ length: COLS }, (_, c) => {
    const fall = player.lost ? Math.min(64, Math.max(0, 16 * (player.loseFrames - LOSE_DELAYS[c]))) : 0;
    return effect.quake.offsets[c] + fall;
  });
  drawFieldBase(ctx, x, offsets);
}

function drawBoard(ctx, skin, x, player, effect) {
  const { board } = player;
  const clearing = new Map(player.clearing.map((c) => [c.y * COLS + c.x, c]));
  const flashFrame = player.phase === 'flash' ? FLASH_FRAMES - player.phaseTimer : 0;
  const popFrame = player.phase === 'pop' ? POP_FRAMES - player.phaseTimer : 0;

  for (let y = 1; y < ROWS; y++) {
    for (let col = 0; col < COLS; col++) {
      const i = y * COLS + col;
      const color = board.cells[i];
      if (color === 0) {
        continue;
      }
      const px = x + col * CELL;
      let py = cellTop(y) + board.offset[i];
      // 13단으로 떨어져 들어오는 중인 블록은 그리지 않는다.
      if (y === 1 && board.offset[i] < 0) {
        continue;
      }
      const style = {};
      const falling = board.offset[i] < 0;
      const landing = board.land[i] >= 0;
      if (clearing.has(i)) {
        if (player.phase === 'flash' && flashFrame % 4 === 2) {
          continue;
        }
        if (player.phase === 'pop') {
          const shape =
            color === GARBAGE ? garbagePopShape(popFrame) : popShape(popFrame, effect.popDelays?.get(i) ?? 1);
          if (!shape) {
            continue;
          }
          style.shape = shape;
        } else {
          style.links = linksAt(effect, board.cells, i);
        }
      } else if (landing && color !== GARBAGE) {
        style.shape = landingShape(board.land[i]);
      } else if (!falling) {
        // 정지한 블록과 착지 중인 방해 블록만 열 흔들림을 따른다.
        style.links = color === GARBAGE ? 0 : linksAt(effect, board.cells, i);
        py += effect.quake.offsets[col];
      }
      if (player.lost) {
        const rowFromBottom = ROWS - 1 - y;
        const t = player.loseFrames - LOSE_DELAYS[col];
        const travel = (rowFromBottom + 5) * 4;
        if (t >= travel) {
          continue;
        }
        py += 8 * Math.max(0, t);
        style.links = 0;
      }
      ctx.globalAlpha = y < HIDDEN_ROWS ? 0.55 : 1;
      skin.drawBlob(ctx, color, px, py, CELL, style);
      ctx.globalAlpha = 1;
    }
  }
}

function drawShadows(ctx, skin, x, player, effect) {
  if (player.lost) return;
  ctx.save();
  ctx.fillStyle = skin.landingShadow?.contactColor ?? '#765b43';
  for (const shadow of effect.shadows) {
    const i = shadow.index;
    if (i === undefined || player.board.cells[i] === 0 || player.board.offset[i] < 0) {
      continue;
    }
    const col = i % COLS;
    const y = Math.floor(i / COLS);
    if (y < HIDDEN_ROWS) {
      continue;
    }
    // 표시 수명은 기존 착지 카운터를 읽되, 블록 복제 대신 바닥에 붙은 접촉 그림자로 그린다.
    const fade = Math.min(1, Math.max(0, (shadow.timer ?? 34) / 34));
    const garbage = player.board.cells[i] === GARBAGE;
    const groundY = cellTop(y) + CELL + (effect.quake.offsets[col] ?? 0);
    ctx.globalAlpha = (skin.landingShadow?.contactAlpha ?? 0.14) * fade;
    ctx.beginPath();
    ctx.ellipse(x + (col + .5) * CELL, groundY - CELL * .045,
      CELL * (garbage ? .3 : .37), CELL * .065, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// 13절 타. 픽셀 단위 위치, 반 칸 좌우 이동, 축 둘레 회전.
function drawPiece(ctx, skin, x, player, showGhost) {
  const { piece } = player;
  if (!piece || player.phase !== 'control') {
    return;
  }
  const px = x + piece.x * CELL - piece.moveDir * 16 * piece.moveFrames;
  const py = FIELD_BOTTOM - CELL - piece.h;

  if (showGhost) {
    let row = rowOf(piece.h);
    while (row > 0 && fits(player.board.cells, piece.x, row - 1, piece.orient)) {
      row -= 1;
    }
    const [dx, dy] = CHILD_OFFSETS[piece.orient];
    const rows = [row, row + dy];
    if (dx !== 0) {
      // 가로 쌍은 한쪽이 닿은 뒤 빈 쪽만 더 떨어지므로 최종 착지 위치를 따로 표시한다.
      for (let i = 0; i < rows.length; i++) {
        const column = piece.x + (i === 0 ? 0 : dx);
        while (rows[i] > 0 && isFree(player.board.cells, column, ROWS - rows[i])) rows[i] -= 1;
      }
    }
    ctx.globalAlpha = 0.25;
    skin.drawBlob(ctx, piece.pivot, x + piece.x * CELL, FIELD_BOTTOM - CELL - rows[0] * CELL, CELL);
    skin.drawBlob(ctx, piece.child, x + (piece.x + dx) * CELL, FIELD_BOTTOM - CELL - rows[1] * CELL, CELL);
    ctx.globalAlpha = 1;
  }

  const turn = (piece.orient - piece.rotateFrom + 4) % 4;
  const stepDegrees = turn === 2 ? 22.5 : 11.25;
  const sign = turn === 2 ? (piece.rotateDirection ?? 1) : turn === 3 ? -1 : 1;
  const angle = ((piece.orient * 90 - sign * piece.rotateFrames * stepDegrees) * Math.PI) / 180;
  const cx = px + CELL * Math.sin(angle);
  const cy = py - CELL * Math.cos(angle);

  skin.drawBlob(ctx, piece.child, cx, cy, CELL);
  const axis = Math.floor(player.frame / 31) % 2 === 1;
  skin.drawBlob(ctx, piece.pivot, px, py, CELL, { axis });
}

function drawWarningIcon(ctx, skin, unit, x, y) {
  if (unit === 1) {
    skin.drawBlob(ctx, GARBAGE, x + 6, y + 6, 20);
    return;
  }
  if (unit === 6) {
    skin.drawBlob(ctx, GARBAGE, x, y, CELL);
    return;
  }
  if (skin.drawWarningIcon) {
    skin.drawWarningIcon(ctx, unit, x, y);
    return;
  }
  const cx = x + 16;
  const cy = y + 16;
  ctx.beginPath();
  if (unit === 30) {
    ctx.fillStyle = '#8c8379';
    ctx.roundRect(x + 2, y + 4, 28, 26, 8);
  } else if (unit === 200) {
    ctx.fillStyle = '#f2c94c';
    for (let k = 0; k < 10; k++) {
      const r = k % 2 === 0 ? 15 : 7;
      const a = (Math.PI * k) / 5 - Math.PI / 2;
      ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    ctx.closePath();
  } else if (unit === 300) {
    ctx.fillStyle = '#f5d76e';
    ctx.arc(cx, cy, 14, 0.6, Math.PI * 2 - 0.6, false);
    ctx.arc(cx + 8, cy, 11, Math.PI * 2 - 0.9, 0.9, true);
    ctx.closePath();
  } else {
    ctx.fillStyle = '#e8b73a';
    ctx.moveTo(x + 3, y + 26);
    ctx.lineTo(x + 5, y + 8);
    ctx.lineTo(x + 11, y + 16);
    ctx.lineTo(cx, y + 4);
    ctx.lineTo(x + 21, y + 16);
    ctx.lineTo(x + 27, y + 8);
    ctx.lineTo(x + 29, y + 26);
    ctx.closePath();
  }
  ctx.fill();
}

// 13절 마. 갱신될 때 필드 왼쪽 끝에서 자기 칸으로 12프레임 동안 퍼진다.
function drawWarning(ctx, skin, x, effect) {
  const { icons, frame } = effect.warning;
  icons.forEach((unit, k) => {
    const ix = x + (k * CELL * Math.min(frame, 12)) / 12;
    drawWarningIcon(ctx, skin, unit, ix, 0);
  });
}

function drawChainLabels(ctx, effect) {
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  for (const label of effect.chainLabels) {
    ctx.font = `bold 30px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(String(label.chain), label.x, label.y - 8);
    ctx.fillStyle = '#e8597d';
    ctx.fillText(String(label.chain), label.x, label.y - 8);
    ctx.font = `bold 15px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.strokeText('연쇄', label.x + 2, label.y + 8);
    ctx.fillText('연쇄', label.x + 2, label.y + 8);
  }
}

function drawAllClear(ctx, x, effect) {
  const ac = effect.allClear;
  if (!ac) {
    return;
  }
  const blinking = ac.age < 60 || ac.leaving !== null;
  const counter = ac.leaving ?? ac.age;
  if (blinking && Math.floor(counter / 3) % 2 === 1) {
    return;
  }
  ctx.font = `bold 26px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText('싹쓸이', x + 96, ac.y);
  ctx.fillStyle = '#f08a24';
  ctx.fillText('싹쓸이', x + 96, ac.y);
}

function drawPair(ctx, skin, pair, x, y, shadow) {
  if (!pair) {
    return;
  }
  if (shadow) {
    ctx.save();
    ctx.filter = skin.landingShadow?.filter ?? 'brightness(0)';
    ctx.globalAlpha = 0.1;
    skin.drawBlob(ctx, pair[1], x + 12, y - CELL + 12, CELL);
    skin.drawBlob(ctx, pair[0], x + 12, y + 12, CELL);
    ctx.restore();
  }
  skin.drawBlob(ctx, pair[1], x, y - CELL, CELL);
  skin.drawBlob(ctx, pair[0], x, y, CELL);
}

// 13절 자. 나갈 쌍은 위로 빠지고, 다다음은 다음 칸으로, 새 쌍은 다다음 칸으로 포물선을 그리며 들어온다.
function drawNext(ctx, skin, effect, solo = false) {
  const anim = effect.next;
  if (!anim) {
    return;
  }
  const side = SIDES[effect.side];
  const dir1 = Math.sign(side.next1.x - side.next2.x);
  const dir2 = Math.sign(side.next2.x - NEXT_START.x);
  const moving = Math.max(0, Math.min(16, anim.frame - NEXT_WAIT));
  const box = solo ? SOLO_NEXT_BOX : NEXT_BOX;

  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height + 8);
  ctx.clip();
  if (anim.frame < NEXT_WAIT && anim.outgoing) {
    drawPair(ctx, skin, anim.outgoing, side.next1.x, side.next1.y - 7 * anim.frame, !solo);
  }
  if (!anim.waiting) drawPair(ctx, skin, anim.pairs[1], NEXT_START.x + dir2 * moving, anim.y2, !solo);
  drawPair(ctx, skin, anim.pairs[0], side.next2.x + dir1 * 2 * moving, anim.y1, !solo);
  ctx.restore();
}

function drawNextBox(ctx, solo = false, label = true) {
  const box = solo ? SOLO_NEXT_BOX : NEXT_BOX;
  ctx.fillStyle = INK; ctx.font = `bold 12px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  if (label) ctx.fillText('다음', box.x + box.width / 2, box.y - 5);
  if (solo) {
    paper(ctx, box.x, box.y, box.width, box.height, {
      fill: PALETTE.paper, edge: '#d6c3a9', radius: 12, shadow: false,
    });
    return;
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.strokeStyle = '#e6cdb8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(NEXT_BOX.x, NEXT_BOX.y, NEXT_BOX.width, NEXT_BOX.height, 12);
  ctx.fill();
  ctx.stroke();
}

function drawScore(ctx, effect, player) {
  const { score } = SIDES[effect.side];
  paper(ctx, score.x - 5, score.y - 3, 142, 34, { radius: 8, shadow: false });
  ctx.font = `bold 22px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = INK;
  const formulaPhases = new Set(['pop-start', 'pop', 'chain-fall']);
  const text =
    effect.formula && formulaPhases.has(player.phase)
      ? `${effect.formula.base}×${effect.formula.multiplier}`.padStart(8, ' ')
      : String(effect.displayScore).padStart(8, '0');
  ctx.fillText(text, score.x, score.y + 2);
}

function drawPortrait(ctx, skin, character, effect, box, player) {
  if (!character) {
    return;
  }
  const presentation = characterPresentation(effect);
  const alpha = fieldChainPresentation(skin, character, effect, player).portraitAlpha;
  ctx.save(); ctx.globalAlpha *= alpha;
  if (alpha > 0) skin.drawCharacter(ctx, character.id, presentation.mood, box.x, box.y, box.size,
    { frame: presentation.frame, blinkFrame: effect.blinkFrame,
      chain: effect.characterChain, instance: `portrait-${effect.side}`, presentation: 'battle' });
  ctx.restore();
  paper(ctx, box.x - 4, box.y + box.size - 2, box.size + 8, 22, { radius: 6, shadow: false });
  ctx.fillStyle = INK;
  ctx.font = `bold 13px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(character.name, box.x + box.size / 2, box.y + box.size + 2, box.size);
}

function drawParticles(ctx, skin, effect) {
  for (const p of effect.particles) {
    const radius = p.age < 5 ? 3 : p.age < 11 ? 5 : p.age < 14 ? 4 : 3;
    ctx.fillStyle = skin.blobColor(p.color);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawOrbs(ctx, effect, project = point => point) {
  for (const orb of effect.orbs) {
    const arrival = orbArrival(orb);
    const pos = project(orbPosition(orb));
    if (orb.frame >= arrival) {
      const t = (orb.frame - arrival) / 14;
      ctx.strokeStyle = `rgba(255, 220, 120, ${1 - t})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 10 + 30 * t, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    const pulse = [0, 1, 2, 3, 2, 1][Math.floor(orb.frame) % 6];
    const radius = 14 + pulse * 2;
    const gradient = ctx.createRadialGradient(pos.x, pos.y, 2, pos.x, pos.y, radius);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.5, orb.kind === 'offset' ? 'rgba(140, 210, 255, 0.9)' : 'rgba(255, 190, 120, 0.9)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const label of effect.offsetLabels) {
    if (label.age >= 50 && label.age % 2 === 1) {
      continue;
    }
    ctx.font = `bold 18px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    const pos = project(label);
    ctx.strokeText('상쇄!', pos.x, pos.y);
    ctx.fillStyle = '#3a8fd1';
    ctx.fillText('상쇄!', pos.x, pos.y);
  }
}

// 15절. 보스 피버 중에는 필드 위에 남은 시간과 이번 배치의 연쇄 수를 보여 준다.
function drawFever(ctx, x, player) {
  if (!player.fever || player.phase === 'revive') {
    return;
  }
  const seconds = (player.fever.timer / 60).toFixed(1);
  ctx.fillStyle = 'rgba(91, 74, 99, 0.82)';
  ctx.beginPath();
  ctx.roundRect(x + 8, FIELD_TOP + 6, FIELD_WIDTH - 16, 26, 8);
  ctx.fill();
  ctx.fillStyle = '#ffe9f4';
  ctx.font = `bold 15px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`피버 ${seconds}초 · ${player.fever.target}연쇄`, x + FIELD_WIDTH / 2, FIELD_TOP + 19);
}

function drawPlayer(ctx, view, index) {
  const player = view.match.players[index];
  const effect = view.effects[index];
  const x = SIDES[effect.side].fieldX;
  drawFieldBack(ctx, x, effect, player);
  drawFieldChain(ctx, view.skin, view.characters[index], effect, player, x);
  drawWarning(ctx, view.skin, x, effect);
  drawShadows(ctx, view.skin, x, player, effect);
  drawBoard(ctx, view.skin, x, player, effect);
  drawPiece(ctx, view.skin, x, player, view.showGhost);
  drawFever(ctx, x, player);
  drawChainLabels(ctx, effect);
  drawAllClear(ctx, x, effect);
  if (!view.result) {
    drawNext(ctx, view.skin, effect, view.match.players.length === 1);
    drawScore(ctx, effect, player);
  }
}

function drawPortraitNext(ctx, skin, effects) {
  const single=effects.length===1;
  paper(ctx,single?376:280,76,single?208:400,244,{radius:24,fill:'#f7edda',shadow:false});
  effects.forEach((effect,i)=>{
    const first=single?400:i===0?304:592, direction=i===0?1:-1;
    ctx.save();ctx.beginPath();ctx.rect(single?384:i===0?288:480,80,192,234);ctx.clip();
    const anim=effect.next;
    if(anim){
      const progress=Math.max(0,Math.min(16,anim.frame-NEXT_WAIT))/16;
      const side=SIDES[effect.side];
      const pair=(value,x,y)=>{ctx.save();ctx.translate(x,y);ctx.scale(2,2);drawPair(ctx,skin,value,0,0,false);ctx.restore()};
      if(anim.frame<NEXT_WAIT&&anim.outgoing)pair(anim.outgoing,first,180-14*anim.frame);
      pair(anim.pairs[0],first+direction*64*(1-progress),180+2*(anim.y1-side.next1.y));
      if (!anim.waiting) pair(anim.pairs[1],first+direction*64*(2-progress),212+2*(anim.y2-side.next2.y));
    }
    ctx.restore();
  });
}

function drawPortraitGame(ctx, view, height) {
  const { players } = view.match, boxes = portraitGameLayout(height, players.length);
  if (!view.result) {
    paper(ctx,36,20,888,360,{radius:28,fill:'#fffdf5',shadow:false});
    drawPortraitNext(ctx,view.skin,view.effects);
  }
  players.forEach((player, i) => {
    const effect = view.effects[i], character = view.characters[i], box = boxes[i];
    const center=i===0?154:806;
    if (!view.result) {
      if (character) {
        const presentation = characterPresentation(effect);
        const alpha = fieldChainPresentation(view.skin, character, effect, player).portraitAlpha;
        ctx.save(); ctx.globalAlpha *= alpha;
        if (alpha > 0) view.skin.drawCharacter(ctx, character.id, presentation.mood, center-108, 80, 216,
          { frame:presentation.frame, blinkFrame:effect.blinkFrame, chain:effect.characterChain,
            instance:`portrait-${effect.side}`, presentation:'battle' });
        ctx.restore();
      }
      ctx.fillStyle=INK;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`bold 30px ${FONT}`;
      ctx.fillText(character?.name ?? `${i+1}P`, center, 52, 212);
      ctx.font=`bold 34px ${FONT}`;
      const formula = effect.formula && ['pop-start','pop','chain-fall'].includes(player.phase);
      ctx.fillText(formula ? `${effect.formula.base}×${effect.formula.multiplier}` : String(effect.displayScore).padStart(8,'0'), center, 332, 212);
    }

    // 기존 필드 좌표를 균등하게 확대해 착지·회전·소거의 움직임을 유지한다.
    const sourceX = SIDES[effect.side].fieldX;
    ctx.save();ctx.translate(box.x,box.y);ctx.scale(box.scale,box.scale);ctx.translate(-sourceX,-FIELD_TOP);
    ctx.beginPath();ctx.rect(sourceX-9,0,FIELD_WIDTH+18,GAME_HEIGHT);ctx.clip();
    drawFieldBack(ctx,sourceX,effect,player);
    drawFieldChain(ctx,view.skin,character,effect,player,sourceX);
    drawWarning(ctx,view.skin,sourceX,effect);
    drawShadows(ctx,view.skin,sourceX,player,effect);drawBoard(ctx,view.skin,sourceX,player,effect);
    drawPiece(ctx,view.skin,sourceX,player,view.showGhost);drawFever(ctx,sourceX,player);
    drawChainLabels(ctx,effect);drawAllClear(ctx,sourceX,effect);drawParticles(ctx,view.skin,effect);
    ctx.restore();
  });
  if (!view.result) drawMascot(ctx, view, true);
  const project = point => {
    const first=boxes[0], last=boxes.at(-1);
    const xScale = boxes.length>1 ? (last.x+last.width/2-first.x-first.width/2)/384 : first.scale;
    return {x:first.x+first.width/2+(point.x-128)*xScale, y:first.y+(point.y-FIELD_TOP)*first.scale};
  };
  if (!view.result) view.effects.forEach(effect=>drawOrbs(ctx,effect,project));
}

function drawGame(ctx, view) {
  const height = screenHeight(ctx);
  if (isPortraitScreen(ctx)) {
    drawPortraitSurface(ctx);drawPortraitGame(ctx,view,height);return;
  }
  view.skin.drawBackground(ctx, SCREEN_WIDTH, height, view.scenery ? `game:${view.scenery}` : 'game');
  const t = gameTransform();
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.scale(t.scale, t.scale);
  ctx.beginPath();
  ctx.rect(0, 0, 640, GAME_HEIGHT);
  ctx.clip();

  const { players } = view.match;
  if (!view.result) drawNextBox(ctx, players.length === 1);
  players.forEach((_, i) => drawPlayer(ctx, view, i));
  if (!view.result) players.forEach((_, i) => {
    const box =
      players.length === 1 ? { x: 448, y: 150, size: 128 } : SIDES[view.effects[i].side].portrait;
    drawPortrait(ctx, view.skin, view.characters[i], view.effects[i], box, players[i]);
  });
  if (!view.result) drawMascot(ctx, view);
  view.effects.forEach((effect) => {
    drawParticles(ctx, view.skin, effect);
    if (!view.result) drawOrbs(ctx, effect);
  });
  ctx.restore();
}

function drawBanner(ctx, text, sub) {
  const height = screenHeight(ctx);
  if(isPortraitScreen(ctx)){
    const lines=sub?sub.split('\n'):[], boxHeight=170+lines.length*48;
    paper(ctx,48,height/2-boxHeight/2,864,boxHeight,{fill:'#fffdf5f5',radius:32});
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=INK;
    ctx.font=`bold 64px ${FONT}`;ctx.fillText(text,480,height/2-boxHeight/2+82,800);
    ctx.font=`32px ${FONT}`;lines.forEach((line,i)=>ctx.fillText(line,480,height/2-boxHeight/2+158+i*48,790));
    return;
  }
  paper(ctx, 140, height / 2 - 76, SCREEN_WIDTH - 280, sub ? 152 : 108, { fill: '#fffdf5f5', radius: 22 });
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 44px ${FONT}`;
  ctx.fillText(text, SCREEN_WIDTH / 2, height / 2 - (sub ? 22 : 20));
  if (sub) {
    ctx.font = `18px ${FONT}`;
    sub.split('\n').forEach((line, i) => {
      ctx.fillText(line, SCREEN_WIDTH / 2, height / 2 + 24 + i * 24);
    });
  }
}

export { FONT, INK, drawBanner, drawGame };
