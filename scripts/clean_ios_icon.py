#!/usr/bin/env python3
"""Remove baked-in light fringes and pre-rounded corners from the iOS home-screen icon."""
from pathlib import Path
from PIL import Image

path = Path("docs/v2/apple-touch-icon.png")
original = Image.open(path).convert("RGB")
w, h = original.size
# The existing raster includes a rounded frame/bright edge. Crop inside that
# frame so iOS can apply its own native rounded mask without exposing slivers.
inset = round(min(w, h) * 0.09)
clean = original.crop((inset, inset, w - inset, h - inset))
# Use high resolution to avoid further degradation of the small source PNG.
clean = clean.resize((512, 512), Image.Resampling.LANCZOS)
clean.save(path, "PNG", optimize=True)
print(f"Updated {path}: {w}x{h} -> 512x512; removed {inset}px edge per side")
