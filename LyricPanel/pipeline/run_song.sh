#!/bin/bash
# usage: run_song.sh <song_dir> <audio file> <lyrics.txt>   -> timed stages, writes captions.srt + review in <song_dir>
PD="$(cd "$(dirname "$0")" && pwd)"; D="$1"; A="$2"; L="$3"; LG="${4:-en}"
export PATH="$PATH:/c/ffmpeg/bin"; export FFMPEG=/c/ffmpeg/bin/ffmpeg
cd "$D" || exit 1
T0=$(date +%s)
cp "$A" song.mp3
T1=$(date +%s)
python -m demucs --two-stems=vocals -n htdemucs -o sep song.mp3 > demucs.log 2>&1 || { echo "demucs failed"; exit 1; }
cp sep/htdemucs/song/vocals.wav vocals.wav
T2=$(date +%s)
python "$PD/pipeline.py" . "$L" small "$LG" > pipeline.log 2>&1 || { echo "pipeline failed"; tail -5 pipeline.log; exit 1; }
T3=$(date +%s)
echo "TIMING copy=$((T1-T0))s  vocal_separation=$((T2-T1))s  alignment_repair_srt=$((T3-T2))s  TOTAL=$((T3-T0))s"
grep -v "Align:\|Adjust\|Warn\|warn\|result =" pipeline.log
