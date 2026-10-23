async function loadSkinScript(dir, { includeStory = false } = {}) {
  if (!dir) {
    return null;
  }
  try {
    const response = await fetch(`${dir}/${includeStory ? 'story' : 'characters'}.json`, { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    // 일반 플레이에서는 대본을 요청하지 않고 캐릭터 이름과 ID만 사용한다.
    return includeStory ? data : { characters: data.characters, scenes: {} };
  } catch {
    return null;
  }
}

// 상대별 장면이 있으면 그것을, 없으면 공통 장면을 쓴다. 'opponent'는 실제 상대 ID로 바꾼다.
function sceneLines(script, keys, opponent) {
  for (const key of keys) {
    const lines = script.scenes[key];
    if (lines) {
      return lines.map((line) => (line.who === 'opponent' ? { ...line, who: opponent } : line));
    }
  }
  return [];
}

function characterOf(script, id) {
  return script.characters[id] ?? { name: id, charId: id };
}

export { characterOf, loadSkinScript, sceneLines };
