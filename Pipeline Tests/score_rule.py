"""Scores variants with and without the stretched-first-word rule (first word > 1.0 s -> start 0.35 s before its end).
usage: python score_rule.py baseline medium ...   Only songs every listed variant has finished are counted."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
SONGS = r"C:\Users\HP\Downloads\Lyrics\Rock Tunes"
LEAD = 6 * 1001 / 24000
key = json.load(open(os.path.join(HERE, "key.json")))
vs = sys.argv[1:]
def path(v, s): return os.path.join(SONGS if v == "baseline" else os.path.join(HERE, "out", v), s, "words.json")
songs = [s for s in sorted(set(k["song"] for k in key)) if all(os.path.exists(path(v, s)) for v in vs)]
print(f"songs counted: {len(songs)} of 16")
for v in vs:
    plain, ruled, moved_p, moved_r, n_moved = [], [], 0, 0, 0
    for s in songs:
        w = json.load(open(path(v, s)))
        for k in key:
            if k["song"] != s: continue
            a, e, t = w[k["widx"]][1], w[k["widx"]][2], k["truth"] + LEAD
            r = e - 0.35 if e - a > 1.0 else a
            plain.append(abs(a - t)); ruled.append(abs(r - t))
            if abs(k["orig"] - k["truth"]) > 0.065:
                n_moved += 1; moved_p += abs(a - t) <= 0.3; moved_r += abs(r - t) <= 0.3
    f = lambda e, x: f"{100 * sum(y <= x for y in e) / len(e):3.0f}%"
    for name, e, m in ((v, plain, moved_p), (v + " + rule", ruled, moved_r)):
        print(f"{name:24} n={len(e):3d}  <0.2s {f(e, .2)}  <0.3s {f(e, .3)}  <0.5s {f(e, .5)}  >1s {sum(y > 1 for y in e):3d}  >2s {sum(y > 2 for y in e):3d} | of the {n_moved} lyrics you moved, within 0.3s: {m}")
