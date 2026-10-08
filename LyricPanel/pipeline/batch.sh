#!/bin/bash
# runs all song folders (top level) that have lyrics.txt; Spanish
ROOT="${1:-/c/Users/HP/Downloads/AI/Lyric Test}"; LANGC="${2:-es}"
cd "$ROOT" || exit 1
B0=$(date +%s)
for d in */; do
  d="${d%/}"; [ "$d" = "LyricPanel" ] && continue
  [ -s "$d/lyrics.txt" ] && [ ! -f "$d/$d.srt" ] || { echo "SKIP $d (no lyrics)"; continue; }
  mp3=$(ls "$d"/*.mp3 | head -1); mp3="$(basename "$mp3")"
  echo "=== START $d $(date +%T)"
  bash "$(dirname "$0")/run_song.sh" "$ROOT/$d" "$mp3" lyrics.txt "$LANGC" > "$d/run.log" 2>&1
  if [ -f "$d/captions.srt" ]; then
    python -c "
import sys
s=open(sys.argv[1],encoding='utf-8-sig').read().replace('\r\n','\n').replace('\n','\r\n')
open(sys.argv[2],'w',encoding='utf-8-sig',newline='').write(s)" "$d/captions.srt" "$d/$d.srt"
    echo "=== DONE $d $(date +%T)"
  else
    echo "=== FAIL $d"
  fi
done
echo "BATCH TOTAL $(( $(date +%s)-B0 ))s"
