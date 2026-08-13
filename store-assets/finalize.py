#!/usr/bin/env python3
"""Convert the 2x stage renders into what the Chrome Web Store actually accepts:
exactly 1280x800, 24-bit PNG, NO alpha channel. Rendering at 2x then
downscaling (LANCZOS) is what makes the 1280x800 output razor sharp."""
from PIL import Image
import os
here = os.path.dirname(os.path.abspath(__file__))
TARGETS = {**{f'store-{i}.png': (1280, 800) for i in range(1, 6)},
           'promo-small.png': (440, 280), 'promo-marquee.png': (1400, 560)}
for name, size in TARGETS.items():
    p = os.path.join(here, 'out', name)
    if not os.path.exists(p):
        continue
    img = Image.open(p).convert('RGB')  # drop alpha -> 24-bit
    if img.size != size:
        img = img.resize(size, Image.LANCZOS)
    img.save(p, optimize=True)
    print(f'{name} -> {img.size} {img.mode}')
