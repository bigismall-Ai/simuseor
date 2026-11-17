#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
vectorize-cicada.py — SiMuseor 蝉形辅助图形 · 反向矢量化管线 (v1.0)

================================================================================
README · 这个脚本在做什么
================================================================================
输入：三张 1536x1536 白底 JPEG（蝉形闭翅 / 单翅 / 双翅，低多边形几何分面 +
      品红→橙渐变 + 白色细接缝线），无透明通道、无矢量源。
输出：每帧一套「纯路径 SVG」（默认 / mono 单色 / dark 深底 / reverse 反白）+
      多尺寸透明底 PNG + favicon.ico + 一份实测报告 JSON。

--------------------------------------------------------------------------------
0. 为什么必须「反向矢量化」
--------------------------------------------------------------------------------
VIS v1.0 §2.6 规定标识资产必须是纯路径 SVG，反白靠「双份资产切换」而不是
filter:invert()。用户只给了 1536 白底 JPEG，所以只能从位图反推矢量。

--------------------------------------------------------------------------------
1. 管线总览（每一步都可单独调参，参数含义见 §参数表）
--------------------------------------------------------------------------------
  S1  白底剥离      近白像素从画布边界洪水填充 → 背景；其余 = 主体(含白色接缝)
  S2  接缝分离      主体内「近白且低彩度」像素 = 接缝核心；膨胀 1px 吃掉 JPEG 晕边
  S3  面片标号      主体减去接缝 = 面片区；4-连通标记 → 每个连通块 = 一个面片
  S4  清理          面积 < MIN_FACET_AREA 的碎块按「多数邻接」并入邻居，避免白点
  S5  像素裂纹轮廓  对每个面片做「像素方块并集」的真实边界（crack boundary），
                    沿格点行走、区域恒在左侧 → 天然无自交、无 1px 缩进
  S6  RDP 简化      面片轮廓与接缝轮廓分别做 Douglas-Peucker，保留尖角
  S7  取色          面片中位色（代表色）；面片内沿全局渐变轴的线性回归 → 渐变端点
  S8  接缝网络      接缝区同样是像素方块并集 → 裂纹轮廓 → 合并成单条多子路径 path
                    （fill-rule=nonzero，洞=面片自动镂空）
  S9  组装 SVG      面片 path（填充/渐变）+ 接缝 path（白色实心）
  S10 变体          mono（单色墨）/ dark（深底重绘色值）/ reverse（深底反白）
  S11 渲染          cairosvg 出 16/32/48/64/128/256/512/1024 PNG + favicon.ico
  S12 实测          可辨性 / 安全区 / 对齐基准，输出 JSON + 控制台

--------------------------------------------------------------------------------
2. 为什么「按面片」而不是「只描外轮廓」
--------------------------------------------------------------------------------
这张图是低多边形平面着色渲染：每个面片是一块**平色多边形**，多边形之间是
1~3px 的白色接缝线。整块渐变糊成一片会丢掉全部识别特征（面片节奏），
所以必须把面片逐块还原成独立 path。

--------------------------------------------------------------------------------
3. 为什么接缝用「整块填充」而不是「描边」
--------------------------------------------------------------------------------
接缝在源图里是「纸透出来」的白色缝隙，且每条缝的宽度不恒定（斜缝在栅格上
呈锯齿）。用 stroke 会得到宽度恒定的假缝；用「接缝区 = 像素方块并集 → 裂纹
轮廓 → 实心填充」可以 1:1 复刻源图里真实的缝形与缝宽。

--------------------------------------------------------------------------------
4. 坐标系
--------------------------------------------------------------------------------
SVG 内部一律使用**源图像素坐标**（1536x1536 画布内的绝对坐标），viewBox 取
主体 bbox；缩放交给浏览器 / CSS。这样三帧共享同一套坐标系，便于做展翅动效
的帧间对齐（见 S12 的对齐实测）。

--------------------------------------------------------------------------------
5. 依赖
--------------------------------------------------------------------------------
  Pillow (PIL)  —— 必需
  cairosvg      —— 仅渲染 PNG/ICO 时需要
  numpy         —— **不需要**（纯 Python 实现，色彩/连通域/轮廓全部手写）
  运行： E:/Projects/model-downloader/.venv/Scripts/python.exe vectorize-cicada.py
================================================================================
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
from collections import deque

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    raise SystemExit("需要 Pillow： pip install pillow")

# ==============================================================================
# 参数表（全部可用命令行覆盖）
# ==============================================================================

DEFAULTS = dict(
    # ---- S1 白底剥离 ----
    bg_luma=240,        # 背景候选：任一通道 >= 240 视为「近白」
    bg_chroma=12,       # 背景候选：max-min <= 12 视为「近白」（JPEG 噪声容差）
    # ---- S2 接缝分离 ----
    seam_luma=230,      # 接缝核心：任一通道 >= 230
    seam_chroma=28,     # 接缝核心：max-min <= 28（淡粉面片彩度 44~70，被排除）
    seam_dilate=1,      # 接缝核心膨胀半径（px）：补 JPEG 断裂，保证栅格屏障连续
    outer_band=2,       # 轮廓外扩带（px）：紧贴轮廓的抗锯齿带，不画成白边
    cell_stroke=6,      # 面片自描边宽度（px）：把面片顶到真实轮廓，避免留白边
    # ---- S3/S4 面片标号 ----
    min_facet_area=40,  # 小于该像素数的连通块视为噪声，并入邻接面片
    # ---- S5/S6 轮廓与简化 ----
    rdp_eps=1.8,        # 面片轮廓 RDP 容差（px，源图像素尺度）
    seam_rdp_eps=1.0,   # 接缝轮廓 RDP 容差（更细，避免削掉缝端头）
    # ---- S7 取色 ----
    grad_min_delta=8,   # 面片内色彩跨度（0-255 欧氏）超过该值才发线性渐变
    # ---- S11 渲染 ----
    sizes=(16, 32, 48, 64, 128, 256, 512, 1024),
    pad_frac=0.0,       # PNG 画布方形化时，主体外留白占主体最大尺寸的比例
)

# ---- 品牌色（对齐 artifacts/vis/vis-tokens.css）----------------------------
BRAND_PAPER = "#f8f6f1"     # --brand-paper          浅色品牌面
BRAND_INK = "#1b1b1e"       # --brand-ink            浅底墨色
BRAND_PAPER_REV = "#15151a"  # --brand-paper-reverse 深色品牌面
BRAND_INK_REV = "#f1ede4"   # --brand-ink-reverse   深底反白字
SEAM_LIGHT = "#ffffff"      # 彩色版接缝：纯白（与源图一致）

# ==============================================================================
# 工具
# ==============================================================================


def hex_of(rgb):
    r, g, b = [max(0, min(255, int(round(c)))) for c in rgb]
    return "#%02x%02x%02x" % (r, g, b)


def rgb_of(hx):
    hx = hx.lstrip("#")
    return tuple(int(hx[i:i + 2], 16) for i in (0, 2, 4))


def srgb_to_hsl(r, g, b):
    r, g, b = r / 255.0, g / 255.0, b / 255.0
    mx, mn = max(r, g, b), min(r, g, b)
    l = (mx + mn) / 2.0
    if mx == mn:
        return 0.0, 0.0, l
    d = mx - mn
    s = d / (2.0 - mx - mn) if l > 0.5 else d / (mx + mn)
    if mx == r:
        h = ((g - b) / d) % 6.0
    elif mx == g:
        h = (b - r) / d + 2.0
    else:
        h = (r - g) / d + 4.0
    return h * 60.0, s, l


def hsl_to_rgb(h, s, l):
    h = (h % 360.0) / 360.0
    if s == 0:
        v = int(round(l * 255))
        return (v, v, v)
    q = l * (1 + s) if l < 0.5 else l + s - l * s
    p = 2 * l - q

    def f(t):
        t = t % 1.0
        if t < 1 / 6.0:
            return p + (q - p) * 6 * t
        if t < 1 / 2.0:
            return q
        if t < 2 / 3.0:
            return p + (q - p) * (2 / 3.0 - t) * 6
        return p

    return tuple(int(round(f(h + off) * 255)) for off in (1 / 3.0, 0.0, -1 / 3.0))


def median(values):
    v = sorted(values)
    n = len(v)
    if n == 0:
        return 0
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2.0


def rdp(points, eps):
    """Douglas-Peucker（迭代版，避免递归爆栈）。points 为闭合折线（首尾相同）。"""
    n = len(points)
    if n < 3 or eps <= 0:
        return list(points)
    keep = bytearray(n)
    keep[0] = 1
    keep[n - 1] = 1
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        x1, y1 = points[i]
        x2, y2 = points[j]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy)
        best, idx = -1.0, -1
        for k in range(i + 1, j):
            x0, y0 = points[k]
            if norm == 0.0:
                d = math.hypot(x0 - x1, y0 - y1)
            else:
                d = abs(dy * (x0 - x1) - dx * (y0 - y1)) / norm
            if d > best:
                best, idx = d, k
        if best > eps and idx > 0:
            keep[idx] = 1
            stack.append((i, idx))
            stack.append((idx, j))
    return [p for p, k in zip(points, keep) if k]


# ==============================================================================
# S1 · 白底剥离
# ==============================================================================


def subject_mask(rgb, w, h, bg_luma, bg_chroma):
    """从画布边界洪水填充近白像素 → 背景。返回 bytearray(1=主体)。"""
    px = rgb.load()
    bg = bytearray(w * h)
    dq = deque()

    def push(x, y):
        i = y * w + x
        if not bg[i]:
            c = px[x, y]
            mn = min(c)
            ch = max(c) - mn
            if mn >= bg_luma and ch <= bg_chroma:
                bg[i] = 1
                dq.append(i)

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)

    while dq:
        i = dq.popleft()
        x, y = i % w, i // w
        if x > 0:
            push(x - 1, y)
        if x < w - 1:
            push(x + 1, y)
        if y > 0:
            push(x, y - 1)
        if y < h - 1:
            push(x, y + 1)

    return bytearray(0 if bg[i] else 1 for i in range(w * h))


def bbox_of(mask, w, h):
    x0, y0, x1, y1 = w, h, -1, -1
    for y in range(h):
        row = y * w
        for x in range(w):
            if mask[row + x]:
                if x < x0:
                    x0 = x
                if x > x1:
                    x1 = x
                if y < y0:
                    y0 = y
                if y > y1:
                    y1 = y
    return (x0, y0, x1 + 1, y1 + 1)


# ==============================================================================
# S2 · 接缝分离
# ==============================================================================


def seam_core_mask(rgb, w, h, subject, luma, chroma):
    px = rgb.load()
    out = bytearray(w * h)
    for y in range(h):
        row = y * w
        for x in range(w):
            if not subject[row + x]:
                continue
            c = px[x, y]
            mn = min(c)
            if mn >= luma and (max(c) - mn) <= chroma:
                out[row + x] = 1
    return out


def dilate(mask, w, h, radius=1):
    """方形结构元膨胀。返回新 bytearray。"""
    cur = mask
    for _ in range(radius):
        nxt = bytearray(w * h)
        for y in range(h):
            row = y * w
            for x in range(w):
                if cur[row + x]:
                    nxt[row + x] = 1
                    continue
                if (x > 0 and cur[row + x - 1]) or (x < w - 1 and cur[row + x + 1]) \
                        or (y > 0 and cur[row - w + x]) or (y < h - 1 and cur[row + w + x]):
                    nxt[row + x] = 1
        cur = nxt
    return cur


def erode(mask, w, h, radius=1):
    cur = mask
    for _ in range(radius):
        nxt = bytearray(w * h)
        for y in range(h):
            row = y * w
            for x in range(w):
                if not cur[row + x]:
                    continue
                if (x == 0 or not cur[row + x - 1]) or (x == w - 1 or not cur[row + x + 1]) \
                        or (y == 0 or not cur[row - w + x]) or (y == h - 1 or not cur[row + w + x]):
                    continue
                nxt[row + x] = 1
        cur = nxt
    return cur


# ==============================================================================
# S3/S4 · 面片标号 + 碎块清理
# ==============================================================================


def label_regions(mask, w, h):
    """4-连通标记。返回 (labels list[int], n_regions)。"""
    labels = [0] * (w * h)
    cur = 0
    for start in range(w * h):
        if not mask[start] or labels[start]:
            continue
        cur += 1
        labels[start] = cur
        stack = [start]
        while stack:
            p = stack.pop()
            x = p % w
            if x > 0 and mask[p - 1] and not labels[p - 1]:
                labels[p - 1] = cur
                stack.append(p - 1)
            if x < w - 1 and mask[p + 1] and not labels[p + 1]:
                labels[p + 1] = cur
                stack.append(p + 1)
            if p >= w and mask[p - w] and not labels[p - w]:
                labels[p - w] = cur
                stack.append(p - w)
            if p < w * (h - 1) and mask[p + w] and not labels[p + w]:
                labels[p + w] = cur
                stack.append(p + w)
    return labels, cur


def region_pixels(labels, n_regions, w, h):
    regions = [[] for _ in range(n_regions + 1)]
    for i, lb in enumerate(labels):
        if lb:
            regions[lb].append(i)
    return regions


def cleanup_small(labels, regions, n_regions, w, h, min_area):
    """把面积过小的碎块按「四邻多数」并入邻接面片；无邻接则留给接缝。

    单遍完成（避免 O(区域数^2) 的反复重扫）；最多再迭代 3 轮以处理
    「小并小」的链式情形。
    """
    def collect_small():
        return [rid for rid in range(1, n_regions + 1)
                if regions[rid] and len(regions[rid]) < min_area]

    for _ in range(3):
        small = collect_small()
        if not small:
            break
        small_set = set(small)
        for rid in small:
            px = regions[rid]
            if not px:
                continue
            votes = {}
            for p in px:
                x = p % w
                for q in (p - 1 if x > 0 else -1, p + 1 if x < w - 1 else -1,
                          p - w if p >= w else -1, p + w if p < w * (h - 1) else -1):
                    if q < 0:
                        continue
                    lb = labels[q]
                    if lb and lb != rid and lb not in small_set:
                        votes[lb] = votes.get(lb, 0) + 1
            if not votes:
                continue
            target = max(votes.items(), key=lambda kv: kv[1])[0]
            for p in px:
                labels[p] = target
            regions[target].extend(px)
            regions[rid] = []
    return labels


# ==============================================================================
# S5 · 像素裂纹轮廓（crack boundary）
# ==============================================================================
# 像素 (x,y) 占据方块 [x,x+1] x [y,y+1]，格点 (i,j) 是方块角。
# 边界 = 内外相邻方块之间的单位边；沿格点行走并让区域恒在左侧。
# 方向表以 y 向下为屏幕坐标：E(1,0) → N(0,-1) → W(-1,0) → S(0,1) 为「左转序」。

_DIR = {(1, 0): 0, (0, -1): 1, (-1, 0): 2, (0, 1): 3}


def crack_loops(labels, w, h, region_id, pixels):
    """返回该连通块的裂纹轮廓环列表（每个环是格点坐标列表，闭合）。"""
    edges = {}
    for p in pixels:
        x = p % w
        y = p // w
        if y == 0 or labels[p - w] != region_id:
            edges[("h", x, y)] = ((x, y), (x + 1, y))
        if y == h - 1 or labels[p + w] != region_id:
            edges[("h", x, y + 1)] = ((x, y + 1), (x + 1, y + 1))
        if x == 0 or labels[p - 1] != region_id:
            edges[("v", x, y)] = ((x, y), (x, y + 1))
        if x == w - 1 or labels[p + 1] != region_id:
            edges[("v", x + 1, y)] = ((x + 1, y), (x + 1, y + 1))
    if not edges:
        return []

    incident = {}
    for eid, (a, b) in edges.items():
        incident.setdefault(a, []).append(eid)
        incident.setdefault(b, []).append(eid)

    def dir_from(corner, eid):
        a, b = edges[eid]
        other = b if a == corner else a
        return _DIR[(other[0] - corner[0], other[1] - corner[1])]

    visited = set()
    loops = []
    for start in edges:
        if start in visited:
            continue
        loop = []
        eid = start
        cur = None          # 当前抵达的格点
        while eid not in visited:
            visited.add(eid)
            a, b = edges[eid]
            if cur is not None and a != cur:
                a, b = b, a          # 保证边从当前格点出发，链才连续
            loop.append(a)
            d = _DIR[(b[0] - a[0], b[1] - a[1])]
            corner = b
            cands = [e for e in incident[corner]
                     if e != eid and dir_from(corner, e) != (d + 2) % 4]
            if not cands:
                break
            nxt = None
            for pref in ((d + 1) % 4, d, (d + 3) % 4):
                hit = [e for e in cands if dir_from(corner, e) == pref]
                if hit:
                    nxt = hit[0]
                    break
            if nxt is None:
                break
            eid = nxt
            cur = corner
        if len(loop) >= 3:
            loops.append(loop)
    return loops


def loop_to_path(loop, eps, close=True):
    """裂纹环 → 闭合折线 → RDP 简化 → path 子路径字符串。"""
    pts = list(loop)
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    simp = rdp(pts, eps)
    if len(simp) < 3:
        return None, simp
    out = []
    for i, (x, y) in enumerate(simp):
        out.append(("M" if i == 0 else "L") + "%g %g" % (x, y))
    if close:
        out.append("Z")
    return " ".join(out), simp


# ==============================================================================
# S7 · 取色（代表色 + 渐变端点）
# ==============================================================================


def facet_colors(rgb, w, h, pixels, grad_min_delta):
    """返回 (代表色 rgb, 渐变端点 (c0,c1) 或 None)。"""
    px = rgb.load()
    rs, gs, bs = [], [], []
    xs = []
    for p in pixels:
        x = p % w
        c = px[x, p // w]
        rs.append(c[0])
        gs.append(c[1])
        bs.append(c[2])
        xs.append(x)
    rep = (median(rs), median(gs), median(bs))

    # 面片内沿 x 轴（全局品红→橙方向）做线性回归，得到渐变两端色
    n = len(xs)
    if n < 12:
        return rep, None
    sx = sum(xs)
    sxx = sum(x * x for x in xs)
    mean_x = sx / n
    var = sxx - n * mean_x * mean_x
    if var <= 1e-6:
        return rep, None
    ends = []
    for ch in (rs, gs, bs):
        m = sum(ch) / n
        sxy = sum(xs[i] * ch[i] for i in range(n)) - n * mean_x * m
        slope = sxy / var
        ends.append((slope, m))
    xmin, xmax = min(xs), max(xs)
    c0 = tuple(max(0, min(255, ends[c][1] + ends[c][0] * (xmin - mean_x))) for c in range(3))
    c1 = tuple(max(0, min(255, ends[c][1] + ends[c][0] * (xmax - mean_x))) for c in range(3))
    delta = math.dist(c0, c1)
    if delta < grad_min_delta:
        return rep, None
    return rep, (c0, c1)


# ==============================================================================
# S8 · 接缝网络
# ==============================================================================


def seam_network(labels, w, h, seam_labels):
    """接缝区（可能多块）→ 全部裂纹环 → 合并为一条多子路径。"""
    loops = []
    for rid in seam_labels:
        px = [i for i in range(w * h) if labels[i] == rid]
        if len(px) < 3:
            continue
        for lp in crack_loops(labels, w, h, rid, px):
            loops.append(lp)
    return loops


# ==============================================================================
# S9/S10 · SVG 组装
# ==============================================================================


def build_svg(facets, seam_d, width, height, seam_color, cell_stroke=6):
    """facets: [(d, fill, stroke_color, grad_id|None, grad_def)]"""
    defs = []
    body = []
    for d, fill, stroke, gid, gdef in facets:
        if gid:
            defs.append(gdef)
        body.append(
            '<path d="%s" fill="%s" stroke="%s" stroke-width="%g" '
            'stroke-linejoin="round" stroke-linecap="round"/>'
            % (d, fill, stroke, cell_stroke)
        )
    seams = (
        '<path d="%s" fill="%s" fill-rule="nonzero"/>' % (seam_d, seam_color)
        if seam_d else ""
    )
    head = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %g %g" width="%g" height="%g" '
        'role="img" aria-hidden="true">' % (width, height, width, height)
    )
    defs_xml = "<defs>%s</defs>" % "".join(defs) if defs else ""
    return head + defs_xml + "".join(body) + seams + "</svg>"


def dark_recolor(rgb):
    """深色主题重绘：真正改色值（提亮暗部 + 微增彩度 + 压顶），不是 invert。"""
    h, s, l = srgb_to_hsl(*rgb)
    l2 = l + 0.17 * max(0.0, (0.34 - l) / 0.34)
    l2 = min(l2, 0.86)
    s2 = min(1.0, s * 1.10 + 0.03)
    return hsl_to_rgb(h, s2, l2)


# ==============================================================================
# 主流程 · 单帧
# ==============================================================================


def vectorize_frame(src_path, outdir, name, P, report):
    t0 = time.time()
    src = Image.open(src_path).convert("RGB")
    W0, H0 = src.size

    # --- S1 白底剥离 -------------------------------------------------------
    # 先在缩略图上定位主体 bbox（省一次 1536^2 的全图洪水填充），
    # 再裁出带 2px 余量的工作区，后续所有像素运算只在工作区里做。
    th = src.resize((W0 // 4, H0 // 4), Image.LANCZOS)
    sub_small = subject_mask(th, th.size[0], th.size[1], P["bg_luma"], P["bg_chroma"])
    bb_small = bbox_of(sub_small, th.size[0], th.size[1])
    x0 = max(0, bb_small[0] * 4 - 2)
    y0 = max(0, bb_small[1] * 4 - 2)
    x1 = min(W0, bb_small[2] * 4 + 2)
    y1 = min(H0, bb_small[3] * 4 + 2)
    cropped = src.crop((x0, y0, x1, y1))
    w, h = cropped.size
    subj = subject_mask(cropped, w, h, P["bg_luma"], P["bg_chroma"])
    bbox = (0, 0, w, h)
    print("   [S1] work area %dx%d  (source %dx%d)" % (w, h, W0, H0))
    t = time.time()

    # --- S2 接缝分离 -------------------------------------------------------
    # 接缝核心 = 主体内「近白且低彩度」像素。淡粉面片彩度 44~70，会被排除；
    # 接缝因是「白线压在品红面上」，实测彩度 7~48、最小通道 184~255，
    # 故阈值取 min>=230 且 chroma<=28（宁可漏一条细缝，也不要吃掉淡粉面片）。
    core = seam_core_mask(cropped, w, h, subj, P["seam_luma"], P["seam_chroma"])
    seam_mask = dilate(core, w, h, P["seam_dilate"])
    seam_mask = bytearray(seam_mask[i] and subj[i] for i in range(w * h))

    # 轮廓外扩带：紧贴轮廓的 1~2px 抗锯齿带也会被判成「近白」，
    # 它必须留在「分隔掩码」里（否则靠边的缝会断、两个面片会粘连），
    # 但**不能**画进接缝网络（否则整圈出现白边）。
    bgm = bytearray(1 - subj[i] for i in range(w * h))
    outer = dilate(bgm, w, h, P["outer_band"])
    seam_render = bytearray(seam_mask[i] and not outer[i] for i in range(w * h))
    print("   [S2] seam core %d -> mask %d -> render %d px" %
          (sum(core), sum(seam_mask), sum(seam_render)))
    t = time.time()

    # --- S3/S4 面片标号 ----------------------------------------------------
    facet_mask = bytearray(subj[i] and not seam_mask[i] for i in range(w * h))
    labels, n = label_regions(facet_mask, w, h)
    regions = region_pixels(labels, n, w, h)
    labels = cleanup_small(labels, regions, n, w, h, P["min_facet_area"])

    # 面片区 = 标号 >0 ；接缝区 = 主体但无标号
    final_facet = bytearray(1 if labels[i] else 0 for i in range(w * h))
    regions = region_pixels(labels, n, w, h)
    live = sum(1 for rid in range(1, n + 1) if regions[rid])
    print("   [S3] raw regions %d -> kept %d" % (n, live))
    t = time.time()

    # --- S5/S6/S7 面片路径 -------------------------------------------------
    facets = []
    facet_meta = []
    for rid in range(1, n + 1):
        px = regions[rid]
        if len(px) < 6:
            continue
        loops = crack_loops(labels, w, h, rid, px)
        if not loops:
            continue
        # 取面积最大的环作为主轮廓，其余（洞）忽略：低多边形面片无洞
        loops.sort(key=len, reverse=True)
        d, simp = loop_to_path(loops[0], P["rdp_eps"])
        if not d:
            continue
        rep, grad = facet_colors(cropped, w, h, px, P["grad_min_delta"])
        gid = None
        if grad:
            gid = "cg%d" % rid
            xs = [p % w for p in px]
            ys = [p // w for p in px]
            gx0, gx1 = min(xs), max(xs)
            gy = sum(ys) / len(ys)
            gdef = (
                '<linearGradient id="%s" gradientUnits="userSpaceOnUse" x1="%g" y1="%g" x2="%g" y2="%g">'
                '<stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient>'
                % (gid, gx0, gy, gx1, gy, hex_of(grad[0]), hex_of(grad[1]))
            )
        else:
            gdef = None
        facets.append([d, "url(#%s)" % gid if gid else hex_of(rep), hex_of(rep), gid, gdef])
        facet_meta.append({
            "id": rid,
            "area": len(px),
            "points": len(simp),
            "color": hex_of(rep),
            "gradient": [hex_of(grad[0]), hex_of(grad[1])] if grad else None,
        })

    # --- S8 接缝网络 -------------------------------------------------------
    # 接缝渲染区 = 接缝掩码去掉轮廓外扩带。其像素方块并集的裂纹轮廓 → 多子路径，
    # fill-rule=nonzero 让「洞」（= 面片）自动镂空，只留网状白缝。
    s_labels, sn = label_regions(seam_render, w, h)
    seam_regions = region_pixels(s_labels, sn, w, h)
    s_labels = cleanup_small(s_labels, seam_regions, sn, w, h, 12)
    seam_subpaths = []
    for rid in range(1, sn + 1):
        px = seam_regions[rid]
        if len(px) < 3:
            continue
        for lp in crack_loops(s_labels, w, h, rid, px):
            d, _ = loop_to_path(lp, P["seam_rdp_eps"])
            if d:
                seam_subpaths.append(d)
    seam_d = " ".join(seam_subpaths)

    # --- S9 组装三套配色 ---------------------------------------------------
    variants = {}
    # 彩色版
    variants["color"] = build_svg(facets, seam_d, w, h, SEAM_LIGHT, P["cell_stroke"])
    # 单色版：面片统一墨色，接缝=品牌纸色（白纸上即镂空）
    mono = [[f[0], BRAND_INK, BRAND_INK, None, None] for f in facets]
    variants["mono"] = build_svg(mono, seam_d, w, h, BRAND_PAPER, P["cell_stroke"])
    # 深底彩色版：色值真正重绘，接缝=深色品牌面
    dark = []
    for f, fm in zip(facets, facet_meta):
        rep = rgb_of(fm["color"])
        dcol = dark_recolor(rep)
        grad = None
        if fm["gradient"]:
            g0 = dark_recolor(rgb_of(fm["gradient"][0]))
            g1 = dark_recolor(rgb_of(fm["gradient"][1]))
            grad = (hex_of(g0), hex_of(g1))
        if grad:
            gid = "dg%d" % fm["id"]
            gdef = re.sub(r'id="cg\d+"', 'id="%s"' % gid, f[4])
            gdef = gdef.replace(hex_of(rgb_of(fm["gradient"][0])), grad[0])
            gdef = gdef.replace(hex_of(rgb_of(fm["gradient"][1])), grad[1])
            dark.append([f[0], "url(#%s)" % gid, hex_of(dcol), gid, gdef])
        else:
            dark.append([f[0], hex_of(dcol), hex_of(dcol), None, None])
    variants["dark"] = build_svg(dark, seam_d, w, h, BRAND_PAPER_REV, P["cell_stroke"])
    # 反白单色版（深底）
    rev = [[f[0], BRAND_INK_REV, BRAND_INK_REV, None, None] for f in facets]
    variants["reverse"] = build_svg(rev, seam_d, w, h, BRAND_PAPER_REV, P["cell_stroke"])

    # --- 落盘 ---------------------------------------------------------------
    os.makedirs(outdir, exist_ok=True)
    files = {}
    for vname, svg in variants.items():
        fn = "SiMuseor-cicada-%s%s.svg" % (name, "" if vname == "color" else "-" + vname)
        path = os.path.join(outdir, fn)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(svg)
        files[vname] = {"path": path, "bytes": os.path.getsize(path)}

    # --- 透明底中间图（位图阶段产物：白底剥离后的原始像素）---------------
    sb = bbox_of(subj, w, h)
    cut = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sp = src.load()
    cp = cropped.load()
    dst = cut.load()
    for y in range(h):
        for x in range(w):
            if subj[y * w + x]:
                dst[x, y] = cp[x, y] + (255,)
    cut_path = os.path.join(outdir, "SiMuseor-cicada-%s-cutout.png" % name)
    cut.save(cut_path)

    report["frames"][name] = {
        "source": src_path,
        "source_size": [W0, H0],
        "work_area": [x0, y0, x1, y1],
        "subject_bbox_in_source": [sb[0] + x0, sb[1] + y0, sb[2] + x0, sb[3] + y0],
        "subject_bbox": [sb[0], sb[1], sb[2], sb[3]],
        "subject_w": sb[2] - sb[0],
        "subject_h": sb[3] - sb[1],
        "facet_count": len(facets),
        "seam_region_px": sum(seam_mask),
        "seam_path_len": len(seam_d),
        "svg": files,
        "cutout": cut_path,
        "elapsed_s": round(time.time() - t0, 2),
        "facets": facet_meta,
    }
    return facets, seam_d, (w, h), subj, cropped, bbox, (x0, y0)


# ==============================================================================
# S11 · 渲染 PNG / ICO
# ==============================================================================


def render_sizes(svg_path, outdir, name, sizes, pad_frac):
    import cairosvg
    out = {}
    for s in sizes:
        png = os.path.join(outdir, "SiMuseor-cicada-%s-%d.png" % (name, s))
        cairosvg.svg2png(url=svg_path, write_to=png, output_width=s, output_height=s)
        out[s] = png
    return out


def write_ico(png_paths, out_path):
    from PIL import Image
    imgs = [Image.open(p).convert("RGBA") for p in png_paths]
    if not imgs:
        return None
    base = max(imgs, key=lambda im: im.size[0])
    base.save(out_path, format="ICO",
              sizes=[(im.size[0], im.size[1]) for im in imgs])
    return out_path


# ==============================================================================
# S12 · 实测
# ==============================================================================


def measure_legibility(png_path, size):
    """在给定尺寸下测：接缝是否还看得见（白/黑像素占比与对比），面片色块数。"""
    from PIL import Image
    im = Image.open(png_path).convert("RGBA")
    w, h = im.size
    px = im.load()
    opaque = 0
    bright = 0
    dark = 0
    colors = {}
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 128:
                continue
            opaque += 1
            lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
            if lum >= 235:
                bright += 1
            if lum <= 40:
                dark += 1
            key = (r // 48, g // 48, b // 48)
            colors[key] = colors.get(key, 0) + 1
    n = max(opaque, 1)
    big = sum(v for v in colors.values() if v >= max(2, opaque * 0.01))
    return {
        "size": size,
        "opaque_px": opaque,
        "coverage": round(opaque / float(w * h), 4),
        "bright_ratio": round(bright / float(n), 4),
        "dark_ratio": round(dark / float(n), 4),
        "color_blocks": len(colors),
        "color_blocks_ge1pct": big,
    }


def main():
    ap = argparse.ArgumentParser(description="SiMuseor 蝉形标识反向矢量化管线")
    ap.add_argument("--srcdir", default=r"E:/Projects/model-downloader/artifacts/vis/assets/logo-new")
    ap.add_argument("--outdir", default=r"E:/Projects/model-downloader/artifacts/vis/assets/cicada")
    ap.add_argument("--frame", action="append", default=[],
                    help="name=path，可重复；默认 min/mid/max 三帧")
    ap.add_argument("--rdp-eps", type=float, default=DEFAULTS["rdp_eps"])
    ap.add_argument("--seam-rdp-eps", type=float, default=DEFAULTS["seam_rdp_eps"])
    ap.add_argument("--seam-dilate", type=int, default=DEFAULTS["seam_dilate"])
    ap.add_argument("--min-facet-area", type=int, default=DEFAULTS["min_facet_area"])
    ap.add_argument("--sizes", default=",".join(str(s) for s in DEFAULTS["sizes"]))
    ap.add_argument("--report", default="")
    args = ap.parse_args()

    P = dict(DEFAULTS)
    P["rdp_eps"] = args.rdp_eps
    P["seam_rdp_eps"] = args.seam_rdp_eps
    P["seam_dilate"] = args.seam_dilate
    P["min_facet_area"] = args.min_facet_area
    sizes = tuple(int(s) for s in args.sizes.split(",") if s.strip())

    frames = args.frame or []
    if not frames:
        for nm, fn in (("min", "SiMuseor-Logo-MIN.jpg"),
                       ("mid", "SiMuseor-Logo-MID.jpg"),
                       ("max", "SiMuseor-Logo-MAX.jpg")):
            frames.append("%s=%s" % (nm, os.path.join(args.srcdir, fn)))

    os.makedirs(args.outdir, exist_ok=True)
    report = {"params": {k: (list(v) if isinstance(v, tuple) else v) for k, v in P.items()},
              "frames": {}}

    for spec in frames:
        nm, path = spec.split("=", 1)
        if not os.path.exists(path):
            path = os.path.join(args.srcdir, path)
        print("[vectorize] %s <- %s" % (nm, path))
        vectorize_frame(path, args.outdir, nm, P, report)

    # --- 渲染 -------------------------------------------------------------
    for nm, fr in report["frames"].items():
        svg_path = fr["svg"]["color"]["path"]
        fr["png"] = render_sizes(svg_path, args.outdir, nm, sizes, P["pad_frac"])
        ico_src = [fr["png"][s] for s in (16, 32, 48) if s in fr["png"]]
        ico_path = os.path.join(args.outdir, "SiMuseor-cicada-%s-favicon.ico" % nm)
        write_ico(ico_src, ico_path)
        fr["ico"] = {"path": ico_path, "bytes": os.path.getsize(ico_path)}
        fr["legibility"] = [measure_legibility(fr["png"][s], s) for s in sizes]
        print("[vectorize] %s: %d facets, ico %d B" % (nm, fr["facet_count"], fr["ico"]["bytes"]))

    rpath = args.report or os.path.join(args.outdir, "cicada-vectorize-report.json")
    with open(rpath, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print("[vectorize] report ->", rpath)


if __name__ == "__main__":
    main()
