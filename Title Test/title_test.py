# Test of the title picture (not part of the panel): draws "TITLE / ARTIST" like the Dance Pilot title card and
# puts it next to the user's own thumbnail. Run: python title_test.py
import os, re
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
THUMBS = r'C:\Users\HP\Documents\Dance Pilot\Thumbnails'
FONT = os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\Windows\Fonts\TitanOne-Regular.ttf')
W, H = 1920, 1080

# Dance Pilot, measured on the user's five thumbnails
SX, SY = 0.9, 1.2            # the text layer's scale in the template (width 90, height 120)
ARTIST_SIZE = 97             # never changes
TITLE_MAX_W = 1780           # long titles fill this width
TITLE_MAX_H = 357            # short titles stop growing here (the user's largest: "Dreams")
GAP = 55                     # title bottom to artist top
CENTRE_X = 957
TITLE_MID, TITLE_DRIFT = 459, 0.1   # middle of the title = 459 + a tenth of its height (a bigger title sits a little lower)
ARTIST_MAX_W = 1780


def ink(text, size):
    f = ImageFont.truetype(FONT, size)
    l, t, r, b = f.getbbox(text)
    return f, l, t, r - l, b - t


def draw_text(text, size):
    """The text at this font size, stretched like the template's layer. Returns an L image cropped to the ink."""
    f, l, t, w, h = ink(text, size)
    im = Image.new('L', (w + 8, h + 8), 0)
    ImageDraw.Draw(im).text((4 - l, 4 - t), text, font=f, fill=255)
    im = im.crop(im.getbbox())
    return im.resize((max(1, round(im.width * SX)), max(1, round(im.height * SY))), Image.LANCZOS)


def fit_artists(artist):
    """Drops artists from the end until the line fits; the separators are the file name's own."""
    parts = re.split(r'(\s*,\s*|\s+&\s+|\s+x\s+|\s+(?:ft|feat)\.?\s+|\s+and\s+)', artist, flags=re.I)
    while True:
        text = ''.join(parts).upper()
        if len(parts) <= 1 or draw_text(text, ARTIST_SIZE).width <= ARTIST_MAX_W:
            return text
        parts = parts[:-2]


def render(title, artist):
    title, artist = title.upper(), fit_artists(artist)
    probe = 400
    _, _, _, w, h = ink(title, probe)
    size = min(TITLE_MAX_W / (w * SX / probe), TITLE_MAX_H / (h * SY / probe))
    t_im, a_im = draw_text(title, round(size)), draw_text(artist, ARTIST_SIZE)
    block = t_im.height + GAP + a_im.height
    top = round(TITLE_MID + TITLE_DRIFT * t_im.height - t_im.height / 2)
    mask = Image.new('L', (W, H), 0)
    mask.paste(t_im, (round(CENTRE_X - t_im.width / 2), top))
    mask.paste(a_im, (round(CENTRE_X - a_im.width / 2), top + t_im.height + GAP))
    # no shadow in the picture: the Drop Shadow on the lyrics nest in the main sequence covers titles, lyrics and logo
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    out.paste(Image.new('RGBA', (W, H), (255, 255, 255, 255)), (0, 0), mask)
    boxes = [(top, top + t_im.height - 1, t_im.width), (top + t_im.height + GAP, top + block - 1, a_im.width)]
    return out, boxes


def theirs(path):
    im = np.asarray(Image.open(path).convert('RGB')).astype(int)
    white = im.min(axis=2) > 238
    rows, bands, start = white.sum(axis=1), [], None
    for y in range(H):
        on = rows[y] > 3
        if on and start is None: start = y
        if not on and start is not None:
            if y - start > 12: bands.append((start, y - 1))
            start = None
    out = []
    for a, b in bands[:2]:
        cols = np.where(white[a:b + 1].sum(axis=0) > 0)[0]
        out.append((a, b, int(cols[-1] - cols[0] + 1)))
    return out


for name in sorted(os.listdir(THUMBS)):
    if not name.lower().endswith('.jpg'): continue
    artist, title = name[:-4].split(' - ', 1)
    pic, mine = render(title, artist)
    yours = theirs(os.path.join(THUMBS, name))
    print(name)
    for label, m, y in zip(('title ', 'artist'), mine, yours):
        print('   %s  mine rows %d-%d width %d   yours rows %d-%d width %d' % (label, m[0], m[1], m[2], y[0], y[1], y[2]))
    pic.save(os.path.join(HERE, name[:-4] + ' (title).png'))
    # side by side for the eye: the user's thumbnail on top, the new title over the same picture (theirs dimmed) below
    orig = Image.open(os.path.join(THUMBS, name)).convert('RGB')
    black = Image.new('RGB', (W, H), (20, 20, 24))
    black.paste(pic, (0, 0), pic)
    both = Image.new('RGB', (W, H * 2 + 20), (90, 90, 90))
    both.paste(orig, (0, 0)); both.paste(black, (0, H + 20))
    both.resize((W // 2, (H * 2 + 20) // 2), Image.LANCZOS).save(os.path.join(HERE, name[:-4] + ' (compare).jpg'), quality=88)
