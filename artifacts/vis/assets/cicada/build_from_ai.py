#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
build_from_ai.py — 把 Illustrator 导出的 SVG 整理成正式资产。

输入：`assets/cicada/svg/SVG/资源 3..7.svg`（AI 从 cicada-FULL.ai 导出）
输出：`assets/cicada/svg/` 下的规范化版本

主理人 18:50 实测结论（为什么用 AI 导出版而不是位图反推版）：
  · AI 版用 `<polygon>` + 直线连接 → 接缝线是**真直线**；位图反推的 RDP 折线有像素阶梯
  · 面片数一致（82 vs 82），顶点数更少（438 vs 533）
  · AI 版带图层名（`图层 2` / `翅膀` / `翅膀-2`）+ CSS class 色板

本脚本补齐 AI 导出件缺的 5 件事：
  ① 语义文件名（资源 N.svg → cicada-max.svg）
  ② 解剖分组 <g>（wings-left / wings-right / body / antennae / legs）
  ③ 每个面片一条带**语义 id** 的元素（wings-left-01…），可逐元素改
  ④ 色值**内联为 fill**（不依赖 <style>），便于按 id 查色改色
  ⑤ mono / dark 变体（dark = HSL 保色相提明度至 ≥3:1）
"""

import io
import os
import re

import numpy as np

ROOT = r"E:/Projects/model-downloader"
SRC = os.path.join(ROOT, "artifacts/vis/assets/cicada/svg/SVG")
OUT = os.path.join(ROOT, "artifacts/vis/assets/cicada/svg")

DARK_BG = np.array([0x15, 0x15, 0x1a])
DARK_TARGET = 3.0

FILES = {"资源 7.svg": "cicada-max",
         "资源 6.svg": "cicada-mid",
         "资源 5.svg": "cicada-min"}
LINEART = {"资源 3.svg": "cicada-max-lineart",
           "资源 4.svg": "cicada-max-lineart-b"}


# ---------------------------------------------------------------- 颜色
def _rel_lum(rgb):
    def ch(v):
        v = v / 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = [ch(c) for c in rgb[:3]]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = _rel_lum(a), _rel_lum(b)
    if la < lb:
        la, lb = lb, la
    return (la + 0.05) / (lb + 0.05)


def rgb_to_hsl(rgb):
    r, g, b = [c / 255.0 for c in rgb[:3]]
    mx, mn = max(r, g, b), min(r, g, b)
    l = (mx + mn) / 2
    if mx == mn:
        return 0.0, 0.0, l
    d = mx - mn
    s = d / (2 - mx - mn) if l > 0.5 else d / (mx + mn)
    if mx == r:
        h = ((g - b) / d) % 6
    elif mx == g:
        h = (b - r) / d + 2
    else:
        h = (r - g) / d + 4
    return h * 60.0, s, l


def hsl_to_rgb(h, s, l):
    h = (h % 360) / 360.0
    if s == 0:
        v = l
        return np.array([v * 255] * 3)
    q = l * (1 + s) if l < 0.5 else l + s - l * s
    p = 2 * l - q

    def hue(t):
        t = t % 1.0
        if t < 1 / 6:
            return p + (q - p) * 6 * t
        if t < 1 / 2:
            return q
        if t < 2 / 3:
            return p + (q - p) * (2 / 3 - t) * 6
        return p
    return np.array([hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255])


def ensure_contrast(rgb, bg=DARK_BG, target=DARK_TARGET):
    if contrast(rgb, bg) >= target:
        return np.asarray(rgb, dtype=np.float64)
    h, s, l = rgb_to_hsl(rgb)
    for i in range(1, 101):
        cand = hsl_to_rgb(h, s, min(0.97, l + i * 0.01))
        if contrast(cand, bg) >= target:
            return cand
    return hsl_to_rgb(h, s, 0.97)


def hex_of(rgb):
    return "#%02x%02x%02x" % tuple(int(round(max(0, min(255, v)))) for v in rgb[:3])


def rgb_of(hx):
    hx = hx.lstrip("#")
    if len(hx) == 3:
        hx = "".join(c * 2 for c in hx)
    return np.array([int(hx[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


# ---------------------------------------------------------------- 解析
TOKEN = re.compile(
    r'<(/?)g(?=[^>]*?(?:data-name|id)="([^"]*)")[^>]*>'
    r'|<(polygon|path)\b([^>]*?)/>'
    r'|</g>')


def parse(text):
    """-> (class->color, [ {stack, tag, attrs, cls} ])"""
    cmap = {}
    st = re.search(r"<style>(.*?)</style>", text, re.S)
    if st:
        for m in re.finditer(r"\.cls-(\d+)\s*\{([^}]*)\}", st.group(1)):
            f = re.search(r"fill:\s*([^;]+)", m.group(2))
            if f and f.group(1).strip().startswith("#"):
                cmap["cls-" + m.group(1)] = f.group(1).strip().lower()

    elems, stack = [], []
    for m in TOKEN.finditer(text):
        if m.group(1) == "/":
            if stack:
                stack.pop()
        elif m.group(3):
            attrs = m.group(4) or ""
            c = re.search(r'class="([^"]*)"', attrs)
            elems.append(dict(stack=list(stack), tag=m.group(3), attrs=attrs,
                              cls=c.group(1) if c else None))
        else:
            stack.append(m.group(2))
    return cmap, elems


def centroid(el):
    p = re.search(r'points="([^"]*)"', el["attrs"])
    if p:
        nums = [float(x) for x in re.findall(r"-?[\d.]+", p.group(1))]
        if nums:
            return (sum(nums[0::2]) / len(nums[0::2]),
                    sum(nums[1::2]) / len(nums[1::2]))
    d = re.search(r'\bd="([^"]*)"', el["attrs"])
    if d:
        nums = [float(x) for x in re.findall(r"-?[\d.]+", d.group(1))]
        if nums:
            return (sum(nums[0::2]) / len(nums[0::2]),
                    sum(nums[1::2]) / len(nums[1::2]))
    return (0.0, 0.0)


def classify(el, w, h):
    names = " ".join(n for n in el["stack"] if n)
    if "翅膀-2" in names:
        return "wings-right"
    if "翅膀" in names:
        return "wings-left"
    cx, cy = centroid(el)
    u, v = cx / w, cy / h
    if v < 0.16:
        return "antennae"
    if v > 0.80 and abs(u - 0.5) > 0.30:
        return "legs"
    if u < 0.34:
        return "wings-left"
    if u > 0.66:
        return "wings-right"
    return "body"


def build(text, out_name, mode="color"):
    cmap, elems = parse(text)
    vm = re.search(r'viewBox="([^"]*)"', text)
    vb = [float(x) for x in vm.group(1).split()] if vm else [0, 0, 100, 100]
    w, h = vb[2], vb[3]

    draw = [e for e in elems if e["tag"] in ("polygon", "path")]
    if not draw:
        return None

    groups = {}
    for e in draw:
        groups.setdefault(classify(e, w, h), []).append(e)

    lines = ["<!-- SiMuseor 蝉形 · %s · 由 Illustrator 导出整理" % out_name,
             "     结构：<g> 解剖分组 → 每面片一条 <polygon>/<path>，语义 id 可逐元素改",
             "     源：AI 导出；色值已内联（不依赖 <style>） -->",
             '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %g %g" '
             'width="%g" height="%g" role="img" aria-hidden="true">' % (w, h, w, h)]

    n = 0
    for g in ("wings-left", "wings-right", "body", "antennae", "legs"):
        if g not in groups:
            continue
        items = sorted(groups[g], key=lambda e: centroid(e)[0])
        lines.append('<g id="%s">' % g)
        for i, e in enumerate(items, 1):
            eid = "%s-%02d" % (g, i)
            n += 1
            fill = cmap.get(e["cls"], "#ffffff")
            if mode == "mono":
                fill = "#1b1b1e"
            elif mode == "dark":
                fill = hex_of(ensure_contrast(rgb_of(fill)))
            p = re.search(r'points="([^"]*)"', e["attrs"])
            d = re.search(r'\bd="([^"]*)"', e["attrs"])
            if p:
                lines.append('  <polygon id="%s" points="%s" fill="%s" fill-rule="evenodd"/>'
                             % (eid, p.group(1), fill))
            else:
                lines.append('  <path id="%s" d="%s" fill="%s" fill-rule="evenodd"/>'
                             % (eid, d.group(1), fill))
        lines.append("</g>")
    lines.append("</svg>")

    out = "\n".join(lines) + "\n"
    path = os.path.join(OUT, out_name + ".svg")
    io.open(path, "w", encoding="utf-8", newline="\n").write(out)
    return path, n, w, h


def main():
    os.makedirs(OUT, exist_ok=True)
    for src_name, base in FILES.items():
        sp = os.path.join(SRC, src_name)
        if not os.path.exists(sp):
            print("跳过（不存在）:", src_name)
            continue
        text = io.open(sp, encoding="utf-8").read()
        for mode, suffix in (("color", ""), ("mono", "-mono"), ("dark", "-dark")):
            r = build(text, base + suffix, mode)
            if r:
                path, n, w, h = r
                print("%-11s %-6s -> %-26s %2d 元素 %gx%-6g %5d B"
                      % (src_name, mode, os.path.basename(path), n, w, h,
                         os.path.getsize(path)))
    for src_name, base in LINEART.items():
        sp = os.path.join(SRC, src_name)
        if not os.path.exists(sp):
            continue
        text = io.open(sp, encoding="utf-8").read()
        out = re.sub(r"fill:\s*#fff\b", "fill: none", text)
        path = os.path.join(OUT, base + ".svg")
        io.open(path, "w", encoding="utf-8", newline="\n").write(out)
        print("%-11s lineart -> %-26s %5d B"
              % (src_name, os.path.basename(path), os.path.getsize(path)))


if __name__ == "__main__":
    main()
