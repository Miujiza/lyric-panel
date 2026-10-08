import sys, json, os, re, subprocess, unicodedata
import numpy as np
d = sys.argv[1]
def norm(s): return re.sub(r'[^a-z0-9ñ]', '', unicodedata.normalize('NFC', s.lower()).replace('á','a').replace('é','e').replace('í','i').replace('ó','o').replace('ú','u').replace('ü','u'))
words = json.load(open(f'{d}/words.json', encoding='utf-8'))
raw = subprocess.run(['/c/ffmpeg/bin/ffmpeg' if False else 'C:/ffmpeg/bin/ffmpeg','-v','quiet','-i',f'{d}/vocals.wav','-ac','1','-ar','16000','-f','f32le','-'],capture_output=True).stdout
x = np.frombuffer(raw, dtype=np.float32); fr = 800
n = len(x)//fr; rms = np.sqrt((x[:n*fr].reshape(n, fr)**2).mean(1))
loud = rms > 0.12*np.percentile(rms, 90)
cov = np.zeros(n, bool)
for w, s, e, p in words:
    cov[max(0, int((s-0.3)/0.05)):int((e+0.3)/0.05)+1] = True
out = []
out.append(f"loud frames: {loud.sum()*0.05:.0f}s; loud but uncaptioned: {100*(loud&~cov).sum()/max(loud.sum(),1):.1f}%; captioned but silent: {100*(cov&~loud).sum()/max(cov.sum(),1):.1f}%")
out.append(f"zero-length words (<0.05s): {sum(1 for w in words if w[2]-w[1] < 0.05)}; low-prob (<0.2): {sum(1 for w in words if w[3] < 0.2)} of {len(words)}")
# uncaptioned singing stretches >=1s (tolerate 0.3s gaps)
un = loud & ~cov; runs = []; i = 0
while i < n:
    if un[i]:
        j = i
        while j < n and (un[j] or (j+6 < n and un[j:j+6].any())): j += 1
        runs.append((i*0.05, j*0.05)); i = j
    else: i += 1
runs = [r for r in runs if r[1]-r[0] >= 1.0]
out.append("uncaptioned singing >=1s: " + (", ".join(f"{a:.1f}-{b:.1f}" for a, b in runs) or "none"))
# lyric lines with no support in free transcript
if os.path.exists(f'{d}/free.json'):
    free = [(norm(w), s, e) for w, s, e in json.load(open(f'{d}/free.json', encoding='utf-8'))]
    srt = open(f'{d}/captions.srt', encoding='utf-8-sig').read().replace('\r', '')
    bad = []
    for blk in srt.strip().split('\n\n'):
        l = blk.split('\n')
        m = re.match(r'(\d+):(\d+):(\d+),(\d+) --> (\d+):(\d+):(\d+),(\d+)', l[1])
        a = int(m[1])*3600+int(m[2])*60+int(m[3])+int(m[4])/1000
        b = int(m[5])*3600+int(m[6])*60+int(m[7])+int(m[8])/1000
        ws = [norm(t) for t in ' '.join(l[2:]).split() if norm(t)]
        near = {w for w, s, e in free if s < b+1.5 and e > a-1.5}
        hit = sum(1 for t in ws if t in near)
        if ws and hit/len(ws) < 0.3: bad.append(f"{a:.1f}s \"{' '.join(l[2:])[:40]}\" ({hit}/{len(ws)})")
    out.append("captions with <30% support in free transcript: " + ("; ".join(bad) or "none"))
else:
    out.append("(no free.json - plain mode, transcript check skipped)")
open(f'{d}/qa.txt', 'w', encoding='utf-8').write('\n'.join(out))
print('##', os.path.basename(d)); print('\n'.join(out))
