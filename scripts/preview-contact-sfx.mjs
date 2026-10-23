import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { contactSamples } from '../src/audio/soft-contact.js';

const path = process.argv[2] ?? 'artifacts/soft-contact-preview.wav';
const rate = 44100, samples = new Float32Array(rate * 4);
for (const [group, name] of ['rotate', 'land'].entries()) {
  for (let variant = 0; variant < 4; variant++) {
    const clip = contactSamples(rate, name, variant);
    const start = Math.round((.2 + group * 1.9 + variant * .35) * rate);
    // Match the default in-game effect volume.
    for (let i = 0; i < clip.length; i++) samples[start + i] += clip[i] * .6;
  }
}
const wav = Buffer.alloc(44 + samples.length * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
wav.writeUInt32LE(samples.length * 2, 40);
for (let i = 0; i < samples.length; i++) wav.writeInt16LE(Math.round(samples[i] * 32767), 44 + i * 2);
await mkdir(dirname(path), { recursive: true });
await writeFile(path, wav);
const previewPath = 'sounds/soft-contact-v1/preview.html';
await mkdir(dirname(previewPath), { recursive: true });
await writeFile(previewPath, `<!doctype html><html lang="ko"><meta charset="utf-8"><title>회전·착지 효과음</title>
<style>body{background:#faf7f0;color:#493e35;font:18px system-ui;margin:60px auto;padding:24px;max-width:720px}button{font:inherit;background:#655b82;color:white;border:0;border-radius:12px;padding:16px 24px;margin:8px}p{line-height:1.7}a{color:#655b82}</style>
<h1>회전·착지 효과음</h1><p>회전은 가벼운 톡, 착지는 낮고 둥근 툭 소리입니다.<br>게임과 같은 효과음을 기본 음량 60%로 재생합니다.</p>
<button data-sound="rotate">회전 듣기</button><button data-sound="land">착지 듣기</button><p id="status" aria-live="polite">버튼을 눌러 들어보세요.</p><a href="/">게임 열기</a>
<script type="module">import {createSfx,playSfx} from '/src/audio/sfx.js';
const sfx=createSfx();let count=0;
for(const button of document.querySelectorAll('button'))button.onclick=async()=>{
 if(!sfx.context){sfx.context=new AudioContext();sfx.master=sfx.context.createGain();sfx.master.gain.value=.6;sfx.master.connect(sfx.context.destination);}
 await sfx.context.resume();playSfx(sfx,button.dataset.sound);
 document.querySelector('#status').textContent=button.textContent+' · '+(++count)+'회 재생';
};</script></html>`);
console.log(path);
