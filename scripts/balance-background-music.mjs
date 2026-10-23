import { allMusicTracks } from '../src/audio/music-config.js';
// 곡의 실제 통합 음량을 측정해 효과음보다 작은 일정한 배경음 레벨로 맞춘다.
// 오디오를 재인코딩하지 않고 스킨의 곡별 재생 배율만 변경한다.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const manifestPath = option('--manifest', 'skins/chiikawa/manifest.json');
const reportPath = option('--report', 'docs/music-balance.json');
const ffmpeg = option('--ffmpeg', 'ffmpeg');
const targetLufs = Number(option('--target', '-36'));
if (!Number.isFinite(targetLufs) || targetLufs > -20 || targetLufs < -60) throw new Error('target must be between -60 and -20 LUFS');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const entries = allMusicTracks(manifest.music);
const measurements = new Map();
for (const track of entries) {
  if (measurements.has(track.file)) continue;
  const file = path.resolve(path.dirname(manifestPath), track.file);
  const result = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-i', file,
    '-af', 'loudnorm=I=-30:TP=-3:LRA=9:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  const json = result.stderr?.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0];
  if (result.status !== 0 || !json) throw new Error(`Could not measure ${track.file}: ${result.stderr?.slice(-500)}`);
  const measured = JSON.parse(json);
  const inputLufs = Number(measured.input_i), truePeakDb = Number(measured.input_tp);
  if (!Number.isFinite(inputLufs) || !Number.isFinite(truePeakDb)) throw new Error(`Invalid loudness: ${track.file}`);
  const gain = Number(Math.min(1, 10 ** ((targetLufs - inputLufs) / 20)).toFixed(6));
  const gainDb = 20 * Math.log10(gain);
  const measurement = { file: track.file, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    inputLufs, truePeakDb, loudnessRangeLu: Number(measured.input_lra), previousGain: track.gain ?? .35,
    gain, effectiveLufs: Number((inputLufs + gainDb).toFixed(2)), effectiveTruePeakDb: Number((truePeakDb + gainDb).toFixed(2)) };
  measurements.set(track.file, measurement);
  console.log(`${track.file}: ${inputLufs} LUFS → ${measurement.effectiveLufs} LUFS (gain ${gain})`);
}
// 측정 중 다른 작업에서 바뀐 캐릭터 등의 데이터는 유지한다.
const current = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const track of allMusicTracks(current.music)) {
  if (track && measurements.has(track.file)) track.gain = measurements.get(track.file).gain;
}
for (const entry of [current.music, ...Object.values(current.music?.scenes ?? {})]) {
  if (entry?.tracks?.length) { entry.file = entry.tracks[0].file; entry.gain = entry.tracks[0].gain; }
}
const report = { date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()), targetLufs,
  reference: 'Before the shared user volume; SFX and voice gains are unchanged.',
  method: 'FFmpeg loudnorm input measurements; static linear gain only, no audio re-encoding or dynamic compression.',
  tool: spawnSync(ffmpeg, ['-version'], { encoding: 'utf8' }).stdout.split('\n')[0],
  tracks: [...measurements.values()] };
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(manifestPath, JSON.stringify(current, null, 2) + '\n');
