"""Lyric timing pipeline: vocals.wav + lyrics.txt -> timed SRT.

usage: python pipeline.py <song_dir> <lyrics.txt> [model]
<song_dir> must contain vocals.wav; writes captions.srt, words.json, report.txt there.
"""
import re, json, sys, unicodedata, statistics as st
import stable_whisper

FPS = 24000 / 1001                                    # timeline frame rate (23.976)
FR = 1 / FPS
LEAD, GAP, MAXHOLD, TAIL = 6 * FR, 11 * FR, 4.0, 1.4   # 6-frame lead (Premiere fade-in); 11-frame gap measured from a finished video
ROW, PAIR_GAP = 46, 2.0                              # chars per row; max pause to still pair two lines
SKIP_SECTIONS = ()                                   # sections to leave out entirely
KEEP_ADLIBS = ("intro",)                             # sections where (bracketed) ad-libs are the content
HOMOGLYPHS = {"е": "e", "о": "o", "а": "a", "с": "c", "р": "p",
              "х": "x", "і": "i", "у": "y"}

song, lyr = sys.argv[1], sys.argv[2]
MODEL = sys.argv[3] if len(sys.argv) > 3 else "small"
LANG = sys.argv[4] if len(sys.argv) > 4 else "en"     # whisper language code, e.g. en, es


def clean(t, adlibs=False):
    t = "".join(HOMOGLYPHS.get(c, c) for c in t)
    t = t.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    # (bracketed) background words: a single word is dropped, two or more words are kept
    t = re.sub(r"\(([^)]*)\)", lambda m: " " + m.group(1) + " " if adlibs or len(m.group(1).split()) > 1 else " ", t)
    return re.sub(r"\s+", " ", t).strip()


lines, sect, skip, adl, junk = [], [], False, False, False                     # lines: text ; sect: section index
si = -1
for raw in open(lyr, encoding="utf-8").read().splitlines():
    raw = raw.strip()
    m = re.fullmatch(r"\[(.*)\]", raw)
    if m:
        junk = False
        si += 1
        skip = bool(SKIP_SECTIONS) and m.group(1).lower().startswith(SKIP_SECTIONS)
        adl = m.group(1).lower().startswith(KEEP_ADLIBS)
        continue
    if re.fullmatch(r"you might also like\W*", raw, re.I):   # Genius recommendation box: junk until the next header
        junk = True
        continue
    if junk and not raw:
        junk = False
    if skip or junk or not raw:
        continue
    c = clean(raw, adl)
    if re.search(r"[A-Za-z]", c):
        lines.append(c)
        sect.append(si)

import subprocess, os, tempfile
from difflib import SequenceMatcher
FF = os.environ.get("FFMPEG", "ffmpeg")
_d, _b = os.path.split(FF)
FFPROBE = os.path.join(_d, _b.replace("ffmpeg", "ffprobe"))
model = stable_whisper.load_model(MODEL, device="cpu")
chunks = []                                            # 1-2 word lines join the previous line for context
for k, l in enumerate(lines):
    if chunks and len(l.split()) <= 2:                  # may continue a line from the previous section (e.g. a refrain)
        chunks[-1].append(k)
    else:
        chunks.append([k])
ctext = lambda c: " ".join(lines[k] for k in c)
norm = lambda w: re.sub(r"[^a-z']", "", unicodedata.normalize("NFKD", w.lower()).encode("ascii", "ignore").decode())
dur = float(subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f"{song}/vocals.wav"],
                           capture_output=True, text=True).stdout)

# 0) plain alignment of the whole lyric first; keep it when it looks healthy (works best on non-repetitive songs)
need = sum(len(l.split()) for l in lines)
tw, keep, gidx = [], [], []
res0 = model.align(f"{song}/vocals.wav", chr(10).join(ctext(c) for c in chunks), language=LANG, original_split=True)
words0 = res0.all_words()
use_plain = False
if len(words0) == need:
    lw0, i0 = [], 0
    for l in lines:
        n0 = len(l.split()); lw0.append(words0[i0:i0 + n0]); i0 += n0
    def _bad(k):
        ws = lw0[k]
        col = any(w.end - w.start < 0.15 and (getattr(w, "probability", 0) or 0) < 0.3 for w in ws)
        short = len(ws) >= 3 and (ws[-1].end - ws[0].start) < 0.12 * len(ws)
        over = k + 1 < len(lw0) and ws[-1].end > lw0[k + 1][0].start + 0.05
        return col or short or over
    nbad = sum(_bad(k) for k in range(len(lines)))
    use_plain = nbad <= max(1, 0.15 * len(lines))
    print(f"plain alignment: {nbad} of {len(lines)} lines look broken -> {'keeping it' if use_plain else 'switching to anchored windows'}")
if use_plain:
    words = words0
else:
    # 1) free transcription (cached): where singing happens and roughly which words
    cache = f"{song}/free.json"
    if os.path.exists(cache):
        tw = json.load(open(cache))
    else:
        tr = model.transcribe(f"{song}/vocals.wav", language=LANG, word_timestamps=True, condition_on_previous_text=False)
        tw = [[norm(w.word), w.start, w.end] for w in tr.all_words() if norm(w.word)]
        json.dump(tw, open(cache, "w"))

    # 2) match lyric words to transcript words -> anchored chunks with a rough time range
    lt, owner, gidx, gi = [], [], [], 0
    for ci, c in enumerate(chunks):
        for t in ctext(c).split():
            if norm(t):
                lt.append(norm(t)); owner.append(ci); gidx.append(gi)
            gi += 1
    from functools import lru_cache


    @lru_cache(maxsize=None)
    def same(x, y):
        return x == y or (len(x) > 3 and len(y) > 3 and SequenceMatcher(None, x, y).ratio() >= 0.8)


    tt = [t[0] for t in tw]
    n1, m1 = len(lt), len(tt)
    dp = [[0] * (m1 + 1) for _ in range(n1 + 1)]              # exact longest-common-subsequence, in order
    for x in range(n1 - 1, -1, -1):
        for y in range(m1 - 1, -1, -1):
            dp[x][y] = dp[x + 1][y + 1] + 1 if same(lt[x], tt[y]) else max(dp[x + 1][y], dp[x][y + 1])
    pairs, x, y = [], 0, 0
    while x < n1 and y < m1:
        if same(lt[x], tt[y]) and dp[x][y] == dp[x + 1][y + 1] + 1:
            pairs.append((x, y)); x += 1; y += 1
        elif dp[x + 1][y] >= dp[x][y + 1]:
            x += 1
        else:
            y += 1
    ps = set(pairs)                                           # keep only matches inside runs of 3+ consecutive words
    keep = [p for p in pairs if sum(((p[0] + d, p[1] + d) in ps) for d in (-2, -1, 1, 2)) >= 2
            and ((p[0] - 1, p[1] - 1) in ps or (p[0] + 1, p[1] + 1) in ps)]
    hits = {}
    for x, y in keep:
        hits.setdefault(owner[x], []).append((tw[y][1], tw[y][2]))
    anch = {}
    for ci, c in enumerate(chunks):
        h = hits.get(ci, [])
        if len(h) >= max(3, 0.5 * len(ctext(c).split())):
            anch[ci] = (min(x[0] for x in h), max(x[1] for x in h))


    def align_window(cis, t0, t1):
        """forced-align the chunks cis inside audio [t0, t1]; returns one word list per chunk (absolute times)"""
        n_words = [len(ctext(chunks[c]).split()) for c in cis]
        tmp = os.path.join(tempfile.gettempdir(), f"win_{cis[0]}_{cis[-1]}.wav")
        subprocess.run([FF, "-loglevel", "error", "-y", "-ss", str(t0), "-t", str(t1 - t0), "-i", f"{song}/vocals.wav", tmp])
        r = model.align(tmp, chr(10).join(ctext(chunks[c]) for c in cis), language=LANG, original_split=True)
        w = [x for x in r.all_words() if re.search(r"[A-Za-z0-9]", x.word)]
        if len(w) != sum(n_words):                                  # aligner split/merged a token: spread evenly, log it
            print(f"WARN word count {len(w)} != {sum(n_words)} for chunks {cis}: spread evenly over {t0:.1f}-{t1:.1f}s")
            src = [x for c in cis for x in ctext(chunks[c]).split()]
            w = [type("W", (), dict(word=t, start=t0 + (t1 - t0) * q / len(src), end=t0 + (t1 - t0) * (q + 1) / len(src), probability=0.0))
                 for q, t in enumerate(src)]
            out, pos = [], 0
            for n in n_words:
                out.append(w[pos:pos + n]); pos += n
            return out
        for x in w:
            x.start += t0; x.end += t0
        out, pos = [], 0
        for n in n_words:
            out.append(w[pos:pos + n]); pos += n
        return out


    # 3) align each anchored chunk in its own window; unanchored runs in the gap between their anchored neighbours
    words, i = [], 0
    prev_end = lambda i: max([anch[j][1] for j in anch if j < i], default=0.0)
    next_start = lambda i: min([anch[j][0] for j in anch if j > i], default=dur)
    while i < len(chunks):
        if i in anch:
            cis = [i]
            t0 = max(anch[i][0] - 1.5, prev_end(i) - 0.2, 0); t1 = min(anch[i][1] + 1.5, next_start(i) + 0.2, dur)
        else:
            j = i
            while j + 1 < len(chunks) and (j + 1) not in anch:
                j += 1
            cis = list(range(i, j + 1)); t0, t1 = prev_end(i), next_start(j)
        if t1 - t0 < 0.6:
            t0, t1 = max(0, t0 - 0.5), min(dur, t1 + 0.5)
        for wl in align_window(cis, t0, t1):
            words += wl
        i = cis[-1] + 1
    need = sum(len(l.split()) for l in lines)
    assert len(words) == need, (len(words), need)
    print("anchored chunks", len(anch), "of", len(chunks))

lw, i = [], 0
for l in lines:
    n = len(l.split())
    lw.append(words[i:i + n])
    i += n




def collapsed(ws):
    return sum(1 for w in ws if w.end - w.start < 0.15 and (getattr(w, "probability", 0) or 0) < 0.3)


def is_bad(k):
    ws = lw[k]
    if collapsed(ws) >= 1 or (ws[-1].end - ws[0].start) < 0.12 * len(ws):
        return True
    return k + 1 < len(lw) and ws[-1].end > lw[k + 1][0].start + 0.05      # overlaps the next line


# repair pass: each run of bad lines is re-aligned alone, in the audio between the nearest good lines
repaired = []
for rnd in range(1):
    bad = [is_bad(k) for k in range(len(lw))]
    runs, k = [], 0
    while k < len(lw):
        if bad[k]:
            j = k
            while j + 1 < len(lw) and bad[j + 1]:
                j += 1
            runs.append([k, j]); k = j + 1
        else:
            k += 1
    if not runs:
        break
    changed = False
    for a0, b0 in runs:
        if b0 - a0 > 5:
            continue
        nw = lambda a, b: sum(len(lines[i].split()) for i in range(a, b + 1))
        a1, b1 = a0, b0
        def win(a, b):
            t0 = lw[a - 1][-1].end if a > 0 else max(0, lw[a][0].start - 2)
            t1 = lw[b + 1][0].start if b + 1 < len(lw) else lw[b][-1].end + 4
            return t0, t1
        t0, t1 = win(a1, b1)
        while t1 - t0 < 0.3 * nw(a1, b1) and (a1 > 0 or b1 + 1 < len(lw)):      # too little room: borrow a neighbour
            if a1 > 0: a1 -= 1
            elif b1 + 1 < len(lw): b1 += 1
            t0, t1 = win(a1, b1)
        if t1 - t0 < 0.5:
            continue
        tmp = os.path.join(tempfile.gettempdir(), f"repair_{a1}_{b1}.wav")
        subprocess.run([FF, "-loglevel", "error", "-y", "-ss", str(t0), "-t", str(t1 - t0), "-i", f"{song}/vocals.wav", tmp])
        r2 = model.align(tmp, chr(10).join(lines[i] for i in range(a1, b1 + 1)), language=LANG, original_split=True)
        w2 = r2.all_words()
        old = sum(collapsed(lw[i]) for i in range(a1, b1 + 1))
        if len(w2) == nw(a1, b1) and sum(collapsed(w2[x:x + 0]) for x in range(0)) == 0:
            pos, new_lw = 0, []
            for i in range(a1, b1 + 1):
                n = len(lines[i].split()); new_lw.append(w2[pos:pos + n]); pos += n
            if old > 0 and sum(collapsed(x) for x in new_lw) < old:
                for i, x in zip(range(a1, b1 + 1), new_lw):
                    for p, q in zip(lw[i], x):
                        p.start, p.end, p.probability = q.start + t0, q.end + t0, q.probability
                repaired.append((a1, b1)); changed = True
    if not changed:
        break

# fallback 1: words the aligner collapsed take the free transcript's time when they were matched there
import numpy as np
bad_w = lambda w: w.end - w.start < 0.1 and (getattr(w, "probability", 0) or 0) < 0.3
gmatch = {gidx[x]: tw[y] for x, y in keep}
flat = [w for ws in lw for w in ws]
subst = 0
for g, w in enumerate(flat):
    if bad_w(w) and g in gmatch:
        w.start, w.end = gmatch[g][1], max(gmatch[g][2], gmatch[g][1] + 0.15); subst += 1

# fallback 2: a line that starts after a gap begins where the vocal energy begins (never into the previous line)
raw = np.frombuffer(subprocess.run([FF, "-loglevel", "error", "-i", f"{song}/vocals.wav", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                                   capture_output=True).stdout, np.float32)
HOP = 800
nfr = len(raw) // HOP
rms = np.sqrt((raw[:nfr * HOP].reshape(nfr, HOP) ** 2).mean(1))
loud = rms > np.percentile(rms, 90) * 0.15
trimmed = []                                      # a line's first word that begins with a long silence: start where the voice starts
for k in range(len(lw)):
    w0 = lw[k][0]
    a0, b0 = int(w0.start / 0.05), int(w0.end / 0.05)
    if b0 - a0 < 12:
        continue
    j = a0
    while j < b0 - 2 and not (loud[j] and loud[j + 1] and loud[j + 2]):
        j += 1
    onset = j * 0.05
    if onset - w0.start >= 0.4 and w0.end - onset >= 0.1:
        w0.start = onset; trimmed.append(k)
rms_s = np.convolve(rms, np.ones(3) / 3, "same")
valleyed = []                                     # a long first word right after the previous word: the previous note was held, so the
for k in range(1, len(lw)):                       # boundary is the deepest loudness dip inside it
    w0, pw = lw[k][0], lw[k - 1][-1]
    if k in trimmed or w0.end - w0.start < 0.8 or w0.start - pw.end > 0.15:
        continue
    a0, b0 = int((w0.start + 0.3) / 0.05), int((w0.end - 0.2) / 0.05)
    if b0 - a0 < 4:
        continue
    m = int(np.argmin(rms_s[a0:b0]))
    if rms_s[a0 + m] < 0.55 * np.median(rms_s[int(w0.start / 0.05):int(w0.end / 0.05)]):
        t = (a0 + m) * 0.05
        pw.end = t
        w0.start = t + 0.05
        valleyed.append(k)
late = []                                         # a stretched first word: the transcript hears a word start inside it, so start there
for k in range(len(lw)):
    w0 = lw[k][0]
    if not tw or w0.end - w0.start <= 1.2 or k in trimmed or k in valleyed:
        continue
    cand = [t[1] for t in tw if w0.start + 0.4 <= t[1] <= w0.end - 0.3]
    if cand:
        w0.start = min(cand); late.append(k)
snapped = []
for k in range(len(lw)):
    w0 = lw[k][0]
    prev_end = lw[k - 1][-1].end if k else 0.0
    if w0.start - prev_end <= 0.5:
        continue
    lo = int(prev_end / 0.05) + 1
    j = int(w0.start / 0.05)
    first, i, dips, gap_found = j, j, 0, False
    while i > lo:
        i -= 1
        if loud[i]:
            first, dips = i, 0
        else:
            dips += 1
            if dips > 5:
                gap_found = True                      # energy really dips before this line starts
                break
    onset = first * 0.05
    if not gap_found:                                 # continuous with the previous line: use the transcript instead
        cand = [t[1] for t in tw if prev_end + 0.05 < t[1] < w0.start - 0.2]
        if not cand:
            continue
        onset = min(cand)
    if 0.3 <= w0.start - onset <= 3.0:
        nxt = lw[k][1].start if len(lw[k]) > 1 else w0.end
        w0.start = onset
        if w0.end < w0.start + 0.1:
            w0.end = min(nxt, w0.start + 0.3)
        snapped.append(k)
json.dump([[w.word, w.start, w.end, getattr(w, "probability", None)] for ws in lw for w in ws], open(f"{song}/words.json", "w"))


def rows(t):
    if len(t) <= ROW:
        return [t]
    sp = [m.start() for m in re.finditer(" ", t)]
    k = min(sp, key=lambda p: abs(p - len(t) / 2))
    return [t[:k], t[k + 1:]]


# units: a lyric line, or a piece of one if it is too long for two rows
units = []                                             # dict(text, words, line)
for k, l in enumerate(lines):
    ws = lw[k]
    if len(l) <= 2 * ROW:
        units.append(dict(text=l, ws=ws, line=k))
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
    for p in parts:
        units.append(dict(text=" ".join(x.word.strip() for x in p), ws=p, line=k))

# pairing rule: two consecutive one-row units from the same section, sung close together
caps, i = [], 0
while i < len(units):
    u = units[i]
    if (i + 1 < len(units) and len(u["text"]) <= ROW and len(units[i + 1]["text"]) <= ROW
            and sect[u["line"]] == sect[units[i + 1]["line"]]
            and units[i + 1]["ws"][0].start - u["ws"][-1].end <= PAIR_GAP):
        caps.append([u["ws"][0].start, units[i + 1]["ws"][-1].end, rows(u["text"]) + rows(units[i + 1]["text"])])
        i += 2
    else:
        caps.append([u["ws"][0].start, u["ws"][-1].end, rows(u["text"])])
        i += 1

# timing
for c in caps:
    c.append(c[0])            # sung start
    c[0] -= LEAD
for n, c in enumerate(caps):
    last = c[1]
    if n + 1 < len(caps):
        nxt = caps[n + 1][0]
        e = min(nxt - GAP, last + MAXHOLD)
        if e < last:                                   # fast section: never cut a word that is still being sung
            e = min(last, nxt - 0.08)
        c[1] = max(e, c[0] + 0.3)
    else:
        c[1] = last + TAIL


def ts(s):
    s = max(round(s * FPS) / FPS, 0)                    # snap to a frame boundary
    ms = int(round(s * 1000)); return f"{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}"


with open(f"{song}/captions.srt", "w", encoding="utf-8") as f:
    for n, (s, e, tx, _) in enumerate(caps, 1):
        f.write(f"{n}\n{ts(s)} --> {ts(e)}\n" + "\n".join(tx) + "\n\n")

# report: flag suspicious captions without printing lyric text
probs = [w.probability for w in words if getattr(w, "probability", None) is not None]
out = [f"repaired lines: {repaired} | transcript-substituted words: {subst} | onset-snapped lines: {len(snapped)} | silence-trimmed lines: {len(trimmed)} | valley-split lines: {len(valleyed)} | transcript-late lines: {len(late)}"]
out += [f"lines {len(lines)} units {len(units)} captions {len(caps)}  first {caps[0][0]:.2f} last end {caps[-1][1]:.2f}"]
if probs:
    out.append(f"word prob mean {st.mean(probs):.2f} median {st.median(probs):.2f}")
for n, (s, e, tx, sung) in enumerate(caps, 1):
    flags = []
    if e - s < 0.9: flags.append("short")
    if e - s > 9: flags.append("long")
    if n > 1 and s < caps[n - 2][1] - 0.001: flags.append("overlap")
    out.append(f"{n:3} {s:8.2f} {e:8.2f} {e-s:5.2f}s rows={len(tx)} {' '.join(flags)}")
open(f"{song}/report.txt", "w").write("\n".join(out))
print("\n".join(out))
