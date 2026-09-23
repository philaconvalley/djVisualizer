"""Makes the placeholder GIFs in gifs/.

The workshop pen can load a GIF from this site with gif="https://.../gifs/x.gif",
because netlify.toml sends Access-Control-Allow-Origin on /gifs/*. These three
are placeholders in the default band colours, so the path works end to end
before the design team supplies real ones. Replace them freely; keep each file
small, because twenty laptops load it on one guest Wi-Fi network.

    python3 scripts/make-gifs.py   # needs Pillow
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "gifs"
SIZE = 320
FRAMES = 24
BASS, MID, HIGH = (255, 69, 58), (48, 209, 88), (10, 132, 255)


def rings(t):
    im = Image.new("RGB", (SIZE, SIZE), (0, 0, 0))
    d = ImageDraw.Draw(im)
    c = SIZE / 2
    for i, colour in enumerate((BASS, MID, HIGH)):
        r = 30 + i * 40 + 18 * math.sin(2 * math.pi * (t + i / 3))
        d.ellipse([c - r, c - r, c + r, c + r], outline=colour, width=8)
    return im


def stars(t):
    im = Image.new("RGB", (SIZE, SIZE), (0, 0, 0))
    d = ImageDraw.Draw(im)
    for i in range(36):
        angle = 2 * math.pi * i / 36
        dist = (i * 37 % 150) + 150 * t
        dist %= 160
        x = SIZE / 2 + dist * math.cos(angle)
        y = SIZE / 2 + dist * math.sin(angle)
        s = 2 + dist / 30
        d.ellipse([x - s, y - s, x + s, y + s], fill=(BASS, MID, HIGH)[i % 3])
    return im


def waves(t):
    im = Image.new("RGB", (SIZE, SIZE), (0, 0, 0))
    d = ImageDraw.Draw(im)
    for band, colour in enumerate((BASS, MID, HIGH)):
        points = []
        for x in range(0, SIZE + 1, 8):
            phase = 2 * math.pi * (x / SIZE * (band + 1) + t)
            points.append((x, SIZE / 2 + (band - 1) * 60 + 30 * math.sin(phase)))
        d.line(points, fill=colour, width=6)
    return im


for name, draw in (("rings", rings), ("stars", stars), ("waves", waves)):
    frames = [draw(f / FRAMES) for f in range(FRAMES)]
    path = OUT / f"{name}.gif"
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=60, loop=0)
    print(path.name, path.stat().st_size, "bytes")
