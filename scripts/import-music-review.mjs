// Import only explicitly listed, user-supplied audio/video files; keep originals outside the repository.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const args=process.argv.slice(2),option=key=>args[args.indexOf(key)+1];
for(const key of ['--skin','--source','--ffmpeg'])if(!args.includes(key))throw Error(`Required: ${key}`);
const folder=path.resolve(option('--skin')),source=path.resolve(option('--source')),ffmpeg=option('--ffmpeg');
const review=path.join(folder,'sounds/music-review-v1');fs.mkdirSync(path.join(review,'samples'),{recursive:true});
const inputs=JSON.parse(fs.readFileSync(path.join(review,'inputs.json')));
const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json')));
const catalogFile=path.join(review,'catalog.json');
const previous=fs.existsSync(catalogFile)?JSON.parse(fs.readFileSync(catalogFile)):null;
const initialMusic=previous?.initialMusic??manifest.music;
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const tracks=previous?.tracks??[...new Map([['default',initialMusic],...Object.entries(initialMusic.scenes)].map(([scene,t])=>[t.file,{id:'old-'+scene,label:inputs.sceneNames[scene]??scene,group:'existing',file:t.file,gain:t.gain??.15}])).values()];
for(const input of inputs.files){
 if(!/^[\w-]+\.mp4$/.test(input.source)||!/^[\w-]+$/.test(input.id))throw Error('Unsafe import name');
 const original=path.join(source,input.source),relative=`sounds/music-review-v1/samples/${input.id}.mp3`,output=path.join(folder,relative);
 const existing=tracks.find(t=>t.id===input.id);
 const sourceHash=sha(original);
 if(existing?.sourceSha256===sourceHash && fs.existsSync(output) && existing.sha256===sha(output)) {
   console.log(input.source+' · unchanged, kept existing audio');
   continue;
 }
 const conversion=spawnSync(ffmpeg,['-hide_banner','-nostdin','-y','-i',original,'-map','0:a:0','-vn','-ar','48000','-ac','2','-c:a','libmp3lame','-b:a','192k','-map_metadata','-1',output],{encoding:'utf8'});
 if(conversion.status!==0)throw Error(conversion.stderr);
 const measured=spawnSync(ffmpeg,['-hide_banner','-nostdin','-i',output,'-af','loudnorm=I=-30:TP=-3:LRA=9:print_format=json','-f','null','-'],{encoding:'utf8'});
 const block=measured.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0];
 if(measured.status!==0||!block)throw Error('Could not measure '+output);
 const loudness=JSON.parse(block),lufs=Number(loudness.input_i);
 if(!Number.isFinite(lufs))throw Error('Silent or invalid audio');
 const record={...input,group:'new',file:relative,gain:Number(Math.min(1,10**((-36-lufs)/20)).toFixed(6)),inputLufs:lufs,truePeakDb:Number(loudness.input_tp),sourceSha256:sourceHash,sha256:sha(output),review:'not-listened',conversion:'FFmpeg libmp3lame 192k 48kHz stereo, no normalization/fades; static gain matches -36 LUFS reference before user volume'};
 const at=tracks.findIndex(t=>t.id===input.id);
 if(at<0)tracks.push(record);else tracks[at]=record;
 console.log(input.source+' → '+relative+' ('+lufs+' LUFS)');
}
fs.writeFileSync(catalogFile,JSON.stringify({version:1,importedAt:new Date().toISOString(),sourceStatus:'User supplied downloads; generator and license not independently verified',sceneNames:inputs.sceneNames,initialMusic,tracks},null,2)+'\n');
