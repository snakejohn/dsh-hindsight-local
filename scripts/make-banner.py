#!/usr/bin/env python3
"""Regenerate docs/images/banner.png (1280x640, GitHub social preview) and
docs/images/cover.png (1920x1080, article cover) with the version from package.json.

    npm run release:assets        # or: python3 scripts/make-banner.py

Needs Pillow (pip install pillow) and Noto Sans CJK (Debian/Ubuntu: fonts-noto-cjk;
Windows/macOS: install "Noto Sans CJK SC" or pass --font-dir). The version is also written
into each PNG as a text chunk ("dsh-hindsight-version"), which tests/test-release-assets.mjs
checks against package.json, so a stale banner fails `npm test`.
"""
import argparse, glob, json, os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter, PngImagePlugin

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, "docs", "images")
FONT_DIRS = ["/usr/share/fonts", "/usr/local/share/fonts", os.path.expanduser("~/.fonts"),
             os.path.expanduser("~/Library/Fonts"), "/Library/Fonts", "C:/Windows/Fonts"]


def find_font(bold, dirs):
    want = "NotoSansCJK-%s" % ("Bold" if bold else "Regular")
    for d in dirs:
        for p in glob.glob(os.path.join(d, "**", want + ".tt[cf]"), recursive=True) + \
                 glob.glob(os.path.join(d, "**", want.replace("CJK", "CJKsc") + ".otf"), recursive=True):
            return p
    sys.exit("找不到 %s（请安装 Noto Sans CJK，或用 --font-dir 指定字体目录）" % want)


def loader(dirs):
    paths = {b: find_font(b, dirs) for b in (True, False)}
    def font(bold, size):
        p = paths[bold]
        for i in range(10):
            try:
                f = ImageFont.truetype(p, size, index=i)
            except OSError:
                break
            if f.getname()[0] == "Noto Sans CJK SC":
                return f
        return ImageFont.truetype(p, size)
    return font


def make(W, H, out, version, font, mascot):
    s = H / 640
    bg = Image.new("RGB", (W, H))
    bg.putdata([(int(232 - 40 * t), int(242 - 22 * t), 255)
                for y in range(H) for x in range(W) for t in (x / W * 0.6 + y / H * 0.4,)])
    bl = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(bl)
    for cx, cy, r, c in [(.15, .2, .35, (120, 180, 255, 110)), (.85, .85, .4, (150, 130, 255, 90)), (.6, .1, .25, (120, 230, 255, 90))]:
        d.ellipse([W * cx - H * r, H * cy - H * r, W * cx + H * r, H * cy + H * r], fill=c)
    bg = Image.alpha_composite(bg.convert("RGBA"), bl.filter(ImageFilter.GaussianBlur(H * 0.12)))
    # mascot card
    ms = int(H * 0.82); m = mascot.resize((ms, ms), Image.LANCZOS)
    mx = W - ms - int(H * 0.08); my = (H - ms) // 2; rad = int(48 * s)
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([mx, my + 12 * s, mx + ms, my + ms + 12 * s], rad, fill=(40, 70, 160, 70))
    bg = Image.alpha_composite(bg, sh.filter(ImageFilter.GaussianBlur(24 * s)))
    mask = Image.new("L", (ms, ms), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, ms - 1, ms - 1], rad, fill=255)
    bg.paste(m, (mx, my), mask)
    ImageDraw.Draw(bg).rounded_rectangle([mx, my, mx + ms, my + ms], rad, outline=(255, 255, 255), width=max(3, int(4 * s)))
    # glass panel
    gx, gy = int(56 * s), int(130 * s); gw, gh = mx - gx - int(40 * s), int(380 * s)
    gl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(gl).rounded_rectangle([gx, gy, gx + gw, gy + gh], int(40 * s), fill=(255, 255, 255, 120), outline=(255, 255, 255, 200), width=max(2, int(2 * s)))
    bg = Image.alpha_composite(bg, gl); d = ImageDraw.Draw(bg)
    tx = gx + int(40 * s)
    pf = font(True, int(20 * s)); pt = "v" + version; pw = d.textlength(pt, font=pf)
    d.rounded_rectangle([tx, gy + int(36 * s), tx + pw + int(28 * s), gy + int(72 * s)], int(18 * s), fill=(10, 132, 255))
    d.text((tx + int(14 * s), gy + int(54 * s)), pt, font=pf, fill="white", anchor="lm")
    d.text((tx, gy + int(150 * s)), "dsh Hindsight", font=font(True, int(56 * s)), fill=(20, 30, 60), anchor="ls")
    d.text((tx, gy + int(222 * s)), "本地记忆插件", font=font(True, int(56 * s)), fill=(10, 100, 230), anchor="ls")
    sf = font(False, int(23 * s))
    d.text((tx, gy + int(280 * s)), "让角色扮演拥有永久记忆", font=sf, fill=(60, 75, 110), anchor="ls")
    d.text((tx, gy + int(320 * s)), "一键部署 · 小白友好 · 数据留在本机", font=sf, fill=(60, 75, 110), anchor="ls")
    d.text((gx, H - int(36 * s)), "github.com/snakejohn/dsh-hindsight-local", font=font(False, int(16 * s)), fill=(80, 100, 150))
    info = PngImagePlugin.PngInfo(); info.add_text("dsh-hindsight-version", version)
    bg.convert("RGB").save(out, optimize=True, pnginfo=info)
    print("wrote %s (v%s)" % (os.path.relpath(out, ROOT), version))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", help="default: package.json version")
    ap.add_argument("--font-dir", action="append", default=[])
    a = ap.parse_args()
    version = a.version or json.load(open(os.path.join(ROOT, "package.json"), encoding="utf-8"))["version"]
    font = loader(a.font_dir + FONT_DIRS)
    mascot = Image.open(os.path.join(IMG, "mascot.png")).convert("RGB")
    make(1280, 640, os.path.join(IMG, "banner.png"), version, font, mascot)
    make(1920, 1080, os.path.join(IMG, "cover.png"), version, font, mascot)


if __name__ == "__main__":
    main()
