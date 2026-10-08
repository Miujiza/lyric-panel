"""Scores pipeline output against the user's hand-corrected SRTs.

usage: python score.py baseline [variant ...]

key.json holds, for every lyric the user's corrected SRT starts with, the index of its first word and the
corrected start time. A variant's words.json gives that word's sung time; the caption would start LEAD earlier.
"baseline" reads the words.json in the song folders (what the corrected SRTs were made from), so its tight
scores are flattering: an untouched lyric counts as exact. Compare variants on the 0.3 s and 0.5 s columns.
"""
import json, os, sys, statistics as st

HERE = os.path.dirname(os.path.abspath(__file__))
SONGS = r"C:\Users\HP\Downloads\Lyrics\Rock Tunes"
LEAD = 6 * 1001 / 24000
key = json.load(open(os.path.join(HERE, "key.json")))
songs = sorted(set(k["song"] for k in key))


def load(variant, song):
    d = os.path.join(SONGS, song) if variant == "baseline" else os.path.join(HERE, "out", variant, song)
    try:
        return json.load(open(os.path.join(d, "words.json")))
    except Exception:
        return None


def row(name, errs):
    a = [abs(e) for e in errs]
    n = len(a)
    if not n:
        return f"{name[:30]:30}  no result"
    p = lambda t: 100 * sum(x <= t for x in a) / n
    return (f"{name[:30]:30} {n:4d}  {p(0.1):4.0f}% {p(0.2):4.0f}% {p(0.3):4.0f}% {p(0.5):4.0f}%   {sum(x > 1 for x in a):3d}   {sum(x > 2 for x in a):3d}"
            f"   {st.mean(sorted(a)[:max(1, int(n * 0.9))]):5.2f}  {st.median(errs):+5.2f}")


for variant in sys.argv[1:] or ["baseline"]:
    print(f"\n== {variant} ==\n{'song':30} {'n':>4}  <0.1s <0.2s <0.3s <0.5s   >1s   >2s  mean90  bias")
    total = []
    for s in songs:
        ks = [k for k in key if k["song"] == s]
        w = load(variant, s)
        if w is None or max(k["widx"] for k in ks) >= len(w):
            print(f"{s[:30]:30}  missing or word count differs")
            continue
        errs = [w[k["widx"]][1] - LEAD - k["truth"] for k in ks]
        total += errs
        print(row(s, errs))
    print(row("ALL", total))
