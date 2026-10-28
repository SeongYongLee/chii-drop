import { GARBAGE } from '../../engine/field.js';
import { drawGrassGarbage, GRASS_COLOR } from './grass.js';
import { connectedBlobCurves, curve, silhouette } from './blob-outline.js';

const SCALE = { normal: [1,1], squash: [1.16,.78], stretch: [.88,1.12],
  pop0: [1.2,.74], pop1: [1,1], pop2: [.62,.62], pop3: [.26,.26] };
const COMMANDS = { M:'moveTo', L:'lineTo', C:'bezierCurveTo', Q:'quadraticCurveTo', Z:'closePath', E:'ellipse', R:'roundRect' };

function drawLayer(ctx, layer) {
  if (layer.text) {
    ctx.fillStyle=layer.fill;ctx.font=`${layer.fontSize??18}px sans-serif`;
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(layer.text,layer.x,layer.y);
    return;
  }
  ctx.beginPath();
  for (const [op,...args] of layer.path) {
    const method=COMMANDS[op];if(method)ctx[method](...args);
  }
  if(layer.fill) {ctx.fillStyle=layer.fill;ctx.fill();}
  if(layer.stroke) {ctx.strokeStyle=layer.stroke;ctx.lineWidth=layer.width??2;ctx.stroke();}
}

// 공통 연결 윤곽에 소품의 내부 특징과 노출된 장식을 겹친다.
function createPropBlobs(art) {
  if (!art || ![1,2,3,4,5].every(id => art[id]?.layers?.length)) return null;
  return {
    blobColor: color => color === GARBAGE ? GRASS_COLOR : (art[color] ?? art[1]).color,
    drawBlob(ctx, color, x, y, size, style = {}) {
      if (color === GARBAGE) { drawGrassGarbage(ctx,x,y,size,style.shape,style); return; }
      const entry=art[color]??art[1], shape=style.shape??'normal';
      const [sx,sy]=SCALE[shape]??SCALE.normal, links=(style.links??0)&15;
      const curves=connectedBlobCurves(links,sx,sy);
      const layers=entry.layers.filter(layer=>!(links&(layer.hideLinks??0)));
      ctx.save();ctx.translate(x,y);ctx.scale(size,size);
      ctx.lineJoin='round';ctx.lineCap='round';
      // 정규화된 좌표로 직접 그려 화면 확대·축소에도 그림자 두께가 유지된다.
      if (style.shadow !== false && !shape.startsWith('pop')) {
        ctx.save();ctx.translate(.10,.13);
        silhouette(ctx,curves);ctx.fillStyle='rgba(65, 49, 40, .28)';ctx.fill();
        ctx.restore();
      }
      if (style.shadowOnly) {ctx.restore();return;}
      if(shape!=='pop1') {
        ctx.save();ctx.translate(.5,1);ctx.scale(sx/100,sy/100);ctx.translate(-50,-100);
        for(const layer of layers)if(layer.outside)drawLayer(ctx,layer);
        ctx.restore();
      }
      silhouette(ctx,curves);ctx.fillStyle=shape==='pop1'?'#fffdf1':entry.color;ctx.fill();
      if(shape!=='pop1') {
        ctx.save();silhouette(ctx,curves);ctx.clip();
        ctx.translate(.5,1);ctx.scale(sx/100,sy/100);ctx.translate(-50,-100);
        // 연결면을 가로막는 몸통 테두리 없이 무늬와 부드러운 음영을 남긴다.
        for(const layer of layers)if(!layer.outside)drawLayer(ctx,layer);
        ctx.restore();
      }
      // 노출된 곡선만 그린다. 인접 칸의 경계에는 선이나 막대를 놓지 않는다.
      ctx.strokeStyle=entry.edge;ctx.lineWidth=.032;
      for(const points of curves){ctx.beginPath();curve(ctx,points);ctx.stroke();}
      if(style.axis) {
        ctx.fillStyle='#fff8e6';ctx.strokeStyle='#795c4b';ctx.lineWidth=.02;
        ctx.beginPath();ctx.ellipse(.5,1+(.84-1)*sy,.035*sx,.024*sy,0,0,Math.PI*2);ctx.fill();ctx.stroke();
      }
      ctx.restore();
    },
  };
}
export { createPropBlobs };
