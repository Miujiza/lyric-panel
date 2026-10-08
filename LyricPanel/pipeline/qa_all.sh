cd "/c/Users/HP/Downloads/AI/Lyric Test"
for d in */; do d="${d%/}"; [ -f "$d/words.json" ] && python LyricPanel/pipeline/qa.py "$d"; done
