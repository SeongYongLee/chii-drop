import { loadImageSkin } from './image-skin.js';

// 개발 서버와 정적 배포본은 동일한 실행 팩·URL을 사용한다.
const SKIN_DIR = 'skins/chiikawa/pages-runtime';
const STORY_DIR = 'skins/chiikawa';

async function loadSkin(options) {
  const skin = await loadImageSkin(SKIN_DIR, options);
  return skin?.characters.length ? skin : null;
}

export { SKIN_DIR, STORY_DIR, loadSkin };
