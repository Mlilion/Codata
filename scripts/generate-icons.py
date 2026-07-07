#!/usr/bin/env python3
"""Generate all app icons from the high-resolution source image.

The script uses macOS built-in tools where possible:
  - sips for PNG resizing
  - iconutil for ICNS generation

Windows ICO output is assembled from PNG entries in Python so ImageMagick is not
required.
"""

import base64
import binascii
import math
import shutil
import struct
import subprocess
import tempfile
import zlib
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE_FILE = PROJECT_ROOT / "desktop-tauri/src-tauri/icons/app-icon-source.png"
TARGET_ICONS_DIR = PROJECT_ROOT / "desktop-tauri/src-tauri/icons"
FRONTEND_PUBLIC = PROJECT_ROOT / "frontend/public"


def require_tool(name: str) -> None:
    if not shutil.which(name):
        raise SystemExit(f"ERROR: required tool not found: {name}")


def resize_png(size: int, dst: Path, *, app_mask: bool = False, tray_template: bool = False) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["sips", "-z", str(size), str(size), str(SOURCE_FILE), "--out", str(dst)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    ensure_rgba_png(dst)
    if app_mask:
        apply_app_icon_mask(dst)
    if tray_template:
        apply_tray_template_mask(dst)


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", binascii.crc32(kind + data) & 0xFFFFFFFF)
    )


def paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def unfilter_scanlines(data: bytes, width: int, height: int, bpp: int) -> list[bytes]:
    stride = width * bpp
    rows = []
    pos = 0
    previous = bytes(stride)

    for _ in range(height):
        filter_type = data[pos]
        pos += 1
        scanline = bytearray(data[pos : pos + stride])
        pos += stride

        for idx, value in enumerate(scanline):
            left = scanline[idx - bpp] if idx >= bpp else 0
            up = previous[idx]
            up_left = previous[idx - bpp] if idx >= bpp else 0

            if filter_type == 1:
                scanline[idx] = (value + left) & 0xFF
            elif filter_type == 2:
                scanline[idx] = (value + up) & 0xFF
            elif filter_type == 3:
                scanline[idx] = (value + ((left + up) // 2)) & 0xFF
            elif filter_type == 4:
                scanline[idx] = (value + paeth(left, up, up_left)) & 0xFF
            elif filter_type != 0:
                raise ValueError(f"Unsupported PNG filter type: {filter_type}")

        row = bytes(scanline)
        rows.append(row)
        previous = row

    return rows


def ensure_rgba_png(path: Path) -> None:
    """Convert sips RGB PNG output to RGBA, preserving fully opaque pixels."""
    raw = path.read_bytes()
    signature = b"\x89PNG\r\n\x1a\n"
    if not raw.startswith(signature):
        raise ValueError(f"Not a PNG file: {path}")

    pos = len(signature)
    before_idat_chunks: list[tuple[bytes, bytes]] = []
    after_idat_chunks: list[tuple[bytes, bytes]] = []
    idat = bytearray()
    seen_idat = False
    width = height = bit_depth = color_type = None

    while pos < len(raw):
        length = struct.unpack(">I", raw[pos : pos + 4])[0]
        kind = raw[pos + 4 : pos + 8]
        data = raw[pos + 8 : pos + 8 + length]
        pos += 12 + length

        if kind == b"IHDR":
            width, height, bit_depth, color_type, compression, filter_method, interlace = struct.unpack(
                ">IIBBBBB", data
            )
            if compression != 0 or filter_method != 0 or interlace != 0:
                raise ValueError(f"Unsupported PNG encoding in {path}")
        elif kind == b"IDAT":
            seen_idat = True
            idat.extend(data)
        else:
            if kind != b"IEND":
                target = after_idat_chunks if seen_idat else before_idat_chunks
                target.append((kind, data))

    if color_type == 6:
        return
    if color_type != 2 or bit_depth != 8 or width is None or height is None:
        raise ValueError(f"Expected 8-bit RGB/RGBA PNG, got color type {color_type}: {path}")

    rows = unfilter_scanlines(zlib.decompress(bytes(idat)), width, height, 3)
    rgba_rows = bytearray()
    for row in rows:
        rgba_rows.append(0)
        for idx in range(0, len(row), 3):
            rgba_rows.extend(row[idx : idx + 3])
            rgba_rows.append(255)

    ihdr = struct.pack(">IIBBBBB", width, height, bit_depth, 6, 0, 0, 0)
    output = bytearray(signature)
    output.extend(png_chunk(b"IHDR", ihdr))
    for kind, data in before_idat_chunks:
        output.extend(png_chunk(kind, data))
    output.extend(png_chunk(b"IDAT", zlib.compress(bytes(rgba_rows), level=9)))
    for kind, data in after_idat_chunks:
        output.extend(png_chunk(kind, data))
    output.extend(png_chunk(b"IEND", b""))
    path.write_bytes(output)


def read_rgba_png(path: Path) -> tuple[int, int, bytearray]:
    raw = path.read_bytes()
    signature = b"\x89PNG\r\n\x1a\n"
    if not raw.startswith(signature):
        raise ValueError(f"Not a PNG file: {path}")

    pos = len(signature)
    idat = bytearray()
    width = height = bit_depth = color_type = None
    compression = filter_method = interlace = None

    while pos < len(raw):
        length = struct.unpack(">I", raw[pos : pos + 4])[0]
        kind = raw[pos + 4 : pos + 8]
        data = raw[pos + 8 : pos + 8 + length]
        pos += 12 + length

        if kind == b"IHDR":
            width, height, bit_depth, color_type, compression, filter_method, interlace = struct.unpack(
                ">IIBBBBB", data
            )
        elif kind == b"IDAT":
            idat.extend(data)

    if (
        width is None
        or height is None
        or bit_depth != 8
        or color_type not in {2, 6}
        or compression != 0
        or filter_method != 0
        or interlace != 0
    ):
        raise ValueError(f"Expected non-interlaced 8-bit RGB/RGBA PNG: {path}")

    source_bpp = 4 if color_type == 6 else 3
    rows = unfilter_scanlines(zlib.decompress(bytes(idat)), width, height, source_bpp)
    pixels = bytearray(width * height * 4)
    out = 0
    for row in rows:
        for idx in range(0, len(row), source_bpp):
            pixels[out : out + 3] = row[idx : idx + 3]
            pixels[out + 3] = row[idx + 3] if source_bpp == 4 else 255
            out += 4

    return width, height, pixels


def write_rgba_png(path: Path, width: int, height: int, pixels: bytearray) -> None:
    rows = bytearray()
    stride = width * 4
    for y in range(height):
        rows.append(0)
        start = y * stride
        rows.extend(pixels[start : start + stride])

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    output = bytearray(signature)
    output.extend(png_chunk(b"IHDR", ihdr))
    output.extend(png_chunk(b"IDAT", zlib.compress(bytes(rows), level=9)))
    output.extend(png_chunk(b"IEND", b""))
    path.write_bytes(output)


def rounded_rect_distance(x: float, y: float, width: int, height: int) -> float:
    left = width * 0.041
    top = height * 0.034
    right = width * 0.957
    bottom = height * 0.944
    radius = min(width, height) * 0.155

    center_x = (left + right) / 2
    center_y = (top + bottom) / 2
    half_x = max((right - left) / 2 - radius, 0)
    half_y = max((bottom - top) / 2 - radius, 0)
    dx = abs(x - center_x) - half_x
    dy = abs(y - center_y) - half_y
    outside = math.hypot(max(dx, 0), max(dy, 0))
    inside = min(max(dx, dy), 0)
    return outside + inside - radius


def apply_app_icon_mask(path: Path) -> None:
    width, height, pixels = read_rgba_png(path)
    for y in range(height):
        for x in range(width):
            distance = rounded_rect_distance(x + 0.5, y + 0.5, width, height)
            idx = (y * width + x) * 4 + 3
            if distance >= 0.75:
                pixels[idx] = 0
            elif distance > -0.75:
                coverage = (0.75 - distance) / 1.5
                pixels[idx] = round(pixels[idx] * max(0, min(1, coverage)))
    write_rgba_png(path, width, height, pixels)


def apply_tray_template_mask(path: Path) -> None:
    width, height, pixels = read_rgba_png(path)
    base_mask = [[False for _ in range(width)] for _ in range(height)]

    for y in range(height):
        for x in range(width):
            idx = (y * width + x) * 4
            r, g, b = pixels[idx], pixels[idx + 1], pixels[idx + 2]
            luma = (0.2126 * r) + (0.7152 * g) + (0.0722 * b)
            saturation = max(r, g, b) - min(r, g, b)
            base_mask[y][x] = saturation > 34 or luma < 205

    radius = max(1, round(width / 16))
    for y in range(height):
        for x in range(width):
            keep = False
            for yy in range(max(0, y - radius), min(height, y + radius + 1)):
                for xx in range(max(0, x - radius), min(width, x + radius + 1)):
                    if (xx - x) ** 2 + (yy - y) ** 2 <= radius**2 and base_mask[yy][xx]:
                        keep = True
                        break
                if keep:
                    break

            idx = (y * width + x) * 4
            pixels[idx : idx + 3] = b"\x00\x00\x00"
            pixels[idx + 3] = 255 if keep else 0

    write_rgba_png(path, width, height, pixels)


def distance_to_segment(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx = bx - ax
    dy = by - ay
    length_sq = (dx * dx) + (dy * dy)
    if length_sq == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0, min(1, (((px - ax) * dx) + ((py - ay) * dy)) / length_sq))
    return math.hypot(px - (ax + (t * dx)), py - (ay + (t * dy)))


def angle_in_c_arc(angle: float) -> bool:
    degrees = math.degrees(angle)
    if degrees < 0:
        degrees += 360
    return 52 <= degrees <= 308


def angle_in_d_arc(angle: float) -> bool:
    degrees = math.degrees(angle)
    return -82 <= degrees <= 82


def tray_template_hit(x: float, y: float, size: int) -> bool:
    center_x = size * 0.50
    center_y = size * 0.50
    radius = size * 0.355
    c_stroke = max(2.0, size * 0.145)
    angle = math.atan2(y - center_y, x - center_x)
    c_distance = abs(math.hypot(x - center_x, y - center_y) - radius)

    start_angle = math.radians(52)
    end_angle = math.radians(308)
    cap_a = (
        center_x + (math.cos(start_angle) * radius),
        center_y + (math.sin(start_angle) * radius),
    )
    cap_b = (
        center_x + (math.cos(end_angle) * radius),
        center_y + (math.sin(end_angle) * radius),
    )
    c_arc = angle_in_c_arc(angle) and c_distance <= c_stroke / 2
    c_caps = min(math.hypot(x - cap_a[0], y - cap_a[1]), math.hypot(x - cap_b[0], y - cap_b[1])) <= c_stroke / 2

    d_center_x = size * 0.43
    d_center_y = size * 0.50
    d_radius = size * 0.17
    d_stroke = max(1.15, size * 0.072)
    d_angle = math.atan2(y - d_center_y, x - d_center_x)
    d_arc_distance = abs(math.hypot(x - d_center_x, y - d_center_y) - d_radius)
    d_arc = angle_in_d_arc(d_angle) and d_arc_distance <= d_stroke / 2
    d_bar = distance_to_segment(
        x,
        y,
        d_center_x,
        d_center_y - d_radius,
        d_center_x,
        d_center_y + d_radius,
    ) <= d_stroke / 2

    return c_arc or c_caps or d_arc or d_bar


def generate_tray_template_icon(size: int, dst: Path) -> None:
    scale = 8
    pixels = bytearray(size * size * 4)
    samples = scale * scale

    for y in range(size):
        for x in range(size):
            hits = 0
            for sy in range(scale):
                sample_y = y + ((sy + 0.5) / scale)
                for sx in range(scale):
                    sample_x = x + ((sx + 0.5) / scale)
                    if tray_template_hit(sample_x, sample_y, size):
                        hits += 1

            alpha = round(255 * hits / samples)
            idx = (y * size + x) * 4
            pixels[idx : idx + 4] = bytes([0, 0, 0, alpha])

    write_rgba_png(dst, size, size, pixels)


def png_bytes(size: int, tmp_dir: Path, *, app_mask: bool = True) -> bytes:
    dst = tmp_dir / f"icon-{size}.png"
    resize_png(size, dst, app_mask=app_mask)
    return dst.read_bytes()


def embedded_png_svg(size: int, png: bytes) -> str:
    b64 = base64.b64encode(png).decode("ascii")
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{size}" height="{size}">
  <image width="{size}" height="{size}" xlink:href="data:image/png;base64,{b64}"/>
</svg>'''


def generate_png_icons() -> None:
    print("\n[1] Generating desktop PNG icons...")
    sizes = [16, 32, 48, 64, 128, 256, 512, 1024]

    for size in sizes:
        resize_png(size, TARGET_ICONS_DIR / f"{size}x{size}.png", app_mask=True)
        print(f"  Generated: {size}x{size}.png")

    resize_png(256, TARGET_ICONS_DIR / "128x128@2x.png", app_mask=True)
    resize_png(1024, TARGET_ICONS_DIR / "512x512@2x.png", app_mask=True)
    resize_png(1024, TARGET_ICONS_DIR / "icon.png", app_mask=True)
    print("  Generated: 128x128@2x.png (256x256)")
    print("  Generated: 512x512@2x.png (1024x1024)")
    print("  Generated: icon.png (1024x1024)")


def generate_iconset() -> None:
    print("\n[2] Generating macOS iconset...")
    iconset_dir = TARGET_ICONS_DIR / "icon.iconset"
    iconset_dir.mkdir(exist_ok=True)

    sizes = [
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

    for size, name in sizes:
        resize_png(size, iconset_dir / name, app_mask=True)
        print(f"  Generated: {name} ({size}x{size})")


def generate_icns() -> None:
    print("\n[3] Generating icon.icns...")
    subprocess.run(
        [
            "iconutil",
            "-c",
            "icns",
            "-o",
            str(TARGET_ICONS_DIR / "icon.icns"),
            str(TARGET_ICONS_DIR / "icon.iconset"),
        ],
        check=True,
    )
    print("  Generated: icon.icns")


def generate_ico() -> None:
    print("\n[4] Generating icon.ico...")
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]

    with tempfile.TemporaryDirectory(prefix="codata-ico-") as tmp:
        tmp_dir = Path(tmp)
        images = [(size, png_bytes(size, tmp_dir)) for size in ico_sizes]

    header = struct.pack("<HHH", 0, 1, len(images))
    entries = []
    offset = len(header) + (16 * len(images))
    for size, image in images:
        dimension = 0 if size == 256 else size
        entries.append(
            struct.pack(
                "<BBBBHHII",
                dimension,
                dimension,
                0,
                0,
                1,
                32,
                len(image),
                offset,
            )
        )
        offset += len(image)

    (TARGET_ICONS_DIR / "icon.ico").write_bytes(
        header + b"".join(entries) + b"".join(image for _, image in images)
    )
    print("  Generated: icon.ico")


def generate_windows_tiles() -> None:
    print("\n[5] Generating Windows tile icons...")
    sizes = [
        (30, "Square30x30Logo.png"),
        (44, "Square44x44Logo.png"),
        (71, "Square71x71Logo.png"),
        (89, "Square89x89Logo.png"),
        (107, "Square107x107Logo.png"),
        (142, "Square142x142Logo.png"),
        (150, "Square150x150Logo.png"),
        (284, "Square284x284Logo.png"),
        (310, "Square310x310Logo.png"),
        (50, "StoreLogo.png"),
    ]

    for size, name in sizes:
        resize_png(size, TARGET_ICONS_DIR / name, app_mask=True)
        print(f"  Generated: {name} ({size}x{size})")


def generate_ios_icons() -> None:
    print("\n[6] Generating iOS AppIcon sizes...")
    ios_dir = TARGET_ICONS_DIR / "ios"
    ios_dir.mkdir(exist_ok=True)

    sizes = [
        (20, "AppIcon-20x20@1x.png"),
        (40, "AppIcon-20x20@2x.png"),
        (20, "AppIcon-20x20@2x-1.png"),
        (60, "AppIcon-20x20@3x.png"),
        (29, "AppIcon-29x29@1x.png"),
        (58, "AppIcon-29x29@2x.png"),
        (29, "AppIcon-29x29@2x-1.png"),
        (87, "AppIcon-29x29@3x.png"),
        (40, "AppIcon-40x40@1x.png"),
        (80, "AppIcon-40x40@2x.png"),
        (40, "AppIcon-40x40@2x-1.png"),
        (120, "AppIcon-40x40@3x.png"),
        (120, "AppIcon-60x60@2x.png"),
        (180, "AppIcon-60x60@3x.png"),
        (76, "AppIcon-76x76@1x.png"),
        (152, "AppIcon-76x76@2x.png"),
        (167, "AppIcon-83.5x83.5@2x.png"),
        (1024, "AppIcon-512@2x.png"),
    ]

    for size, name in sizes:
        resize_png(size, ios_dir / name, app_mask=True)
        print(f"  Generated iOS: {name} ({size}x{size})")


def generate_tray_icons() -> None:
    print("\n[7] Generating tray icons...")
    for size, name in [(16, "tray-template.png"), (32, "tray-template@2x.png")]:
        generate_tray_template_icon(size, TARGET_ICONS_DIR / name)
        print(f"  Generated: {name} ({size}x{size})")


def generate_web_icons() -> None:
    print("\n[8] Generating web icons...")
    FRONTEND_PUBLIC.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="codata-web-icons-") as tmp:
        tmp_dir = Path(tmp)
        favicon_png = png_bytes(32, tmp_dir)
        logo_svg_png = png_bytes(128, tmp_dir)

    resize_png(512, FRONTEND_PUBLIC / "logo-512.png", app_mask=True)
    (FRONTEND_PUBLIC / "favicon.svg").write_text(embedded_png_svg(32, favicon_png))
    (FRONTEND_PUBLIC / "logo.svg").write_text(embedded_png_svg(128, logo_svg_png))
    print("  Generated: frontend/public/favicon.svg")
    print("  Generated: frontend/public/logo.svg")
    print("  Generated: frontend/public/logo-512.png")


def main() -> None:
    print(f"Source: {SOURCE_FILE}")
    print(f"Target: {TARGET_ICONS_DIR}")

    if not SOURCE_FILE.is_file():
        raise SystemExit(f"ERROR: source icon does not exist: {SOURCE_FILE}")

    require_tool("sips")
    require_tool("iconutil")
    TARGET_ICONS_DIR.mkdir(parents=True, exist_ok=True)

    generate_png_icons()
    generate_iconset()
    generate_icns()
    generate_ico()
    generate_windows_tiles()
    generate_ios_icons()
    generate_tray_icons()
    generate_web_icons()

    print("\nAll icons generated successfully.")
    print(f"   Source: {SOURCE_FILE}")
    print(f"   Target: {TARGET_ICONS_DIR}")


if __name__ == "__main__":
    main()
