import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordSummary, renderRecordsPanel } from '../src/input/records-panel.js';

const levels = [{ id:'easy', label:'쉬움' }, { id:'hard', label:'어려움' }];
test('기록은 난이도별로 합산하고 손상되거나 없는 수치를 0으로 표시한다', () => {
  const records = recordSummary({ soloBest:123456789, soloMaxChain:-1, cpu:{ easy:{ win:2, lose:1 }, hard:{ win:NaN, lose:4 } } }, levels);
  assert.equal(records.best,123456789);
  assert.equal(records.chain,0);
  assert.equal(records.wins,2);
  assert.equal(records.losses,5);
  assert.deepEqual(recordSummary(undefined,levels).cpu.map(row=>[row.win,row.lose]),[[0,0],[0,0]]);
});
class Element {
  constructor(tag) { this.tag=tag; this.children=[]; this.attributes={}; }
  append(...children) { this.children.push(...children); }
  replaceChildren() { this.children=[]; }
  setAttribute(key,value) { this.attributes[key]=value; }
}
const descendants = node => [node,...node.children.flatMap(descendants)];
test('읽기 전용 전적표는 점수 구분자·승률·미플레이 상태를 구별한다', () => {
  const container = new Element('div');
  renderRecordsPanel({ createElement:tag=>new Element(tag) },container,
    recordSummary({soloBest:123456789,cpu:{easy:{win:2,lose:1}}},levels));
  const nodes=descendants(container), texts=nodes.map(node=>node.textContent);
  assert.ok(texts.includes('123,456,789'));
  assert.ok(texts.includes('67%'));
  assert.ok(texts.includes('기록 없음'));
  assert.equal(nodes.filter(node=>node.tag==='table').length,1);
  assert.equal(nodes.filter(node=>node.scope==='row').length,2);
  assert.equal(nodes.filter(node=>node.tag==='button').length,0);
});
test('비어 있는 전적은 안내를 보여주고 이전 렌더를 중복하지 않는다', () => {
  const container=new Element('div'), document={createElement:tag=>new Element(tag)};
  const records=recordSummary(undefined,levels);
  renderRecordsPanel(document,container,records);
  renderRecordsPanel(document,container,records);
  assert.equal(container.children.length,1);
  assert.ok(descendants(container).some(node=>node.className==='records-empty'));
});
