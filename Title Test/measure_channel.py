# Measures title and artist on a channel's thumbnails and compares them with the same text drawn in the channel font.
# python measure_channel.py "<Channel>"      (test tool, not part of the panel)
import os, re, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONTS = os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\Windows\Fonts')
CH = {
    'Dance Pilot':   dict(font='TitanOne-Regular.ttf', artist=97, colour=(255, 255, 255), sx=0.9, sy=1.2, track=0),
    'Rock Tunes':    dict(font='DkMidnightChalkerRegular-lGWV.otf', artist=120, colour=(255, 192, 0), sx=1, sy=1, track=0),
    'Rock Vivo':     dict(font='Piedra-Regular.ttf', artist=100, colour=(255, 255, 255), sx=1, sy=1, track=0),
    'Brit Tunes':    dict(font='Lemon Mocktail .ttf', artist=110, colour=(255, 255, 255), sx=1, sy=1, track=0),
    'TikTok Melody': dict(font='BaksoSapi.otf', artist=100, colour=(251, 214, 143), sx=1, sy=1, track=-30),
}
name = sys.argv[1]
c = CH[name]
thumbs = r'C:\Users\HP\Documents\%s\Thumbnails' % name
font_path = os.path.join(FONTS, c['font'])


def ink(text, size, track=0):
    f = ImageFont.truetype(font_path, size)
    if not track:
        l, t, r, b = f.getbbox(text)
        return r - l, b - t
    # tracking: each letter moves by track/1000 em; kerning kept by measuring pairs
    x, top, bot, left, right = 0.0, 1e9, -1e9, 1e9, -1e9
    for i, ch in enumerate(text):
        l, t, r, b = f.getbbox(ch)
        left, right, top, bot = min(left, x + l), max(right, x + r), min(top, t), max(bot, b)
        adv = f.getlength(text[i:i + 2]) - f.getlength(text[i + 1:i + 2]) if i + 1 < len(text) else f.getlength(ch)
        x += adv + track * size / 1000.0
    return right - left, bot - top


def bands(path):
    im = np.asarray(Image.open(path).convert('RGB')).astype(int)
    h, w, _ = im.shape
    white = im.min(axis=2) > 236
    col = np.abs(im - np.array(c['colour'])).sum(axis=2) < 70
    mask = white | col
    mask[820:, :] = False                      # the watermark zone
    rows, out, start = mask.sum(axis=1), [], None
    for y in range(h):
        on = rows[y] > 6
        if on and start is None: start = y
        if not on and start is not None:
            if y - start > 25: out.append((start, y - 1))
            start = None
    res = []
    for a, b in out:
        cols = np.where(mask[a:b + 1].sum(axis=0) > 1)[0]
        res.append((a, b, int(cols[0]), int(cols[-1])))
    return res


print(name, '| artist size', c['artist'])
for f in sorted(os.listdir(thumbs)):
    if not f.lower().endswith('.jpg'): continue
    artist, title = f[:-4].split(' - ', 1)
    bs = bands(os.path.join(thumbs, f))
    print(f)
    for a, b, x0, x1 in bs:
        print('    rows %4d-%4d h %3d   cols %4d-%4d w %4d  cx %d' % (a, b, b - a + 1, x0, x1, x1 - x0 + 1, (x0 + x1) // 2))
    if len(bs) >= 2:
        aw, ah = ink(artist.upper(), c['artist'], c['track'])
        tw, th = ink(title.upper(), 400, c['track'])
        t, a_ = bs[0], bs[-1]
        print('    artist drawn at size %d: w %d h %d (file-name text; thumbnail w %d h %d)' % (c['artist'], aw * c['sx'], ah * c['sy'], a_[3] - a_[2] + 1, a_[1] - a_[0] + 1))
        print('    title size by width %.0f, by height %.0f | gap %d' % (400 * (t[3] - t[2] + 1) / (tw * c['sx']), 400 * (t[1] - t[0] + 1) / (th * c['sy']), a_[0] - t[1] - 1))
