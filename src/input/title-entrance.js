import { reducedUiMotion } from '../view/ui-motion.js';
import { COMPANION_SPRITE_SIZE, COMPANION_HEADROOM } from './menu-companions.js';

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
export const TITLE_ENTRANCE_FRAMES = 132;

// 화면의 배치만 읽는 전환이다. 경기 상태·난수와 독립적이며 캐릭터 종횡비를 바꾸지 않는다.
export function titleArrival(age, index) {
  const depart = 34 + index * 5;
  const progress = clamp((age - depart) / 46);
  const landed = depart + 46;
  const phase = age < depart ? 'title' : age < landed ? 'air' : age < landed + 8 ? 'land'
    : age < landed + 14 ? 'recover' : age < landed + 24 ? 'settle' : 'ready';
  return { progress, travel: smooth(progress), fade: smooth((age - landed - 24) / 8), phase,
    tilt: Math.sin(progress * Math.PI) * (index === 1 ? -.07 : .07) };
}

export function createTitleEntrance(document, canvas) {
  let state;
  function finish() {
    if (!state) return;
    state.overlay.remove();
    state.controls?.style.removeProperty('opacity');
    for (const button of state.buttons) button.style.removeProperty('opacity');
    state = null;
  }
  function start(skin, source, frame) {
    finish();
    if (!skin.titleEntrance || reducedUiMotion() || !source?.rect?.width) return false;
    const overlay = document.createElement('canvas');
    overlay.setAttribute('aria-hidden', 'true');
    Object.assign(overlay.style, {position:'fixed',inset:'0',width:'100%',height:'100%',zIndex:'100',pointerEvents:'auto'});
    const view = document.defaultView;
    const width = view.innerWidth, height = view.innerHeight, density = view.devicePixelRatio || 1;
    overlay.width = Math.round(width * density); overlay.height = Math.round(height * density);
    const ctx = overlay.getContext('2d');ctx.setTransform(density,0,0,density,0,0);
    const scaleX = source.rect.width / 960, scaleY = source.rect.height / source.height;
    const b = source.box;
    const box = {x:source.rect.left+b.x*scaleX,y:source.rect.top+b.y*scaleY,width:b.width*scaleX,height:b.height*scaleY};
    const place = layer => ({x:box.x+layer.box.x*box.width,y:box.y+layer.box.y*box.height,
      width:layer.box.width*box.width,height:layer.box.height*box.height});
    const actors = skin.titleEntrance.actors.map(layer => {
      ctx.save();ctx.globalAlpha=0;const initial=skin.drawTitlePart(ctx,layer.part,place(layer));ctx.restore();
      return {layer,initial};
    });
    state={skin,overlay,ctx,frame,width,height,actors,letter:place(skin.titleEntrance.lettering),
      controls:document.getElementById('mobile-controls'),buttons:[]};
    document.body.append(overlay);
    overlay.addEventListener('click',finish);
    draw(frame);
    return true;
  }
  function draw(frame) {
    if (!state) return;
    const s=state,age=Math.max(0,frame-s.frame),view=document.defaultView;
    if (age>=TITLE_ENTRANCE_FRAMES || view.innerWidth!==s.width || view.innerHeight!==s.height || reducedUiMotion()) {finish();return;}
    s.buttons=[...document.querySelectorAll('.menu-companion')];
    if (s.controls) s.controls.style.opacity=String(smooth((age-35)/24));
    const ctx=s.ctx;ctx.clearRect(0,0,s.width,s.height);
    if (age < 56) {
      ctx.save();ctx.globalAlpha=1-smooth((age-32)/24);
      s.skin.drawBackground(ctx,s.width,s.height,'title');ctx.restore();
    }
    for (let i=0;i<s.actors.length;i++) {
      const {layer,initial}=s.actors[i],motion=titleArrival(age,i),button=s.buttons[i];
      const target=button?.querySelector('canvas')?.getBoundingClientRect();
      if (!target?.width) {finish();return;}
      // 기존 산책의 발 위치로 도착한 뒤 짧게 겹쳐 그리며 대기로 이어 간다.
      ctx.save();ctx.globalAlpha=0;
      const pose=s.skin.drawCharacter?.(ctx,layer.charId,'idle',4,4,COMPANION_SPRITE_SIZE-8,{reducedMotion:true,presentation:'selection'});
      ctx.restore();
      const unit=target.width/COMPANION_SPRITE_SIZE;
      const endWidth=pose?pose.width*unit:target.width*.64;
      const endX=pose?target.left+(pose.x+pose.width/2)*unit:target.left+target.width/2;
      const endFoot=pose?target.top+(COMPANION_HEADROOM+pose.y+pose.height)*unit:target.bottom-target.width*.055;
      const width=mix(initial.width,endWidth,motion.travel);
      const part=motion.phase==='title' ? layer.part
        : layer.poses?.[motion.phase==='ready'?'settle':motion.phase] ?? layer.poses?.recover ?? layer.part;
      const aspect=s.skin.titlePartAspect?.(part) ?? initial.width/initial.height;
      const height=width/aspect;
      const cx=mix(initial.x+initial.width/2,endX,motion.travel);
      const foot=mix(initial.y+initial.height,endFoot,motion.progress**2);
      ctx.save();ctx.globalAlpha=1-motion.fade;ctx.translate(cx,foot);ctx.rotate(motion.tilt);
      s.skin.drawTitlePart(ctx,part,{x:-width/2,y:-height,width,height});ctx.restore();
      // 마지막은 새로 그린 닮은 그림 대신 실제 대기 PNG를 같은 좌표에 그린다.
      if(motion.fade>0 && motion.fade<1 && s.skin.drawCharacter){
        ctx.save();ctx.globalAlpha=motion.fade;ctx.translate(target.left,target.top);ctx.scale(unit,unit);
        ctx.translate(0,COMPANION_HEADROOM);
        s.skin.drawCharacter(ctx,layer.charId,'idle',4,4,COMPANION_SPRITE_SIZE-8,
          {reducedMotion:true,presentation:'selection',instance:`menu-companion-${i}`});ctx.restore();
      }
      button.style.opacity=motion.fade===1?'1':'0';
      if (age>34+i*5+46 && age<34+i*5+57) {
        const t=(age-(34+i*5+46))/11;
        ctx.save();ctx.globalAlpha=(1-t)*.24;ctx.strokeStyle='#b79778';ctx.lineWidth=2;
        ctx.beginPath();ctx.ellipse(endX,endFoot+2,target.width*(.24+.12*t),3,0,0,Math.PI*2);ctx.stroke();ctx.restore();
      }
    }
    const letter=s.letter;
    if (age<44) {
      const scale=age<14?mix(1,.95,smooth(age/14)):mix(.95,1.16,smooth((age-14)/20));
      ctx.save();ctx.globalAlpha=1-smooth((age-32)/12);
      ctx.translate(letter.x+letter.width/2,letter.y+letter.height/2);ctx.scale(scale,scale);
      s.skin.drawTitlePart(ctx,s.skin.titleEntrance.lettering.part,{x:-letter.width/2,y:-letter.height/2,width:letter.width,height:letter.height});ctx.restore();
    }
    if (age>=32 && age<65) {
      const t=(age-32)/33;
      ctx.save();ctx.globalAlpha=(1-t)*.8;
      for(let i=0;i<16;i++) {
        const angle=i*Math.PI*2/16,radius=(.15+t*.6)*letter.width;
        const x=letter.x+letter.width/2+Math.cos(angle)*radius*.65;
        const y=letter.y+letter.height/2+Math.sin(angle)*radius*.25+t*t*35;
        ctx.fillStyle=['#f4bac8','#f7d685','#a9d4e9'][i%3];ctx.beginPath();ctx.ellipse(x,y,3+2*(i%2),3+2*(i%2),0,0,Math.PI*2);ctx.fill();
      }
      ctx.restore();
    }
  }
  return {start,draw,finish,get active(){return Boolean(state);}};
}
