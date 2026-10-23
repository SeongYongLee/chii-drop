// 이미 생성된 대기·기쁨 컷을 이용한 작은 몸동작. 비트맵은 편집하지 않는다.
import fs from 'node:fs';
const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('Usage: node scripts/connect-idle-motions.mjs <skin manifest>');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const [index, character] of (manifest.characters ?? []).entries()) {
  const { happy } = character.moods ?? {};
  if (!happy?.frames || happy.frames.length < 3) continue;
  const cut = (index, duration, scale = 1) => {
    const frame = { ...happy, ...happy.frames[index], duration, frames: undefined,
      loop: undefined, poster: undefined, loopFrom: undefined, blink: undefined };
    frame.scale = (frame.scale ?? 1) * scale;
    return frame;
  };
  const clip = (frames) => ({ file: happy.file, loop: false, poster: 0, frames });
  character.idleMotion = { period: 660 + index % 3 * 60, jitter: 150 };
  character.moods.idleMove1 = clip([
    cut(0, 8), cut(1, 10), cut(1, 8, 1.008), cut(1, 10), cut(0, 10),
  ]);
  character.moods.idleMove2 = clip([
    cut(0, 8), cut(1, 8), cut(2, 12), cut(1, 8), cut(0, 10),
  ]);
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
