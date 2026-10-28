import {unlockSfx} from '../audio/sfx.js';
import {playCharacterVoice} from '../audio/character-voice.js';
import {reducedUiMotion} from '../view/ui-motion.js';

// App-owned presentation state survives scene recreation and never consumes match RNG.
export function createMenuCompanionCast(){
 const states=new Map();
 const pick=(s,min,span)=>{s.seed=(Math.imul(s.seed,1664525)+1013904223)>>>0;return min+s.seed%span;};
 function beginRest(s,i){
  s.phase='rest';s.remaining=pick(s,420,301);s.phaseAge=0;
  s.action=(s.action+1)%2;s.actionAt=pick(s,48+i*12,73);
 }
 return {entries(app){
  const frame=app.menuFrame??app.animationFrame??0;
  return (app.skin.characters??[]).slice(0,3).map((character,i)=>{
   let s=states.get(character.id);
   if(!s){s={x:[.12,.5,.85][i],direction:i===1?-1:1,last:frame,walk:0,
    phase:'rest',remaining:480+i*73,phaseAge:0,actionAt:48+i*32,action:0,
    trips:0,dashEnds:0,seed:0x71b13d^(i+1)*7919,reactedAt:-1000};states.set(character.id,s);}
   const entering=app.menuEntranceActive===true;
   const dt=entering?0:Math.max(0,Math.min(6,frame-s.last));s.last=frame;
   if(entering){s.direction=1;s.phase='rest';s.phaseAge=0;s.remaining=Math.max(240,s.remaining);}
   const age=frame-s.reactedAt,quiet=reducedUiMotion();
   if(age>=72&&!quiet&&dt>0){
    s.remaining-=dt;s.phaseAge+=dt;
    if(s.phase==='walk'||s.phase==='dash'){
     const dashing=s.phase==='dash';
     s.x+=s.direction*dt*(dashing ? .014 : .0009+i*.00018);s.walk+=dt*(dashing?3.2:1);
     if(s.x<=0||s.x>=1){
      s.x=Math.max(0,Math.min(1,s.x));s.direction*=-1;
      if(!dashing||--s.dashEnds<=0)beginRest(s,i);
     }
     else if(!dashing&&[...states.entries()].some(([id,other])=>id!==character.id&&Math.abs(other.x-s.x)<.24&&(other.x-s.x)*s.direction>0)){
      s.direction*=-1;beginRest(s,i);
     }
     else if(!dashing&&s.remaining<=0)beginRest(s,i);
    }else if(s.remaining<=0){
     s.trips++;
     s.phase=character.menuCompanion?.dash===true&&s.trips%3===1?'dash':'walk';
     s.dashEnds=s.phase==='dash'?2:0;
     s.phaseAge=0;s.remaining=pick(s,90,61);
    }
   }
   const activityFrame=s.phaseAge-s.actionAt;
   const performing=s.phase==='rest'&&activityFrame>=0&&activityFrame<240;
   const mood=entering?'idle':age<72?'happy':quiet?'idle':['walk','dash'].includes(s.phase)?'walk':performing?`menuRest${s.action+1}`:'idle';
   return {id:character.id,name:character.name??character.id,position:s.x,facing:s.direction,depth:s.phase==='dash'?1:2,
    react(){if(frame-s.reactedAt<72)return;s.reactedAt=frame;void unlockSfx(app.sfx).then(()=>playCharacterVoice(app.sfx,character.id,'select',{channel:'menu-reaction'}));},
    draw(ctx,size){app.skin.drawCharacter(ctx,character.id,mood,4,4,size-8,{frame:mood==='happy'?age:mood==='walk'?s.walk:performing?activityFrame:frame,instance:`menu-companion-${i}`,reducedMotion:quiet||entering,presentation:'selection'});},
   };
  });
 }};
}

const casts=new WeakMap();
export function menuCompanionsForApp(app){
 if(!casts.has(app))casts.set(app,createMenuCompanionCast());
 return casts.get(app).entries(app);
}
