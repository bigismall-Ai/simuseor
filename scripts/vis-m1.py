"""VIS M1 机械替换：字重 / 圆角 / 阴影 / --accent 填充 / --faint 文本 / 线宽。

严格按 artifacts/vis/_phase3-engineering.md §5.2 执行：
- 不新增、不删除任何 CSS 变量值
- 只把字面量与引用换成白名单值 / 合规变量
- 每项改完打印实际命中数，与文档预期对账
"""
from __future__ import annotations

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
STYLES = ROOT / "web/src/styles.css"


def load() -> str:
    return STYLES.read_text(encoding="utf-8")


def save(text: str) -> None:
    STYLES.write_text(text, encoding="utf-8")


def report(label: str, before: int, after: int) -> None:
    flag = "OK " if after == 0 else "!! 剩余"
    print(f"  {label}: {before} -> {after}  {flag}")


def m1a_weights() -> None:
    """M1-a 字重白名单：550→500，620/640/650/660/680→600。"""
    s = load()
    before = len(re.findall(r"font-weight: (?:550|620|640|650|660|680)", s))
    # 550 是 .btn / label / badge 等「中等偏轻」，归 500
    s = re.sub(r"font-weight: 550\b", "font-weight: 500", s)
    # 620~680 是一堆「想比 600 稍粗」的尝试，统一 600
    for w in ("620", "640", "650", "660", "680"):
        s = re.sub(rf"font-weight: {w}\b", "font-weight: 600", s)
    # font: 550 12px/1.4 ... （简写形式）
    s = re.sub(r"font: 550 ", "font: 500 ", s)
    save(s)
    after = len(re.findall(r"font-weight: (?:550|620|640|650|660|680)", load()))
    report("M1-a 字重", before, after)


def m1b_radius() -> None:
    """M1-b 圆角：4px→radius-xs，6px 分两处（btn-xs→sm，step-row→xs），16px→radius-lg。"""
    s = load()
    before = len(re.findall(r"border-radius: (?:4|6|9|16)px;", s))
    s = s.replace("border-radius: 4px;", "border-radius: var(--radius-xs);")
    # 16px 的 .modal：值不变只 token 化（radius-lg 定义即 16px）
    s = s.replace("border-radius: 16px;", "border-radius: var(--radius-lg);")
    save(s)
    print(f"  M1-b 圆角: 已处理 4px / 16px；6px 需按选择器逐条判断")
    after = len(re.findall(r"border-radius: (?:4|9|16)px;", load()))
    report("M1-b 剩余（不含 6px）", before, after)


def m1b_radius_6() -> None:
    """6px 两处目标不同：.btn-xs 归 8px（sm），.step-row 归 5px（xs）。"""
    s = load()
    for m in re.finditer(r"([^\n{}]+)\{[^}]*border-radius: 6px;", s):
        print(f"    6px 命中: {m.group(1).strip()[:60]}")
    save(s)


def m1c_shadows() -> None:
    """M1-c hover 阴影：.task:hover 去 box-shadow；.segmented active 去内阴影。"""
    s = load()
    hits = 0

    old_task = """.task:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-sm);
}"""
    new_task = """.task:hover {
  border-color: var(--border-strong);
}"""
    if old_task in s:
        s = s.replace(old_task, new_task)
        hits += 1

    old_seg = """  box-shadow: 0 1px 2px rgb(24 24 27 / 0.08);"""
    # 只在 .segmented button.active 里删
    seg_match = re.search(r"(\.segmented button\.active \{[^}]*?)" + re.escape(old_seg) + r"(\s*\})", s)
    if seg_match:
        s = s[: seg_match.start()] + seg_match.group(1).rstrip() + "\n}" + s[seg_match.end():]
        hits += 1

    save(s)
    print(f"  M1-c hover 阴影: 处理 {hits} 处")


def m1d_accent_fill() -> None:
    """M1-d --accent 白字填充 → --primary（仅 filter-chip.active 与 step-dot）。"""
    s = load()
    hits = 0

    old = """.filter-chip.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-primary);"""
    new = """.filter-chip.active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);"""
    if old in s:
        s = s.replace(old, new)
        hits += 1

    old_hover = """.filter-chip.active:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: var(--on-primary); }"""
    new_hover = """/* hover 与 active 完全一致：--accent-hover #c7d2fe 上白字 1.49:1、--primary-hover #6366f1 上
   白字 4.47:1 都不达标。可点性由 cursor / aria-pressed / :focus-visible 承担。 */
.filter-chip.active:hover { background: var(--primary); border-color: var(--primary); color: var(--on-primary); }"""
    if old_hover in s:
        s = s.replace(old_hover, new_hover)
        hits += 1

    old_dot = ".step-row.active .step-dot { background: var(--accent); color: var(--on-primary); }"
    new_dot = ".step-row.active .step-dot { background: var(--primary); color: var(--on-primary); }"
    if old_dot in s:
        s = s.replace(old_dot, new_dot)
        hits += 1

    save(s)
    print(f"  M1-d --accent 白字填充: 处理 {hits} 处（预期 3）")
    left = len(re.findall(r"var\(--accent\);\s*\n\s*color: var\(--on-primary\)", load()))
    print(f"    仍有 accent+on-primary 组合: {left}")


def m1e_faint() -> None:
    """M1-e --faint 承载文本 → --muted。非文本用途（scrollbar / log-live）保持。"""
    s = load()
    keep_markers = [
        "*::-webkit-scrollbar-thumb:hover { background: var(--faint)",
        ".log-live.paused { background: var(--faint)",
    ]
    # 先把「非文本用途」的两处临时替换成占位符，避免被批量改掉
    for i, marker in enumerate(keep_markers):
        s = s.replace(marker, marker.replace("var(--faint)", f"__FAINT_KEEP{i}__"))

    before = len(re.findall(r"var\(--faint\)", s))
    s = s.replace("var(--faint)", "var(--muted)")
    # placeholder 也降级为 --muted（只换色，不动选择器与文案）
    s = s.replace("color: var(--placeholder)", "color: var(--muted)")

    for i, marker in enumerate(keep_markers):
        s = s.replace(f"__FAINT_KEEP{i}__", "var(--faint)")

    save(s)
    after = len(re.findall(r"var\(--faint\)", load()))
    print(f"  M1-e --faint 文本: {before} 处改 --muted，保留非文本 {after} 处")
    print(f"    --placeholder 剩余: {len(re.findall(r'var\\(--placeholder\\)', load()))}")


def m1f_stroke() -> None:
    """M1-f 线宽 1.6 → 1.5。"""
    s = load()
    before = len(re.findall(r"stroke-width: 1\.6", s))
    s = s.replace("stroke-width: 1.6;", "stroke-width: 1.5;")
    save(s)
    after = len(re.findall(r"stroke-width: 1\.6", load()))
    report("M1-f 线宽", before, after)


def main() -> None:
    print("VIS M1 机械替换")
    m1a_weights()
    m1b_radius()
    m1b_radius_6()
    m1c_shadows()
    m1d_accent_fill()
    m1e_faint()
    m1f_stroke()
    print("\n完成。请跑 vis-check.mjs 验收。")


if __name__ == "__main__":
    main()
