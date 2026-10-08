"""Combines several finished variants per lyric (median of their starts, each with the stretched-first-word rule)
and checks whether their agreement predicts which lyrics are right.  usage: python ensemble_test.py v1 v2 v3 ..."""
import json, os, sys, statistics as st
HERE = os.path.dirname(os.path.abspath(__file__))
SONGS = r"C:\Users\HP\Downloads\Lyrics\Rock Tunes"
LEAD = 6 * 1001 / 24000
key = json.load(open(os.path.join(HERE, "key.json")))
vs = sys.argv[1:]
def path(v, s): return os.path.join(SONGS if v == "baseline" else os.path.join(HERE, "out", v), s, "words.json")
songs = [s for s in sorted(set(k["song"] for k in key)) if all(os.path.exists(path(v, s)) for v in vs)]
W = {(v, s): json.load(open(path(v, s))) for v in vs for s in songs}
rows = []
for k in key:
    if k["song"] not in songs: continue
    c = []
    for v in vs:
        a, e = W[(v, k["song"])][k["widx"]][1:3]
        c.append(e - 0.35 if e - a > 1.0 else a)
    rows.append(dict(t=k["truth"] + LEAD, c=c, moved=abs(k["orig"] - k["truth"]) > 0.065))
def show(name, pick, rs=rows):
    e = [abs(pick(r) - r["t"]) for r in rs]; mv = [r for r in rs if r["moved"]]
    print(f"{name:34} n={len(e):3d}  <0.3s {100*sum(x<=.3 for x in e)/len(e):3.0f}%  <0.5s {100*sum(x<=.5 for x in e)/len(e):3.0f}%  >1s {sum(x>1 for x in e):3d}  >2s {sum(x>2 for x in e):3d} | moved lyrics within 0.3s: {sum(abs(pick(r)-r['t'])<=.3 for r in mv)} of {len(mv)}")
print("songs:", len(songs))
for i, v in enumerate(vs): show(v + " + rule", lambda r, i=i: r["c"][i])
show("median of all", lambda r: st.median(r["c"]))
show("earliest of all", lambda r: min(r["c"]))
show("latest of all", lambda r: max(r["c"]))
print("\nagreement as a warning light (spread = latest minus earliest start among the variants):")
for lo, hi in [(0, .15), (.15, .3), (.3, .6), (.6, 1.5), (1.5, 999)]:
    rs = [r for r in rows if lo <= max(r["c"]) - min(r["c"]) < hi]
    if rs:
        bad = sum(abs(st.median(r["c"]) - r["t"]) > 0.3 for r in rs)
        print(f"  spread {lo:4.2f}-{hi:<6.2f}: {len(rs):3d} lyrics, median start more than 0.3s off in {bad:3d} ({100*bad/len(rs):3.0f}%), more than 1s off in {sum(abs(st.median(r['c']) - r['t']) > 1 for r in rs):3d}")
