import { loadImageSkin } from './image-skin.js';

const SKIN_DIR = 'skins/chiikawa';

async function loadSkin() {
  const skin = await loadImageSkin(SKIN_DIR);
  return skin?.characters.length ? skin : null;
}

export { SKIN_DIR, loadSkin };
