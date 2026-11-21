"""
色域实测：把 model-tone.ts 的家族色 / 任务色 / 中性底拉出来，算出每个槽位的
色相域、L* 域、C* 域，以及文字压底的对比度区间。VIS color.html 的「色域约束」
必须来自实测数字，不能是拍脑袋的区间。

同时解出照片卡遮罩的白字下限 alpha（渐变约束要用）。

用法：.venv\\Scripts\\python.exe artifacts\\vis\\vis-color-domain.py
"""

import re
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TONE_TS = ROOT / "web" / "src" / "app" / "core" / "model-tone.ts"

# ── 色彩数学 ────────────────────────────────────────────────────────────────

def hex_to_rgb(h):
    h = h.strip().lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb_to_hsl(r, g, b):
    r, g, b = r / 255.0, g / 255.0, b / 255.0
    mx, mn = max(r, g, b), min(r, g, b)
    l = (mx + mn) / 2
    if mx == mn:
        h = s = 0.0
    else:
        d = mx - mn
        s = d / (2 - mx - mn) if l > 0.5 else d / (mx + mn)
        if mx == r:
            h = ((g - b) / d) % 6
        elif mx == g:
            h = (b - r) / d + 2
        else:
            h = (r - g) / d + 4
        h *= 60
    return h, s * 100, l * 100


def _lab_f(t):
    return t ** (1 / 3) if t > 216 / 24389 else (841 / 108) * t + 4 / 29


def rgb_to_lab(r, g, b):
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = lin(r), lin(g), lin(b)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 1.0
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    fx, fy, fz = _lab_f(x), _lab_f(y), _lab_f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def luminance(rgb):
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = [lin(c) for c in rgb]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def composite(fg_rgb, alpha, bg_rgb):
    return tuple(fg_rgb[i] * alpha + bg_rgb[i] * (1 - alpha) for i in range(3))


# ── 解析 model-tone.ts ──────────────────────────────────────────────────────

def parse_block(src, name):
    """抓 `export const <name> = { ... }` 里的 key: { bg, ink, strong, mark } 行。"""
    m = re.search(r"export const %s\s*:[^=]*=\s*\{" % name, src)
    if not m:
        return {}
    depth, i = 0, m.end() - 1
    for j in range(m.end() - 1, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                body = src[m.end():j]
                break
    else:
        body = src[m.end():]

    out = {}
    for key, bg, ink, strong, mark in re.findall(
        r"(\w+)\s*:\s*\{\s*bg:\s*'(#[0-9a-fA-F]{6})',\s*ink:\s*'(#[0-9a-fA-F]{6})',"
        r"\s*strong:\s*'(#[0-9a-fA-F]{6})',\s*mark:\s*'(#[0-9a-fA-F]{6})'\s*\}", body):
        out[key] = dict(zip(("bg", "ink", "strong", "mark"), (bg, ink, strong, mark)))
    return out


src = TONE_TS.read_text(encoding="utf-8")
FAM = parse_block(src, "FAMILY_TONE")
FAM_D = parse_block(src, "FAMILY_TONE_DARK")
TASK = parse_block(src, "TASK_TONE")
TASK_D = parse_block(src, "TASK_TONE_DARK")

m = re.search(r"export const NEUTRAL_TONE:\s*Tone\s*=\s*\{(.*?)\};", src, re.S)
NEUTRAL = dict(re.findall(r"(bg|ink|strong|mark):\s*'(#[0-9a-fA-F]{6})'", m.group(1)))
m = re.search(r"export const NEUTRAL_TONE_DARK:\s*Tone\s*=\s*\{(.*?)\};", src, re.S)
NEUTRAL_D = dict(re.findall(r"(bg|ink|strong|mark):\s*'(#[0-9a-fA-F]{6})'", m.group(1)))

print("解析结果：家族 %d / 家族深 %d / 任务 %d / 任务深 %d" %
      (len(FAM), len(FAM_D), len(TASK), len(TASK_D)))
assert len(FAM) == 25 and len(TASK) == 12, "解析数量不符，检查正则"


def stats(table, slot, label):
    hues, ls, cs, sats = [], [], [], []
    for k, v in table.items():
        rgb = hex_to_rgb(v[slot])
        h, s, l = rgb_to_hsl(*rgb)
        L, a, b = rgb_to_lab(*rgb)
        hues.append(h)
        sats.append(s)
        ls.append(L)
        cs.append(math.hypot(a, b))
    return {
        "表": label, "槽位": slot, "n": len(table),
        "h_min": min(hues), "h_max": max(hues),
        "s_min": min(sats), "s_max": max(sats),
        "L_min": min(ls), "L_max": max(ls),
        "C_min": min(cs), "C_max": max(cs),
    }


def contrast_rows(table, label):
    rows = []
    for k, v in table.items():
        bg = hex_to_rgb(v["bg"])
        rows.append({
            "id": k,
            "ink_on_bg": contrast(hex_to_rgb(v["ink"]), bg),
            "strong_on_bg": contrast(hex_to_rgb(v["strong"]), bg),
            "mark_on_bg": contrast(hex_to_rgb(v["mark"]), bg),
            "bg_on_page": contrast(bg, hex_to_rgb("#f5f5f6" if label == "浅" else "#0b0b0d")),
        })
    return rows


print("\n═══ 槽位色域（HSL / L* / C*） ═══")
print(f"{'表':<8}{'槽位':<8}{'n':>3}  {'H域':<14}{'S域':<14}{'L*域':<14}{'C*域':<14}")
all_stats = []
for tbl, lab in ((FAM, "家族浅"), (FAM_D, "家族深"), (TASK, "任务浅"), (TASK_D, "任务深")):
    for slot in ("bg", "ink", "strong", "mark"):
        s = stats(tbl, slot, lab)
        all_stats.append(s)
        print(f"{lab:<8}{slot:<8}{s['n']:>3}  "
              f"{s['h_min']:6.1f}–{s['h_max']:6.1f}  "
              f"{s['s_min']:5.1f}–{s['s_max']:5.1f}  "
              f"{s['L_min']:5.1f}–{s['L_max']:5.1f}  "
              f"{s['C_min']:5.1f}–{s['C_max']:5.1f}")

print("\n═══ 文字压底对比度 ═══")
for tbl, lab, page in ((FAM, "家族浅", "#f5f5f6"), (FAM_D, "家族深", "#0b0b0d"),
                        (TASK, "任务浅", "#f5f5f6"), (TASK_D, "任务深", "#0b0b0d")):
    rows = contrast_rows(tbl, lab)
    for field, name in (("ink_on_bg", "ink/bg"), ("strong_on_bg", "strong/bg"),
                        ("mark_on_bg", "mark/bg"), ("bg_on_page", "bg/页底")):
        vals = [r[field] for r in rows]
        worst = min(rows, key=lambda r: r[field])
        print(f"{lab:<8}{name:<10} min {min(vals):5.2f}:1 ({worst['id']})   "
              f"max {max(vals):5.2f}:1   中位 {sorted(vals)[len(vals)//2]:5.2f}:1")

# ── 照片卡遮罩：白字压在照片上需要多少 alpha ────────────────────────────────
print("\n═══ 照片遮罩 scrim alpha 下限（白字 4.5:1） ═══")
scrim = hex_to_rgb("#0a0c18")
for photo_name, photo in (("纯白照片", (255, 255, 255)),
                          ("中灰照片", (128, 128, 128)),
                          ("浅灰照片", (200, 200, 200))):
    need = None
    for i in range(1, 101):
        a = i / 100
        if contrast((255, 255, 255), composite(scrim, a, photo)) >= 4.5:
            need = a
            break
    print(f"  {photo_name:<8} 需 alpha ≥ {need:.2f}  "
          f"(现用 0.45 → 实算 {contrast((255,255,255), composite(scrim, 0.45, photo)):.2f}:1)")

# ── 蝉形 / 品牌渐变端点 ─────────────────────────────────────────────────────
print("\n═══ 渐变端点（H/S/L 与两端对比度） ═══")
GRADS = {
    "蝉形色带 5 档": ["#3a0a3f", "#6d0a5e", "#a3389c", "#d2477e", "#f4776a"],
    "MiniMax 官方 symbol": ["#e21680", "#ff633a"],
    "家族色 ramp 样例 flux": [FAM["flux"]["bg"], FAM["flux"]["ink"], FAM["flux"]["strong"]],
    "家族色 ramp 样例 qwen": [FAM["qwen"]["bg"], FAM["qwen"]["ink"], FAM["qwen"]["strong"]],
    "交互渐变 indigo 600→700": ["#4f46e5", "#4338ca"],
}
for name, stops in GRADS.items():
    print(f"\n  {name}")
    for s in stops:
        rgb = hex_to_rgb(s)
        h, sa, l = rgb_to_hsl(*rgb)
        L, a, b = rgb_to_lab(*rgb)
        cw = contrast(rgb, (255, 255, 255))
        cb = contrast(rgb, (0, 0, 0))
        print(f"    {s}  H{h:6.1f}° S{sa:5.1f}% L{l:5.1f}%  L*{L:5.1f} C*{math.hypot(a,b):5.1f}  "
              f"白字{cw:5.2f}:1 黑字{cb:5.2f}:1")
    hs = [rgb_to_hsl(*hex_to_rgb(s))[0] for s in stops]
    Ls = [rgb_to_lab(*hex_to_rgb(s))[0] for s in stops]
    dh = max(hs) - min(hs)
    print(f"    → 端点 Δh {dh:.1f}°   ΔL* {max(Ls) - min(Ls):.1f}")

out = {
    "stats": all_stats,
    "families_light": FAM,
    "families_dark": FAM_D,
    "tasks_light": TASK,
    "tasks_dark": TASK_D,
    "neutral": NEUTRAL,
    "neutral_dark": NEUTRAL_D,
}
(ROOT / "artifacts" / "vis" / "_work" / "color-domain.json").write_text(
    json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
print("\n写出：artifacts/vis/_work/color-domain.json")
