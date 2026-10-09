"""Test pipeline v2, step 2: combine several alignment runs of one song into one SRT plus a review list.

usage: python combine.py <out dir> <lyrics.txt> <run dir> <run dir> [<run dir> ...]

Each run dir holds a words.json written by the pipeline for the same lyrics. For every lyric line the start is the
middle value of the runs' starts, after the stretched-first-word rule (a first word longer than 1 s starts 0.35 s
before its end). Captions are then built exactly as pipeline.py builds them. Writes into <out dir>:
  captions.srt   the timed lyrics
  words.json     the combined word times
  review.json    per caption: its times, whether the runs disagreed (check it), and the other starts they proposed
"""
import json, os, re, statistics as st, sys

FPS = 24000 / 1001
FR = 1 / FPS
LEAD, GAP, MAXHOLD, TAIL = 6 * FR, 11 * FR, 4.0, 1.4
ROW, PAIR_GAP = 46, 2.0
KEEP_ADLIBS = ("intro",)
HOMOGLYPHS = {"е": "e", "о": "o", "а": "a", "с": "c", "р": "p", "х": "x", "і": "i", "у": "y"}
STRETCH, BACK = 1.0, 0.35            # the stretched-first-word rule
DISAGREE = 0.3                       # runs further apart than this -> the caption is marked for a check

out_dir, lyr, run_dirs = sys.argv[1], sys.argv[2], sys.argv[3:]


def clean(t, adlibs=False):
    t = "".join(HOMOGLYPHS.get(c, c) for c in t)
    t = t.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    t = re.sub(r"\(([^)]*)\)", lambda m: " " + m.group(1) + " " if adlibs or len(m.group(1).split()) > 1 else " ", t)
    return re.sub(r"\s+", " ", t).strip()


# same line and section reading as pipeline.py
lines, sect, adl, junk, si = [], [], False, False, -1
for raw in open(lyr, encoding="utf-8").read().splitlines():
    raw = raw.strip()
    m = re.fullmatch(r"\[(.*)\]", raw)
    if m:
        junk = False
        si += 1
        adl = m.group(1).lower().startswith(KEEP_ADLIBS)
        continue
    if re.fullmatch(r"you might also like\W*", raw, re.I):
        junk = True
        continue
    if junk and not raw:
        junk = False
    if junk or not raw:
        continue
    c = clean(raw, adl)
    if re.search(r"[A-Za-z]", c):
        lines.append(c)
        sect.append(si)

need = sum(len(l.split()) for l in lines)
runs = []
for d in run_dirs:
    w = json.load(open(os.path.join(d, "words.json")))
    if len(w) != need:
        print(f"skipping {d}: {len(w)} words, lyrics have {need}")
        continue
    runs.append(w)
if not runs:
    raise SystemExit("no usable runs")


class W:
    def __init__(self, word, start, end):
        self.word, self.start, self.end = word, start, end


lw, line_info, pos = [], [], 0
for l in lines:
    n = len(l.split())
    firsts = [(r[pos][1], r[pos][2]) for r in runs]
    ruled = [e - BACK if e - a > STRETCH else a for a, e in firsts]
    chosen = st.median(ruled)
    rep = min(range(len(runs)), key=lambda q: abs(ruled[q] - chosen))
    ws = [W(x[0], float(x[1]), float(x[2])) for x in runs[rep][pos:pos + n]]
    ws[0].start = chosen
    for x in ws[1:]:
        x.start = max(x.start, chosen)
        x.end = max(x.end, x.start + 0.02)
    if ws[0].end < chosen + 0.05:
        ws[0].end = min(ws[1].start, chosen + 0.3) if n > 1 and ws[1].start > chosen + 0.05 else chosen + 0.3
    ws[-1].end = max(st.median(r[pos + n - 1][2] for r in runs), ws[-1].start + 0.05)
    cands = []
    for c in sorted([a for a, e in firsts] + [e - BACK for a, e in firsts if e - a > STRETCH]):
        if cands and c - cands[-1][-1] <= 0.1:
            cands[-1].append(c)
        else:
            cands.append([c])
    line_info.append(dict(spread=max(ruled) - min(ruled), cands=[sum(c) / len(c) for c in cands], chosen=chosen))
    lw.append(ws)
    pos += n
json.dump([[w.word, w.start, w.end, None] for ws in lw for w in ws], open(os.path.join(out_dir, "words.json"), "w"))


def rows(t):
    if len(t) <= ROW:
        return [t]
    sp = [m.start() for m in re.finditer(" ", t)]
    k = min(sp, key=lambda p: abs(p - len(t) / 2))
    return [t[:k], t[k + 1:]]


# units, pairing and timing: unchanged from pipeline.py
units = []
for k, l in enumerate(lines):
    ws = lw[k]
    if len(l) <= 2 * ROW:
        units.append(dict(text=l, ws=ws, line=k, head=True))
        continue
    parts, cur = [], []
    for w in ws:
        cur.append(w)
        if len(" ".join(x.word.strip() for x in cur)) >= 2 * ROW * 0.6:
            parts.append(cur); cur = []
    if cur:
        if parts and len(" ".join(x.word.strip() for x in cur)) < 12:
            parts[-1] += cur
        else:
            parts.append(cur)
    for q, p in enumerate(parts):
        units.append(dict(text=" ".join(x.word.strip() for x in p), ws=p, line=k, head=q == 0))

caps, i = [], 0
while i < len(units):
    u = units[i]
    if (i + 1 < len(units) and len(u["text"]) <= ROW and len(units[i + 1]["text"]) <= ROW
            and sect[u["line"]] == sect[units[i + 1]["line"]]
            and units[i + 1]["ws"][0].start - u["ws"][-1].end <= PAIR_GAP):
        caps.append([u["ws"][0].start, units[i + 1]["ws"][-1].end, rows(u["text"]) + rows(units[i + 1]["text"]), u])
        i += 2
    else:
        caps.append([u["ws"][0].start, u["ws"][-1].end, rows(u["text"]), u])
        i += 1
for c in caps:
    c[0] -= LEAD
for n, c in enumerate(caps):
    last = c[1]
    if n + 1 < len(caps):
        nxt = caps[n + 1][0]
        e = min(nxt - GAP, last + MAXHOLD)
        if e < last:
            e = min(last, nxt - 0.08)
        c[1] = max(e, c[0] + 0.3)
    else:
        c[1] = last + TAIL


def snap(s):
    return max(round(s * FPS) / FPS, 0)


def ts(s):
    ms = int(round(snap(s) * 1000)); return f"{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}"


review = []
with open(os.path.join(out_dir, "captions.srt"), "w", encoding="utf-8") as f:
    for n, (s, e, tx, u) in enumerate(caps, 1):
        f.write(f"{n}\n{ts(s)} --> {ts(e)}\n" + "\n".join(tx) + "\n\n")
        info = line_info[u["line"]] if u["head"] else None      # a piece cut from the middle of a long line has no alternatives
        alts = sorted(set(round(snap(c - LEAD), 3) for c in info["cands"])) if info else []
        alts = [a for a in alts if abs(a - snap(s)) > 0.06]
        review.append(dict(n=n, start=round(snap(s), 3), end=round(snap(e), 3), check=bool(info and info["spread"] > DISAGREE),
                           spread=round(info["spread"], 2) if info else 0.0, alternatives=alts))
json.dump(dict(runs=len(runs), captions=review), open(os.path.join(out_dir, "review.json"), "w"), indent=1)
print(f"{len(caps)} captions from {len(runs)} runs; {sum(r['check'] for r in review)} marked to check, {sum(bool(r['alternatives']) for r in review)} have an alternative start")
