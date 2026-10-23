import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { buildInfo } from '../scripts/build-info.mjs';

test('버전 정보는 중첩 모듈과 동적 온라인 진입점까지 같은 버전으로 고정한다', async () => {
  const info = buildInfo();
  assert.ok(info.modules.includes('src/app/main.js'));
  assert.ok(info.modules.includes('src/net/entry.js'));
  assert.ok(info.modules.includes('src/view/skins/index.js'));
  assert.equal(new Set(info.modules).size, info.modules.length);
  async function walk(dir) {
    return (await Promise.all((await readdir(dir, {withFileTypes:true})).map(entry => entry.isDirectory()
      ? walk(`${dir}/${entry.name}`) : entry.name.endsWith('.js') ? [`${dir}/${entry.name}`] : []))).flat();
  }
  assert.deepEqual(info.modules,[...await walk('src')].sort());
  for (const file of info.modules) {
    const code = await readFile(file,'utf8');
    for (const match of code.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"]+\.js)\1/g)) {
      const target = new URL(match[2],`https://example.invalid/game/${file}`).pathname.slice('/game/'.length);
      assert.ok(info.modules.includes(target), `${file} imports unmapped ${target}`);
    }
  }
});
