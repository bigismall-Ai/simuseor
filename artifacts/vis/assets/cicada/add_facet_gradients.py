#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
add_facet_gradients.py — 给蝉形矢量的每个面片加内部微渐变。

背景（主理人 19:00 裁决）：
  · 源资产 `assets/cicada/svg/cicada-{max,mid,min}.svg` 是 86/61/40 个**纯色填充**
    的面片（来自 Illustrator 导出，`<polygon>` + 直线连接）
  · 用户要求「修改渐变色」→ 裁决：**每面片微渐变**（方案 A），**保持现有色相**
    （312°–360°/0° 暖色带 plum→品红→橙红不动）

与「全局贯穿渐变」（方案 C）的区别（实测否决理由）：
  C 会让所有面片共用一条渐变 → **面片间的色彩差异被压平**，低多边形的
  「拼块感」消失。A 保留每个面片的独立色，只在**面片内部**加极轻的光泽变化。

渐变构造（每个面片独立）：
  · 色相：面片自身色相 ± HUE_SPAN（默认 10°），沿对角线方向渐变
  · 饱和度：起点 ×1.04 → 终点 ×1.00（轻微衰减）
  · 明度：起点 ×0.97 → 终点 ×1.03（微亮起微暗收，形成极轻的金属光泽）
  · 渐变方向：按面片包围盒的对角线（bbox 左上 → 右下），userSpaceOnUse

输出：
  cicada-{max,mid,min}.svg            ← 替换原纯色版
  cicada-{max,mid,min}-mono.svg       ← mono 不变（单色剪影不需渐变）
  cicada-{max,mid,min}-dark.svg       ← 深色版：渐变 + HSL 提明至 ≥3:1
"""

import io
import os
import re

import numpy as np

ROOT = r"E:/Projects/model-downloader"
SVG_DIR = os.path.join(ROOT, "artifacts/vis/assets/cicada/svg")

DARK_BG = np.array([0x15, 0x15, 0x1a])
DARK_TARGET = 3.0

HUE_SPAN = 10.0     # 面片内色相跨度（度）
SAT_FROM = 1.04     # 起点饱和度倍率
SAT_TO = 1.00
LIGHT_FROM = 0.97   # 起点明度倍率
LIGHT_TO = 1.03


# ---------------------------------------------------------------- 色彩
def hex_of(rgb):
    return "#%02x%02x%02x" % tuple(int(round(max(0, min(255, v)))) for v in rgb[:3])


def rgb_of(hx):
    hx = hx.lstrip("#")
    if len(hx) == 3:
        hx = "".join(c * 2 for c in hx)
    return np.array([int(hx[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


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


def ensure_contrast(rgb, bg=DARK_BG, target=DARK_TARGET):
    if contrast(rgb, bg) >= target:
        return np.asarray(rgb, dtype=np.float64)
    h, s, l = rgb_to_hsl(rgb)
    for i in range(1, 101):
        cand = hsl_to_rgb(h, s, min(0.97, l + i * 0.01))
        if contrast(cand, bg) >= target:
            return cand
    return hsl_to_rgb(h, s, 0.97)


# ---------------------------------------------------------------- 解析
ELEM = re.compile(
    r'<(polygon|path)\s+id="([^"]*)"\s+(points|d)="([^"]*)"\s+fill="(#[0-9a-fA-F]{6})"([^>]*)/>')


def bbox_of(el):
    if el["geom"] == "points":
        n = [float(x) for x in re.findall(r"-?[\d.]+", el["data"])]
        xs, ys = n[0::2], n[1::2]
    else:
        n = [float(x) for x in re.findall(r"-?[\d.]+", el["data"])]
        xs, ys = n[0::2], n[1::2]
    if not xs:
        return (0, 0, 1, 1)
    return (min(xs), min(ys), max(xs), max(ys))


def parse(text):
    """解析元素，**同时记录它属于哪个 <g id>**（解剖分组）。

    v2.1 修正：旧版只按元素顺序输出，导致加渐变后**丢失了 <g> 分组**
    （面片变成 82 个匿名 polygon）。渐变是「给面片上色」，
    不该动结构 —— 分组与语义 id 必须原样保留。

    分组归属用「<g> 开标签与 </g> 的栈匹配」判定，不用前缀计数
    （前缀计数在嵌套/自闭合场景下会错位）。
    """
    els = []
    # 先把 <g id="..."> 与 </g> 的位置标出来，维护一个栈
    events = []
    for gm in re.finditer(r'<g\s+id="([^"]*)"[^>]*>|</g>', text):
        events.append((gm.start(), gm.end(), gm.group(1) if gm.group(1) else None))
    stack = []
    grp_at = []          # 每个 g 区间的 [起, 止, 组名]
    for (s0, e0, name) in events:
        if name is not None:
            stack.append((s0, name))
        else:
            if stack:
                st, nm = stack.pop()
                grp_at.append((st, s0, nm))
    grp_at.sort()

    for m in ELEM.finditer(text):
        grp = ""
        for (g0, g1, nm) in grp_at:
            if g0 < m.start() < g1:
                grp = nm
                break
        els.append(dict(tag=m.group(1), eid=m.group(2), geom=m.group(3),
                        data=m.group(4), fill=m.group(5), rest=m.group(6),
                        group=grp))
    return els


def facet_union_path(els):
    """所有面片并集 → 一条 path，用作**白色底衬**。

    为什么必须有：AI 导出版**没有底衬** —— 接缝是「面片之间的空隙」露出的
    页面背景。所以浅底上接缝是白色，深底上就变成黑色（实测深色版接缝不可见）。
    补一条覆盖整个主体的白色底衬，接缝在任何底色下都是白色。

    实现：polygon 走 points→path 转换，path 直接取 d，合并成一条多子路径 path，
    fill-rule="evenodd" 让相邻面片区域重叠不产生孔洞。
    """
    segs = []
    for el in els:
        if el["geom"] == "points":
            n = [float(x) for x in re.findall(r"-?[\d.]+", el["data"])]
            pts = list(zip(n[0::2], n[1::2]))
            if len(pts) < 3:
                continue
            if pts[0] != pts[-1]:
                pts.append(pts[0])
            segs.append("M" + " L".join("%g %g" % p for p in pts) + " Z")
        else:
            d = el["data"].strip()
            if d:
                segs.append(d)
    return " ".join(segs) if segs else None


def grad_defs(els, dark=False):
    """生成每个面片的 linearGradient 定义。"""
    defs = []
    grads = {}
    for i, el in enumerate(els):
        base = rgb_of(el["fill"])
        if dark:
            base = ensure_contrast(base)
        h, s, l = rgb_to_hsl(base)
        c0 = hsl_to_rgb(h - HUE_SPAN, min(1.0, s * SAT_FROM), max(0.0, min(1.0, l * LIGHT_FROM)))
        c1 = hsl_to_rgb(h + HUE_SPAN, min(1.0, s * SAT_TO), max(0.0, min(1.0, l * LIGHT_TO)))
        if dark:
            c0 = ensure_contrast(c0)
            c1 = ensure_contrast(c1)
        x0, y0, x1, y1 = bbox_of(el)
        gid = "fg%03d" % (i + 1)
        defs.append('<linearGradient id="%s" gradientUnits="userSpaceOnUse" '
                    'x1="%g" y1="%g" x2="%g" y2="%g">'
                    '<stop offset="0" stop-color="%s"/>'
                    '<stop offset="1" stop-color="%s"/></linearGradient>'
                    % (gid, x0, y0, x1, y1, hex_of(c0), hex_of(c1)))
        grads[el["eid"]] = gid
    return defs, grads


def build(src_path, out_path, mode="color"):
    text = io.open(src_path, encoding="utf-8").read()
    els = parse(text)
    if not els:
        print("跳过（无面片）:", src_path)
        return False

    if mode == "mono":
        # mono = 单色剪影，不需要渐变
        out = []
        for el in els:
            out.append('<%s id="%s" %s="%s" fill="#1b1b1e" fill-rule="evenodd"/>'
                       % (el["tag"], el["eid"], el["geom"], el["data"]))
        body = "".join(out)
        head = text[:text.index(">") + 1]
        # 保留原 viewBox
        vb = re.search(r'viewBox="([^"]*)"', text).group(1)
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s" width="%s" height="%s" '
               'role="img" aria-hidden="true">\n%s\n</svg>'
               % (vb, vb.split()[2], vb.split()[3], body))
        io.open(out_path, "w", encoding="utf-8", newline="\n").write(svg)
        return True

    defs, grads = grad_defs(els, dark=(mode == "dark"))
    # 按原 <g> 分组重建结构 —— 加渐变只改 fill，不动分组与语义 id
    body = []
    # 白色底衬（seam-base-*）必须在**所有面片之前**画 —— 它是接缝的载体，
    # 面片盖在上面，接缝就是面片之间透出的白。若夹在组里会破坏组结构。
    base_els = [e for e in els if e["eid"].startswith("seam-base")]
    facet_els = [e for e in els if not e["eid"].startswith("seam-base")]
    for el in base_els:
        body.append('<%s id="%s" %s="%s" fill="#ffffff" fill-rule="evenodd"/>'
                    % (el["tag"], el["eid"], el["geom"], el["data"]))
    # 面片按原 <g> 分组重建
    cur = None
    for el in facet_els:
        g = el["group"]
        if g != cur:
            if cur is not None:
                body.append("</g>")
            if g:
                body.append('<g id="%s">' % g)
            cur = g
        body.append('<%s id="%s" %s="%s" fill="url(#%s)" fill-rule="evenodd"/>'
                    % (el["tag"], el["eid"], el["geom"], el["data"], grads[el["eid"]]))
    if cur is not None:
        body.append("</g>")
    vb = re.search(r'viewBox="([^"]*)"', text).group(1)
    w, h = vb.split()[2], vb.split()[3]
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s" width="%s" height="%s" '
           'role="img" aria-hidden="true">\n'
           '<!-- SiMuseor 蝉形 · 每面片微渐变（色相±%g°，饱和/明度微调）\n'
           '     色相基准不变（plum→品红→橙红 暖色带）；渐变仅在面片内部\n'
           '     解剖分组与每面片语义 id 原样保留（渐变只改 fill） -->\n'
           '<defs>\n%s\n</defs>\n%s\n</svg>'
           % (vb, w, h, HUE_SPAN, "\n".join(defs), "\n".join(body)))
    io.open(out_path, "w", encoding="utf-8", newline="\n").write(svg)
    return True


def main():
    """一次读取纯色底座，同时输出 color / dark / mono 三个变体。

    ⚠️ 不能循环里「写 color 再读 color」——color 会覆盖源，后两个变体就
    读不到纯色输入了（fill 已是 url(#...) 形式，纯色正则匹配不到）。
    ✅ 必须走 build()：它是唯一保留 <g> 解剖分组与语义 id 的输出路径
       （早期版本在 main 里内联拼字符串，把分组弄丢了）。
    """
    for base in ("cicada-max", "cicada-mid", "cicada-min"):
        # 纯色底座：_flat_ 前缀（由 build_from_ai 或部署版生成）
        src = os.path.join(SVG_DIR, "_flat_" + base + ".svg")
        if not os.path.exists(src):
            src = os.path.join(SVG_DIR, base + ".svg")
        if not os.path.exists(src):
            print("跳过（不存在）:", base)
            continue
        text = io.open(src, encoding="utf-8").read()
        if "linearGradient" in text:
            print("  %-14s 底座已是渐变版，跳过" % base)
            continue
        els = parse(text)
        if not els:
            print("  %-14s 未解析到面片" % base)
            continue
        from collections import Counter
        groups = dict(Counter(e["group"] for e in els))
        for mode, suffix in (("color", ""), ("dark", "-dark"), ("mono", "-mono")):
            out = os.path.join(SVG_DIR, base + suffix + ".svg")
            build(src, out, mode)
            t = io.open(out, encoding="utf-8").read()
            print("%-26s %6d B  渐变=%-3d 元素=%-3d 分组=%d"
                  % (base + suffix + ".svg", len(t.encode()), t.count("linearGradient"),
                     t.count("<polygon") + t.count("<path"), t.count("<g ")))
        print("  %-14s 底座分组: %s" % (base, groups))

    print("\n完成。渐变参数：色相 ±%g°  饱和 ×%.2f→%.2f  明度 ×%.2f→%.2f"
          % (HUE_SPAN, SAT_FROM, SAT_TO, LIGHT_FROM, LIGHT_TO))


if __name__ == "__main__":
    main()
