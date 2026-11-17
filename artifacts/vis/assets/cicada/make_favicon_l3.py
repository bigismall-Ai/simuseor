#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
make_favicon_l3.py — L3 favicon 独立重画（v2.1）

主理人裁决：favicon 必须**独立重画**（不缩放 MAX 帧），并修掉 4 项验收冲突。

四项冲突（fe-engineer 实测）：
  63  缺 favicon-180.png（apple-touch）
  66  全档透明 69.5%–76.0%（用户裁决：保留透明底，改为用描边保证深底可辨）
  67  16px 主体高仅 8px，规范要求 ≥10px（须缩短翼展、抬升身体）
  ＋  favicon.svg 的 viewBox 是 MAX 原画板 0 0 1397 644，与 16px 方形构图不同构

本脚本：
  · **复用 MAX 矢量的真实面片几何**（不手绘、不重新分割）
  · **方形化构图**：主体高占画布 ≥62.5%（16px 档 ≥10px），横向不溢出
  · 面片按横向位置量化为 **5 档色带**（plum→orange），叠 **深紫描边 #2a0a2e**
  · **保留透明底**（用户裁决 2026-11-17）：不铺不透明底板，
    改由深紫描边保证深色 OS 标签栏下的轮廓可辨
  · 输出 svg / png(16,32,48,64,180) / ico(16,32,48)，**SVG 与 PNG 同构**
"""

import io
import os
import re

import numpy as np

ROOT = r"E:/Projects/model-downloader"
SVG_DIR = os.path.join(ROOT, "artifacts/vis/assets/cicada/svg")
PNG_DIR = os.path.join(ROOT, "artifacts/vis/assets/cicada/png")
ICO_DIR = os.path.join(ROOT, "artifacts/vis/assets/cicada/ico")

PAPER = "#f8f6f1"      # 浅底板色（登记值）
# 用户裁决（2026-11-17）：**保留透明底** —— 不铺 #f8f6f1 不透明底板。
# 理由：深色 OS 标签栏下不透明浅底会变成一块突兀白方块；
# 规范 §3.3 的「必须自带不透明底板」条款据此改为「底板随浏览器 chrome」，
# 验收项 66 的口径同步改为「深底可辨」（用描边保证轮廓不丢）。
DEEP = "#2a0a2e"       # 规范深紫描边色
BANDS = ["#3a0a3f", "#6d0a5e", "#a3389c", "#d2477e", "#f4776a"]

TARGET_H_RATIO = 0.6875  # 主体高占画布 ≥62.5%（取 11px/16px，向上取整留余量）
# x 方向压缩比（相对等比）—— **按档位分级**：
#   16px  重压 0.46 → 主体近方形（11×11），16px 下「身体」必须立得住
#   32px+ 轻压 0.62 → 主体宽高比 ≈1.35，保住展翅的横向舒展感
# 分级的理由：16px 是像素最紧的档，压缩换高度是划算的；
# 32px 以上像素够，压缩反而丢形态 —— 32px 档实测重压后「接缝白线消失、
# 翅膀失去展开感」。接缝白线随面片变窄而消失，故大档必须少压。
X_COMPRESS_BY_SIZE = {16: 0.46, 32: 0.62, 48: 0.66, 64: 0.68, 180: 0.72}
SIDE_PAD = 0.08          # 左右留白（仅作校验参考）


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
    """按档位生成方形化 favicon SVG。"""
    x_compress = X_COMPRESS_BY_SIZE.get(size, 0.62)
    target_h = 16.0 * TARGET_H_RATIO
    sy = target_h / sh
    sx = sy * x_compress
    body_w = sw * sx
    body_h = sh * sy
    ox = (16.0 - body_w) / 2.0
    oy = (16.0 - body_h) / 2.0

    def tx(p):
        return (ox + (p[0] - x0) * sx, oy + (p[1] - y0) * sy)

    # 色带：按面片中心横向位置分 5 档（MAX 帧横向即 plum→orange 的渐变方向）
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

    # 描边宽随尺寸收敛：16px 用 0.5（保住轮廓），大档用 0.16（不糊内部）
    stroke = 0.5 if size <= 16 else (0.28 if size <= 32 else 0.16)

    parts = ['<!-- SiMuseor 蝉形 · L3 favicon · %dpx 档' % size,
             '     方形化构图：主体高占画布 %.0f%%（16px 档 ≥10px）' % (100 * TARGET_H_RATIO),
             '     5 档色带（plum→orange）+ 深紫描边 %s' % DEEP,
             '     透明底（深色 OS 标签栏下靠描边保轮廓，不用不透明浅底）',
             '     非等比：x 压缩 %.2f（登记例外，仅 favicon 档位） -->' % x_compress,
             '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" '
             'role="img" aria-hidden="true">',
             '  <path id="outline" d="%s" fill="none" stroke="%s" stroke-width="%.3f" '
             'stroke-linejoin="round" stroke-linecap="round" fill-rule="evenodd"/>'
             % (subpaths(els), DEEP, stroke)]
    for idx in sorted(groups):
        parts.append('  <path id="band-%d" d="%s" fill="%s" fill-rule="evenodd"/>'
                     % (idx, subpaths(groups[idx]), BANDS[idx]))
    parts.append('</svg>')
    return chr(10).join(parts) + chr(10), body_w, body_h


def main():
    import cairosvg
    from PIL import Image

    els = load_max()
    print("MAX 面片: %d" % len(els))
    if not els:
        print("ERROR: 未读到面片")
        return

    allpts = [p for _, pts in els for p in pts]
    x0 = min(p[0] for p in allpts); x1 = max(p[0] for p in allpts)
    y0 = min(p[1] for p in allpts); y1 = max(p[1] for p in allpts)
    sw, sh = x1 - x0, y1 - y0

    os.makedirs(PNG_DIR, exist_ok=True)
    os.makedirs(ICO_DIR, exist_ok=True)

    for size in (16, 32, 48, 64, 180):
        svg, bw, bh = build_svg_for(size, els, x0, x1, y0, sw, sh)
        print("  %3dpx 档: 主体 %.2f×%.2f（高占比 %.0f%% 宽高比 %.2f）"
              % (size, bw, bh, 100 * bh / 16.0, bw / bh))
        tmp_svg = os.path.join(SVG_DIR, "_tmp_fav_%d.svg" % size)
        io.open(tmp_svg, "w", encoding="utf-8", newline="").write(svg)
        tmp_png = os.path.join(PNG_DIR, "_tmp_fav.png")
        cairosvg.svg2png(url=tmp_svg, write_to=tmp_png,
                         output_width=size, output_height=size)
        im = Image.open(tmp_png).convert("RGBA")
        im.save(os.path.join(PNG_DIR, "favicon-%d.png" % size))
        os.remove(tmp_png); os.remove(tmp_svg)
        if size == 32:
            # favicon.svg 以 32px 档为基准（16px 过扁、180px 过细）
            io.open(os.path.join(SVG_DIR, "favicon.svg"), "w",
                    encoding="utf-8", newline="").write(svg)

    ims = [Image.open(os.path.join(PNG_DIR, "favicon-%d.png" % s)).convert("RGBA")
           for s in (16, 32, 48)]
    ico = os.path.join(ICO_DIR, "favicon.ico")
    ims[-1].save(ico, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)],
                 append_images=ims[:-1])
    print("ICO -> %s (%d B)" % (os.path.basename(ico), os.path.getsize(ico)))

    for s in (16, 32, 48, 180):
        a = np.asarray(Image.open(os.path.join(PNG_DIR, "favicon-%d.png" % s)).convert("RGBA"))
        op = a[:, :, 3] > 10
        ys, xs = np.nonzero(op)
        print("  %3dpx: 主体 %d×%d（高占比 %.0f%%）透明 %.1f%%"
              % (s, xs.max() - xs.min() + 1, ys.max() - ys.min() + 1,
                 100 * (ys.max() - ys.min() + 1) / s, 100 * (~op).sum() / op.size))


if __name__ == "__main__":
    main()
