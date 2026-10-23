"""Extract a user-supplied video's audio for a temporary local skin soundtrack."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from datetime import date

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--input', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--ffmpeg', default='ffmpeg')
args = parser.parse_args()
args.output.parent.mkdir(parents=True, exist_ok=True)
filters = 'loudnorm=I=-20:TP=-2:LRA=9,afade=t=in:d=0.15'
command = [args.ffmpeg, '-hide_banner', '-nostdin', '-y', '-i', str(args.input),
           '-map', '0:a:0', '-vn', '-af', filters, '-ar', '44100', '-ac', '2',
           '-c:a', 'libmp3lame', '-b:a', '160k', '-map_metadata', '-1', str(args.output)]
subprocess.run(command, check=True)
record = {
    'date': str(date.today()), 'source': str(args.input.resolve()),
    'sourceSha256': hashlib.sha256(args.input.read_bytes()).hexdigest(),
    'output': args.output.name, 'outputSha256': hashlib.sha256(args.output.read_bytes()).hexdigest(),
    'tool': subprocess.check_output([args.ffmpeg, '-version'], text=True).splitlines()[0],
    'command': command, 'sourceStatus': 'User supplied local file; origin URL not supplied',
    'review': 'Temporary game assignment; no new listening review implied',
}
args.output.with_suffix('.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
