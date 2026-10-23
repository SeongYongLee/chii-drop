// 모바일에서는 Canvas 메뉴와 중복하지 않고 네이티브 대화상자 하나를 사용한다.
export function createPauseDialog(view, { choose, opened }) {
  const doc=view.document;
  if(!doc.createElement||!doc.body?.append)return null;
  const dialog=doc.createElement('dialog');
  if(typeof dialog.showModal!=='function')return null;
  dialog.className='mobile-pause-dialog';dialog.setAttribute('aria-labelledby','mobile-pause-title');
  const heading=doc.createElement('h2');heading.id='mobile-pause-title';heading.textContent='일시정지';
  const buttons=doc.createElement('div');buttons.className='mobile-pause-actions';
  dialog.append(heading,buttons);
  let signature='';
  dialog.addEventListener('cancel',event=>{event.preventDefault();choose(0)});
  for(const type of ['keydown','keyup'])dialog.addEventListener(type,event=>event.stopPropagation());
  return {
    get open(){return dialog.open},
    sync(items,show){
      if(!show){if(dialog.open)dialog.close();return}
      const next=JSON.stringify(items.map(item=>item.label));
      if(next!==signature){
        signature=next;buttons.replaceChildren();
        items.forEach((item,index)=>{
          const button=doc.createElement('button');button.type='button';button.textContent=item.label;
          button.addEventListener('click',()=>choose(index));buttons.append(button);
        });
      }
      if(!dialog.isConnected)doc.body.append(dialog);
      if(!dialog.open){opened();dialog.showModal()}
    },
  };
}
