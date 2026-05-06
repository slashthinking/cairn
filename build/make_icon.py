"""
Generate Cairn app icon: black rounded square with a clean white "C" centered.
Outputs: build/icon.iconset/* and build/icon.icns (via iconutil).

Run from cairn/ root:  uv run build/make_icon.py   (or python3 build/make_icon.py)
"""

import math
import os
import shutil
import subprocess
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


HERE = Path(__file__).resolve().parent
ICONSET = HERE / "icon.iconset"
ICNS = HERE / "icon.icns"


def render_icon(size: int) -> Image.Image:
    """Draw the icon at `size` × `size` and return a PIL RGBA image."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Rounded square background — radius is 22.5% of size (matches macOS Big Sur style)
    radius = int(size * 0.225)
    # Subtle linear gradient from #1A1A1F (top-left) → #08080C (bottom-right)
    grad = Image.new("RGB", (size, size))
    gd = ImageDraw.Draw(grad)
    for y in range(size):
        # Diagonal-ish gradient via row blend
        t = y / max(1, size - 1)
        r = int(0x1A * (1 - t) + 0x08 * t)
        g = int(0x1A * (1 - t) + 0x08 * t)
        b = int(0x1F * (1 - t) + 0x0C * t)
        gd.line([(0, y), (size, y)], fill=(r, g, b))

    # Mask the gradient with the rounded rectangle
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([(0, 0), (size, size)], radius=radius, fill=255)
    bg = Image.composite(grad, Image.new("RGB", (size, size), (0, 0, 0)), mask)
    img.paste(bg, (0, 0), mask)

    # Subtle 1px inner stroke (rgba(255,255,255,0.08))
    stroke = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stroke)
    sd.rounded_rectangle(
        [(0, 0), (size - 1, size - 1)],
        radius=radius,
        outline=(255, 255, 255, max(8, size // 96)),
        width=max(1, size // 512),
    )
    img = Image.alpha_composite(img, stroke)

    # The "C" — thick arc shape, drawn as an annulus minus a notch.
    # Geometry: outer radius = 0.32 of size, inner = 0.205, opens to the right.
    cx, cy = size / 2, size / 2
    outer_r = size * 0.32
    inner_r = size * 0.205
    # Bounding boxes
    outer_box = [
        (cx - outer_r, cy - outer_r),
        (cx + outer_r, cy + outer_r),
    ]
    inner_box = [
        (cx - inner_r, cy - inner_r),
        (cx + inner_r, cy + inner_r),
    ]

    # Draw a full white disc, then erase the inner disc, then erase the right notch.
    c_layer = Image.new("L", (size, size), 0)
    cd = ImageDraw.Draw(c_layer)
    cd.ellipse(outer_box, fill=255)
    cd.ellipse(inner_box, fill=0)
    # Notch: a wedge from center facing right, spanning ±42 degrees
    notch_r = outer_r + size * 0.02
    pts = [(cx, cy)]
    for ang_deg in range(-42, 43, 2):
        ang = math.radians(ang_deg)
        pts.append((cx + notch_r * math.cos(ang), cy + notch_r * math.sin(ang)))
    cd.polygon(pts, fill=0)

    # Soften the C's open ends with rounded caps
    cap_r = (outer_r - inner_r) / 2
    cap_y_offset = (outer_r + inner_r) / 2 * math.sin(math.radians(42))
    cap_x_offset = (outer_r + inner_r) / 2 * math.cos(math.radians(42))
    for sign in (-1, 1):
        cap_cx = cx + cap_x_offset
        cap_cy = cy + sign * cap_y_offset
        cd.ellipse(
            [
                (cap_cx - cap_r, cap_cy - cap_r),
                (cap_cx + cap_r, cap_cy + cap_r),
            ],
            fill=255,
        )

    white = Image.new("RGBA", (size, size), (245, 245, 248, 255))
    img.paste(white, (0, 0), c_layer)

    return img


def main() -> None:
    # Iconset sizes Apple expects
    targets = [
        (16, "icon_16x16.png"),
        (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"),
        (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"),
        (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"),
        (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"),
        (1024, "icon_512x512@2x.png"),
    ]

    if ICONSET.exists():
        shutil.rmtree(ICONSET)
    ICONSET.mkdir(parents=True)

    for size, name in targets:
        img = render_icon(size)
        img.save(ICONSET / name, "PNG")
        print(f"  wrote {name}")

    # Convert to .icns using macOS native iconutil
    if shutil.which("iconutil"):
        subprocess.run(
            ["iconutil", "-c", "icns", str(ICONSET), "-o", str(ICNS)],
            check=True,
        )
        print(f"\nicns: {ICNS}")
    else:
        print("iconutil not found — leaving iconset uncompiled.", file=sys.stderr)


if __name__ == "__main__":
    main()
