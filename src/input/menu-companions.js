// Background characters sit outside the menu card, anchored just below its controls.
export const COMPANION_SPRITE_SIZE=112;
export const COMPANION_HEADROOM=24;
export function createMenuCompanions(document, parent, onUnlock) {
  let host, signature='', buttons=[], current=[];
  return {
    sync(entries=[],anchor=parent) {
      current=entries;
      const visible=String(Boolean(entries.length));
      if(document.body?.dataset&&document.body.dataset.menuCompanions!==visible)document.body.dataset.menuCompanions=visible;
      if(!entries.length){if(host&&!host.hidden)host.hidden=true;return;}
      if(!host){
        host=document.createElement('div');host.className='menu-companions';
        host.setAttribute('role','group');host.setAttribute('aria-label','캐릭터와 놀기');
        (document.body??parent).append(host);
      }
      if(host.hidden)host.hidden=false;
      const size=host.getBoundingClientRect?.().height||104;
      const rect=anchor.getBoundingClientRect?.();
      let width=360;
      if(rect){
        const viewport=document.documentElement?.clientWidth??rect.width;
        width=Math.max(0,viewport-32);
        const left=Math.max(16,Math.min(viewport-width-16,rect.left+(rect.width-width)/2));
        const footer=anchor===parent?document.getElementById?.('fan-notice'):null;
        const floor=footer&&!footer.hidden?footer.getBoundingClientRect?.().top:null;
        const top=Math.max(rect.bottom+8,Number.isFinite(floor)?floor-size-12:0);
        const placement={left:`${left}px`,top:`${top}px`,width:`${width}px`};
        for(const [key,value] of Object.entries(placement))if(host.style[key]!==value)host.style[key]=value;
      }
      const next=JSON.stringify(entries.map(({id,name})=>[id,name]));
      if(signature!==next){
        signature=next;host.replaceChildren();buttons=[];
        entries.forEach((entry,i)=>{
          const button=document.createElement('button'),canvas=document.createElement('canvas');
          button.type='button';button.className='menu-companion';
          button.style.left='0px';
          button.setAttribute('aria-label',`${entry.name} 반응 보기`);
          canvas.width=COMPANION_SPRITE_SIZE*2;
          canvas.height=(COMPANION_SPRITE_SIZE+COMPANION_HEADROOM)*2;
          canvas.setAttribute('aria-hidden','true');
          button.append(canvas);host.append(button);buttons.push(canvas);
          button.addEventListener('click',()=>{onUnlock();current[i]?.react();});
          // Native Enter/Space clicks must not also select the focused menu item.
          for(const type of ['keydown','keyup'])button.addEventListener(type,event=>event.stopPropagation());
        });
      }
      buttons.forEach((canvas,i)=>{
        const button=host.children[i];
        const x=(entries[i].position??i/Math.max(1,entries.length-1))*Math.max(0,width-size);
        const styles={width:`${size}px`,transform:`translateX(${x}px) scaleX(${entries[i].facing??1})`,zIndex:String(entries[i].depth??2)};
        for(const [key,value] of Object.entries(styles))if(button.style[key]!==value)button.style[key]=value;
        const ctx=canvas.getContext('2d');
        // Preserve the sprite's scale and foot baseline; only add transparent space above it.
        ctx.setTransform(2,0,0,2,0,COMPANION_HEADROOM*2);
        ctx.clearRect(0,-COMPANION_HEADROOM,COMPANION_SPRITE_SIZE,COMPANION_SPRITE_SIZE+COMPANION_HEADROOM);
        entries[i].draw(ctx,COMPANION_SPRITE_SIZE);
      });
    },
  };
}
