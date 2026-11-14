#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
RUN=/bulk2/runs/linearcodereview/demo
# Usage: CS_DIST_DIR=<frozen web/dist copy> [NARRATION=narration-b.json] [SKIP_RECORD=1] work/demo/make.sh
export NARRATION="${NARRATION:-$ROOT/narration.json}"
mkdir -p "$RUN" "$RUN/audio" "$RUN/raw"

# The recording instance is disposable and never posts to GitHub.
[ -n "${SKIP_RECORD:-}" ] || bash /home/ubuntu/junction/linearcodereview/work/judge-instance.sh 4318 "${CS_DIST_DIR:?freeze web/dist first and pass CS_DIST_DIR}"

# TTS is the only external call. hsec injects the key without printing it.
hsec exec --only ELEVENLABS_API_KEY -- node "$ROOT/tts.mjs" "$ROOT"

if [ -z "${SKIP_RECORD:-}" ]; then
  rm -f "$RUN/raw.webm"
  CS_URL=http://localhost:4318 bun "$ROOT/record.ts" "$ROOT"
fi

# Browser navigation takes time, but narration starts only once each new page is ready.
# Cut those navigation intervals out so every spoken chapter sits on its own real screen.
python3 - <<'PY'
import json, subprocess
from pathlib import Path
run=Path('/bulk2/runs/linearcodereview/demo')
raw=run/'raw.webm'
cuts=run/'cuts'
cuts.mkdir(exist_ok=True)
for p in cuts.glob('*.mp4'): p.unlink()
marks=json.load(open(run/'record-timings.json'))['marks']
lines=[]
for i,m in enumerate(marks):
    out=cuts/f'{i:02}.mp4'
    subprocess.run(['ffmpeg','-nostdin','-loglevel','error','-y','-i',str(raw),'-ss',str(m['start']),'-t',str(m['duration']),'-an','-c:v','libx264','-preset','fast','-crf','16','-g','15','-pix_fmt','yuv420p','-r','30',str(out)],check=True)
    lines.append(f"file '{out}'")
(run/'cuts.txt').write_text('\n'.join(lines)+'\n')
subprocess.run(['ffmpeg','-nostdin','-loglevel','error','-y','-f','concat','-safe','0','-i',str(run/'cuts.txt'),'-an','-c','copy',str(run/'cut.mp4')],check=True)
print('cut video ready')
PY

python3 - <<'PY'
import json
root='/home/ubuntu/junction/linearcodereview/work/demo'
run='/bulk2/runs/linearcodereview/demo'
import os
spec=json.load(open(os.environ['NARRATION']))
t=0.0
srt=[]
timed=[]
def ts(x):
    h=int(x//3600); m=int((x%3600)//60); s=int(x%60); ms=int(round((x-int(x))*1000))
    if ms==1000: s+=1; ms=0
    return f'{h:02}:{m:02}:{s:02},{ms:03}'
for i,shot in enumerate(spec['shots'],1):
    meta=json.load(open(f"{run}/audio/{i-1:02}-{shot['id']}.json"))
    d=float(meta['dur'])
    caption=shot['text'].replace('. ', '.\\n')
    srt.append(f"{i}\n{ts(t+0.1)} --> {ts(t+d-0.1)}\n{caption}\n")
    timed.append({**shot, 'duration': d, 'chars': meta.get('chars'), 'starts': meta.get('starts')})
    t += d
open(run+'/captions.srt','w').write('\n'.join(srt))
open(run+'/timing.json','w').write(json.dumps({'duration':t,'shots':timed},indent=2))
print(f'narration duration {t:.2f}s')
PY

# Each clip is padded or trimmed to its timed length so the voice never drifts from the picture.
python3 - <<'PY'
import json, subprocess
from pathlib import Path
run=Path('/bulk2/runs/linearcodereview/demo')
t=json.load(open(run/'timing.json'))
lst=[]
for i,s in enumerate(t['shots']):
    src=run/'audio'/f"{i:02}-{s['id']}.mp3"; dst=run/'audio'/f"{i:02}-{s['id']}.wav"
    subprocess.run(['ffmpeg','-nostdin','-loglevel','error','-y','-i',str(src),'-af',f"apad,atrim=0:{s['duration']:.3f}",'-ar','44100','-ac','2',str(dst)],check=True)
    lst.append(f"file '{dst}'")
(run/'voice.txt').write_text('\n'.join(lst)+'\n')
subprocess.run(['ffmpeg','-nostdin','-loglevel','error','-y','-f','concat','-safe','0','-i',str(run/'voice.txt'),'-c:a','pcm_s16le',str(run/'voice.wav')],check=True)
PY
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$RUN/voice.wav")
ffmpeg -nostdin -loglevel error -y -stream_loop -1 -i /home/ubuntu/work/ycagentshack/film/public/audio/sub-music.mp3 -t "$DUR" -af volume=0.16 "$RUN/music.wav"

# The Remotion film reads these symlinks; binaries remain in /bulk2/runs/... as required.
FILM="$ROOT/film"
cp "$RUN/timing.json" "$FILM/timing.json"
ln -sfn "$RUN/voice.wav" "$FILM/public/audio/voice.wav"
ln -sfn "$RUN/music.wav" "$FILM/public/audio/music.wav"
for f in "$RUN"/cuts/*.mp4; do ln -sfn "$f" "$FILM/public/cuts/$(basename "$f")"; done

# What GitHub itself reports for the 92-file pull request (read-only API call), for the opening card.
gh pr view 5 -R toukoursin/junction26-messagepack-csharp --json title,author,additions,deletions,changedFiles,headRefOid,mergeStateStatus,statusCheckRollup,number > "$FILM/gh.json"
gh pr diff 5 -R toukoursin/junction26-messagepack-csharp --name-only > "$RUN/gh-files.txt"
python3 -c "import json;p='$FILM/gh.json';d=json.load(open(p));d['files']=open('$RUN/gh-files.txt').read().split();json.dump(d,open(p,'w'))"
python3 -c "import json;d=json.load(open('$RUN/timing.json'))['duration'];print(f'film length {d:.2f}s');assert d<=114.5,'over 1:55'"
FILM_START=$(date +%s)
(
  cd "$FILM"
  npx remotion render src/index.tsx CountersignFilm "$RUN/countersign-demo.mp4" \
    --codec=h264 --audio-codec=aac --crf=18 --concurrency=24 --pixel-format=yuv420p --overwrite --public-dir "$RUN"
)
FILM_END=$(date +%s)
cp "$RUN/countersign-demo.mp4" "$RUN/countersign-demo-v$(date -u +%Y%m%d-%H%M%S).mp4"
ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate,codec_name -of default=noprint_wrappers=1 "$RUN/countersign-demo.mp4"
echo "rendered $RUN/countersign-demo.mp4 in $((FILM_END-FILM_START))s"
