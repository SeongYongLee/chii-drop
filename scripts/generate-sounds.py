"""Original, deterministic PCM sound design. Python standard library only."""
import array
import json
import math
from pathlib import Path
import random
import wave

RATE = 44100
ROOT = Path(__file__).resolve().parent.parent / 'sounds' / 'soft-pop-v1'
TAU = math.tau


def note(n):
    return 440 * 2 ** ((n - 69) / 12)


def empty(seconds):
    return [0.0] * round(seconds * RATE)


def bell(out, pitch, start=0, duration=.18, level=.3, end=None, kind='bell'):
    """Integrated pitch glide with a zero-ended envelope prevents clicks."""
    phase = 0.0
    for i in range(round(duration * RATE)):
        t = i / RATE
        u = t / duration
        freq = pitch if end is None else pitch * (end / pitch) ** u
        phase += TAU * freq / RATE
        attack = min(1, t / .004)
        release = min(1, (duration - t) / .012)
        env = attack * release * math.exp(-5 * u)
        if kind == 'wood':
            sample = .75 * math.sin(phase) + .2 * math.sin(phase * 2.73) * math.exp(-12 * u)
        elif kind == 'round':
            sample = math.sin(phase) + .08 * math.sin(2 * phase)
        else:
            sample = math.sin(phase) + .24 * math.sin(2 * phase) * math.exp(-5 * u) + .07 * math.sin(3.98 * phase) * math.exp(-10 * u)
        index = round(start * RATE) + i
        if index < len(out):
            out[index] += level * env * sample


def rustle(out, start=0, duration=.2, level=.2, seed=1):
    rng = random.Random(seed)
    smooth = 0
    for i in range(round(duration * RATE)):
        u = i / (duration * RATE)
        smooth += .12 * (rng.uniform(-1, 1) - smooth)
        env = min(1, i / (RATE * .005)) * (1 - u) ** 3
        index = round(start * RATE) + i
        if index < len(out):
            out[index] += smooth * env * level


def write(name, samples, stereo=False):
    # Fixed headroom, no loudness normalization of intentionally quiet controls.
    peak = max(abs(x) for x in samples) or 1
    scale = min(1, .78 / peak)
    pcm = array.array('h', (round(max(-1, min(1, x * scale)) * 32767) for x in samples))
    import sys
    if sys.byteorder != 'little':
        pcm.byteswap()
    with wave.open(str(ROOT / (name + '.wav')), 'wb') as f:
        f.setnchannels(2 if stereo else 1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(pcm.tobytes())
    return {'file': name + '.wav', 'seconds': round(len(samples) / RATE / (2 if stereo else 1), 3), 'peak': round(peak * scale, 4)}


def build():
    ROOT.mkdir(parents=True, exist_ok=True)
    assets = []
    def save(key, label, out, **meta):
        assets.append({'id': key, 'name': label, **write(key, out), **meta})
    out = empty(.10); bell(out, 720, duration=.075, level=.13, end=560, kind='wood'); save('move', '이동 · 작은 나무 톡', out)
    out = empty(.16); bell(out, 630, duration=.12, level=.2, end=1080, kind='round'); save('rotate', '회전 · 물방울 휙', out)
    out = empty(.22); bell(out, 210, duration=.17, level=.35, end=100, kind='round'); bell(out, 510, duration=.055, level=.08, kind='wood'); save('lock', '착지 · 말랑한 통', out)
    steps = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]
    for chain, step in enumerate(steps, 1):
        out = empty(.44)
        for j, interval in enumerate([0, 7, 12]):
            bell(out, note(67 + step + interval), start=j * .055, duration=.27, level=.18)
        bell(out, note(55 + step), duration=.13, level=.12, kind='round')
        save(f'clear-{chain:02}', f'{chain}연쇄 · 반짝이는 팝', out, event='clear', chain=chain)
    out = empty(.36); bell(out, 330, duration=.26, level=.25, end=1320, kind='round'); bell(out, 1568, start=.18, duration=.13, level=.15); save('attack', '공격 · 올라가는 반짝임', out)
    out = empty(.32)
    for j, pitch in enumerate([1175, 880, 1175]): bell(out, pitch, start=j*.055, duration=.16, level=.16, kind='round')
    save('offset', '상쇄 · 부드러운 맞부딪힘', out)
    out = empty(.4); rustle(out, duration=.3, level=.6, seed=27)
    for j, pitch in enumerate([180, 140, 110]): bell(out, pitch, start=j*.045, duration=.2, level=.2, end=pitch*.7, kind='wood')
    save('garbage', '방해 블록 · 자갈 토독', out)
    out = empty(.95)
    for j, n in enumerate([72, 69, 65, 60]): bell(out, note(n), start=j*.16, duration=.4, level=.24, kind='round')
    save('over', '패배 · 조용한 내려감', out)
    out = empty(1.15)
    for j, n in enumerate([72, 76, 79, 84, 88]): bell(out, note(n), start=j*.12, duration=.5, level=.2)
    for n in [60, 64, 67]: bell(out, note(n), start=.48, duration=.6, level=.1)
    save('win', '승리 · 작은 축하 종', out)
    out = empty(.09); bell(out, 1046, duration=.065, level=.12, kind='wood'); save('cursor', '메뉴 이동 · 틱', out)
    out = empty(.3)
    for j,n in enumerate([79,84]): bell(out,note(n),start=j*.065,duration=.2,level=.2)
    save('confirm','결정 · 딩동',out)
    out = empty(.2); bell(out,note(74),duration=.15,level=.18,end=note(67),kind='round'); save('cancel','취소 · 또록',out)
    out = empty(.22); bell(out,note(76),duration=.17,level=.23,kind='round'); save('count','카운트다운 · 동',out)
    out = empty(.5)
    for n in [79,84]: bell(out,note(n),duration=.38,level=.17)
    save('go','시작 · 맑은 신호',out)
    # Original 16-bar phrase at 120 BPM: 32 seconds, ending resolves into its start.
    length = 32
    left, right = empty(length), empty(length)
    chords = [[60,64,67],[57,60,64],[53,57,60],[55,59,62]] * 4
    melody = [[76,79,81,79],[76,72,74,76],[77,76,72,69],[71,74,79,74],
              [79,81,84,81],[79,76,72,76],[77,81,79,77],[74,71,67,71],
              [76,79,84,79],[81,79,76,72],[77,76,74,72],[71,74,79,81],
              [84,81,79,76],[79,76,72,69],[72,77,76,74],[71,74,67,71]]
    for bar, chord in enumerate(chords):
        start = bar * 2
        for beat in range(4):
            bass = note(chord[0]-12 if beat%2==0 else chord[2]-12)
            for channel in [left,right]: bell(channel,bass,start+beat*.5,.35,.10,kind='round')
        for step in range(8):
            n = chord[step%3]+12
            bell(left,note(n),start+step*.25,.22,.055)
            bell(right,note(n),start+step*.25+.018,.22,.045)
        for beat,n in enumerate(melody[bar]):
            bell(left,note(n),start+beat*.5,.34,.10)
            bell(right,note(n),start+beat*.5+.012,.34,.095)
    stereo = [sample for pair in zip(left,right) for sample in pair]
    assets.append({'id':'meadow-loop','name':'작은 산책 · 오리지널 배경음악','loop':True, 'bpm':120, **write('meadow-loop',stereo,True)})
    manifest = {'id':'soft-pop-v1','sampleRate':RATE,'format':'PCM signed 16-bit WAV','assets':assets}
    (ROOT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(f'Generated {len(assets)} original sound files in {ROOT}')


if __name__ == '__main__':
    build()
