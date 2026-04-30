#!/usr/bin/env python3
"""Convert bookmarks icon.svg to proper Tauri icon.ico using PIL ImageDraw.

The SVG contains:
  1. A rounded rect at (6,6)-(58,58) with rx=14, filled #D9D0A9 (beige background)
  2. A white-stroked bookmark path with no fill: M24 18h16v30l-8-6-8 6z
     Points: (24,18) -> (40,18) -> (40,48) -> (32,42) -> (24,48) -> close

We render at 256x256 (4x scale) for quality, then downscale to all ICO sizes.
"""
import os
from math import pi as _pi

from PIL import Image, ImageDraw

BASE = 256       # render resolution
SCALE = BASE / 64  # scale factor from 64x64 SVG to BASE resolution

BG_COLOR   = (0xD9, 0xD0, 0xA9, 255)  # #D9D0A9 beige
WHITE      = (255, 255, 255, 255)
TRANSPARENT = (0, 0, 0, 0)

# ------------------------------------------------------------
# helper – round to int with pixel perfect scaling
# ------------------------------------------------------------
def s(v: float) -> int:
    return round(v * SCALE)

# ------------------------------------------------------------
# render the icon at the base resolution
# ------------------------------------------------------------
img = Image.new("RGBA", (BASE, BASE), TRANSPARENT)
draw = ImageDraw.Draw(img)

# --- rounded-rect background  (x=6..58, y=6..58, rx=14)  ---
# PIL 9.2+ has rounded_rectangle
draw.rounded_rectangle(
    [s(6), s(6), s(58), s(58)],
    radius=s(14),
    fill=BG_COLOR,
)

# --- bookmark outline  -------------------------------------
# M24 18  h16  → (40,18)
#       v30  → (40,48)
#       l-8-6 → (32,42)   (rel: dx=-8, dy=-6)
#       l-8 6 → (24,48)   (rel: dx=-8, dy=+6)  – space in SVG is same as comma
#       z     → close back to (24,18)
pts_svg_64 = [
    (24, 18),
    (40, 18),
    (40, 48),
    (32, 42),
    (24, 48),
]
pts = [(s(x), s(y)) for (x, y) in pts_svg_64]

# SVG has stroke-linejoin="round" stroke-linecap="round" stroke-width=4
draw.line(
    pts + [pts[0]],          # close the shape
    fill=WHITE,
    width=max(1, s(4)),      # scale stroke-width as well
    joint="curve",           # closest PIL equivalent to stroke-linejoin="round"
)

# ------------------------------------------------------------
# generate icon.ico (multi‑size)  &  helper PNGs
# ------------------------------------------------------------
ico_sizes = [16, 24, 32, 48, 64, 128, 256]
app_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
icon_dir = os.path.join(app_dir, "src-tauri", "icons")

ico_frames = []
for sz in ico_sizes:
    resized = img.resize((sz, sz), Image.LANCZOS)
    ico_frames.append(resized)

ico_path = os.path.join(icon_dir, "icon.ico")
ico_frames[0].save(ico_path, format="ICO", sizes=[(sz, sz) for sz in ico_sizes])

# PNGs at common sizes (Tauri bundler uses these as well)
for label, size in [("icon.png", 256), ("32x32.png", 32), ("128x128.png", 128), ("128x128@2x.png", 256)]:
    p = img.resize((size, size), Image.LANCZOS)
    p.save(os.path.join(icon_dir, label), format="PNG")

print("Bookmark icons generated correctly")
