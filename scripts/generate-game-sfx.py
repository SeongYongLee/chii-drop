"""Reproducible CC0 recording edits. Requires numpy and soundfile.
Usage: python generate-game-sfx.py --source-dir PATH [--output-dir sounds/foley-play-v1]
No source-game audio, oscillators, generated noise, melodies or pitch shifting.
"""
import argparse
import hashlib
import json
import re
import wave
from pathlib import Path
import numpy as np
import soundfile as sf

parser = argparse.ArgumentParser()
parser.add_argument('--source-dir', type=Path, required=True)
parser.add_argument('--output-dir', type=Path, default=Path('sounds/foley-play-v1'))
args = parser.parse_args()
rate = 44100
records = json.loads((args.source_dir / 'manifest.json').read_text())['sources']
cache = {}
used = []
assets = []
audio = {}


def recording(name):
    if name not in cache:
        path = args.source_dir / name
        record = next(item for item in records if item['file'] == name)
        assert record['license'] == 'CC0-1.0'
        assert hashlib.sha256(path.read_bytes()).hexdigest() == record['sha256']
        x, sr = sf.read(path, always_2d=True)
        x = x.mean(axis=1)
        if sr != rate:
            x = np.interp(np.arange(round(len(x)*rate/sr))/rate, np.arange(len(x))/sr, x)
        cache[name] = x
        used.append(record)
    return cache[name]


def crop(name, start, seconds, cutoff=5000):
    source = recording(name)
    x = source[round(start*rate):round((start+seconds)*rate)].copy()
    assert len(x) > 100
    x -= x.mean()
    n = 1 << (len(x)*2-1).bit_length()
    f = np.fft.rfftfreq(n, 1/rate)
    response = (1-np.exp(-(f/65)**4))/np.sqrt(1+(f/cutoff)**6)
    x = np.fft.irfft(np.fft.rfft(x, n)*response, n)[:len(x)]
    active = x[np.abs(x) > max(np.max(abs(x))*.08, 1e-6)]
    rms = np.sqrt(np.mean(active*active)) if len(active) else 1
    x *= min(.14/max(rms, 1e-9), .65/max(np.max(abs(x)), 1e-9))
    a, b = min(len(x)//2, 88), min(len(x)//2, 440)
    x[:a] *= np.linspace(0, 1, a)
    x[-b:] *= np.linspace(1, 0, b)
    return x


def soft(i): return crop('impactSoft_medium_000.ogg', .002*i, .105, 3400)
def heavy(i): return crop('impactSoft_heavy_001.ogg', .006*i, .18, 1900)
def wood(i): return crop('impactWood_light_001.ogg', .002*i, .085, 4300)
def cloth(i, length=.11): return crop('jacket-whoosh.mp3', .08+.055*i, length, 5200)
def bubble(i): return crop('water-bubbles.mp3', [.69, 2.50, 5.68, 9.62][i % 4], .14, 4600)


def emit(group, i, layers):
    length = max(round(t*rate)+len(x) for x, t, gain in layers)+441
    x = np.zeros(length)
    for part, at, gain in layers:
        start = round(at*rate)
        x[start:start+len(part)] += part*gain
    x -= x.mean()
    x[:88] *= np.linspace(0, 1, 88)
    x[-441:] *= np.linspace(1, 0, 441)
    x *= min(1, .55/max(np.max(abs(x)), 1e-9))
    name = re.sub(r'([A-Z])', lambda m: '-'+m[1].lower(), group)+f'-{i+1:02}.wav'
    args.output_dir.mkdir(parents=True, exist_ok=True)
    pcm = np.round(x*32767).astype('<i2')
    with wave.open(str(args.output_dir / name), 'wb') as out:
        out.setparams((1, 2, rate, 0, 'NONE', 'not compressed')); out.writeframes(pcm.tobytes())
    assets.append({'event': group, 'file': name, 'seconds': round(len(x)/rate, 4),
                   'peak': round(float(np.max(abs(x))), 5), 'sha256': hashlib.sha256(pcm.tobytes()).hexdigest()})
    audio.setdefault(group, []).append(x)


for i in range(4):
    if i < 3:
        emit('move', i, [(wood(i), 0, .45)])
        emit('warning', i, [(wood(i), 0, .7), (wood((i+1)%3), .035, .32), (cloth(i), 0, .18)])
        emit('warningHeavy', i, [(heavy(i), 0, .42), (wood(i), .012, .7), (wood((i+1)%3), .06, .48)])
        emit('garbage', i, [(cloth(i, .20), 0, .6)])
        emit('garbageLand', i, [(heavy(i), 0, .95), (wood(i), .015, .3), (soft(i), .04, .4)])
        emit('attack', i, [(cloth(i, .18), 0, .75), (soft(i), .08, .4)])
        emit('offset', i, [(soft(i), 0, .7), (wood(i), .025, .5)])
        emit('cursor', i, [(wood(i), 0, .5)])
    emit('rotate', i, [(cloth(i, .075+.008*i), 0, .75), (soft(i), .014, .14)])
    emit('land', i, [(soft(i), 0, .85), (heavy(i), .004, .22+.025*i), (wood(i), .008, .08)])
    emit('clear', i, [(bubble(j+i), j*.042, .65/(1+j*.2)) for j in range(i+1)])
    if i < 2:
        emit('confirm', i, [(wood(i), 0, .45), (soft(i), .055, .65), (bubble(i), .06, .18)])
        emit('cancel', i, [(cloth(i), 0, .5), (wood(i), .02, .25)])

emit('count', 0, [(wood(0), 0, .65), (soft(0), 0, .25)])
emit('go', 0, [(soft(0), 0, .8), (bubble(1), .055, .6)])
emit('over', 0, [(cloth(2, .26), 0, .55), (heavy(1), .1, .6)])
emit('win', 0, [(soft(0), 0, .55), (wood(1), .09, .5), (bubble(0), .15, .5), (bubble(2), .24, .4)])
emit('allClear', 0, [(cloth(1, .18), 0, .5)]+[(bubble(i), i*.055, .6) for i in range(4)])
emit('revive', 0, [(heavy(2), 0, .6), (cloth(2, .23), .04, .8), (bubble(3), .1, .25)])
manifest = {'id': 'foley-play-v1', 'date': '2026-10-22', 'sampleRate': rate,
            'method': 'CC0 recording crops, filtering, layering and fades; no AI audio generation or pitch shifting',
            'sources': used, 'assets': assets}
(args.output_dir / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
# A short listening comparison: rotation x4, landing x4, warning steps, falling and landing garbage.
sequence = [('rotate', i) for i in range(4)]+[('land', i) for i in range(4)]+[('warning', 0), ('warningHeavy', 1), ('garbage', 0), ('garbageLand', 0)]
demo = np.zeros(round(8.1*rate))
for i, (event, variant) in enumerate(sequence):
    x = audio[event][variant]*.8
    start = round((.2+i*.65)*rate)
    demo[start:start+len(x)] += x
with wave.open(str(args.output_dir / 'demo.wav'), 'wb') as out:
    out.setparams((1, 2, rate, 0, 'NONE', 'not compressed')); out.writeframes(np.round(demo*32767).astype('<i2').tobytes())
print(f'{len(assets)} variants; max peak {max(item["peak"] for item in assets):.4f}')
