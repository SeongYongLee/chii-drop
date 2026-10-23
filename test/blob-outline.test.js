import test from 'node:test';
import assert from 'node:assert/strict';
import { connectedBlobCurves } from '../src/view/skins/blob-outline.js';

function edge(curves,axis,value) {
  return curves.flatMap(points=>[points[0],points[3]])
    .filter(point=>point[axis]===value).map(point=>point[1-axis]).sort((a,b)=>a-b);
}

test('16가지 연결은 이웃 칸과 같은 폭으로 맞닿으며 경계에 테두리 곡선을 놓지 않는다',()=>{
  for(let links=0;links<16;links++)for(const [sx,sy]of[[1,1],[1.16,.78],[.88,1.12],[.62,.62]]) {
    const curves=connectedBlobCurves(links,sx,sy);
    for(const [bit,axis,value]of[[1,1,0],[2,0,1],[4,1,1],[8,0,0]]) {
      if(!(links&bit))continue;
      const endpoints=edge(curves,axis,value);
      assert.equal(endpoints.length,2);
      const expected=[.24,.76].map(value=>axis===0?1+(value-1)*sy:.5+(value-.5)*sx);
      assert.ok(Math.abs(endpoints[0]-expected[0])<1e-12);
      assert.ok(Math.abs(endpoints[1]-expected[1])<1e-12);
      const oppositeBit={1:4,2:8,4:1,8:2}[bit];
      for(let other=0;other<16;other++)if(other&oppositeBit) {
        const neighbor=edge(connectedBlobCurves(other,sx,sy),axis,1-value);
        assert.ok(endpoints.every((point,i)=>Math.abs(point-neighbor[i])<1e-12));
      }
      assert.ok(curves.every(points=>!points.every(point=>point[axis]===value)), '칸 경계를 따라 선을 그리지 않는다');
    }
  }
});
