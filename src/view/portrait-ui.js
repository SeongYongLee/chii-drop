import { screenHeight } from '../app/screen.js';
import { PALETTE, UI_FONT, flower, paper } from './festival.js';

export function drawPortraitSurface(ctx) {
  const height=screenHeight(ctx);
  ctx.fillStyle='#fdf6ec';ctx.fillRect(0,0,960,height);
  ctx.fillStyle='#f5e8df';ctx.fillRect(0,0,960,12);
  flower(ctx,48,48,10,PALETTE.pink);flower(ctx,912,48,10,PALETTE.blue);
}

export function drawPortraitHero(ctx,app,title,{character,characters,subtitle='',frame=app.animationFrame??0}={}) {
  const height=screenHeight(ctx);
  drawPortraitSurface(ctx);
  const titleSize=title.length>14?44:76;
  const size=Math.min(characters?292:420,Math.max(150,height-300));
  const groupTop=Math.max(12,(height-size-300)*.35);
  const titleY=groupTop+80, top=groupTop+190;
  paper(ctx,48,titleY-66,864,132,{radius:30,fill:'#fffdf5',shadow:false});
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=PALETTE.ink;
  ctx.font=`bold ${titleSize}px ${UI_FONT}`;ctx.fillText(title,480,titleY,820);
  const roster=characters??[character??app.skin.characters?.[0]].filter(Boolean);
  const width=roster.length*size+(roster.length-1)*12;
  roster.forEach((entry,i)=>app.skin.drawCharacter(ctx,entry.id,'idle',
    480-width/2+i*(size+12),top,size,{frame,instance:`portrait-hero-${i}`,presentation:'selection',silhouette:entry.selectable===false}));
  if(subtitle){
    const subtitleY=Math.min(height-54,top+size+76);
    paper(ctx,100,subtitleY-34,760,68,{radius:24,fill:'#fffdf5',shadow:false});
    ctx.fillStyle=PALETTE.ink;ctx.font=`32px ${UI_FONT}`;ctx.fillText(subtitle,480,subtitleY,710);
  }
}
