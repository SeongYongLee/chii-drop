import { CELL, FIELD_BOTTOM, FIELD_WIDTH } from './layout.js';

// 평상시에는 이음매 없는 한 장의 받침. 열 변위가 달라질 때만 나눠 그린다.
// 타일의 기존 흔들림·패배 낙하 위치는 그대로 전달받는다.
function drawFieldBase(ctx, x, offsets) {
  for (let start=0; start<offsets.length;) {
    let end=start+1;
    while(end<offsets.length && offsets[end]===offsets[start])end++;
    const y=FIELD_BOTTOM+offsets[start];
    ctx.save();
    ctx.beginPath();ctx.rect(x+start*CELL,y,(end-start)*CELL,17);ctx.clip();
    ctx.fillStyle='#d5c3a2';
    ctx.beginPath();ctx.roundRect(x,y,FIELD_WIDTH,15,5);ctx.fill();
    ctx.fillStyle='#eee2c8';
    ctx.beginPath();ctx.roundRect(x+1,y,FIELD_WIDTH-2,6,3);ctx.fill();
    ctx.strokeStyle='#b6a286';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(x+5,y+14);ctx.lineTo(x+FIELD_WIDTH-5,y+14);ctx.stroke();
    ctx.strokeStyle='#f5ecd8';
    ctx.beginPath();ctx.moveTo(x+5,y+2);ctx.lineTo(x+FIELD_WIDTH-5,y+2);ctx.stroke();
    ctx.restore();
    start=end;
  }
}
export { drawFieldBase };
