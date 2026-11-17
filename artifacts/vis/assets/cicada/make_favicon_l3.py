#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
make_favicon_l3.py - L3 favicon 独立重画（v2.3）

主理人裁决：favicon 必须**独立重画**（不缩放 MAX 帧），并修掉 4 项验收冲突。

四项冲突（fe-engineer 实测）：
  63  缺 favicon-180.png（apple-touch）
  66  全档透明 69.5%-76.0%（用户裁决：保留透明底，改由深紫描边保证深底可辨）
  67  16px 主体高仅 8px，规范要求 >=10px
  +   favicon.svg 的 viewBox 是 MAX 原画板，与 16px 档方形构图不同构

v2.3 最终设计 —— **画布比例随档位变**（favicon 的画布不必是方的）：

  · 16px 档：**方形 16x16**，主体高占 69%（>=10px，规范硬要求）。
    此档像素极紧，必须压 x（登记为「禁非等比拉伸」的例外）。
  · 32px 及以上：**长方形 16x8**，主体**等比**（宽高比 2.17，与 MAX 帧一致）。
    像素够了就不该压缩 —— 形状准确度优先。浏览器标签栏按图标自身比例显示，
    不要求方形。

这样同时满足：16px 可辨（主体高 >=10px）/ 大档形状最准（等比无变形）/
全档不裁切（主体宽 <= 画布宽的 88%）。

v2.2 的教训：单纯用「目标压缩比 x sy」在大档位会被宽上限一压到底，
结果 48/64/180 三档全变成同一个比例 1.28 —— 分级形同虚设。
"""

import io
import os
import re

import numpy as np

ROOT = r"E:/Projects/model-downloader"
SVG_DIR = os.path.join(ROOT, "artifacts/vis/assets/cicada/svg")
PNG_DIR = os.path.join(ROOT, "artifacts/vis/assets/cicada/png")
ICO_DIR = os.path.join(ROOT, "artifacts/vis/assets/cicada/ico")

DEEP = "#2a0a2e"       # 规范深紫描边色
BANDS = ["#3a0a3f", "#6d0a5e", "#a3389c", "#d2477e", "#f4776a"]

TARGET_H_RATIO = 0.6875  # 16px 档主体高占画布（11/16px）
BODY_W_MAX = 0.88         # 主体宽最多占画布 88%
X_COMPRESS_16 = 0.46      # 仅 16px 档的非等比压缩比

# 画布比例：16px 方形；32px+ 长方形（等比展翅）
CANVAS = {16: (16.0, 16.0), 32: (16.0, 8.0), 48: (16.0, 8.0),
          64: (16.0, 8.0), 180: (16.0, 8.0)}


def load_max():
    """读 MAX 矢量，提取面片多边形（源像素坐标）。跳过白色底衬。"""
    src = os.path.join(SVG_DIR, "cicada-max.svg")
    s = io.open(src, encoding="utf-8").read()
    els = []
    for m in re.finditer(
            r'<(polygon|path)\s+id="([^"]*)"\s+(points|d)="([^"]*)"\s+fill="(?:url\(#\w+\)|#[0-9a-fA-F]{6})"',
            s):
        tag, eid, geom, data = m.groups()
        if eid.startswith("seam-base"):
            continue
        n = [float(x) for x in re.findall(r"-?[\d.]+", data)]
        pts = list(zip(n[0::2], n[1::2]))
        if len(pts) >= 3:
            els.append((eid, pts))
    return els


def build_svg_for(size, els, x0, x1, y0, sw, sh):
    """按档位生成 favicon SVG。返回 (svg, 主体宽, 主体高, 画布宽, 画布高)。"""
    canvas_w, canvas_h = CANVAS.get(size, (16.0, 8.0))

    if size <= 16:
        # 方形画布 + 压 x（像素紧，必须换高度）
        sy = (canvas_h * TARGET_H_RATIO) / sh
        sx = sy * X_COMPRESS_16
        sx_cap = (canvas_w * BODY_W_MAX) / sw
        if sx > sx_cap:
            sx = sx_cap
        note = "方形：像素紧，压 x 保主体高 >=10px"
    else:
        # 长方形画布 + 等比（形状最准）
        sx = sy = (canvas_w * BODY_W_MAX) / sw
        if sh * sy > canvas_h * BODY_W_MAX:
            sy = (canvas_h * BODY_W_MAX) / sh
            sx = sy
        note = "长方形：等比展翅，形状最准"

    body_w = sw * sx
    body_h = sh * sy
    ox = (canvas_w - body_w) / 2.0
    oy = (canvas_h - body_h) / 2.0

    def tx(p):
        return (ox + (p[0] - x0) * sx, oy + (p[1] - y0) * sy)

    groups = {}
    for eid, pts in els:
        cx = sum(p[0] for p in pts) / len(pts)
        t = (cx - x0) / max(1.0, (x1 - x0))
        idx = int(min(len(BANDS) - 1, max(0, round(t * (len(BANDS) - 1)))))
        groups.setdefault(idx, []).append((eid, pts))

    def subpaths(items):
        out = []
        for eid, pts in items:
            out.append("M" + " L".join("%.4f %.4f" % tx(p) for p in pts) + " Z")
        return " ".join(out)

    stroke = 0.5 if size <= 16 else (0.16 if size <= 32 else 0.08)

    parts = [
        "<!-- SiMuseor 蝉形 · L3 favicon · %dpx 档" % size,
        "     画布 %.0fx%.0f（%s）" % (canvas_w, canvas_h, note),
        "     主体 %.2fx%.2f（占画布 %.0f%%x%.0f%%，宽高比 %.2f）"
        % (body_w, body_h, 100 * body_w / canvas_w, 100 * body_h / canvas_h,
           body_w / body_h),
        "     5 档色带（plum→orange）+ 深紫描边 %s" % DEEP,
        "     透明底（深色 OS 标签栏下靠描边保轮廓，不用不透明浅底）",
        "     非等比例外：仅 16px 档（x=%.2f）；32px+ 等比 -->" % X_COMPRESS_16,
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %g %g" width="%g" height="%g" '
        'role="img" aria-hidden="true">' % (canvas_w, canvas_h, canvas_w, canvas_h),
        '  <path id="outline" d="%s" fill="none" stroke="%s" stroke-width="%.3f" '
        'stroke-linejoin="round" stroke-linecap="round" fill-rule="evenodd"/>'
        % (subpaths(els), DEEP, stroke),
    ]
    for idx in sorted(groups):
        parts.append('  <path id="band-%d" d="%s" fill="%s" fill-rule="evenodd"/>'
                     % (idx, subpaths(groups[idx]), BANDS[idx]))
    parts.append("</svg>")
    return chr(10).join(parts) + chr(10), body_w, body_h, canvas_w, canvas_h


def main():
    import cairosvg
    from PIL import Image

    els = load_max()
    print("MAX 面片: %d" % len(els))
    if not els:
        print("ERROR: 未读到面片")
        return

    allp = []
    for eid, pts in els:
        allp.extend(pts)
    x0 = min(p[0] for p in allp)
    x1 = max(p[0] for p in allp)
    y0 = min(p[1] for p in allp)
    y1 = max(p[1] for p in allp)
    sw, sh = x1 - x0, y1 - y0

    os.makedirs(PNG_DIR, exist_ok=True)
    os.makedirs(ICO_DIR, exist_ok=True)

    for size in (16, 32, 48, 64, 180):
        svg, bw, bh, cw, ch = build_svg_for(size, els, x0, x1, y0, sw, sh)
        print("  %3dpx 档: 画布 %.0fx%.0f 主体 %.2fx%.2f（占 %.0f%%x%.0f%% 宽高比 %.2f）"
              % (size, cw, ch, bw, bh, 100 * bw / cw, 100 * bh / ch, bw / bh))
        tmp_svg = os.path.join(SVG_DIR, "_tmp_fav_%d.svg" % size)
        io.open(tmp_svg, "w", encoding="utf-8", newline="").write(svg)
        tmp_png = os.path.join(PNG_DIR, "_tmp_fav.png")
        cairosvg.svg2png(url=tmp_svg, write_to=tmp_png,
                         output_width=size, output_height=int(round(size * ch / cw)))
        im = Image.open(tmp_png).convert("RGBA")
        im.save(os.path.join(PNG_DIR, "favicon-%d.png" % size))
        os.remove(tmp_png)
        os.remove(tmp_svg)
        if size == 32:
            io.open(os.path.join(SVG_DIR, "favicon.svg"), "w",
                    encoding="utf-8", newline="").write(svg)

    ims = [Image.open(os.path.join(PNG_DIR, "favicon-%d.png" % s)).convert("RGBA")
           for s in (16, 32, 48)]
    ico = os.path.join(ICO_DIR, "favicon.ico")
    ims[-1].save(ico, format="ICO", sizes=[(16, 16), (32, 16), (48, 24)],
                 append_images=ims[:-1])
    print("ICO -> %s (%d B)" % (os.path.basename(ico), os.path.getsize(ico)))

    for s in (16, 32, 48, 64, 180):
        a = np.asarray(Image.open(os.path.join(PNG_DIR, "favicon-%d.png" % s)).convert("RGBA"))
        op = a[:, :, 3] > 10
        ys, xs = np.nonzero(op)
        touch = (xs.min() == 0) or (xs.max() == a.shape[1] - 1)
        print("  %3dpx: 画布 %dx%d 主体 %dx%d 透明 %.1f%% %s"
              % (s, a.shape[1], a.shape[0], xs.max() - xs.min() + 1,
                 ys.max() - ys.min() + 1, 100 * (~op).sum() / op.size,
                 "⚠ 触边=被裁" if touch else "无裁切"))


if __name__ == "__main__":
    main()
