// 렌더러 테스트용 인터페이스. 게임에서 불러오거나 선택할 수 있는 스킨이 아니다.
import { FLOORS, FINAL, SECRET_FINAL } from '../../src/story/campaign.js';
import { blobColor, drawBlob } from '../../src/view/skins/blobs.js';

const MOCK_SKIN = {
  characters: Array.from({ length: 3 }, (_, i) => ({ id: `actor-${i}`, name: `참가자 ${i + 1}` })),
  blobColor, drawBlob, drawBackground() {}, drawCharacter() {},
};
const characters = {
  player: { name: '주인공', charId: 'actor-0' },
  companion: { name: '동행', charId: 'actor-1' },
  [FINAL]: { name: '챔피언', charId: FINAL },
  [SECRET_FINAL]: { name: '손님', charId: SECRET_FINAL },
};
FLOORS.forEach((floor, i) => {
  for (const id of [...floor.ordinary, floor.fixed]) characters[id] = { name: id, charId: id };
  characters[floor.hidden] = { name: `낯선 손님 ${i + 1}`, charId: floor.hidden };
});
const MOCK_SCRIPT = { characters, scenes: {
  opening: [{ text: '대회 시작', visual: 'tower' }],
  'floor.start': [{ who: 'companion', text: '다음 층이야.' }],
  'hidden.appear': [{ who: 'companion', text: '어? 대진표에 없던 손님이 있어.' }],
  'opponent.before': [{ who: 'opponent', text: '잘 부탁해!' }],
  'secretFinal.invite': [{ text: '한 판 더.' }],
  done: [{ text: '대회는 끝났다. 언젠가 또 열릴지도 모른다.' }],
} };
export { MOCK_SKIN, MOCK_SCRIPT };
