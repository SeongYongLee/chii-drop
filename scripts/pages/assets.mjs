import { allMusicTracks } from '../../src/audio/music-config.js';
import { readFile, writeFile, mkdir, copyFile, realpath, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';

export const SKIN_ROOT = 'skins/chiikawa';
export const RUNTIME = `${SKIN_ROOT}/pages-runtime`;
export const STORY = `${SKIN_ROOT}/story.json`;
export function publicManifest(value) {
  // 2026-10-23 사용자 승인: 배정된 캐릭터 음성·장면별 음악도 실행 팩에 포함한다.
  const result = structuredClone(value);
  // 스토리의 배정된 출연진도 공개 실행 팩에 포함한다. 선택창 노출 여부는 원래 값을 유지한다.
  result.characters ??= [];
  return result;
}
export function validateStory(story, manifest) {
  if (!story?.characters || Array.isArray(story.characters) || !story?.scenes || Array.isArray(story.scenes)) throw new Error('대본의 캐릭터·장면 구조가 올바르지 않습니다.');
  const available = new Set((manifest.characters ?? []).map(character => character.id));
  for (const [id, character] of Object.entries(story.characters)) {
    if (!available.has(character.charId ?? id)) throw new Error(`대본 캐릭터의 실행 이미지가 없습니다: ${id}`);
  }
  if (Object.values(story.scenes).some(scene => !Array.isArray(scene))) throw new Error('대본의 장면은 배열이어야 합니다.');
}
export function publicCharacterInfo(manifest) {
  return { characters: Object.fromEntries((manifest.characters ?? [])
    .filter(character => character.selectionVisible !== false)
    .map(character => [character.id, { name: character.name, charId: character.id }])) };
}
export function validateCharacterInfo(info, manifest) {
  if (JSON.stringify(info) !== JSON.stringify(publicCharacterInfo(manifest))) {
    throw new Error('공개 캐릭터 정보에는 현재 선택 화면의 이름·ID만 포함할 수 있습니다.');
  }
}
export function audioPaths(value) {
  const files = new Set();
  for (const track of allMusicTracks(value.music)) if (track.file) files.add(track.file);
  for (const character of value.characters ?? []) {
    for (const entries of Object.values(character.voices ?? {})) {
      if (!Array.isArray(entries)) throw new Error('음성 배정은 파일 배열이어야 합니다.');
      for (const file of entries) files.add(file);
    }
  }
  return files;
}
export function runtimePaths(value) { return new Set([...imagePaths(value), ...audioPaths(value)]); }
export function imagePaths(value, found = new Set()) {
  if (typeof value === 'string' && /\.(png|webp)$/i.test(value)) found.add(value);
  else if (Array.isArray(value)) value.forEach(item => imagePaths(item, found));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => imagePaths(item, found));
  return found;
}
export function remapImages(value, mapping) {
  if (typeof value === 'string') return mapping.get(value) ?? value;
  if (Array.isArray(value)) return value.map(item => remapImages(item, mapping));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,remapImages(item,mapping)]));
  return value;
}
export async function safeFile(root, relative) {
  if (typeof relative !== 'string' || !/^[\w/-]+\.(png|webp|wav|mp3)$/.test(relative) || relative.split('/').includes('..')) throw new Error(`실행 자료 경로가 안전하지 않습니다: ${relative}`);
  const actual = await realpath(resolve(root, relative));
  if (!actual.startsWith((await realpath(root)) + sep)) throw new Error('스킨 밖의 파일은 포함하지 않습니다.');
  return actual;
}
export async function prepareAssets() {
  const manifest = publicManifest(JSON.parse(await readFile(`${SKIN_ROOT}/manifest.json`, 'utf8')));
  validateStory(JSON.parse(await readFile(STORY, 'utf8')), manifest);
  const mapping = new Map(), records = [];
  // 누락 파일을 먼저 검사한 뒤 생성 폴더만 갱신해 미사용 자료가 남지 않게 한다.
  const paths = [...runtimePaths(manifest)];
  for (const path of paths) await safeFile(SKIN_ROOT, path);
  await rm(`${RUNTIME}/assets`, { recursive: true, force: true });
  await mkdir(`${RUNTIME}/assets`, { recursive: true });
  for (const path of paths) {
    const original = await safeFile(SKIN_ROOT, path);
    const bytes = await readFile(original);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const destination = `assets/${hash.slice(0,20)}.${path.split('.').at(-1)}`;
    await copyFile(original, `${RUNTIME}/${destination}`);
    mapping.set(path, destination); records.push({ original: path, file: destination, sha256: hash, bytes: bytes.length });
  }
  await writeFile(`${RUNTIME}/manifest.json`, JSON.stringify(remapImages(manifest, mapping), null, 2)+'\n');
  const characters = JSON.stringify(publicCharacterInfo(manifest), null, 2) + '\n';
  await writeFile(`${SKIN_ROOT}/characters.json`, characters);
  await writeFile(`${RUNTIME}/characters.json`, characters);
  await writeFile(`${RUNTIME}/asset-index.json`, JSON.stringify(records, null, 2)+'\n');
  // 상세 CREDITS는 로컬에 보존한다. 공개 출처는 루트 README에 직접 적는다.
  console.log(`Pages 실행 자료 ${records.length}개 (음성·음악 ${audioPaths(manifest).size}개), ${(records.reduce((sum,r)=>sum+r.bytes,0)/1024/1024).toFixed(2)}MB 준비`);
}
