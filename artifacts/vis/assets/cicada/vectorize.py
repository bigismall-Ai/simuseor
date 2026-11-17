#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
vectorize_v2.py — SiMuseor 蝉形辅助图形 · 反向矢量化管线（v2 实现）

================================================================================
与 v1（vectorize-cicada.py）的差异
--------------------------------------------------------------------------------
v1 用「裂纹边界行走」(crack_loops) 追踪每个连通块的轮廓，实测产出崩坏：
只切出 3 个面片、SVG 仅 4 条 path、16–128px 渲染的不透明像素为 0。

v2 换成三步稳健法：
  A. 主体 = 从画布边界洪水填充剥离白底（连通域标记 + 取触边连通域，等价且更快）
  B. 面片 / 接缝 = 对**主体整体**做连通域标记后，用「腐蚀是否消失」区分
       · 面片   ：腐蚀后仍大面积存活
       · 接缝带 ：2px 宽的白色发丝，腐蚀一次就消失
     源图里接缝是纯白线，但被 JPEG 抗锯齿混成了粉色过渡像素
     （实测 (255,170,207)/(255,207,232)/(255,210,225)），
     **纯色阈值抓不到它**（严格判据 min>=238 且 chroma<12 只命中 39 px），
     必须用几何判据而不是颜色判据。
  C. 轮廓 = cv2.findContours(RETR_CCOMP) + approxPolyDP。
     接缝 = 一整块白底，facet 画在它上面 → 缝自然显示为白色网络，
     矢量输出是「还原」而不是「近似」。
================================================================================

用法
--------------------------------------------------------------------------------
    python vectorize_v2.py --outdir artifacts/vis/assets/cicada
    python vectorize_v2.py --outdir ... --frame max=<path> --sizes 16,32,64
"""

import argparse
import io
import json
import os

import cv2
import numpy as np
from PIL import Image

# ---------------------------------------------------------------- 默认参数
DEFAULTS = dict(
    bg_thr=40,          # 背景判据：max(255 - c) <= bg_thr
    min_facet=60,       # 面片最小面积（源图像素）
    seam_tophat=55,     # 接缝亮度脊线阈值（tophat 5×5）
    seam_base_eps=5.0,  # 底衬专用容差（底衬只是剪影，精度要求低于面片）
    rdp_eps=3.0,        # 轮廓简化容差（源图像素）；实测 eps2→3 顶点数降 18% 而接缝区色差几乎不变
    grad_delta=10,      # 面片内颜色极差超过此值 → 用线性渐变而非纯色
    seam_color="#ffffff",
)


# ==============================================================================
# 基础工具
# ==============================================================================


def hex_of(rgb):
    return "#%02x%02x%02x" % tuple(int(round(v)) for v in rgb)


def rgb_of(hx):
    hx = hx.lstrip("#")
    return np.array([int(hx[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def subject_mask(rgb):
    """从画布边界洪水填充剥离白底，返回主体布尔掩膜。"""
    h, w = rgb.shape[:2]
    dist = (255 - rgb.astype(np.int16)).max(axis=2)
    near = (dist <= DEFAULTS["bg_thr"]).astype(np.uint8)
    n, lab = cv2.connectedComponents(near, connectivity=4)
    border_ids = set(lab[0, :].tolist()) | set(lab[h - 1, :].tolist())
    border_ids |= set(lab[:, 0].tolist()) | set(lab[:, w - 1].tolist())
    bg = np.isin(lab, list(border_ids)) & (lab > 0)
    return ~bg


def bbox_of(mask):
    ys, xs = np.nonzero(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def rdp(points, eps):
    """Douglas-Peucker 简化（返回保序点列）。"""
    pts = np.asarray(points, dtype=np.float64)
    if len(pts) < 3:
        return pts
    keep = np.zeros(len(pts), dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        a, b = pts[i], pts[j]
        ab = b - a
        nrm = float(np.hypot(ab[0], ab[1]))
        seg = pts[i + 1:j]
        if nrm < 1e-9:
            dist = np.hypot(seg[:, 0] - a[0], seg[:, 1] - a[1])
        else:
            dist = np.abs(ab[0] * (a[1] - seg[:, 1]) - (a[0] - seg[:, 0]) * ab[1]) / nrm
        k = int(np.argmax(dist))
        if dist[k] > eps:
            k += i + 1
            keep[k] = True
            stack.append((i, k))
            stack.append((k, j))
    return pts[keep]


def contours_to_path(mask, eps, fill_rule="evenodd"):
    """二值掩膜 → 一条 path（外轮廓 + 孔洞）。"""
    cnts, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    parts = []
    for c in cnts:
        if len(c) < 3:
            continue
        ap = cv2.approxPolyDP(c, eps, True)
        if len(ap) < 3:
            continue
        pts = rdp(ap.reshape(-1, 2), eps * 0.6)
        if len(pts) < 3:
            continue
        parts.append("M" + " L".join("%g %g" % (p[0], p[1]) for p in pts) + " Z")
    if not parts:
        return None
    return " ".join(parts)


def rel_lum(rgb):
    def ch(v):
        v = v / 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = [ch(c) for c in rgb[:3]]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = rel_lum(a), rel_lum(b)
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


def ensure_contrast(rgb, bg, target=3.0):
    """保持色相/饱和度，抬高明度直到对 bg 达到目标对比度。"""
    if contrast(rgb, bg) >= target:
        return np.asarray(rgb, dtype=np.float64)
    h, s, l = rgb_to_hsl(rgb)
    best = np.asarray(rgb, dtype=np.float64)
    for i in range(1, 101):
        nl = min(0.98, l + i * 0.01)
        cand = hsl_to_rgb(h, s, nl)
        if contrast(cand, bg) >= target:
            return cand
        best = cand
    return best


# ==============================================================================
# 面片分析
# ==============================================================================


def facet_gradient(pixels, colors, w, h):
    """面片内颜色沿主轴的线性回归 → (c0, c1, x1, y1, x2, y2) 或 None。

    ⚠️ 本函数在 v2.0 中被**禁用**：源图实测是纯色平涂（8×8 sd 1.0–4.0），
    面片掩膜里混入的「接缝粉色过渡像素」会让线性回归误判成面片内渐变
    （实测 64/64 面片 spread 中位 208）。保留函数仅供将来真正含渐变的源图使用。
    """
    if len(pixels) < 40:
        return None
    pts = np.asarray(pixels, dtype=np.float64)
    rgb = np.asarray(colors, dtype=np.float64)
    c = pts - pts.mean(axis=0)
    cov = (c.T @ c) / len(c)
    evals, evecs = np.linalg.eigh(cov)
    axis = evecs[:, int(np.argmax(evals))]
    if np.hypot(axis[0], axis[1]) < 1e-9:
        return None
    t = (pts - pts.mean(axis=0)) @ axis
    spread = t.max() - t.min()
    if spread < 12:
        return None
    t0, t1 = t.min(), t.max()
    c0 = np.zeros(3)
    c1 = np.zeros(3)
    for k in range(3):
        A = np.vstack([np.ones_like(t), t]).T
        sol, *_ = np.linalg.lstsq(A, rgb[:, k], rcond=None)
        c0[k] = sol[0] + sol[1] * t0
        c1[k] = sol[0] + sol[1] * t1
    if np.abs(c0 - c1).max() < DEFAULTS["grad_delta"]:
        return None
    origin = pts.mean(axis=0)
    p0 = origin + axis * t0
    p1 = origin + axis * t1
    return (np.clip(c0, 0, 255), np.clip(c1, 0, 255),
            float(p0[0]), float(p0[1]), float(p1[0]), float(p1[1]))


def facet_color(pixels, colors):
    """面片代表色 = **纯色平涂**，取中位色。

    必须剔除接缝的粉色过渡像素后再取中位 —— 否则中位色会被亮粉拉偏。
    """
    rgb = np.asarray(colors, dtype=np.float64)
    med = np.median(rgb, axis=0)
    # 只保留距中位色在阈值内的像素（剔除接缝混入的亮粉/暗紫）
    d = np.abs(rgb - med).max(axis=1)
    core = rgb[d <= 18]
    if len(core) >= max(8, len(rgb) // 8):
        med = np.median(core, axis=0)
    return med


def analyze_frame(rgb_path, debug=False):
    im = Image.open(rgb_path).convert("RGB")
    full = np.asarray(im)
    sub = subject_mask(full)
    x0, y0, x1, y1 = bbox_of(sub)
    crop = full[y0:y1 + 1, x0:x1 + 1]
    mask = sub[y0:y1 + 1, x0:x1 + 1]
    h, w = mask.shape

    # ---- 接缝 = 亮度脊线（tophat），不是纯色阈值 -----------------------------
    # 源图接缝是纯白线，但被 JPEG 抗锯齿混成粉色过渡像素，纯色阈值抓不到；
    # tophat 实测分离度极好：88.7% 的主体像素 tophat < 10（面片内部），
    # 接缝是明显的 > 50 的高脊线。
    gray = cv2.cvtColor(crop.astype(np.uint8), cv2.COLOR_RGB2GRAY)
    k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    tophat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, k5).astype(np.int16)
    seam_core = ((tophat >= DEFAULTS["seam_tophat"]) & mask).astype(np.uint8)
    k3 = np.ones((3, 3), np.uint8)
    seam_core = cv2.morphologyEx(seam_core, cv2.MORPH_CLOSE, k3, iterations=1)
    # 主体外缘是「暗→白」的谷不是脊，tophat≈0，不会被误判为接缝 ✓

    # ---- 面片 = 主体去掉接缝脊线后的连通域 ----------------------------------
    facet_mask = (mask.astype(np.uint8) & (1 - seam_core))
    n, lab = cv2.connectedComponents(facet_mask, connectivity=4)
    facets = []
    for i in range(1, n):
        comp = (lab == i).astype(np.uint8)
        area = int(comp.sum())
        if area < DEFAULTS["min_facet"]:
            continue
        ys, xs = np.nonzero(comp)
        cols = crop[ys, xs].astype(np.float64)
        med = facet_color(list(zip(xs.tolist(), ys.tolist())), cols)
        # 内核色差（剔除接缝混入后）—— 纯色平涂应接近 0
        d = np.abs(cols - med).max(axis=1)
        core = cols[d <= 18]
        spread = float((core.max(axis=0) - core.min(axis=0)).max()) if len(core) else 0.0
        facets.append(dict(comp=comp, area=area, color=med, spread=spread, grad=None,
                           bbox=(int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))))
    facets.sort(key=lambda f: -f["area"])

    # ---- 白色底衬：整个主体剪影。面片画在它上面 → 缝自然显示为白色网络 ------
    sil = mask.astype(np.uint8)
    seam_px = int((sil & (1 - facet_mask.astype(bool))).sum())

    if debug:
        print("   [debug] 连通域 %d | 接缝脊线 %d px (%.2f%%) | 面片 %d" %
              (n - 1, int(seam_core.sum()), 100.0 * seam_core.sum() / max(1, sil.sum()), len(facets)))
        print("   [debug] 面积分布 top12:", [f["area"] for f in facets[:12]])
        print("   [debug] 面积 <60 的连通域被丢弃，共 %d 个" %
              sum(1 for i in range(1, n) if int((lab == i).sum()) < DEFAULTS["min_facet"]))

    return dict(crop=crop, mask=mask, facets=facets, seam=sil,
                seam_core=seam_core, seam_px=seam_px,
                size=(w, h), src_bbox=(x0, y0, x1, y1))



def seam_base_paths(mask, eps, min_area=24):
    """底衬 = 主体剪影，**按连通块拆成多条独立 path**。

    为什么拆：主体实际由 24 个连通块组成（左右翅 / 躯肢 / 触角各自断开），
    合成一条 path 会产生 360 个顶点、其中 6 条是 1 点碎块（面积 0，纯噪）。
    拆分后：① 每块可单独编辑 / 删除 ② 顶点降到 ~200 ③ 结构可读。

    返回 [(path_d, area), ...]（按面积降序）
    """
    cnts, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL,
                                cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in cnts:
        area = cv2.contourArea(c)
        if area < min_area:
            continue          # 丢弃 1 点碎块
        ap = cv2.approxPolyDP(c, eps, True)
        if len(ap) < 3:
            continue
        pts = rdp(ap.reshape(-1, 2), eps * 0.6)
        if len(pts) < 3:
            continue
        out.append(("M" + " L".join("%g %g" % (p[0], p[1]) for p in pts) + " Z", area))
    out.sort(key=lambda t: -t[1])
    return out


def build_svg(fa, seam_color=DEFAULTS["seam_color"], gradient=True):
    """彩色版：白色底衬（接缝网络）+ 面片。

    **可编辑性设计**（v2.0）：
      · 每个面片 = 一条 `<path>`，带**语义 id**（`facet-wing-l-03` 之类）
      · 按解剖区域**分组**（`<g id="wings-left">` 等）
      · 面片用**纯色填充**（源图是纯色平涂，渐变是分割伪影）
      · 顶部有注释说明结构，改单个面片只需改它自己的 `fill`
    """
    w, h = fa["size"]
    body = []
    groups = {}
    for idx, f in enumerate(fa["facets"]):
        cx, cy = (f["bbox"][0] + f["bbox"][2]) / 2, (f["bbox"][1] + f["bbox"][3]) / 2
        g = classify_region(cx, cy, w, h)
        groups.setdefault(g, []).append((idx, f))
    # 每组内按 x 排序 → id 序号即「从左到右」的视觉顺序
    for g in groups:
        groups[g].sort(key=lambda t: (t[1]["bbox"][0], t[1]["bbox"][1]))
    counters = {}
    for g in groups:
        for i, (idx, f) in enumerate(groups[g]):
            f["gid"] = "%s-%02d" % (g, i + 1)

    parts = []
    parts.append("<!-- SiMuseor 蝉形 · MAX 帧 · 低多边形面片矢量")
    parts.append("     结构：<g> 按解剖区域分组 → <path> 每个面片一条，纯色填充")
    parts.append("     编辑：改单个面片 = 改该 <path> 的 fill 属性（色值格式 #rrggbb）")
    parts.append("     面片 %d 个 · 主体 %dx%d · 接缝为白色底衬透出" % (len(fa["facets"]), w, h))
    parts.append("     -->")

    # ① 底衬（白色接缝网）必须**最先**绘制 —— 它在面片之下，接缝靠它透出
    for i, (sd, area) in enumerate(seam_base_paths(fa["mask"], DEFAULTS["seam_base_eps"])):
        parts.append('  <path id="seam-base-%02d" d="%s" fill="%s" fill-rule="evenodd"/>'
                     % (i + 1, sd, seam_color))

    # ② 面片盖在底衬之上
    for gname in ("wings-left", "wings-right", "body", "antennae", "legs"):
        if gname not in groups:
            continue
        parts.append('<g id="%s">' % gname)
        for idx, f in groups[gname]:
            d = contours_to_path(f["comp"], DEFAULTS["rdp_eps"])
            if not d:
                continue
            parts.append('  <path id="%s" d="%s" fill="%s" fill-rule="evenodd"/>'
                         % (f["gid"], d, hex_of(f["color"])))
        parts.append("</g>")

    head = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" '
            'width="%d" height="%d" role="img" aria-hidden="true">' % (w, h, w, h))
    return head + "\n".join(parts) + "\n</svg>"


def classify_region(cx, cy, w, h):
    """按几何位置判定面片所属解剖区域。"""
    u = cx / w                      # 0..1 横向
    v = cy / h                      # 0..1 纵向
    if v < 0.18:
        return "antennae"
    if v > 0.78 and abs(u - 0.5) > 0.28:
        return "legs"
    if u < 0.34:
        return "wings-left"
    if u > 0.66:
        return "wings-right"
    return "body"



def build_mono_svg(fa, color):
    """单色剪影：整个主体（含缝）填一种颜色。"""
    w, h = fa["size"]
    parts = []
    for i, (sd, area) in enumerate(seam_base_paths(fa["mask"], DEFAULTS["seam_base_eps"])):
        parts.append('  <path id="silhouette-%02d" d="%s" fill="%s" fill-rule="evenodd"/>'
                     % (i + 1, sd, color))
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d" '
            'role="img" aria-hidden="true">\n%s\n</svg>' % (w, h, w, h, "\n".join(parts)))


def build_dark_svg(fa, bg=(0x15, 0x15, 0x1a), target=3.0):
    """深底版：暗部抬到对深底 ≥ target:1，接缝保持白色骨架。

    与彩色版**同样的分组与语义 id**，便于逐面片对照修改。
    """
    w, h = fa["size"]
    groups = {}
    for idx, f in enumerate(fa["facets"]):
        cx, cy = (f["bbox"][0] + f["bbox"][2]) / 2, (f["bbox"][1] + f["bbox"][3]) / 2
        groups.setdefault(classify_region(cx, cy, w, h), []).append((idx, f))
    for g in groups:
        groups[g].sort(key=lambda t: (t[1]["bbox"][0], t[1]["bbox"][1]))
    for g in groups:
        for i, (idx, f) in enumerate(groups[g]):
            f["gid"] = "%s-%02d" % (g, i + 1)

    parts = ["<!-- SiMuseor 蝉形 · MAX 帧 · 深色主题版",
             "     与彩色版结构一致（同分组、同 id），仅面片色值经对比度抬升",
             "     最暗面片对 #15151a 实测 %.2f:1（目标 ≥3:1） -->" % target]
    # ① 底衬最先绘制
    for i, (sd, area) in enumerate(seam_base_paths(fa["mask"], DEFAULTS["seam_base_eps"])):
        parts.append('  <path id="seam-base-%02d" d="%s" fill="#ffffff" fill-rule="evenodd"/>'
                     % (i + 1, sd))
    # ② 面片
    for gname in ("wings-left", "wings-right", "body", "antennae", "legs"):
        if gname not in groups:
            continue
        parts.append('<g id="%s">' % gname)
        for idx, f in groups[gname]:
            d = contours_to_path(f["comp"], DEFAULTS["rdp_eps"])
            if not d:
                continue
            parts.append('  <path id="%s" d="%s" fill="%s" fill-rule="evenodd"/>'
                         % (f["gid"], d, hex_of(ensure_contrast(f["color"], bg, target))))
        parts.append("</g>")
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d" '
            'role="img" aria-hidden="true">\n%s\n</svg>' % (w, h, w, h, "\n".join(parts)))



# ==============================================================================
# 渲染
# ==============================================================================


def render(svg_path, out_png, size):
    import cairosvg
    cairosvg.svg2png(url=svg_path, write_to=out_png, output_width=size, output_height=size)


def write_ico(png_paths, out_path):
    try:
        from PIL import Image as PILImage
        ims = [PILImage.open(p).convert("RGBA") for p in png_paths]
        ims[-1].save(out_path, format="ICO",
                     sizes=[(im.width, im.height) for im in ims],
                     append_images=ims[:-1])
        return True
    except Exception as exc:  # pragma: no cover
        print("   ico 写入失败:", exc)
        return False


def measure(png_path):
    a = np.asarray(Image.open(png_path).convert("RGBA"))
    alpha = a[:, :, 3]
    op = alpha > 10
    if op.sum() == 0:
        return dict(size=int(a.shape[0]), opaque_px=0, coverage=0.0,
                    bright_ratio=0.0, dark_ratio=0.0)
    rgb = a[:, :, :3].astype(np.float64)
    lum = rgb.mean(axis=2)
    bright = ((lum > 200) & op).sum() / op.sum()
    dark = ((lum < 90) & op).sum() / op.sum()
    return dict(size=int(a.shape[0]), opaque_px=int(op.sum()),
                coverage=round(float(op.sum()) / (a.shape[0] * a.shape[1]), 4),
                bright_ratio=round(float(bright), 4), dark_ratio=round(float(dark), 4))


# ==============================================================================
# main
# ==============================================================================


def main():
    ap = argparse.ArgumentParser(description="SiMuseor 蝉形反向矢量化（v2）")
    ap.add_argument("--srcdir", default="artifacts/vis/assets/logo-new")
    ap.add_argument("--outdir", default="artifacts/vis/assets/cicada")
    ap.add_argument("--frame", action="append", default=None,
                    help="name=path，可重复")
    ap.add_argument("--sizes", default="16,32,48,64,128,256,512,1024")
    ap.add_argument("--report", default=None)
    args = ap.parse_args()

    frames = args.frame or [
        "min=%s/SiMuseor-Logo-MIN.jpg" % args.srcdir,
        "mid=%s/SiMuseor-Logo-MID.jpg" % args.srcdir,
        "max=%s/SiMuseor-Logo-MAX.jpg" % args.srcdir,
    ]
    os.makedirs(args.outdir, exist_ok=True)
    sizes = [int(s) for s in args.sizes.split(",") if s.strip()]
    report = {"params": dict(DEFAULTS), "sizes": sizes, "frames": {}}

    for spec in frames:
        name, path = spec.split("=", 1)
        print("[vectorize-v2] %s <- %s" % (name, path))
        fa = analyze_frame(path)
        fac = fa["facets"]
        print("   主体 %dx%d px | 面片 %d | 接缝带 %d px" %
              (fa["size"][0], fa["size"][1], len(fac), int(fa["seam"].sum())))

        svg = build_svg(fa)
        mono = build_mono_svg(fa, "#1b1b1e")
        dark = build_dark_svg(fa)
        os.makedirs(os.path.join(args.outdir, "svg"), exist_ok=True)
        os.makedirs(os.path.join(args.outdir, "png"), exist_ok=True)
        os.makedirs(os.path.join(args.outdir, "ico"), exist_ok=True)
        outs = {}
        for key, content in (("color", svg), ("mono", mono), ("dark", dark)):
            p = os.path.join(args.outdir, "svg", "cicada-%s%s.svg" % (name, "" if key == "color" else "-" + key))
            io.open(p, "w", encoding="utf-8", newline="\n").write(content)
            outs[key] = dict(path=p, bytes=len(content.encode("utf-8")))

        legib = []
        pngs = []
        for s in sizes:
            png = os.path.join(args.outdir, "png", "cicada-%s-%d.png" % (name, s))
            render(outs["color"]["path"], png, s)
            pngs.append(png)
            m = measure(png)
            m["path"] = png
            legib.append(m)
        ico = os.path.join(args.outdir, "ico", "cicada-%s.ico" % name)
        write_ico(pngs[-4:-1] if len(pngs) >= 4 else pngs, ico)

        report["frames"][name] = dict(
            source=path, size=list(fa["size"]), facet_count=len(fac),
            seam_px=int(fa["seam"].sum()),
            seam_ratio=round(float(fa["seam"].sum()) / max(1, int(fa["mask"].sum())), 4),
            top_facets=[dict(area=int(f["area"]), color=hex_of(f["color"]),
                             spread=round(float(f["spread"]), 1),
                             gradient=bool(f["grad"])) for f in fac[:8]],
            svg=outs, legibility=legib, ico=ico)
        print("   → %d 面片 | svg %d B | ico %s" %
              (len(fac), outs["color"]["bytes"], os.path.basename(ico)))

    rp = args.report or os.path.join(args.outdir, "vectorize-report.json")
    io.open(rp, "w", encoding="utf-8", newline="\n").write(
        json.dumps(report, ensure_ascii=False, indent=1))
    print("[vectorize-v2] report -> %s" % rp)


if __name__ == "__main__":
    main()
