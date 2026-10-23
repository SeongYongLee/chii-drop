// 기존 생성 컷으로 경기 중 자신감·긴장 표정을 연결한다.
import fs from 'node:fs';
const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('Usage: node scripts/connect-situation-motions.mjs <skin manifest>');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const character of manifest.characters ?? []) {
  const { happy, sad } = character.moods ?? {};
  if (!happy?.frames || happy.frames.length < 3 || !sad?.frames || sad.frames.length < 3) continue;
  const cut = (clip, index, duration) => ({ ...clip, ...clip.frames[index], duration,
    frames: undefined, loop: undefined, loopFrom: undefined, poster: undefined, blink: undefined });
  character.moods.leading = { file: happy.file, loop: true, poster: 2,
    frames: [cut(happy, 0, 8), cut(happy, 1, 10), cut(happy, 2, 32), cut(happy, 1, 10), cut(happy, 0, 120)] };
  character.moods.trailing = { file: sad.file, loop: true, poster: 2,
    frames: [cut(happy, 0, 8), cut(sad, 1, 12), cut(sad, 2, 72), cut(sad, 1, 12), cut(happy, 0, 75)] };
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
