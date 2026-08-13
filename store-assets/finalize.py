#!/usr/bin/env python3
"""Convert the 2x stage renders into what the Chrome Web Store actually accepts:
exactly 1280x800, 24-bit PNG, NO alpha channel. Rendering at 2x then
downscaling (LANCZOS) is what makes the 1280x800 output razor sharp."""
from PIL import Image
import os
here = os.path.dirname(os.path.abspath(__file__))
for i in range(1, 6):
    p = os.path.join(here, 'out', f'store-{i}.png')
    img = Image.open(p)
    img = img.convert('RGB')  # drop alpha -> 24-bit
    if img.size != (1280, 800):
        img = img.resize((1280, 800), Image.LANCZOS)
    img.save(p, optimize=True)
    print(f'store-{i}.png -> {img.size} {img.mode}')
