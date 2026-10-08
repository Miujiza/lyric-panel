import os, re, json, sys, statistics as st, collections
from difflib import SequenceMatcher

SONGS = r"C:\Users\HP\Downloads\Lyrics\Rock Tunes"
LIB = r"C:\Users\HP\Documents\Lyric Library"
FPS = 24000 / 1001
FR = 1 / FPS
TOL = 1.5 * FR      # anything within a frame and a half counts as untouched

def parse(p):
    t = open(p, encoding='utf-8-sig').read().replace('\r', '')
    out = []
    for b in re.split(r'\n\s*\n', t):
        ls = [x for x in b.split('\n') if x.strip()]
        for i, l in enumerate(ls):
            m = re.match(r'(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)', l)
            if m:
                g = list(map(int, m.groups()))
                out.append(dict(s=g[0]*3600+g[1]*60+g[2]+g[3]/1000, e=g[4]*3600+g[5]*60+g[6]+g[7]/1000, rows=[x.strip() for x in ls[i+1:]]))
                break
    return out

norm = lambda w: re.sub(r"[^a-z0-9']", '', w.lower())
def words(cues):
    out = []
    for ci, c in enumerate(cues):
        ws = [norm(w) for w in ' '.join(c['rows']).split()]
        ws = [w for w in ws if w]
        for k, w in enumerate(ws): out.append((w, ci, k == 0, k == len(ws) - 1))
    return out

def pct(a, b): return '%3d%%' % round(100 * a / b) if b else '  - '
def q(v, p):
    v = sorted(v)
    return v[min(len(v) - 1, int(p * len(v)))] if v else float('nan')

ALL = []
rows_out = []
detail = len(sys.argv) > 1
for name in sorted(os.listdir(SONGS)):
    d = os.path.join(SONGS, name)
    if not os.path.isdir(d): continue
    po, pc = os.path.join(d, name + '.srt'), os.path.join(LIB, name + '.srt')
    if not (os.path.exists(po) and os.path.exists(pc)): print('missing', name[:30]); continue
    O, C = parse(po), parse(pc)
    ow, cw = words(O), words(C)
    sm = SequenceMatcher(None, [w[0] for w in ow], [w[0] for w in cw], autojunk=False)
    o2c = {}
    for a, b, n in sm.get_matching_blocks():
        for k in range(n): o2c[a + k] = b + k
    text_changed = len(ow) - len(o2c) + len(cw) - len(o2c)
    # word timing (sung) per original cue
    wj = None
    try:
        W = json.load(open(os.path.join(d, 'words.json')))
        if len(W) == sum(len(' '.join(c['rows']).split()) for c in O): wj = W
    except Exception: pass
    log = ''
    try: log = open(os.path.join(d, 'pipeline.log'), encoding='utf-8', errors='replace').read()
    except Exception: pass
    mode = 'plain' if 'keeping it' in log else 'anchored' if 'anchored' in log else '?'
    first_idx = {}; last_idx = {}
    for i, w in enumerate(ow):
        first_idx.setdefault(w[1], i); last_idx[w[1]] = i
    wpos = 0
    recs = []
    for oi, c in enumerate(O):
        nw = len(' '.join(c['rows']).split())
        sung = wj[wpos][1] if wj else None; sung_end = wj[wpos + nw - 1][2] if wj else None
        prob = st.mean([x[3] or 0 for x in wj[wpos:wpos + nw]]) if wj else None
        p0 = (wj[wpos][3] or 0) if wj else None
        widx = wpos
        w0dur = (wj[wpos][2] - wj[wpos][1]) if wj else None
        minp = min((x[3] or 0) for x in wj[wpos:wpos + nw]) if wj else None
        wpos += nw
        fi, li = first_idx.get(oi), last_idx.get(oi)
        r = dict(widx=widx, w0dur=w0dur, minp=minp, nw=nw, nO=len(O), song=name, oi=oi, s=c['s'], e=c['e'], sung=sung, sung_end=sung_end, prob=prob, p0=p0, mode=mode, ds=None, de=None, regroup=False, screens=None,
                 gap_before=c['s'] - O[oi - 1]['e'] if oi else None, pause_before=None)
        if fi in o2c and li in o2c:
            cf, cl = cw[o2c[fi]], cw[o2c[li]]
            if cf[2]: r['ds'] = C[cf[1]]['s'] - c['s']
            else: r['regroup'] = True
            if cl[3]: r['de'] = C[cl[1]]['e'] - c['e']
            else: r['regroup'] = True
            r['screens'] = cl[1] - cf[1] + 1
            r['cs'], r['ce'] = C[cf[1]]['s'], C[cl[1]]['e']
            r['inner'] = [C[k]['e'] for k in range(cf[1], cl[1])]
            r['innerlen'] = [len(' '.join(C[k]['rows'])) for k in range(cf[1], cl[1] + 1)]
            r['innergap'] = [C[k + 1]['s'] - C[k]['e'] for k in range(cf[1], cl[1])]
        recs.append(r)
    if wj:
        wpos = 0
        for oi, c in enumerate(O):
            nw = len(' '.join(c['rows']).split())
            if oi: recs[oi]['pause_before'] = wj[wpos][1] - wj[wpos - 1][2]
            wpos += nw
    ALL += recs
    ds = [r['ds'] for r in recs if r['ds'] is not None]; de = [r['de'] for r in recs if r['de'] is not None]
    ch = [x for x in ds if abs(x) > TOL]
    che = [x for x in de if abs(x) > TOL]
    cgap = [C[i + 1]['s'] - C[i]['e'] for i in range(len(C) - 1)]
    rows_out.append((name[:26], mode, len(O), len(C), text_changed, sum(r['regroup'] for r in recs), len(ds), len(ch), len([x for x in ch if abs(x) > 0.3]), len([x for x in ch if abs(x) > 1]),
                     st.median(ch) if ch else 0, len(che), sum(1 for g in cgap if abs(g) < TOL), len(cgap)))
    if detail and sys.argv[1].lower() in name.lower():
        for r in recs:
            print('%3d s=%7.2f ds=%s de=%s scr=%s sung-lead=%s p0=%s pause=%s %s' % (r['oi'], r['s'], '%+.2f' % r['ds'] if r['ds'] is not None else '  ? ', '%+.2f' % r['de'] if r['de'] is not None else '  ? ', r['screens'],
                  '%.2f' % (r['sung'] - r['s']) if r['sung'] is not None else '?', '%.2f' % r['p0'] if r['p0'] is not None else '?', '%.2f' % r['pause_before'] if r['pause_before'] is not None else '-', 'REGROUP' if r['regroup'] else ''))

print('%-26s %-8s %4s %4s %5s %5s | %5s %5s %5s %5s %7s | %5s | %s' % ('song', 'mode', 'orig', 'now', 'words', 'regrp', 'start', 'moved', '>0.3s', '>1s', 'median', 'endMv', 'touching'))
for r in rows_out:
    print('%-26s %-8s %4d %4d %5d %5d | %5d %5d %5d %5d %+7.2f | %5d | %d/%d' % r)

ds = [r['ds'] for r in ALL if r['ds'] is not None]
print('\nALL: original cues', len(ALL), 'start comparable', len(ds))
mv = [x for x in ds if abs(x) > TOL]
print('starts moved', len(mv), pct(len(mv), len(ds)), ' earlier', sum(x < 0 for x in mv), ' later', sum(x > 0 for x in mv))
for lo, hi in [(0, .1), (.1, .2), (.2, .3), (.3, .5), (.5, 1), (1, 2), (2, 5), (5, 999)]:
    a = [x for x in mv if lo <= abs(x) < hi]
    print('  |shift| %4.1f-%-5.1f: %3d  (earlier %3d, later %3d)' % (lo, hi, len(a), sum(x < 0 for x in a), sum(x > 0 for x in a)))
print('  median signed %+.3f  median abs %.3f  p90 abs %.2f' % (st.median(mv), st.median([abs(x) for x in mv]), q([abs(x) for x in mv], .9)))
de = [r['de'] for r in ALL if r['de'] is not None]
me = [x for x in de if abs(x) > TOL]
print('ends moved', len(me), pct(len(me), len(de)), ' earlier', sum(x < 0 for x in me), ' later', sum(x > 0 for x in me), ' median signed %+.3f' % st.median(me))

# does the end simply follow the next start?  compare the gap to the next cue before and after
print('\nby pipeline mode:')
for m in ('plain', 'anchored', '?'):
    a = [r for r in ALL if r['mode'] == m and r['ds'] is not None]
    if a: print('  %-8s cues %3d moved %s  >0.3s %s' % (m, len(a), pct(sum(abs(r['ds']) > TOL for r in a), len(a)), pct(sum(abs(r['ds']) > 0.3 for r in a), len(a))))
print('by first-word probability:')
for lo, hi in [(0, .3), (.3, .6), (.6, .85), (.85, 1.01)]:
    a = [r for r in ALL if r['p0'] is not None and r['ds'] is not None and lo <= r['p0'] < hi]
    if a: print('  p0 %.2f-%.2f cues %3d moved %s  >0.3s %s' % (lo, hi, len(a), pct(sum(abs(r['ds']) > TOL for r in a), len(a)), pct(sum(abs(r['ds']) > 0.3 for r in a), len(a))))
print('by pause before the line (sung gap from previous word):')
for lo, hi in [(-9, .15), (.15, .5), (.5, 1.5), (1.5, 4), (4, 999)]:
    a = [r for r in ALL if r['pause_before'] is not None and r['ds'] is not None and lo <= r['pause_before'] < hi]
    if a:
        m2 = [r['ds'] for r in a if abs(r['ds']) > TOL]
        print('  pause %5.2f-%-6.2f cues %3d moved %s  >0.3s %s  median signed %+.2f' % (lo, hi, len(a), pct(len(m2), len(a)), pct(sum(abs(x) > 0.3 for x in m2), len(a)), st.median(m2) if m2 else 0))
a = [r for r in ALL if r['oi'] == 0 and r['ds'] is not None]
print('first cue of each song: moved', sum(abs(r['ds']) > TOL for r in a), 'of', len(a), ['%+.2f' % r['ds'] for r in a])
# corrected lead relative to the aligner's sung time
lead = [r['sung'] - r['cs'] for r in ALL if r['sung'] is not None and r['ds'] is not None]
leadm = [r['sung'] - r['cs'] for r in ALL if r['sung'] is not None and r['ds'] is not None and abs(r['ds']) > TOL]
print('\nlead (aligner sung time minus caption start): original always %.3f; corrected median %.3f, moved-only median %.3f, p10 %.2f p90 %.2f' % (6 * FR, st.median(lead), st.median(leadm), q(leadm, .1), q(leadm, .9)))
# split screens
sp = [r for r in ALL if r['screens'] and r['screens'] > 1]
print('original cues shown as 2+ screens:', len(sp), ' regrouped cues:', sum(r['regroup'] for r in ALL), ' unmatched:', sum(r['screens'] is None for r in ALL))
json.dump(ALL, open(os.path.join(os.path.dirname(__file__), 'compare.json'), 'w'))
