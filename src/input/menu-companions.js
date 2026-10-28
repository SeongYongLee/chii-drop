// Background characters sit outside the menu card, anchored just below its controls.
export function createMenuCompanions(document, parent, onUnlock) {
  let host, signature='', buttons=[], current=[];
  return {
    sync(entries=[]) {
      current=entries;
      if(document.body?.dataset)document.body.dataset.menuCompanions=String(Boolean(entries.length));
      if(!entries.length){if(host)host.hidden=true;return;}
      if(!host){
        host=document.createElement('div');host.className='menu-companions';
        host.setAttribute('role','group');host.setAttribute('aria-label','캐릭터와 놀기');
        (document.body??parent).append(host);
      }
      host.hidden=false;
      const rect=parent.getBoundingClientRect?.();
      if(rect){
        const width=Math.min(360,rect.width);
        const placement={left:`${rect.left+(rect.width-width)/2}px`,top:`${rect.bottom+8}px`,width:`${width}px`};
        for(const [key,value] of Object.entries(placement))if(host.style[key]!==value)host.style[key]=value;
      }
      const next=JSON.stringify(entries.map(({id,name})=>[id,name]));
      if(signature!==next){
        signature=next;host.replaceChildren();buttons=[];
        entries.forEach((entry,i)=>{
          const button=document.createElement('button'),canvas=document.createElement('canvas');
          button.type='button';button.className='menu-companion';
          button.setAttribute('aria-label',`${entry.name} 반응 보기`);
          canvas.width=224;canvas.height=224;canvas.setAttribute('aria-hidden','true');
          button.append(canvas);host.append(button);buttons.push(canvas);
          button.addEventListener('click',()=>{onUnlock();current[i]?.react();});
          // Native Enter/Space clicks must not also select the focused menu item.
          for(const type of ['keydown','keyup'])button.addEventListener(type,event=>event.stopPropagation());
        });
      }
      buttons.forEach((canvas,i)=>{
        const ctx=canvas.getContext('2d');
        ctx.setTransform(2,0,0,2,0,0);ctx.clearRect(0,0,112,112);
        entries[i].draw(ctx,112);
      });
    },
  };
}
