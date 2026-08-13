#!/usr/bin/env python3
"""Generate the WholePage icon set. 100% original geometric mark (asset dossier:
no third-party artwork anywhere in the package — see docs/asset-provenance.md).

Mark: a tall rounded 'page' bar with a wider capture band across its top third —
'the whole page, captured'. No camera, flame, lens, feather, or OS imagery.
"""
from PIL import Image, ImageDraw

INK = (22, 21, 15, 255)         # #16150F background — warm ink black
PAGE = (241, 238, 229, 255)     # #F1EEE5 bone page bar
TAPE = (242, 194, 0, 255)       # #F2C200 measuring-tape yellow
TICK = (22, 21, 15, 255)        # etched ruler marks on the tape


def vertical_gradient(draw, box, top, bottom):
    x0, y0, x1, y1 = box
    h = max(1, y1 - y0)
    for i in range(h):
        t = i / h
        color = tuple(round(top[c] + (bottom[c] - top[c]) * t) for c in range(3)) + (255,)
        draw.line([(x0, y0 + i), (x1, y0 + i)], fill=color)


def make(size: int) -> Image.Image:
    s = 16  # supersample
    S = size * s
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Background: ink rounded square
    r = round(S * 0.22)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=INK)

    # Page bar: tall rounded rect, centered — the long page
    pw = round(S * 0.38)
    px0 = (S - pw) // 2
    py0 = round(S * 0.14)
    py1 = round(S * 0.86)
    d.rounded_rectangle([px0, py0, px0 + pw, py1], radius=round(pw * 0.20), fill=PAGE)

    # Faint content lines on the page (reads as "a page" at larger sizes)
    line_c = (16, 20, 19, 60)
    lh = max(1, round(S * 0.025))
    for i, ty in enumerate((0.22, 0.62, 0.70, 0.78)):
        y = round(S * ty)
        inset = round(pw * 0.18)
        w_frac = 0.64 if i in (0, 3) else 1.0
        d.rounded_rectangle(
            [px0 + inset, y, px0 + inset + round((pw - 2 * inset) * w_frac), y + lh],
            radius=lh // 2, fill=line_c,
        )

    # Capture band: a measuring-tape strip ACROSS the page with short handles
    # and etched ruler ticks — "this page, measured and captured".
    bh = round(S * 0.18)
    by0 = round(S * 0.34)
    handle = round(S * 0.10)
    bx0 = px0 - handle
    bx1 = px0 + pw + handle
    d.rounded_rectangle([bx0, by0, bx1, by0 + bh], radius=round(bh * 0.30), fill=TAPE)
    # Ruler ticks: alternating tall/short marks along the top edge of the tape
    n_ticks = 7
    tick_w = max(1, round(S * 0.012))
    for i in range(1, n_ticks + 1):
        tx = bx0 + round((bx1 - bx0) * i / (n_ticks + 1))
        tall = i % 2 == 1
        th = round(bh * (0.52 if tall else 0.30))
        d.rectangle([tx - tick_w // 2, by0, tx + tick_w // 2, by0 + th], fill=TICK)

    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    for size in (16, 32, 48, 128, 256):
        make(size).save(os.path.join(here, f"icon{size}.png"))
    print("icons written")
