#!/usr/bin/env python3
"""Render the article's tables as PNG (小黑盒 has no markdown tables).

    python3 scripts/render-tables.py      # also run by: npm run article:assets

Writes docs/images/table-status.png in the style of docs/images/table-storage.png (light grey
header, white rows, thin grey borders, Noto Sans CJK). The status colours are drawn as circles,
so no emoji font is needed. Edit ROWS below when the sidebar texts change.
"""
import glob, os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "images", "table-status.png")
GREEN, YELLOW, GREY, RED = (52, 199, 89), (255, 204, 0), (209, 213, 219), (255, 59, 48)
HEAD = ["颜色", "文字", "你要做什么"]
ROWS = [
    (GREEN, "记忆正常", "啥也不用管"),
    (YELLOW, "正在准备 / 模型被限流", "等一会儿，要记的内容不会丢"),
    (YELLOW, "模型地址连不上", "打开你给 dsh 用的那个本机模型程序，连上后自动继续"),
    (YELLOW, "N 段没整理好", "会自动重试；也可以去「状态」页点「重试失败项」"),
    (GREY, "需要设置", "点它，去填密钥"),
    (RED, "出问题了", "点它看原因，一般点「重试」就好"),
]
S = 2  # pixel scale (the reference image is a 2x screenshot)
W = 885 * S
COLS = [130 * S, 300 * S, W - 430 * S - 2 * S]
HEAD_H, ROW_H, PAD = 48 * S, 46 * S, 18 * S
BORDER, HEAD_BG, TEXT = (226, 229, 234), (242, 244, 247), (38, 38, 38)


def font(bold, size):
    want = "NotoSansCJK-%s" % ("Bold" if bold else "Regular")
    for d in ["/usr/share/fonts", "/usr/local/share/fonts", os.path.expanduser("~/.fonts"), "/Library/Fonts", "C:/Windows/Fonts"]:
        for p in glob.glob(os.path.join(d, "**", want + ".tt[cf]"), recursive=True):
            for i in range(10):
                try:
                    f = ImageFont.truetype(p, size, index=i)
                except OSError:
                    break
                if f.getname()[0] == "Noto Sans CJK SC":
                    return f
    sys.exit("找不到 Noto Sans CJK 字体")


def main():
    H = HEAD_H + ROW_H * len(ROWS) + 2 * S
    im = Image.new("RGB", (W, H), "white"); d = ImageDraw.Draw(im)
    fb, fr = font(True, 15 * S), font(False, 15 * S)
    d.rectangle([0, 0, W - 1, HEAD_H], fill=HEAD_BG)
    xs = [S]
    for w in COLS: xs.append(xs[-1] + w)
    for i, t in enumerate(HEAD):
        d.text((xs[i] + PAD, HEAD_H // 2), t, font=fb, fill=TEXT, anchor="lm")
    for r, (color, a, b) in enumerate(ROWS):
        y = HEAD_H + r * ROW_H; cy = y + ROW_H // 2; rad = 8 * S
        cx = xs[0] + PAD + rad
        d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=color, outline=tuple(max(0, c - 40) for c in color), width=S)
        d.text((xs[1] + PAD, cy), a, font=fr, fill=TEXT, anchor="lm")
        d.text((xs[2] + PAD, cy), b, font=fr, fill=TEXT, anchor="lm")
    for k in range(len(ROWS) + 1):
        y = HEAD_H + k * ROW_H; d.rectangle([0, y, W - 1, y + S - 1], fill=BORDER)
    d.rectangle([0, 0, W - 1, S - 1], fill=BORDER); d.rectangle([0, H - S, W - 1, H - 1], fill=BORDER)
    for x in xs[:-1] + [W - S]: d.rectangle([x - S if x > S else 0, 0, x - 1 if x > S else S - 1, H - 1], fill=BORDER)
    im.save(OUT, optimize=True)
    print("wrote docs/images/table-status.png")


if __name__ == "__main__":
    main()
