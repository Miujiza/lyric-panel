"""Builds the v2 result for every benchmark song from the runs that already exist (song folder = small, small-opts, medium)."""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__)); SONGS = r"C:\Users\HP\Downloads\Lyrics\Rock Tunes"
for s in sorted(set(k["song"] for k in json.load(open(os.path.join(HERE, "key.json"))))):
    out = os.path.join(HERE, "out", "v2", s); os.makedirs(out, exist_ok=True)
    r = subprocess.run([sys.executable, os.path.join(HERE, "combine.py"), out, os.path.join(SONGS, s, "lyrics.txt"), os.path.join(SONGS, s),
                        os.path.join(HERE, "out", "small-opts", s), os.path.join(HERE, "out", "medium", s)], capture_output=True, text=True, encoding="utf-8", errors="replace")
    print(s[:36].ljust(36), (r.stdout.strip() or r.stderr.strip()[-200:]))
