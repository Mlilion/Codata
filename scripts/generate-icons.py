#!/usr/bin/env python3
"""Generate all icons from high-resolution source using ImageMagick.

Pure resize only - no transparency or other processing.

Usage:
    python3 scripts/generate-icons.py

Requirements:
    - ImageMagick (magick command)
    - macOS iconutil for icns generation
"""

import base64
import subprocess
import shutil
from pathlib import Path

# Paths
PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE_FILE = PROJECT_ROOT / "desktop-tauri/src-tauri/workcrf-v2-tauri-icons/niuma.png"
TARGET_ICONS_DIR = PROJECT_ROOT / "desktop-tauri/src-tauri/icons"
FRONTEND_PUBLIC = PROJECT_ROOT / "frontend/public"


def run_magick(args: list, description: str = "") -> bool:
    """Run ImageMagick magick command."""
    cmd = ["magick"] + args
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ERROR: {description} - {result.stderr}")
        return False
    return True


def generate_png_icons():
    """Generate all PNG sizes - pure resize."""
    print("\n[1] Generating PNG icons...")
    sizes = [16, 32, 48, 64, 128, 256, 512, 1024]

    for size in sizes:
        dst = TARGET_ICONS_DIR / f"{size}x{size}.png"
        run_magick([str(SOURCE_FILE), "-resize", f"{size}x{size}", str(dst)])
        print(f"  Generated: {size}x{size}.png")

    # @2x variants
    run_magick([str(SOURCE_FILE), "-resize", "256x256", str(TARGET_ICONS_DIR / "128x128@2x.png")])
    run_magick([str(SOURCE_FILE), "-resize", "1024x1024", str(TARGET_ICONS_DIR / "512x512@2x.png")])
    print("  Generated: 128x128@2x.png (256x256)")
    print("  Generated: 512x512@2x.png (1024x1024)")

    # icon.png
    run_magick([str(SOURCE_FILE), "-resize", "512x512", str(TARGET_ICONS_DIR / "icon.png")])
    print("  Generated: icon.png (512x512)")


def generate_iconset():
    """Generate icon.iconset for macOS - pure resize."""
    print("\n[2] Generating icon.iconset...")
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
        dst = iconset_dir / name
        run_magick([str(SOURCE_FILE), "-resize", f"{size}x{size}", str(dst)])
        print(f"  Generated: {name} ({size}x{size})")


def generate_icns():
    """Generate icon.icns using iconutil."""
    print("\n[3] Generating icon.icns...")
    iconset_dir = TARGET_ICONS_DIR / "icon.iconset"
    icns_path = TARGET_ICONS_DIR / "icon.icns"

    if shutil.which("iconutil"):
        subprocess.run(["iconutil", "-c", "icns", "-o", str(icns_path), str(iconset_dir)], check=True)
        print(f"  Generated: icon.icns")
    else:
        print("  WARNING: iconutil not found (macOS only)")


def generate_ico():
    """Generate Windows ICO - pure resize."""
    print("\n[4] Generating icon.ico...")
    dst = TARGET_ICONS_DIR / "icon.ico"
    run_magick([
        str(SOURCE_FILE),
        "-define", "icon:auto-resize=256,128,64,48,32,16",
        str(dst)
    ])
    print(f"  Generated: icon.ico")


def generate_windows_tiles():
    """Generate Windows Store tile icons - pure resize."""
    print("\n[5] Generating Windows tiles...")
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
        dst = TARGET_ICONS_DIR / name
        run_magick([str(SOURCE_FILE), "-resize", f"{size}x{size}", str(dst)])
        print(f"  Generated: {name} ({size}x{size})")


def generate_ios_icons():
    """Generate iOS AppIcon sizes - pure resize."""
    print("\n[6] Generating iOS icons...")
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
        dst = ios_dir / name
        run_magick([str(SOURCE_FILE), "-resize", f"{size}x{size}", str(dst)])
        print(f"  Generated iOS: {name} ({size}x{size})")


def generate_tray_icons():
    """Generate macOS tray icons - pure resize."""
    print("\n[7] Generating tray icons...")
    for size, name in [(22, "tray-template.png"), (44, "tray-template@2x.png")]:
        dst = TARGET_ICONS_DIR / name
        run_magick([str(SOURCE_FILE), "-resize", f"{size}x{size}", str(dst)])
        print(f"  Generated: {name} ({size}x{size})")


def generate_favicon():
    """Generate web favicon - pure resize + base64."""
    print("\n[8] Generating favicon...")
    tmp_png = "/tmp/favicon-32.png"
    run_magick([str(SOURCE_FILE), "-resize", "32x32", tmp_png])

    with open(tmp_png, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")

    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="32" height="32">
  <image width="32" height="32" xlink:href="data:image/png;base64,{b64}"/>
</svg>'''

    (FRONTEND_PUBLIC / "favicon.svg").write_text(svg)
    print("  Generated: frontend/public/favicon.svg")


def main():
    print(f"Source: {SOURCE_FILE}")
    print(f"Target: {TARGET_ICONS_DIR}")

    # Ensure ImageMagick is available
    if not shutil.which("magick"):
        print("ERROR: ImageMagick (magick) not found. Install with: brew install imagemagick")
        return

    # Create directories
    TARGET_ICONS_DIR.mkdir(exist_ok=True)

    generate_png_icons()
    generate_iconset()
    generate_icns()
    generate_ico()
    generate_windows_tiles()
    generate_ios_icons()
    generate_tray_icons()
    generate_favicon()

    print("\n✅ All icons generated successfully!")
    print(f"   Source: {SOURCE_FILE}")
    print(f"   Target: {TARGET_ICONS_DIR}")


if __name__ == "__main__":
    main()