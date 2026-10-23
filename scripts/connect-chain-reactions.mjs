// 기존 비트맵은 유지하고 생성된 컷을 연쇄 단계별로 다시 연결한다.
import fs from 'node:fs';

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('Usage: node scripts/connect-chain-reactions.mjs <skin manifest>');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const character of manifest.characters ?? []) {
  const { happy, win } = character.moods ?? {};
  if (!happy?.frames || happy.frames.length < 7 || !win?.frames || win.frames.length < 4) continue;
  const cut = (clip, index, duration) => ({ ...clip, ...clip.frames[index], frames: undefined,
    loop: undefined, poster: undefined, loopFrom: undefined, blink: undefined, duration });
  const rest = (duration) => cut(happy, 0, duration);
  const clip = (frames, poster) => ({ file: happy.file, loop: false, poster, frames });
  const jump = [cut(win, 1, 5), cut(win, 2, 5), cut(win, 3, 5)];
  Object.assign(character.moods, {
    chain1: clip([rest(4), cut(happy, 1, 6), cut(happy, 2, 8), cut(happy, 1, 5), rest(12)], 2),
    chain3: { ...happy },
    chain5: clip([rest(4), ...jump, cut(win, win.frames.length - 1, 16), rest(12)], 4),
    chain7: clip([rest(3), ...jump, cut(happy, 1, 3), ...jump,
      cut(win, win.frames.length - 1, 18), rest(12)], 8),
  });
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
