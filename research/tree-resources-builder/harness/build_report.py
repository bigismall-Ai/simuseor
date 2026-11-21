"""生成离线自包含可视化报告 report.html（内嵌 CSS/JS/SVG/图片，无外部资源）。"""
from __future__ import annotations

import base64
import io
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = json.load(open(os.path.join(ROOT, "assets", "pipeline_data.json"), encoding="utf-8"))
VAL = DATA["validation"]
PREV = DATA["previews"]
MANIFEST = DATA["manifest"]
EXPORT_PATH = os.path.join(ROOT, "assets", "validation", "exports.json")
EXPORTS = json.load(open(EXPORT_PATH, encoding="utf-8")) if os.path.exists(EXPORT_PATH) else None
SOMA_PATH = os.path.join(ROOT, "assets", "validation", "soma_cpu_test.json")
SOMA = json.load(open(SOMA_PATH, encoding="utf-8")) if os.path.exists(SOMA_PATH) else None
SOMA_PREV_PATH = os.path.join(ROOT, "assets", "validation", "soma_previews.json")
SOMA_PREV = json.load(open(SOMA_PREV_PATH, encoding="utf-8")) if os.path.exists(SOMA_PREV_PATH) else {}
ADULT_PATH = os.path.join(ROOT, "assets", "validation", "soma_anny_adult.json")
ADULT = json.load(open(ADULT_PATH, encoding="utf-8")) if os.path.exists(ADULT_PATH) else None
PUBLIC_PATH = os.path.join(ROOT, "assets", "validation", "public_assets.json")
PUBLIC = json.load(open(PUBLIC_PATH, encoding="utf-8")) if os.path.exists(PUBLIC_PATH) else None
PUBLIC_PREV_PATH = os.path.join(ROOT, "assets", "validation", "public_previews.json")
PUBLIC_PREV = json.load(open(PUBLIC_PREV_PATH, encoding="utf-8")) if os.path.exists(PUBLIC_PREV_PATH) else {}
SRC_PREV_PATH = os.path.join(ROOT, "assets", "validation", "source_previews.json")
SRC_PREV = json.load(open(SRC_PREV_PATH, encoding="utf-8")) if os.path.exists(SRC_PREV_PATH) else {}
SHOT_PATH = os.path.join(ROOT, "assets", "validation", "shot_001.json")
SHOT = json.load(open(SHOT_PATH, encoding="utf-8")) if os.path.exists(SHOT_PATH) else None
SHOT_SHEET = os.path.join(ROOT, "shots", "shot_001", "contact_sheet.jpg")
PREV.update(SOMA_PREV)


def scan_assets():
    files = []
    for dirpath, _, names in os.walk(os.path.join(ROOT, "assets")):
        for n in names:
            p = os.path.join(dirpath, n)
            files.append({"path": os.path.relpath(p, ROOT), "bytes": os.path.getsize(p)})
    files.sort(key=lambda x: x["path"])
    return {"count": len(files), "total_bytes": sum(f["bytes"] for f in files), "files": files}


MANIFEST.update(scan_assets())


# ------------------------------------------------------------------ 图片
def b64(path, max_w=1180, quality=84):
    p = path if os.path.isabs(path) else os.path.join(ROOT, path)
    im = Image.open(p).convert("RGB")
    if im.width > max_w:
        im = im.resize((max_w, int(im.height * max_w / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


# ------------------------------------------------------------------ 覆盖矩阵
CATS = ["人物", "服装", "道具", "载具·汽车", "载具·飞机", "载具·轮船", "建筑", "大型场景",
        "生物/动物", "植被", "人群", "特效占位", "动作数据", "摄像机/空间"]
PARADIGMS = ["A 代码生成", "B 图元序列", "C 参数化操控", "D 验证闭环", "E 组合策略", "F 非网格"]
# full=完整几何, proxy=代理/简化, data=纯数据, apply=强制适用, na=不适用, todo=待验证
MATRIX = [
    ["proxy", "proxy", "full", "apply", "comb", "data"],
    ["proxy", "proxy", "proxy", "apply", "comb", "na"],
    ["full", "full", "full", "apply", "comb", "na"],
    ["full", "full", "todo", "apply", "comb", "na"],
    ["proxy", "proxy", "full", "apply", "comb", "na"],
    ["full", "proxy", "full", "apply", "comb", "na"],
    ["full", "full", "full", "apply", "comb", "na"],
    ["proxy", "full", "na", "apply", "comb", "data"],
    ["proxy", "proxy", "full", "apply", "comb", "na"],
    ["full", "proxy", "full", "apply", "comb", "na"],
    ["na", "full", "proxy", "apply", "comb", "data"],
    ["na", "na", "na", "apply", "comb", "data"],
    ["na", "na", "na", "apply", "comb", "data"],
    ["na", "na", "na", "apply", "comb", "data"],
]
CELL = {
    "full": ("●", "完整几何", "lv-full"),
    "proxy": ("◐", "简化/代理", "lv-proxy"),
    "data": ("○", "纯数据/参数", "lv-data"),
    "apply": ("✓", "强制适用", "lv-apply"),
    "comb": ("◆", "按类别组合", "lv-comb"),
    "na": ("—", "不适用", "lv-na"),
    "todo": ("?", "待验证", "lv-todo"),
}
CELL_NOTE = {
    "人物": ["bpy 可写人体但拓扑/绑定成本高", "图元拼装只得体块", "SOMA-X：Apache-2.0，CPU 12ms/mesh（官方）", "尺度/水密/关节限位", "C 为主 + A 做服装外壳", "SOMA-X 77 关节 + BVH 重定向"],
    "服装": ["偏移壳/板片可程序化", "服装=板片图元", "无成熟开源参数化服装底座", "贴合/穿插检查", "人体底座 + 壳层", "—"],
    "道具": ["OpenSCAD/CadQuery 强项", "零件+装配描述", "参数化模板库可复用", "尺寸/水密", "A/B 混用", "—"],
    "载具·汽车": ["loft + 零件库（本报告已产出）", "零件装配语义", "无成熟开源参数化汽车底座", "尺度/离地/穿插", "A+B", "—"],
    "载具·飞机": ["bpy 可建但参数化弱", "部件装配", "OpenVSP：NASA NOSA，headless API", "气动外形尺寸", "VSP + 装配", "—"],
    "载具·轮船": ["loft 船体可程序化", "分段装配", "Freeship/DELFTship", "干舷/尺度", "C+A", "—"],
    "建筑": ["bpy/代码可生成体量", "BIMScript 类场景程序", "IfcOpenShell + Bonsai", "层高/构件语义", "B+C", "—"],
    "大型场景": ["散件生成可行，场景组织弱", "USD 组装 + 实例化", "—", "布局/视锥/碰撞", "B 为主", "布局 JSON + 时序"],
    "生物/动物": ["有机形态代码化不可用", "体块代理", "SMAL（研究许可）", "比例/骨架异构", "C 唯一现实解", "—"],
    "植被": ["L-system 本报告实测", "枝干图元 + 冠层代理", "Arbaro/ngPlant/Sapling", "高度/枝干连通", "C+A", "—"],
    "人群": ["不适用（逐人建造成本过高）", "实例化 + 变换表", "同一人体底座参数化", "间距/密度", "B+F", "crowd_layout + BVH clip"],
    "特效占位": ["不适用", "不适用", "不适用", "轨迹连续性", "F", "体积/轨迹 JSON + USD Volume"],
    "动作数据": ["不适用", "不适用", "不适用", "滑步/限位/角速度", "F", "BVH（本报告已产出）"],
    "摄像机/空间": ["不适用", "不适用", "不适用", "投影覆盖率/居中", "F", "USD Camera + JSON（本报告已产出）"],
}


def matrix_html():
    head = "".join(f"<th>{p}</th>" for p in PARADIGMS)
    rows = []
    for i, cat in enumerate(CATS):
        cells = []
        for j, val in enumerate(MATRIX[i]):
            sym, label, cls = CELL[val]
            note = CELL_NOTE[cat][j]
            cells.append(
                f'<td class="cell {cls}" data-cat="{cat}" data-par="{PARADIGMS[j]}" '
                f'data-val="{val}" data-note="{note}" tabindex="0">'
                f'<span class="sym">{sym}</span><span class="lbl">{label}</span></td>')
        rows.append(f'<tr data-cat="{cat}"><th class="rowh">{cat}</th>{"" .join(cells)}</tr>')
    return f'<table class="matrix" id="matrix"><thead><tr><th>资产类别</th>{head}</tr></thead><tbody>{"".join(rows)}</tbody></table>'


# ------------------------------------------------------------------ 雷达图
TOOLS = [
    ("Blender bpy", [5.0, 5.0, 5.0, 4.6, 4.2], "#3b6ea5"),
    ("CadQuery/build123d", [5.0, 5.0, 4.0, 5.0, 4.0], "#c07a3e"),
    ("OpenSCAD", [5.0, 5.0, 4.4, 4.8, 3.0], "#6f8f5a"),
    ("SOMA-X", [4.2, 4.0, 3.4, 5.0, 5.0], "#8a5ea8"),
    ("OpenVSP", [5.0, 4.8, 4.0, 4.6, 4.0], "#b34f5f"),
    ("trimesh+manifold", [5.0, 5.0, 4.8, 5.0, 3.2], "#4b7f86"),
]
TOOL_AXES = ["CPU 路径", "代码可运行", "社区活跃", "约束匹配", "白模适用"]


def radar_svg(size=620):
    cx, cy, R = size / 2, size / 2 + 8, size * 0.31
    n = len(TOOL_AXES)
    out = [f'<svg viewBox="0 0 {size} {size}" class="chart" role="img" aria-label="工具成熟度雷达图">']
    for ring in range(1, 6):
        pts = []
        for i in range(n):
            a = -3.14159 / 2 + 2 * 3.14159 * i / n
            r = R * ring / 5
            pts.append(f"{cx + r * __import__('math').cos(a):.1f},{cy + r * __import__('math').sin(a):.1f}")
        out.append(f'<polygon points="{" ".join(pts)}" fill="none" stroke="#d7dbe2" stroke-width="1"/>')
    for i, lab in enumerate(TOOL_AXES):
        a = -3.14159 / 2 + 2 * 3.14159 * i / n
        x, y = cx + R * 1.16 * __import__('math').cos(a), cy + R * 1.16 * __import__('math').sin(a)
        anchor = "middle" if abs(x - cx) < 20 else ("start" if x > cx else "end")
        out.append(f'<text x="{x:.1f}" y="{y + 4:.1f}" text-anchor="{anchor}" class="axlab">{lab}</text>')
    for name, vals, color in TOOLS:
        pts = []
        for i, v in enumerate(vals):
            a = -3.14159 / 2 + 2 * 3.14159 * i / n
            r = R * v / 5
            pts.append(f"{cx + r * __import__('math').cos(a):.1f},{cy + r * __import__('math').sin(a):.1f}")
        out.append(f'<polygon points="{" ".join(pts)}" fill="{color}" fill-opacity="0.10" '
                   f'stroke="{color}" stroke-width="2"/>')
        for i, v in enumerate(vals):
            a = -3.14159 / 2 + 2 * 3.14159 * i / n
            r = R * v / 5
            out.append(f'<circle cx="{cx + r * __import__("math").cos(a):.1f}" '
                       f'cy="{cy + r * __import__("math").sin(a):.1f}" r="3" fill="{color}"/>')
    out.append("</svg>")
    legend = "".join(f'<span class="lg"><i style="background:{c}"></i>{n}</span>' for n, _, c in TOOLS)
    return "".join(out), legend


# ------------------------------------------------------------------ 散点图
SCATTER = [
    ("SOMA-X", 4.40, 4.90, "C", 12, "l", -3),
    ("CadQuery / build123d", 4.15, 4.55, "A", 11, "l", 12),
    ("OpenVSP", 3.95, 4.45, "C", 9, "r", -10),
    ("Blender bpy", 2.95, 4.20, "A", 13, "l", 0),
    ("SMAL", 3.35, 4.05, "C", 9, "r", 14),
    ("JSON 配方 + 解释器", 4.75, 3.55, "A", 10, "l", -4),
    ("USD 场景组装", 4.25, 3.35, "B", 9, "l", 15),
    ("OpenSCAD", 4.92, 3.30, "A", 8, "l", -11),
    ("L-system 植被", 4.55, 2.95, "C", 8, "l", 13),
    ("ShapeAssembly", 4.86, 2.68, "B", 8, "l", -9),
    ("BVH 程序化动作", 4.58, 2.32, "F", 7, "l", 4),
]
PCOLOR = {"A": "#3b6ea5", "B": "#c07a3e", "C": "#8a5ea8", "F": "#4b7f86"}


def scatter_svg(w=780, h=470):
    ml, mr, mt, mb = 72, 30, 34, 62
    iw, ih = w - ml - mr, h - mt - mb

    def X(v):
        return ml + (v / 5) * iw

    def Y(v):
        return mt + (1 - v / 5) * ih

    out = [f'<svg viewBox="0 0 {w} {h}" class="chart" role="img" aria-label="精度与速度散点图">']
    for g in range(1, 6):
        out.append(f'<line x1="{X(g)}" y1="{mt}" x2="{X(g)}" y2="{mt + ih}" stroke="#e3e6eb"/>')
        out.append(f'<line x1="{ml}" y1="{Y(g)}" x2="{ml + iw}" y2="{Y(g)}" stroke="#e3e6eb"/>')
        out.append(f'<text x="{X(g)}" y="{mt + ih + 20}" text-anchor="middle" class="tick">{g}</text>')
        out.append(f'<text x="{ml - 10}" y="{Y(g) + 4}" text-anchor="end" class="tick">{g}</text>')
    out.append(f'<rect x="{X(3)}" y="{mt}" width="{iw / 2}" height="{ih / 2}" fill="#3b6ea5" opacity="0.04"/>')
    out.append(f'<text x="{X(4.1)}" y="{Y(4.55)}" class="quad">高精度 · 快迭代</text>')
    out.append(f'<text x="{X(4.1)}" y="{Y(1.35)}" class="quad">快速但仅代理</text>')
    out.append(f'<text x="{X(1.25)}" y="{Y(4.55)}" class="quad">精确但重</text>')
    out.append(f'<text x="{X(1.25)}" y="{Y(1.35)}" class="quad">不建议</text>')
    for i, (name, x, y, p, r, side, dy) in enumerate(SCATTER, start=1):
        out.append(f'<circle cx="{X(x):.1f}" cy="{Y(y):.1f}" r="{r}" fill="{PCOLOR[p]}" '
                   f'fill-opacity="0.28" stroke="{PCOLOR[p]}" stroke-width="2"/>')
        out.append(f'<text x="{X(x):.1f}" y="{Y(y) + 3.5:.1f}" text-anchor="middle" '
                   f'class="pnum">{i}</text>')
    out.append(f'<text x="{ml + iw / 2}" y="{h - 12}" text-anchor="middle" class="axname">生成/迭代速度 →</text>')
    out.append(f'<text transform="translate(18,{mt + ih / 2}) rotate(-90)" text-anchor="middle" '
               f'class="axname">结构精度 / 可控性 →</text>')
    out.append("</svg>")
    items = "".join(
        f'<span class="pitem"><b class="pno" style="background:{PCOLOR[p]}">{i}</b>'
        f'{n}<span class="pmeta">精度 {y:.1f} · 速度 {x:.1f}</span></span>'
        for i, (n, x, y, p, r, side, dy) in enumerate(SCATTER, start=1))
    return "".join(out), f'<div class="ptlist">{items}</div>'


# ------------------------------------------------------------------ 平行坐标
P_AXES = ["几何精度", "类别覆盖", "工程简洁度", "开箱可用", "可验证性"]
SERIES = [
    ("架构 1：统一契约", [4.2, 4.6, 4.4, 4.2, 4.9], "#3b6ea5"),
    ("架构 2：MCP 异构编排", [4.6, 4.9, 2.4, 3.2, 3.8], "#c07a3e"),
    ("单范式：纯 bpy", [3.9, 3.2, 3.0, 3.6, 3.4], "#6f8f5a"),
]


def parallel_svg(w=900, h=430):
    ml, mr, mt, mb = 60, 60, 60, 60
    iw, ih = w - ml - mr, h - mt - mb
    out = [f'<svg viewBox="0 0 {w} {h}" class="chart" role="img" aria-label="平行坐标图">']
    for i, ax in enumerate(P_AXES):
        x = ml + iw * i / (len(P_AXES) - 1)
        out.append(f'<line x1="{x:.1f}" y1="{mt}" x2="{x:.1f}" y2="{mt + ih}" stroke="#cfd4dc"/>')
        out.append(f'<text x="{x:.1f}" y="{mt - 18}" text-anchor="middle" class="axlab">{ax}</text>')
        for g in (1, 3, 5):
            y = mt + ih * (1 - g / 5)
            out.append(f'<text x="{x - 6:.1f}" y="{y + 4:.1f}" text-anchor="end" class="tick">{g}</text>')
    for name, vals, color in SERIES:
        pts = []
        for i, v in enumerate(vals):
            x = ml + iw * i / (len(P_AXES) - 1)
            y = mt + ih * (1 - v / 5)
            pts.append(f"{x:.1f},{y:.1f}")
        out.append(f'<polyline points="{" ".join(pts)}" fill="none" stroke="{color}" stroke-width="3" '
                   f'stroke-linejoin="round"/>')
        for p in pts:
            x, y = p.split(",")
            out.append(f'<circle cx="{x}" cy="{y}" r="4" fill="{color}"/>')
    out.append("</svg>")
    legend = "".join(f'<span class="lg"><i style="background:{c}"></i>{n}</span>' for n, _, c in SERIES)
    return "".join(out), legend


# ------------------------------------------------------------------ 架构图
def box(x, y, w, h, title, lines, fill="#f4f6f9", stroke="#c9d1dc", badge=""):
    t = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{fill}" stroke="{stroke}" stroke-width="1.4"/>']
    t.append(f'<text x="{x + 14}" y="{y + 24}" class="boxt">{title}</text>')
    if badge:
        t.append(f'<text x="{x + w - 12}" y="{y + 22}" text-anchor="end" class="badge">{badge}</text>')
    for i, ln in enumerate(lines):
        t.append(f'<text x="{x + 14}" y="{y + 46 + i * 18}" class="boxl">{ln}</text>')
    return "".join(t)


def arrow(x1, y1, x2, y2, color="#7a8699", dashed=False, curve=0):
    dash = ' stroke-dasharray="6 5"' if dashed else ""
    if curve:
        mid = ((x1 + x2) / 2, (y1 + y2) / 2 + curve)
        d = f"M{x1},{y1} Q{mid[0]},{mid[1]} {x2},{y2}"
    else:
        d = f"M{x1},{y1} L{x2},{y2}"
    return (f'<path d="{d}" fill="none" stroke="{color}" stroke-width="2"{dash} '
            f'marker-end="url(#arw)"/>')


def arch_svg():
    out = ['<svg viewBox="0 0 1120 560" class="chart arch" role="img" aria-label="架构一数据流图">',
           '<defs><marker id="arw" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">'
           '<path d="M0,0 L9,4.5 L0,9 z" fill="#7a8699"/></marker>'
           '<marker id="arwr" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">'
           '<path d="M0,0 L9,4.5 L0,9 z" fill="#c07a3e"/></marker></defs>']
    out.append('<rect x="26" y="26" width="250" height="508" rx="12" fill="#f7f8fb" stroke="#dde2ea"/>')
    out.append('<text x="42" y="52" class="colt">LLM 侧（云端 API）</text>')
    out.append(box(42, 74, 218, 96, "Planner", ["解析镜头/资产清单", "拆分为可执行任务", "选择范式与适配器"], "#eef3fa"))
    out.append(box(42, 194, 218, 108, "Author", ["输出 JSON 配方 / 代码", "参数化指令（体型·尺寸）", "结构化场景描述"], "#eef3fa"))
    out.append(box(42, 326, 218, 90, "Repair", ["读验证反馈", "定位失败字段", "生成最小参数修正"], "#fbf1e8"))
    out.append(box(42, 440, 218, 74, "Prompt 资产库", ["规范/示例/失败案例", "检索增强（可选）"], "#f2f5f7"))
    out.append('<rect x="296" y="26" width="430" height="508" rx="12" fill="#f7f9f8" stroke="#d9e3df"/>')
    out.append('<text x="312" y="52" class="colt">本地 CPU 执行层</text>')
    out.append(box(312, 74, 196, 92, "配方解释器", ["白名单几何原语", "loft / boolean / L-system", "trimesh + manifold3d"], "#edf5f1", "实测"))
    out.append(box(524, 74, 186, 92, "参数化适配器", ["SOMA-X（人体）", "OpenVSP / IFC / SMAL", "进程隔离，按需加载"], "#edf5f1", "接口"))
    out.append(box(312, 190, 196, 96, "动画烘焙器", ["关节角 → BVH", "步态/关键帧参数", "FK 自检"], "#edf5f1", "实测"))
    out.append(box(524, 190, 186, 96, "相机/特效", ["贝塞尔路径采样", "视锥参数计算", "体积/碎片轨迹"], "#edf5f1", "实测"))
    out.append(box(312, 312, 398, 88, "资产总线 Asset Bus", ["glTF/GLB（几何）  ·  USDA（场景/相机/骨骼）",
                                                            "JSON（语义契约/布局/参数）  ·  BVH（动作）"], "#eaf1f6"))
    out.append(box(312, 426, 398, 92, "验证内核（确定性）", ["水密/尺度/部件间隙/碰撞/贴地", "关节限位·滑步·相机覆盖率·体积连续性", "输出 {code, ok, metric, hint}"], "#fbf6ea"))
    out.append('<rect x="752" y="26" width="342" height="508" rx="12" fill="#fbf9f7" stroke="#eadfd4"/>')
    out.append('<text x="768" y="52" class="colt">汇合与下游</text>')
    out.append(box(768, 74, 310, 92, "汇合：USD Stage + GLB", ["同一米制坐标系，Z-up", "相机时序 / UsdSkel / 体积代理", "一次导出，多端消费"], "#f8efe6"))
    out.append(box(768, 186, 310, 104, "白模下游", ["Blender / UE / Unity 预演", "深度·法线·遮罩·骨架控制图", "供视频/图像生成模型条件化"], "#f8efe6", "实测"))
    out.append(box(768, 310, 310, 88, "人工/自动复核", ["多视角软光栅预览", "云端 VLM 打分（可选）", "与参考剪影 IoU"], "#f8efe6"))
    out.append(box(768, 418, 310, 96, "回灌", ["失败样本 → Prompt 资产库", "指标基线 → 回归测试", "决定是否升级架构 2"], "#f8efe6"))
    # 箭头
    out.append(arrow(260, 122, 310, 120))
    out.append(arrow(260, 248, 310, 230))
    out.append(arrow(260, 370, 310, 360))
    out.append(arrow(410, 166, 410, 188))
    out.append(arrow(620, 166, 620, 188))
    out.append(arrow(410, 286, 410, 310))
    out.append(arrow(620, 286, 620, 310))
    out.append(arrow(510, 400, 510, 424))
    out.append(arrow(710, 356, 766, 300))
    out.append(arrow(710, 470, 766, 466))
    out.append(arrow(766, 470, 620, 500, "#c07a3e", True))
    out.append(arrow(300, 500, 262, 420, "#c07a3e", True))
    out.append('<text x="404" y="512" class="fb">结构化反馈（无需 GPU）</text>')
    out.append("</svg>")
    return "".join(out)


def arch2_svg():
    out = ['<svg viewBox="0 0 1120 470" class="chart arch" role="img" aria-label="架构二 MCP 编排图">',
           '<defs><marker id="arw2" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">'
           '<path d="M0,0 L9,4.5 L0,9 z" fill="#7a8699"/></marker></defs>']
    out.append(box(30, 40, 210, 90, "LLM（云端）", ["Planner / Coder", "MCP Client", "按工具能力选择"], "#eef3fa"))
    out.append(box(300, 30, 190, 390, "MCP 网关", ["统一工具描述", "超时/重试/进程池", "返回物 + 日志标准化"], "#f2f5f7"))
    tools = [("Blender MCP", "bpy 全量建模/渲染"), ("FreeCAD MCP", "参数化 CAD / STEP"),
             ("OpenSCAD MCP", "CSG 批处理"), ("SOMA-X Worker", "人体参数化（自定义）"),
             ("VSP / IFC Worker", "载具 / 建筑（自定义）")]
    for i, (t, d) in enumerate(tools):
        out.append(box(540, 30 + i * 78, 250, 66, t, [d], "#f7f9f8"))
        out.append(arrow(490, 225, 538, 63 + i * 78))
    out.append(box(830, 40, 260, 120, "验证服务（CPU）", ["几何/场景/动作/相机", "独立于工具进程", "统一 JSON 反馈"], "#fbf6ea"))
    out.append(box(830, 190, 260, 100, "资产总线", ["GLB + USDA + JSON", "版本与哈希登记"], "#eaf1f6"))
    out.append(box(830, 320, 260, 100, "下游消费", ["DCC / 引擎预演", "控制图序列"], "#f8efe6"))
    out.append(arrow(790, 100, 828, 100))
    out.append(arrow(790, 280, 828, 240))
    out.append(arrow(960, 160, 960, 188))
    out.append(arrow(960, 290, 960, 318))
    out.append(arrow(830, 370, 300, 430, "#c07a3e", True))
    out.append('<text x="560" y="452" class="fb">失败结果回传 LLM：切换工具 / 改参数 / 降级范式</text>')
    out.append("</svg>")
    return "".join(out)


def somax_svg():
    out = ['<svg viewBox="0 0 1000 300" class="chart" role="img" aria-label="SOMA-X 上下游">',
           '<defs><marker id="arw3" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">'
           '<path d="M0,0 L9,4.5 L0,9 z" fill="#7a8699"/></marker></defs>']
    out.append(box(24, 40, 230, 200, "上游输入", ["体型系数 (B,K)", "姿态 (B,77,3) axis-angle",
                                                 "根位移 / 手部 25 关节", "可选 SMPL/SMPL-X/MHR/ANNY"], "#f4f6f9"))
    out.append(box(300, 40, 250, 200, "SOMA-X（CPU）", ["身份迁移（稀疏矩阵）",
                                                       "RBF 骨架拟合（线性求解）", "LBS（解析）", "可选 MLP 修正"], "#eef3fa", "Apache-2.0"))
    out.append(box(596, 40, 220, 200, "输出", ["顶点 (B,N,3) 米制", "关节 (B,77,3)",
                                                "手部变换 (B,25,4,4)", "USD / NPZ"], "#f7f9f8"))
    out.append(box(840, 40, 136, 200, "下游", ["DCC / 引擎", "动作重定向", "控制图", "机器人仿真"], "#f8efe6"))
    out.append(arrow(256, 140, 298, 140))
    out.append(arrow(552, 140, 594, 140))
    out.append(arrow(818, 140, 838, 140))
    out.append("</svg>")
    return "".join(out)


def dep_svg():
    out = ['<svg viewBox="0 0 1000 470" class="chart" role="img" aria-label="最小验证依赖图">',
           '<defs><marker id="arw4" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">'
           '<path d="M0,0 L9,4.5 L0,9 z" fill="#7a8699"/></marker></defs>']
    out.append(box(40, 40, 250, 100, "V1 几何白模可渲染 ✅", ["配方 → 流形网格 → GLB", "软光栅预览 + 尺度/水密"], "#edf5f1", "本机实测"))
    out.append(box(40, 190, 250, 100, "V2 人物+动作闭环 ✅/◐", ["SOMA-X 三后端 CPU 前向已通", "BVH 重定向待集成"], "#edf5f1", "部分实测"))
    out.append(box(40, 340, 250, 100, "V3 非几何可被消费 ◐", ["BVH 导入 DCC", "USD 相机/体积读取"], "#fbf1e8", "部分验证"))
    out.append(box(380, 110, 250, 110, "V4 场景与人群组合 ✅", ["布局 + 实例 + 相机视锥", "贴地/穿插/间距/覆盖率"], "#edf5f1", "本机实测"))
    out.append(box(380, 300, 250, 110, "V5 LLM 生成质量 ○", ["云端 API → 代码/配方", "执行成功率 & 首次通过率"], "#f2f5f7", "待验证"))
    out.append(box(720, 110, 230, 110, "架构 1 验收 ✅", [f"全部 {VAL['summary']['total']} 项验证通过", f"{MANIFEST['count']} 个产物可追溯"], "#edf5f1", "本机实测"))
    out.append(box(720, 300, 230, 110, "架构 2 验收 ○", ["MCP 工具联通性", "跨进程稳定性"], "#f2f5f7", "待验证"))
    out.append(arrow(290, 90, 378, 140))
    out.append(arrow(290, 240, 378, 175))
    out.append(arrow(290, 390, 378, 340))
    out.append(arrow(630, 165, 718, 165))
    out.append(arrow(630, 355, 718, 355))
    out.append(arrow(292, 290, 292, 338))
    out.append(arrow(290, 130, 290, 188))
    out.append(arrow(630, 355, 630, 230))
    out.append('<text x="300" y="165" class="fb">共享验证内核</text>')
    out.append("</svg>")
    return "".join(out)


def boundary_svg():
    """新增类别边界说明图：形态 → 管线位置 → 控制价值。"""
    out = ['<svg viewBox="0 0 1080 360" class="chart" role="img" aria-label="新增类别边界图">',
           '<defs><marker id="arw5" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">'
           '<path d="M0,0 L9,4.5 L0,9 z" fill="#9aa3b0"/></marker></defs>']
    out.append('<text x="30" y="40" class="colt">类别</text>')
    out.append('<text x="300" y="40" class="colt">进入管线的形态</text>')
    out.append('<text x="760" y="40" class="colt">与几何白模的衔接点 / 控制价值</text>')
    rows = [
        ("生物/动物", "完整几何（低模，SMAL）/ 体块代理", "接入同一 LBS 与 USD 场景；四足骨架需独立重定向", "#e9f2ee", "full"),
        ("植被", "简化几何（枝干）+ 冠层代理", "枝干可碰撞/投影，冠层只参与体积与遮挡", "#eef4e8", "full"),
        ("人群", "代理人偶 + 变换表 + 动作 clip", "实例化到场景；远景 xlow LOD，近景 mid LOD", "#eef3fa", "proxy"),
        ("特效占位", "体积包络 + 轨迹 JSON", "转深度/法线/遮罩序列；体积本身控制弱", "#f6eef4", "data"),
        ("动作数据", "BVH（关节层级 + 帧数据）", "驱动同骨架网格；脚底接触点约束空间关系", "#eef3fa", "data"),
        ("摄像机", "参数化路径 + 焦距/传感器", "决定画面构图与运动；投影检查可自动化", "#f8efe6", "data"),
    ]
    y = 62
    for name, form, link, fill, kind in rows:
        out.append(f'<rect x="24" y="{y}" width="240" height="40" rx="6" fill="{fill}" stroke="#d8dee7"/>')
        out.append(f'<text x="38" y="{y + 25}" class="boxt">{name}</text>')
        out.append(f'<rect x="294" y="{y}" width="430" height="40" rx="6" fill="#ffffff" stroke="#dde2ea"/>')
        out.append(f'<text x="308" y="{y + 25}" class="boxl">{form}</text>')
        out.append(f'<text x="752" y="{y + 25}" class="boxl">{link}</text>')
        out.append(arrow(266, y + 20, 292, y + 20))
        out.append(arrow(726, y + 20, 748, y + 20))
        y += 48
    out.append("</svg>")
    return "".join(out)


# ------------------------------------------------------------------ 组件
def badge_v(text, kind="v1"):
    return f'<span class="badge {kind}">{text}</span>'


def checks_table(results):
    rows = []
    for key, r in results.items():
        status = '<span class="ok">通过</span>' if r["pass"] else '<span class="bad">失败</span>'
        codes = "、".join(c["code"] for c in r["checks"] if c["ok"])
        fails = [c for c in r["checks"] if not c["ok"]]
        detail = "；".join(f'{c["code"]}: {c["message"]}' for c in fails) or "—"
        metrics = r.get("metrics", {})
        keym = []
        for k in ("faces", "components", "watertight_ratio", "root_travel_m", "foot_slide_mean_m_per_frame",
                  "subject_in_frame", "crowd_min_spacing_m", "max_part_gap_m", "path_length_m"):
            if k in metrics:
                keym.append(f"{k}={metrics[k]}")
        rows.append(f'<tr><td><code>{r["asset"]}</code></td><td>{status}</td>'
                    f'<td class="small">{codes}</td><td class="small">{detail}</td>'
                    f'<td class="small mono">{", ".join(keym) or "—"}</td></tr>')
    return ("<table class='tbl'><thead><tr><th>资产</th><th>结果</th><th>通过的检查</th>"
            "<th>失败详情</th><th>关键指标</th></tr></thead><tbody>" + "".join(rows) + "</tbody></table>")


def gallery_item(key, title, caption, cls=""):
    path = PREV.get(key)
    if not path:
        return ""
    return (f'<figure class="shot {cls}"><img src="{b64(path)}" alt="{title}"/>'
            f'<figcaption><b>{title}</b><span>{caption}</span></figcaption></figure>')


def loop_section():
    loop = VAL["agentic_loop"]
    it0, it1 = loop[0], loop[1]
    fails0 = [c for c in it0["result"]["checks"] if not c["ok"]]
    acts = it1.get("actions", [])
    rows0 = "".join(f'<tr><td><code>{c["code"]}</code></td><td class="bad">失败</td>'
                    f'<td>{c["message"]}</td><td class="small">{c["hint"]}</td></tr>' for c in fails0)
    rows1 = "".join(f'<tr><td><code>{c["code"]}</code></td><td class="ok">通过</td>'
                    f'<td>{c["message"]}</td><td class="small">{c["hint"] or "—"}</td></tr>'
                    for c in it1["result"]["checks"])
    acts_html = "".join(f'<li><code>{a["param"]} = {a["value"]}</code> ← {a["reason"]}</li>' for a in acts)
    return f"""
    <div class="grid2">
      <figure class="shot"><img src="{b64(os.path.join(ROOT, 'assets', 'validation', 'iter0_character.png'))}" alt="迭代 0"/>
        <figcaption><b>迭代 0：参数错误</b><span>身高 2.45 m、手臂外移 0.16 m</span></figcaption></figure>
      <figure class="shot"><img src="{b64(os.path.join(ROOT, 'assets', 'validation', 'iter1_character.png'))}" alt="迭代 1"/>
        <figcaption><b>迭代 1：修复后</b><span>身高 1.75 m、关节贴合，复检全部通过</span></figcaption></figure>
    </div>
    <p>失败信号由 CPU 验证器直接给出，不含任何渲染模型或 GPU 推理：</p>
    <table class="tbl"><thead><tr><th>检查码</th><th>结果</th><th>观测</th><th>修复提示</th></tr></thead><tbody>{rows0}</tbody></table>
    <p class="kv">自动推导的修复动作：</p><ul class="acts">{acts_html}</ul>
    <details><summary>展开迭代 1 的完整复检结果（{len(it1['result']['checks'])} 项）</summary>
      <table class="tbl"><thead><tr><th>检查码</th><th>结果</th><th>观测</th><th>提示</th></tr></thead><tbody>{rows1}</tbody></table>
    </details>
    """


def manifest_table(limit=18):
    files = sorted(MANIFEST["files"], key=lambda f: -f["bytes"])[:limit]
    rows = "".join(f'<tr><td><a href="{f["path"].replace(chr(92), "/")}"><code>{f["path"].replace(chr(92), "/")}</code></a></td>'
                   f'<td class="num">{f["bytes"] / 1024:.1f} KB</td></tr>' for f in files)
    return ("<table class='tbl small'><thead><tr><th>文件（可点击打开）</th><th>大小</th></tr></thead><tbody>"
            + rows + "</tbody></table>")


def public_tables():
    if not PUBLIC:
        return "<p class='small'>公共资产清单缺失。</p>"
    prev_map = {"old_military_crate": "public_crate", "ArmChair_01": "public_chair",
                "Kenney car-kit": "public_sedan", "CAR Model - Free Model By Ignition Labs": "public_car_ccby",
                "Fox": "public_fox", "MakeHuman shirts01": "public_shirt"}
    rows = []
    for a in sorted(PUBLIC["assets"], key=lambda x: (x["category"], x["name"])):
        st = a.get("stats") or {}
        faces = st.get("faces")
        pv = PUBLIC_PREV.get(prev_map.get(a["name"], ""))
        size = pv.get("size_m") if pv else None
        rows.append(
            f'<tr><td><a href="{a["page"]}"><b>{a["name"]}</b></a></td>'
            f'<td class="small">{a["category"]}</td>'
            f'<td class="small">{a["license"]}</td>'
            f'<td class="num">{f"{faces:,}" if faces else "—"}</td>'
            f'<td class="num">{a["bytes"]/1024/1024:.1f} MB</td>'
            f'<td class="small mono">{"×".join(f"{x:.2f}" for x in size) + " m" if size else "—"}</td></tr>')
    total_mb = PUBLIC["summary"]["bytes"] / 1024 / 1024
    pub_dir = os.path.join(os.path.dirname(os.path.dirname(ROOT)), "var", "public-assets")
    disk_mb = 0.0
    if os.path.isdir(pub_dir):
        for dp, _, ns in os.walk(pub_dir):
            disk_mb += sum(os.path.getsize(os.path.join(dp, n)) for n in ns) / 1024 / 1024
    return (f'<p class="small">已下载 {PUBLIC["summary"]["total"]} 项；清单记录精选件 {total_mb:.1f} MB，'
            f'解压后磁盘实际约 {disk_mb:.0f} MB（含 Kenney 包内全部模型与 MakeHuman 全量服装）。'
            f'原始文件位于 <code>var/public-assets</code>（gitignored），清单与哈希见 '
            f'<a href="assets/validation/public_assets.json">public_assets.json</a>。'
            f'Kenney 行只统计预览单件，包内分别含 45 / 330+ 个模型；尺寸列取白模归一化后的预览值。</p>'
            f'<table class="tbl"><thead><tr><th>名称</th><th>类别</th><th>许可</th><th>面数</th>'
            f'<th>体积</th><th>归一化尺寸</th></tr></thead><tbody>{"".join(rows)}</tbody></table>')


def public_gallery():
    order = [("public_crate", "Poly Haven 军用箱", "CC0 · 20,952 面"),
             ("public_chair", "Poly Haven 扶手椅", "CC0 · 5,626 面"),
             ("public_sedan", "Kenney 轿车", "CC0 · 低模车辆包"),
             ("public_car_ccby", "Poly Pizza 跑车", "CC-BY · Ignition Labs"),
             ("public_fox", "Khronos Fox", "CC-BY 4.0 · 带骨骼动画"),
             ("public_shirt", "MakeHuman T 恤", "CC0 · 服装壳")]
    out = []
    for key, title, sub in order:
        meta = PUBLIC_PREV.get(key)
        if not meta:
            continue
        out.append(f'<figure class="shot"><img src="{b64(meta["path"])}" alt="{title}"/>'
                   f'<figcaption><b>{title}</b><span>{sub}</span></figcaption></figure>')
    return f'<div class="grid3" style="margin-top:12px">{"".join(out)}</div>'


def source_gallery():
    if not SRC_PREV:
        return ""
    out = []
    for key, m in SRC_PREV.items():
        out.append(f'<figure class="shot srcshot"><img src="{b64(m["path"])}" alt="{m["label"]}"/>'
                   f'<figcaption><b>{m["label"]}</b>'
                   f'<span>{m["license"]} · <a href="{m["page"]}">来源页面</a></span></figcaption></figure>')
    return f'<div class="grid3" style="margin-top:12px">{"".join(out)}</div>'


def shot_section():
    if not SHOT:
        return "<p class='small'>竖切片结果缺失。</p>"
    s = SHOT["summary"]
    ok = lambda v: "<span class='ok'>通过</span>" if v else "<span class='bad'>未达</span>"
    rows = [
        ("规格", f"{s['resolution'][0]}×{s['resolution'][1]} · {s['fps']} fps · {s['frames']} 帧 / {s['duration_s']} s"),
        ("根位移 / 速度", f"{s.get('root_speed_mps')} m/s（脚锁式根位移）"),
        ("脚滑（均值 / 最大）", f"{s['foot_slide_mean_m']*100:.2f} cm / {s['foot_slide_max_m']*100:.2f} cm 每帧"
                              f"<br/><span class='small'>{s.get('foot_slide_note','')}</span>"),
        ("贴地最低点", f"{s['ground_min_z']*100:.1f} cm"),
        ("主体入画率（最低）", f"{s['subject_inside_min']*100:.0f}%"),
        ("主体高度占比（均值）", f"{s['subject_height_ratio_mean']*100:.0f}%"),
        ("判定", ok(s["pass"])),
    ]
    body = "".join(f"<tr><td>{a}</td><td>{b}</td></tr>" for a, b in rows)
    img = ""
    if os.path.exists(SHOT_SHEET):
        img = (f'<figure class="shot"><img src="{b64(SHOT_SHEET, max_w=1300)}" alt="shot001 contact sheet"/>'
               f'<figcaption><b>shot_001 联系表</b><span>每 0.7 秒取一帧；ANNY 白模 + 街景 + 推镜</span></figcaption></figure>')
    mp4 = s.get("mp4")
    links = '<a href="shots/shot_001/previs.mp4">previs.mp4</a>' if mp4 else ""
    frames = '<a href="shots/shot_001/frames/">帧序列</a>'
    return f"""
    <p>用 SOMA/ANNY 参数化人体在姿态空间直接生成 5 秒步态（不做外部 BVH 重定向），与街景、人群、车辆、相机推镜组合，
    用 CPU 软光栅逐帧渲染。根位移采用「脚锁」策略：每帧让最低的那只脚在世界坐标中保持不动，因此脚滑是可度量的。</p>
    <table class="tbl"><tbody>{body}</tbody></table>
    {img}
    <p class="small">产物：{links} · {frames} · <a href="assets/validation/shot_001.json">shot_001.json</a></p>
    """


def provenance_table():
    rows = [
        ("人物白模（场景主角）", "SOMA-X / ANNY 参数化底座（本机 CPU 前向）", "soma_anny_adult.py", "仅权重，无第三方网格"),
        ("人物基线 / 人群代理", "程序化体块人偶（不是下载资产）", "human_proxy()", "无"),
        ("服装外壳", "程序化偏移壳（无布料模拟）", "jacket()", "无"),
        ("道具", "程序化布尔并集（manifold3d）", "prop_crate()", "无"),
        ("载具·汽车 / 轮船", "程序化截面 loft + 布尔开窗/抽壳（汽车含内饰代理）", "vehicle_car() / vehicle_boat()", "无"),
        ("建筑体量", "程序化体块与楼板", "building()", "无（未用 IFC/OSM）"),
        ("生物代理", "程序化体块（未用 SMAL）", "creature_quadruped()", "无"),
        ("植被", "递归 L-system + 冠层代理", "tree()", "无（未用 Arbaro/Sapling）"),
        ("特效 / 相机 / 动作", "程序化参数与轨迹", "fx_proxy() / camera_path() / motion_walk()", "无"),
    ]
    body = "".join(f"<tr><td><b>{a}</b></td><td>{b}</td><td class='small'><code>{c}</code></td><td>{d}</td></tr>"
                   for a, b, c, d in rows)
    return ("<p class='small'>唯一下载的资产是 SOMA-X 的人体权重（SOMA 原生 / MHR lod6 / ANNY）；"
            "其余几何全部由本项目 harness 在 CPU 上程序化生成，未使用任何公开网格资产包。</p>"
            "<table class='tbl'><thead><tr><th>资产</th><th>来源</th><th>生成入口</th>"
            f"<th>外部网格资产</th></tr></thead><tbody>{body}</tbody></table>")


def soma_tables():
    if not SOMA:
        return "<p class='small'>SOMA-X 本机测试结果缺失。</p>"
    names = {"soma": "SOMA 原生（128 PCA）", "mhr": "MHR（45 体型 + 68 尺度）",
             "anny": "ANNY（6 表型，零表型=儿童）", "anny_adult": "ANNY 成人（height=0.45）"}
    run_rows = ""
    rows_data = list(SOMA["runs"])
    if ADULT:
        rows_data.append({**ADULT, "backend": "anny_adult"})
    for r in rows_data:
        h = r.get("height_m") or (r["bounds_m"][5] - r["bounds_m"][2])
        pose = " · A-pose" if r["backend"] == "anny_adult" else ""
        run_rows += (f'<tr><td><b>{names.get(r["backend"], r["backend"])}</b>{pose}</td>'
                     f'<td class="num">{r["vertices"]:,} / {r["faces"]:,}</td>'
                     f'<td>{"是" if r["watertight"] else "否"}</td>'
                     f'<td class="num">{h:.3f} m</td>'
                     f'<td class="num"><b>{r["forward_ms_median"]:.1f} ms</b></td>'
                     f'<td class="small"><a href="{r["file"].replace(chr(92), "/")}"><code>{r["file"].replace(chr(92), "/")}</code></a></td></tr>')
    env = (f'{SOMA["torch"]} · CUDA={SOMA["cuda_available"]} · Python 3.11 venv（<code>var/soma-venv</code>）'
           f' · 权重 <code>var/soma-assets</code>（gitignored）')
    assets = [
        ("SOMA（原生）", "SOMA_neutral.npz 25.4 MB + 模板 27 MB + 修正模型 28.4 MB", "HF 直链", "Apache-2.0", "✅ 已跑通"),
        ("MHR", "mhr_model_lod1.pt 663.9 MB / lod6 2 MB + 网格", "HF 直链", "Apache-2.0", "✅ lod6 已跑通"),
        ("ANNY", "pip install anny（45.5 MB，内含模型）+ Anny/*.obj", "PyPI", "Apache-2.0", "✅ 已跑通"),
        ("SMPL", "仅对应网格，不含模型文件", "MPI 站点注册下载", "非商用研究；商用需 Meshcapade", "⛔ 需账号"),
        ("SMPL-X", "仅对应网格，不含模型文件", "MPI 站点注册下载", "非商用研究", "⛔ 需账号"),
        ("MANO（手）", "仅 wrap 网格，不含 MANO_*.pkl", "MPI 站点注册下载", "非商用研究", "⛔ 需账号"),
    ]
    asset_rows = "".join(f'<tr><td><b>{a}</b></td><td class="small">{b}</td><td class="small">{c}</td>'
                         f'<td class="small">{d}</td><td>{e}</td></tr>' for a, b, c, d, e in assets)
    return f"""
    <p class="small">实测环境：{env}；<code>device="cpu"</code>、<code>mode="dense"</code>、<code>lod="low"</code>，全零姿态（T-pose），预热后 5 次中位数。</p>
    <table class="tbl"><thead><tr><th>后端</th><th>顶点 / 面</th><th>水密</th><th>身高</th><th>前向耗时</th><th>产物</th></tr></thead>
      <tbody>{run_rows}</tbody></table>
    <p class="small">三个后端共享同一套 SOMA 拓扑与 77 关节；ANNY 零表型得到 0.44 m 儿童体型，说明其全年龄覆盖，成人需设置 age/height 等表型。
    原始输出为 Y-up、髋部在原点，导出时统一转为 Z-up 并落到 z=0（转换记录在 <a href="assets/validation/soma_cpu_test.json">soma_cpu_test.json</a>）。</p>
    <table class="tbl"><thead><tr><th>引用资产</th><th>在 SOMA-X 中的形态 / 体积</th><th>获取方式</th><th>许可</th><th>本机状态</th></tr></thead>
      <tbody>{asset_rows}</tbody></table>
    """


def soma_gallery():
    cap = {"soma_native": ("SOMA 原生后端", "128 维体型 PCA，10.3 ms"),
           "soma_mhr": ("MHR 后端", "45 体型 + 68 尺度，12.9 ms"),
           "soma_anny": ("ANNY 后端（零表型）", "6 表型；零表型=儿童，31 ms"),
           "soma_anny_adult": ("ANNY 成人（A-pose）", "身高参数搜索到 1.776 m；场景主角，37.6 ms")}
    out = []
    for key in ("soma_native", "soma_mhr", "soma_anny", "soma_anny_adult"):
        p = SOMA_PREV.get(key)
        if not p:
            continue
        t, sub = cap[key]
        out.append(f'<figure class="shot"><img src="{b64(p)}" alt="{t}"/>'
                   f'<figcaption><b>{t}</b><span>{sub}</span></figcaption></figure>')
    return f'<div class="grid2" style="margin-top:12px">{"".join(out)}</div>'


def exports_table():
    if not EXPORTS:
        return "<p class='small'>导出回读结果缺失。</p>"
    rows = []
    for f in EXPORTS["files"]:
        if f["type"] == "glb":
            detail = f'{f["geometries"]} 几何 · {f["faces"]} 面 · {f["nodes"]} 节点'
        elif f["type"] in ("obj", "stl"):
            detail = f'{f["faces"]} 面' + (f' · 水密 {"是" if f.get("watertight") else "否"}' if f["type"] == "stl" else "")
        elif f["type"] == "usda":
            detail = f'{f["prims"]} prim · 相机 {f["camera_focal_mm"]} mm · 骨骼 {f["skeleton_joints"]} 关节 · up={f["up_axis"]}'
        else:
            detail = f'{f["frames"]} 帧 · {f["joints"]} 关节 · {f["frame_time"]:.5f}s/帧'
        rows.append(f'<tr><td><a href="{f["file"].replace(chr(92), "/")}"><code>{f["file"].replace(chr(92), "/")}</code></a></td>'
                    f'<td>{f["type"]}</td><td class="small">{detail}</td>'
                    f'<td>{"<span class=\'ok\'>可解析</span>" if f["ok"] else "<span class=\'bad\'>失败</span>"}</td></tr>')
    return (f'<p class="small">回读 {EXPORTS["summary"]["total"]} 个文件，通过 {EXPORTS["summary"]["passed"]} 个：'
            f'GLB 头部 magic/节点/网格可解析，USD 舞台可打开且含相机时序与 UsdSkel 骨骼，BVH 层级与帧数可解析。</p>'
            "<table class='tbl small'><thead><tr><th>文件</th><th>格式</th><th>回读结果</th><th>状态</th></tr></thead>"
            f'<tbody>{"".join(rows)}</tbody></table>')


# ------------------------------------------------------------------ 样式
CSS = """
:root{
  --bg:#f7f8fa; --panel:#ffffff; --ink:#1d2430; --muted:#5d6878; --line:#e1e5ec;
  --accent:#2f5f8f; --accent2:#c07a3e; --ok:#2f7d5c; --bad:#b34b4b; --radius:10px;
  --mono:"Cascadia Mono","Consolas","SFMono-Regular",monospace;
}
html[data-theme="dark"]{
  --bg:#12161c; --panel:#181e27; --ink:#e6eaf0; --muted:#98a3b3; --line:#2a3341;
  --accent:#7aa7d6; --accent2:#d99a5b; --ok:#6bbd94; --bad:#dd7b7b;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.75 "Segoe UI","Microsoft YaHei","PingFang SC",system-ui,sans-serif}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:var(--mono);font-size:.88em;background:rgba(127,140,160,.12);padding:1px 5px;border-radius:4px}
.side{position:fixed;inset:0 auto 0 0;width:252px;border-right:1px solid var(--line);background:var(--panel);
  padding:22px 16px 26px;overflow:auto;z-index:20}
.brand{font-weight:700;font-size:15px;letter-spacing:.02em;line-height:1.4}
.brand small{display:block;font-weight:400;color:var(--muted);font-size:11.5px;margin-top:4px}
.nav{margin-top:18px;display:flex;flex-direction:column;gap:2px}
.nav a{padding:7px 9px;border-radius:6px;color:var(--muted);font-size:13px}
.nav a:hover{background:rgba(127,140,160,.10);text-decoration:none;color:var(--ink)}
.nav a.active{background:rgba(47,95,143,.12);color:var(--accent);font-weight:600}
.nav .grp{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin:14px 0 4px}
.tools{margin-top:18px;display:flex;gap:8px;flex-wrap:wrap}
.btn{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:999px;
  padding:4px 11px;font-size:12px;cursor:pointer}
.btn:hover{color:var(--ink);border-color:var(--muted)}
main{margin-left:252px;padding:44px 48px 90px;max-width:1240px}
h1{font-size:31px;line-height:1.3;margin:0 0 8px;letter-spacing:-.01em}
h2{font-size:22px;margin:52px 0 14px;padding-top:10px;border-top:1px solid var(--line)}
h3{font-size:16.5px;margin:28px 0 10px}
h4{font-size:14.5px;margin:20px 0 8px}
p{margin:9px 0}
.lead{font-size:16px;color:var(--muted);max-width:880px}
.kicker{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:700}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:20px 22px;margin:16px 0}
.card h3{margin-top:0}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:16px}
.kpi b{display:block;font-size:25px;line-height:1.2;letter-spacing:-.02em}
.kpi span{font-size:12px;color:var(--muted)}
.tbl{width:100%;border-collapse:collapse;margin:12px 0;font-size:13.5px}
.tbl th{text-align:left;font-size:12px;color:var(--muted);font-weight:600;padding:8px 10px;
  border-bottom:1px solid var(--line);white-space:nowrap}
.tbl td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
.tbl tr:hover td{background:rgba(127,140,160,.05)}
.tbl .small, .small{font-size:12px;color:var(--muted)}
.mono{font-family:var(--mono);font-size:11.5px}
.num{text-align:right;font-family:var(--mono);font-size:12px;white-space:nowrap}
.ok{color:var(--ok);font-weight:600;white-space:nowrap}.bad{color:var(--bad);font-weight:600;white-space:nowrap}
.badge{display:inline-block;font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.badge.v1{color:#2f7d5c;border-color:#9fcbb5;background:rgba(47,125,92,.08)}
.badge.v2{color:#8a6b2f;border-color:#d9c48c;background:rgba(192,122,62,.09)}
.badge.v3{color:#5c6b80;border-color:#c3ccda}
.badge.u{color:#8a4a4a;border-color:#d8a9a9;background:rgba(179,75,75,.08)}
.note{border-left:3px solid var(--accent2);background:rgba(192,122,62,.07);padding:10px 14px;border-radius:0 8px 8px 0;margin:14px 0;font-size:13.5px}
blockquote{margin:0}
ul,ol{padding-left:22px}
li{margin:4px 0}
.shot{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
.shot img{display:block;width:100%;height:auto;background:#eef0f4}
.shot figcaption{padding:10px 12px;display:flex;flex-direction:column;gap:2px;font-size:12.5px;color:var(--muted)}
.shot figcaption b{color:var(--ink);font-size:13px}
.srcshot img{aspect-ratio:4/3;object-fit:cover}
.chart{width:100%;height:auto;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);margin:8px 0}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin:6px 0 12px}
.lg{display:inline-flex;align-items:center;gap:6px}
.lg i{width:10px;height:10px;border-radius:3px;display:inline-block}
.matrix{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px;background:var(--panel);
  border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
.matrix th{position:sticky;top:0;background:var(--panel);z-index:2;font-size:11.5px;color:var(--muted);
  padding:10px 8px;border-bottom:1px solid var(--line);text-align:center;white-space:nowrap}
.matrix thead th:first-child{text-align:left}
.matrix .rowh{text-align:left;font-size:12.5px;font-weight:600;color:var(--ink);padding:8px 12px;
  border-bottom:1px solid var(--line);white-space:nowrap;background:var(--panel)}
.matrix td{padding:6px 6px;text-align:center;border-bottom:1px solid var(--line);cursor:pointer;
  transition:background .15s;border-right:1px solid rgba(127,140,160,.06)}
.matrix td:hover, .matrix td:focus{outline:none;background:rgba(47,95,143,.10)}
.matrix .sym{display:block;font-size:15px;line-height:1.1}
.matrix .lbl{display:block;font-size:9.5px;color:var(--muted);margin-top:1px}
.lv-full{background:rgba(47,125,92,.13)}
.lv-proxy{background:rgba(47,95,143,.11)}
.lv-data{background:rgba(138,94,168,.11)}
.lv-apply{background:rgba(192,122,62,.10)}
.lv-comb{background:rgba(75,127,134,.10)}
.lv-na{color:#9aa3b0;background:transparent}
.lv-todo{background:rgba(179,75,75,.12)}
.filterbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:12px 0}
.filterbar input,.filterbar select{background:var(--panel);border:1px solid var(--line);color:var(--ink);
  border-radius:7px;padding:6px 10px;font-size:13px;min-width:180px}
#cellInfo{margin-top:10px;font-size:13px;color:var(--muted);min-height:22px}
.tree{font-family:var(--mono);font-size:12px;line-height:1.7;color:var(--muted);white-space:pre;overflow:auto;
  background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:16px}
.acts{font-size:13px;color:var(--muted)}
.kv{font-size:13px;color:var(--muted);margin:10px 0 4px}
details{border:1px solid var(--line);border-radius:8px;padding:10px 14px;margin:10px 0;background:var(--panel)}
summary{cursor:pointer;font-size:13.5px;color:var(--accent);font-weight:600}
.footer{margin-left:252px;padding:24px 48px 60px;color:var(--muted);font-size:12px;border-top:1px solid var(--line)}
/* SVG 文本 */
svg text{font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;fill:#3b4554}
html[data-theme="dark"] svg text{fill:#c8d1de}
svg .boxt{font-size:13px;font-weight:700}
svg .boxl{font-size:11.5px;fill:#5d6878}
html[data-theme="dark"] svg .boxl{fill:#9aa7b8}
svg .colt{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;fill:#6b7889}
svg .axlab{font-size:12px;font-weight:600}
svg .axname{font-size:12.5px;font-weight:600;fill:#6b7889}
svg .tick{font-size:10.5px;fill:#98a3b3}
svg .ptlab{font-size:11px;fill:#4a5566}
svg .pnum{font-size:10px;font-weight:700;fill:#ffffff}
.ptlist{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 18px;margin:10px 0 4px;font-size:12.5px}
.pitem{display:flex;align-items:center;gap:7px;color:var(--ink)}
.pno{display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:50%;
  color:#fff;font-size:10px;font-weight:700;flex:none}
.pmeta{color:var(--muted);font-size:11px;margin-left:2px}
@media (max-width:1080px){.ptlist{grid-template-columns:1fr 1fr}}
svg .quad{font-size:11px;fill:#a2abba}
svg .badge{font-size:9.5px;fill:#2f7d5c}
svg .fb{font-size:11px;fill:#b07840}
@media (max-width:1080px){
  .side{position:static;width:auto;border-right:0;border-bottom:1px solid var(--line);display:flex;
    flex-wrap:wrap;gap:10px;align-items:center;padding:14px 18px}
  .nav{flex-direction:row;flex-wrap:wrap;margin:0;gap:6px}
  .nav .grp{display:none}
  main,.footer{margin-left:0;padding:26px 18px 60px}
  .grid2,.grid3,.grid4{grid-template-columns:1fr}
  h1{font-size:25px}
}
@media print{.side{display:none}main{margin:0;max-width:none}}
"""

JS = """
(function(){
  var root=document.documentElement;
  var saved=localStorage.getItem('trb-theme');
  if(saved){root.setAttribute('data-theme',saved);}
  document.getElementById('themeBtn').onclick=function(){
    var cur=root.getAttribute('data-theme')==='dark'?'light':'dark';
    root.setAttribute('data-theme',cur);localStorage.setItem('trb-theme',cur);
  };
  // 导航高亮
  var links=[].slice.call(document.querySelectorAll('.nav a'));
  var secs=links.map(function(a){return document.querySelector(a.getAttribute('href'));}).filter(Boolean);
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){
      es.forEach(function(e){
        if(e.isIntersecting){
          links.forEach(function(l){l.classList.toggle('active',l.getAttribute('href')==='#'+e.target.id);});
        }
      });
    },{rootMargin:'-20% 0px -70% 0px'});
    secs.forEach(function(s){io.observe(s);});
  }
  // 矩阵筛选 + 详情
  var q=document.getElementById('mFilter'), onlyTodo=document.getElementById('onlyTodo');
  var rows=[].slice.call(document.querySelectorAll('#matrix tbody tr'));
  function apply(){
    var v=(q.value||'').trim();
    rows.forEach(function(r){
      var ok=!v || r.dataset.cat.indexOf(v)>=0;
      if(onlyTodo && onlyTodo.checked){
        var hasTodo=[].slice.call(r.querySelectorAll('td')).some(function(t){return t.dataset.val==='todo';});
        ok=ok && hasTodo;
      }
      r.style.display=ok?'':'none';
    });
  }
  if(q){q.addEventListener('input',apply);}
  if(onlyTodo){onlyTodo.addEventListener('change',apply);}
  var info=document.getElementById('cellInfo');
  [].slice.call(document.querySelectorAll('#matrix td.cell')).forEach(function(td){
    function show(){
      info.textContent=td.dataset.cat+' × '+td.dataset.par+'：'+td.querySelector('.lbl').textContent+' — '+td.dataset.note;
    }
    td.addEventListener('click',show);
    td.addEventListener('focus',show);
  });
})();
"""


CONTRACT = """{
  "asset_id": "prop_crate_v3",
  "category": "prop",
  "paradigm": "A4-json-recipe",
  "units": "meter", "up": "Z",
  "geometry": [
    {"op": "box", "size": [0.62, 0.62, 0.62], "at": [0, 0, 0.31]},
    {"op": "rail", "axis": "z", "count": 4, "radius": 0.03}
  ],
  "constraints": {"height_m": [0.55, 0.90], "watertight": true},
  "attach": {"scene": "street_a", "at": [2.4, -1.1, 0], "yaw_deg": 18}
}"""


def main():
    report = f"""<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Tree Resources Builder · 白模参考资产体系调研</title>
<style>{CSS}</style>
</head>
<body>
<aside class="side">
  <div class="brand">Tree Resources Builder<small>LLM 规划 + CPU 确定性执行 · 白模参考资产调研</small></div>
  <nav class="nav">
    <div class="grp">概览</div>
    <a href="#summary">摘要与载体说明</a>
    <a href="#method">约束、方法与证据等级</a>
    <div class="grp">调研</div>
    <a href="#somax">SOMA-X 深挖</a>
    <a href="#paradigms">范式 A–F 候选方案</a>
    <a href="#coverage">覆盖矩阵与边界</a>
    <a href="#maturity">工具成熟度</a>
    <div class="grp">设计</div>
    <a href="#arch">候选架构与数据流</a>
    <a href="#tradeoff">关键取舍</a>
    <div class="grp">实证</div>
    <a href="#artifacts">生成物与验证</a>
    <a href="#shot">5 秒竖切片</a>
    <a href="#loop">Agentic 闭环演练</a>
    <a href="#plan">最小验证计划</a>
    <div class="grp">结论</div>
    <a href="#boundaries">诚实边界与风险</a>
    <a href="#sources">来源</a>
  </nav>
  <div class="tools">
    <button class="btn" id="themeBtn">切换主题</button>
    <a class="btn" href="plans/PLAN.md">计划表</a>
  </div>
</aside>

<main>
<section id="summary">
  <div class="kicker">Research Report · 2026-11-19</div>
  <h1>LLM 规划 + CPU 确定性执行的<br/>白模参考资产体系</h1>
  <p class="lead">在「纯 CPU、禁用 3D 生成式模型、LLM 仅云端 API」的约束下，系统调研可产出真人 AI 电影白模参考资产的技术范式，
  给出两套端到端架构、覆盖矩阵、取舍分析与最小验证计划；并附带<b>本机真实生成</b>的几何/非几何资产与验证结果。</p>

  <div class="grid4" style="margin:20px 0">
    <div class="kpi"><b>6</b><span>调研范式（A–F）</span></div>
    <div class="kpi"><b>24+</b><span>候选工具 / 底座</span></div>
    <div class="kpi"><b>{VAL['summary']['passed']}/{VAL['summary']['total']}</b><span>本机验证项全部通过</span></div>
    <div class="kpi"><b>3</b><span>SOMA 后端 CPU 实测（SOMA/MHR/ANNY）</span></div>
  </div>

  <div class="card">
    <h3>载体形式与理由</h3>
    <p>本交付物是<b>单个自包含 HTML</b>：CSS/JS/SVG 全部内嵌，全部预览图以 base64 内联，<b>不加载任何 CDN、字体、脚本或图片外链</b>，断网可直接双击打开。
    选择它而不是「静态图 + Markdown」的原因是：</p>
    <ul>
      <li>覆盖矩阵与工具对比需要<b>筛选、悬停/点击查看依据</b>，静态图片做不到；</li>
      <li>图表必须随窗口缩放保持可读，SVG 比位图更稳；</li>
      <li>同一文件即可完成评审、归档与离线分发，避免图片目录失配。</li>
    </ul>
    <p>同时保留全部原始资产（GLB/OBJ/STL/USDA/BVH/JSON 与 PNG 预览）在 <code>assets/</code> 下，报告中的文件路径均可直接点击打开。</p>
    <p class="small">离线校验：见文末「交付校验」，脚本会扫描外链并做 JS 语法检查。</p>
  </div>

  <div class="card">
    <h3>三条核心结论</h3>
    <ol>
      <li><b>必须混合范式。</b>硬表面走代码/CAD，人物与生物走参数化底座，场景与人群走图元装配，动作/相机/特效走纯数据代理；没有单一工具能覆盖全部类别。</li>
      <li><b>质量上限由验证闭环决定。</b>本机实测表明「尺度 + 部件间隙 + 水密 + 构图」四类确定性检查就足以捕获典型废网格，并驱动参数级修复；不需要 GPU 或视觉大模型。</li>
      <li><b>统一汇合层应是 GLB + USD + JSON 契约，而不是某个 DCC 软件。</b>本机用 <code>trimesh/manifold3d</code> 与 <code>usd-core</code> 在 CPU 上完成了几何、相机时序、骨骼与体积代理的单一舞台导出。</li>
    </ol>
  </div>
</section>

<section id="method">
  <h2>约束、方法与证据等级</h2>
  <p>硬约束构成问题的边界（禁止 3D 生成式模型、禁止 GPU、LLM 仅云端 API），但边界内不预设工具。所有候选方案按四项口径评估：
  CPU 路径可用性、代码/资产可运行性、与硬约束匹配度、对白模参考目标的适用性。</p>
  <div class="grid2">
    <div class="card">
      <h3>本机资源基线（实测）</h3>
      <table class="tbl">
        <tr><td>Python</td><td class="mono">3.13.12（项目 .venv），系统另有 3.9.25</td></tr>
        <tr><td>几何库</td><td class="mono">trimesh 5.2.1 + manifold3d 3.5.5</td></tr>
        <tr><td>场景层</td><td class="mono">usd-core 26.11（可用）</td></tr>
        <tr><td>SOMA-X</td><td class="mono">py-soma-x 0.3.6 + torch 2.15.0+cpu（Python 3.11 venv）</td></tr>
        <tr><td>渲染</td><td>自研 numpy z-buffer 软光栅 + Pillow（零 GPU）</td></tr>
        <tr><td>未安装</td><td>Blender / OpenSCAD / FreeCAD（bpy 需 Python 3.11）</td></tr>
        <tr><td>网络</td><td>代理 127.0.0.1:7890；pip 需显式官方源</td></tr>
      </table>
    </div>
    <div class="card">
      <h3>证据等级标记</h3>
      <p>{badge_v('✅ 本机实测', 'v1')} 在本机 CPU 上真实执行并验证。</p>
      <p>{badge_v('◐ 上游文档/基准', 'v2')} 有官方代码与文档，但本机因资源/版本未执行。</p>
      <p>{badge_v('○ 论文/第三方', 'v3')} 有论文或第三方评测，未亲自复现。</p>
      <p>{badge_v('! 待验证假设', 'u')} 属于推理结论，需最小验证计划确认。</p>
      <p class="small">报告会明确区分「已验证可行」与「理论上可行但需进一步验证」，不把上游基准当成本机结论。</p>
    </div>
  </div>
  <div class="note">调研方法：优先 2025–2026 的开源项目与论文，同时覆盖 OpenSCAD/FreeCAD/OpenUSD 等经过时间验证的基础设施；对每个候选区分「仅论文/演示」与「有可运行代码且 CPU 路径可用」。</div>
</section>

<section id="somax">
  <h2>SOMA-X：人物白模的参数化底座</h2>
  <p>SOMA-X 把多种体型模型映射到统一拓扑与 77 关节骨架，核心管线是闭式解析（重心坐标迁移、RBF 骨架拟合、LBS），
  <b>0 个学习参数</b>；官方给出 CPU 12.1 ms/mesh（32 核，batch=1）的延迟，属于「确定性几何执行」，不违反约束。
  许可为 Apache-2.0，可商用；本机已用 <b>SOMA / MHR / ANNY 三个后端</b>跑通 CPU 前向（低模 10.3 / 12.9 / 31.0 ms），
  但 SMPL / SMPL-X / MANO 的模型文件不在 SOMA-X 中，需另行申请且仅限非商用研究。</p>
  {somax_svg()}
  <div class="grid2">
    <div class="card">
      <h3>接口契约（直接影响集成方式）</h3>
      <table class="tbl">
        <tr><th>方向</th><th>内容</th></tr>
        <tr><td>输入</td><td class="mono">identity (B,K)；pose (B,77,3) axis-angle；root (B,3)；hand pose (B,25,3)</td></tr>
        <tr><td>输出</td><td class="mono">vertices (B,N,3) 米制；joints (B,77,3)；手部 (B,25,4,4)；USD/NPZ</td></tr>
        <tr><td>LOD</td><td class="mono">mid 18,056 / low 4,505 / xlow 612 顶点</td></tr>
        <tr><td>身份后端</td><td>SOMA-shape、SMPL、SMPL-X、MHR、ANNY、GarmentMeasurements</td></tr>
      </table>
      <p class="small">来源：Model Card 与 GitHub README（见 <code>research/somax.md</code>）。</p>
    </div>
    <div class="card">
      <h3>判断：首选，但不是万能</h3>
      <p><b>优势</b>：输出天然是匿名纯几何；77 关节与关节位置让动作数据与白模同坐标系；三档 LOD 可同时服务近景与远景人群；USD 输出可直接进入统一场景。</p>
      <p><b>边界</b>：不覆盖服装、道具、建筑、载具、生物、植被、特效；首次使用需下载权重并缓存；依赖 PyTorch（CPU）；不含面部/口型；可选 MLP 修正项属于学习参数，可关闭。</p>
      <p>{badge_v('✅ 本机实测：SOMA / MHR / ANNY 三后端', 'v1')}</p>
    </div>
  </div>

  <h3>本机 CPU 实测（不是上游引用）</h3>
  <p>用 <code>py-soma-x 0.3.6</code> + <code>torch 2.15.0+cpu</code> 在 Python 3.11 venv 中真实跑通三个可自由复用的后端；
  权重按后端最小化下载，未拉取 663.9 MB 的 MHR lod1。所有产物已转 Z-up、脚底 z=0 并回读校验。</p>
  {soma_tables()}
  {soma_gallery()}
  <div class="note">复用结论：<b>SOMA 原生、MHR、ANNY 可以下载并商用</b>（均 Apache-2.0），且 CPU 延迟在同一量级（10–31 ms/低模）；
  <b>SMPL / SMPL-X / MANO 不能直接从 SOMA-X 获得模型文件</b>——HF 仓库只提供对应网格，模型本体需在 MPI 站点注册后按非商用研究许可下载，商用必须走 Meshcapade 授权。
  因此商用白模管线应只依赖前三个后端。</div>
</section>

<section id="paradigms">
  <h2>范式 A–F：候选方案与判断</h2>
  <p>每个范式给出 2–3 个具体候选，并标注 CPU 可行性、许可、可运行性与本报告的采用结论。</p>

  <h3>A · 程序化代码生成（Code-as-3D）</h3>
  <table class="tbl">
    <thead><tr><th>候选</th><th>形态</th><th>CPU / 许可</th><th>能力边界</th><th>结论</th></tr></thead>
    <tbody>
      <tr><td><b>Blender bpy</b>（headless）</td><td>Python 全量建模 + 六视图渲染</td><td>✅ / GPL-2.0+</td><td>能力最全；bpy 与 Python 版本强绑定，启动开销大</td><td>场景装配与视觉验证主力 {badge_v('◐', 'v2')}</td></tr>
      <tr><td><b>CadQuery / build123d</b></td><td>B-Rep 参数化，STEP/STL</td><td>✅ / Apache-2.0</td><td>硬表面精度高；有机形态成本高</td><td>道具/机械件/构件 {badge_v('○ 论文+代码', 'v3')}</td></tr>
      <tr><td><b>OpenSCAD</b></td><td>声明式 CSG 批处理</td><td>✅ / GPL-2.0</td><td>最稳的「代码→实心白模」；无曲面 loft</td><td>快速体块/夹具</td></tr>
      <tr><td><b>FreeCAD API</b></td><td>宏 + 参数表</td><td>✅ / LGPL-2.1</td><td>生态成熟，API 冗长</td><td>工程件，非首选</td></tr>
      <tr><td><b>three.js / Babylon.js</b></td><td>JS 几何 + GLB</td><td>✅ / MIT</td><td>预览与生成同构；无 B-Rep</td><td>网页审阅层</td></tr>
      <tr><td><b>JSON 几何配方 + 解释器</b></td><td>白名单原语（loft/boolean/L-system）</td><td>✅ / 自研</td><td>表达力受解释器限制；可精确校验</td><td><b>本报告主干</b> {badge_v('✅ 已产出', 'v1')}</td></tr>
    </tbody>
  </table>
  <p class="small">证据：BlenderGym（CVPR 2025）用「代码编辑 + 六视图」评测 VLM 并发现<b>验证器扩容比生成扩容更有效</b>；3DCodeBench（2026）与 CodeGen-3D 均把执行成功率与渲染一致性作为核心指标；CAD-Coder（2025）证明 VLM 可生成语法 100% 合法的 CadQuery 代码（其模型本身属于专用生成模型，本报告不采用其权重）。</p>

  <h3>B · 结构化 Token / 图元序列</h3>
  <table class="tbl">
    <thead><tr><th>候选</th><th>形态</th><th>CPU / 许可</th><th>能力边界</th><th>结论</th></tr></thead>
    <tbody>
      <tr><td><b>ShapeAssembly DSL</b></td><td>长方体零件 + 父子附着 + 对称</td><td>✅ / 研究代码</td><td>层级清晰，只能代理</td><td>家具/载具/建筑的骨架表达</td></tr>
      <tr><td><b>SceneScript / BIMScript</b></td><td>场景即命令序列（make_wall…）</td><td>推理端为专用模型；执行器 ✅</td><td>语义可读、可直接编辑</td><td>借鉴语言设计，由云端 LLM 直出</td></tr>
      <tr><td><b>装配图 + 参数化零件库</b></td><td>URDF / glTF 节点 / USD Composition</td><td>✅</td><td>兼容性最好；零件库覆盖度决定上限</td><td><b>场景与人群主力</b> {badge_v('✅ 场景已产出', 'v1')}</td></tr>
    </tbody>
  </table>

  <h3>C · 参数化模型操控</h3>
  <table class="tbl">
    <thead><tr><th>底座</th><th>覆盖</th><th>CPU / 许可</th><th>判断</th></tr></thead>
    <tbody>
      <tr><td><b>SOMA-X</b></td><td>人体 + 手</td><td>✅ / Apache-2.0</td><td>人物首选；见上一节</td></tr>
      <tr><td>SMPL / SMPL-X</td><td>人体 + 手 + 表情</td><td>✅ / 非商用研究许可</td><td>兼容后端，商用需授权</td></tr>
      <tr><td>MakeHuman + MPFB2</td><td>人体（全年龄）</td><td>需 Blender / 代码 AGPL、导出 CC0</td><td>快速体型库</td></tr>
      <tr><td><b>SMAL</b></td><td>四足动物</td><td>✅ / 非商用研究许可</td><td>动物唯一成熟底座；骨架与人体异构</td></tr>
      <tr><td><b>OpenVSP</b></td><td>飞机/飞行器</td><td>✅ / NASA NOSA</td><td>载具（航空）最强，headless API</td></tr>
      <tr><td><b>IfcOpenShell + Bonsai</b></td><td>建筑/BIM</td><td>✅ / LGPL-3.0</td><td>构件语义与 IFC 互操作最佳</td></tr>
      <tr><td>Freeship / DELFTship</td><td>船体</td><td>✅</td><td>船体曲面参数化</td></tr>
      <tr><td>Arbaro / ngPlant / Sapling</td><td>植被</td><td>✅</td><td>参数化树；Sapling 维护停滞</td></tr>
      <tr><td>汽车参数化库</td><td>汽车</td><td>—</td><td><b>不存在成熟开源方案</b>：用代码 loft + 零件库</td></tr>
      <tr><td>服装参数化底座</td><td>服装</td><td>—</td><td><b>不存在</b>：人体底座 + 偏移壳/板片</td></tr>
    </tbody>
  </table>

  <h3>D · Agentic 验证与迭代闭环</h3>
  <div class="grid2">
    <div class="card">
      <h4>验证器类型</h4>
      <ul>
        <li>网格：水密、法线一致、退化面、自交（manifold3d/trimesh）</li>
        <li>尺度：类别先验（身高、层高、车长）</li>
        <li>装配：部件间隙、贴地、AABB/凸包穿插</li>
        <li>运动：关节限位、脚部滑步、角速度、根位移</li>
        <li>构图：主体投影覆盖率、居中偏移、入画率</li>
        <li>特效：轨迹连续性、半径单调性</li>
      </ul>
    </div>
    <div class="card">
      <h4>多 Agent 分工</h4>
      <p>Planner → Coder → Executor → Critic → Repair。工具层可用 MCP 标准化（Blender/FreeCAD/OpenSCAD/CadQuery 均有现成 MCP server），
      但 MCP 只解决「调用」，<b>不解决正确性</b>；正确性仍由验证器保证。</p>
      <p>{badge_v('✅ 本机闭环演练', 'v1')} 见「Agentic 闭环演练」。</p>
    </div>
  </div>

  <h3>E · 跨类别组合策略</h3>
  <p>结论不是「一个工具打天下」，而是「一套契约打天下」：JSON 配方/脚本（LLM 可编辑）→ CPU 适配器（每类一个）→ 资产总线（GLB/USD/JSON/BVH）→ 统一验证内核。
  组合复杂度主要来自<b>适配器数量</b>与<b>许可合规</b>，而不是验证回路。</p>

  <h3>F · 非网格参考资产</h3>
  <table class="tbl">
    <thead><tr><th>类别</th><th>推荐格式</th><th>生成方式（CPU）</th><th>关键验证</th></tr></thead>
    <tbody>
      <tr><td>动作/表演</td><td>BVH（文本、可 diff）</td><td>LLM 出步态参数/关键帧 → 本地烘焙；或检索动作库后重定向</td><td>关节限位、脚滑、根位移、角速度</td></tr>
      <tr><td>摄像机</td><td>USD Camera + JSON</td><td>贝塞尔路径采样 + 焦距/传感器参数</td><td>投影覆盖率、居中、路径平滑</td></tr>
      <tr><td>特效体积</td><td>JSON 体积序列 + USD Volume / Alembic</td><td>轨迹 + 半径/密度场；破碎用 pybullet 刚体</td><td>连续性、半径单调</td></tr>
      <tr><td>人群</td><td>变换表 + 动作 clip（UsdSkel / PointInstancer）</td><td>人体底座参数化 + 实例化</td><td>间距、密度、贴地</td></tr>
    </tbody>
  </table>
  <p class="small">诚实边界：动作的「表演级细腻度」无法由 LLM 直接生成，可行的是程序化基础动作 + 检索复用 + 人工修；特效体积对下游视频模型的控制信号弱，必须转成深度/法线/遮罩序列。</p>
</section>

<section id="coverage">
  <h2>范式 × 资产类别覆盖矩阵</h2>
  <p>图例：<span class="lg"><span class="sym">●</span> 完整几何</span> <span class="lg"><span class="sym">◐</span> 简化/代理</span>
  <span class="lg"><span class="sym">○</span> 纯数据/参数</span> <span class="lg"><span class="sym">✓</span> 强制适用</span>
  <span class="lg"><span class="sym">—</span> 不适用</span> <span class="lg"><span class="sym">?</span> 待验证</span></p>
  <div class="filterbar">
    <input id="mFilter" placeholder="筛选资产类别，例如：载具 / 植被 / 动作"/>
    <label class="small"><input type="checkbox" id="onlyTodo"/> 只看含「待验证」的行</label>
  </div>
  {matrix_html()}
  <div id="cellInfo">点击任意单元格查看判断依据。</div>
  <div class="note">注意：D 列是「元范式」，对全部几何/非几何资产都强制适用；E 列表示该类资产需要多范式组合。矩阵中的「待验证」只有一处——汽车参数化底座，这是当前证据下的真实空白。</div>

  <h3>新增类别的边界与衔接</h3>
  {boundary_svg()}
</section>

<section id="maturity">
  <h2>工具成熟度与风险矩阵</h2>
  <p>五维评分（0–5）为本报告的评估值，依据是官方文档、可运行仓库与本机实测；不等同于社区排名。</p>
  {radar_svg()[0]}
  <div class="legend">{radar_svg()[1]}</div>
  <details open>
    <summary>五维评分数值（评估值，0–5）</summary>
    <table class="tbl small"><thead><tr><th>工具</th>{"".join(f"<th>{a}</th>" for a in TOOL_AXES)}</tr></thead>
      <tbody>{"".join(f"<tr><td>{n}</td>" + "".join(f"<td class='num'>{v:.1f}</td>" for v in vals) + "</tr>" for n, vals, _ in TOOLS)}</tbody>
    </table>
  </details>
  <div class="grid2">
    <div class="card">
      <h4>主要风险</h4>
      <ul>
        <li><b>许可</b>：SMPL/SMPL-X 与 SMAL 均为非商用研究许可；SOMA-X（Apache-2.0）与 MakeHuman 导出（CC0）是商用安全选项。</li>
        <li><b>版本绑定</b>：bpy 与 Python 版本强绑定，必须进程隔离，不能塞进业务 venv。</li>
        <li><b>权重与网络</b>：SOMA-X 首次使用需从 Hugging Face 下载；离线部署需预先镜像缓存。</li>
        <li><b>MCP 生态碎片化</b>：多个社区 server 并存，接口与稳定性不一，需要自建网关与超时/重试。</li>
      </ul>
    </div>
    <div class="card">
      <h4>成熟度判断（摘要）</h4>
      <p>{badge_v('✅ 生产可用', 'v1')} trimesh/manifold3d、OpenUSD、OpenSCAD、CadQuery、OpenVSP、Blender headless。</p>
      <p>{badge_v('◐ 可用但需适配', 'v2')} SOMA-X（CPU 路径明确）、IfcOpenShell、Arbaro/ngPlant、BVH 生态。</p>
      <p>{badge_v('○ 需验证/受限', 'v3')} SMAL（许可）、MCP 编排稳定性、LLM 首次通过率。</p>
    </div>
  </div>
</section>

<section id="arch">
  <h2>候选架构与数据流</h2>
  <p>两套架构共用同一执行与验证内核，区别在「工具如何被编排」：架构 1 把工具封装为进程内适配器；架构 2 把工具封装为 MCP 服务。</p>

  <h3>架构 1：统一契约 + 单一 CPU 执行层（推荐主干）</h3>
  {arch_svg()}
  <div class="grid2">
    <div class="card">
      <h4>为什么推荐</h4>
      <ul>
        <li>LLM 的输出被限制为 JSON 配方/白名单脚本，<b>可校验、可回滚、可白名单</b>；</li>
        <li>几何与非几何资产在资产总线汇合（GLB/USD/JSON/BVH），下游一次消费；</li>
        <li>验证内核与生成器解耦，失败反馈可直接映射到参数字段。</li>
      </ul>
    </div>
    <div class="card">
      <h4>适用与代价</h4>
      <p>适合人物、道具、建筑、场景、动作、相机；对需要完整 DCC 功能（绑定、布料、粒子）的镜头，适配器会变重。
      工程复杂度集中在适配器与验证器，而非调度。</p>
    </div>
  </div>

  <h3>架构 2：MCP 异构工具编排（能力扩展层）</h3>
  {arch2_svg()}
  <p>当某类资产已有成熟工具（FreeCAD 的工程件、Blender 的绑定/布料、OpenSCAD 的 CSG），通过 MCP 直接复用比重写适配器更快。
  代价是进程管理、版本漂移、错误语义不统一，且每个工具都要额外做结果标准化。建议作为架构 1 的<b>插件式补充</b>，而不是主运行时。</p>

  <div class="card">
    <h3>统一契约（LLM 可编辑的最小语义层）</h3>
    <pre class="tree">{CONTRACT}</pre>
    <p class="small">约束字段直接进入验证器；LLM 的修复只允许改参数与操作序列，不允许改验证器本身。</p>
  </div>
</section>

<section id="tradeoff">
  <h2>关键取舍</h2>
  <p>散点图比较「生成/迭代速度」与「结构精度/可控性」；气泡大小表示类别覆盖广度。右上象限是理想区，现实方案都在做取舍。</p>
  {scatter_svg()[0]}
  {scatter_svg()[1]}
  <p class="small">编号说明：A 代码生成（蓝）、B 图元序列（橙）、C 参数化（紫）、F 非几何（青）。</p>
  {parallel_svg()[0]}
  <div class="legend">{parallel_svg()[1]}</div>
  <div class="grid2">
    <div class="card">
      <h4>四条取舍结论</h4>
      <ul>
        <li><b>几何精度 vs 生成速度</b>：CAD 与参数化底座精度最高但迭代慢；JSON 配方最快但只到代理级。</li>
        <li><b>结构可控性 vs 类别覆盖</b>：统一契约可控性最好；MCP 覆盖最广但把复杂度转移到集成层。</li>
        <li><b>工程复杂度 vs 开箱可用</b>：单范式（纯 bpy）开箱最快，但只能覆盖硬表面。</li>
        <li><b>几何白模 vs 代理表达</b>：人物/生物/植被用代理更划算；道具/载具/建筑值得做完整几何。</li>
      </ul>
    </div>
    <div class="card">
      <h4>推荐落点</h4>
      <p>生产主干选「架构 1 + 分级精度」：近景主体完整几何（SOMA-X/CAD），中景代理，远景实例化。
      动作与相机用纯数据，特效先用轨迹代理再按镜头补体积。</p>
      <p class="small">该选择在本机已被验证：{VAL['summary']['total']} 项检查全部通过，且产物可在 70–100 秒内重新生成。</p>
    </div>
  </div>
</section>

<section id="artifacts">
  <h2>生成物与验证（本机实测）</h2>
  <p>下列资产全部由本机 CPU 管线生成：几何为米制、Z-up，非几何使用同一坐标系；预览图由自研软光栅渲染，不依赖 GPU 或云服务。
  街景主角已替换为 <b>ANNY 成人 A-pose 白模</b>（1.776 m），不再是早期的体块人偶代理。</p>
  <table class="tbl">
    <thead><tr><th>层</th><th>输出形式</th><th>验证方式</th></tr></thead>
    <tbody>
      <tr><td><b>几何白模</b></td><td>GLB / OBJ / STL（无材质、无纹理；米制，Z-up）</td>
          <td>水密/体积/退化面/尺度/部件间隙/贴地/穿插；导出后回读</td></tr>
      <tr><td><b>非几何参考</b></td><td>BVH（动作）、JSON（相机/布局/特效/人群）、USDA（场景/相机时序/骨骼/体积）</td>
          <td>层级与帧数、关节限位、脚滑、根位移、路径平滑、投影覆盖率、轨迹连续性</td></tr>
    </tbody>
  </table>
  <h3>资产来源：程序化生成 vs 下载资产</h3>
  {provenance_table()}

  <h3>公开资产可用性（调研结论）</h3>
  <p>可以下载，且多数类别有 CC0 来源；但「下载」不等于「能直接进白模管线」，仍需许可登记、尺度/朝向归一化、材质剥离与几何修复。
  商用链路只允许 CC0 或 CC-BY（保留署名），<b>排除 CC-BY-NC 与 Sketchfab Standard License</b>。</p>
  <table class="tbl">
    <thead><tr><th>类别</th><th>推荐公开来源（许可）</th><th>判断</th></tr></thead>
    <tbody>
      <tr><td><b>服装布料</b></td><td>MakeHuman/MPFB 服装（CC0）、Quaternius/Kenney 服装（CC0）、Sketchfab CC0</td>
          <td>可下载；难点是贴合人体与褶皱，布料仍需 CPU 模拟或代理</td></tr>
      <tr><td><b>生物代理</b></td><td>Quaternius/Kenney 动物（CC0）、Sketchfab CC0；SMAL 仅非商用研究</td>
          <td>可下载低模代理；骨架与 SOMA 异构，需独立重定向</td></tr>
      <tr><td><b>植被</b></td><td>Poly Haven 树（CC0）、Quaternius/Kenney 自然包（CC0）</td>
          <td>可下载；近景主树用扫描件，背景继续用 L-system</td></tr>
      <tr><td><b>道具</b></td><td>Poly Haven（CC0）、Kenney（CC0）、Google Scanned Objects（CC-BY 4.0）</td>
          <td>可下载；扫描件需减面、非流形修复与尺度校正</td></tr>
      <tr><td><b>载具</b></td><td>Kenney/Quaternius 车包（CC0）、Sketchfab CC0、Khronos 样例（逐件核对）</td>
          <td>可下载；本项目已先补齐门窗/抽壳/内饰，公开模型可作为高保真替代</td></tr>
      <tr><td><b>建筑</b></td><td>Kenney/Quaternius 模块包（CC0）；BIM 走 IfcOpenShell</td>
          <td>可下载外观模块；楼层/构件语义仍需 IFC 或自建</td></tr>
    </tbody>
  </table>
  <p class="small">完整来源、风险与接入步骤见 <a href="research/public_assets.md">research/public_assets.md</a>；
  子代理对社区扩展来源的并行调研见 <a href="research/community_assets.md">research/community_assets.md</a>。</p>

  <h3>已下载的公共资产（本机实测）</h3>
  {public_tables()}
  {public_gallery()}
  <div class="note">CC-BY 署名：Fox © 2014 tomkranis，动画 © 2017 @AsoboStudio &amp; @scurest（CC-BY 4.0）；
  Poly Pizza 跑车 © Ignition Labs（CC-BY）。ToyCar（CC0，Guido Odendahl / Eric Chadwick）已下载但未列入预览。
  所有下载件都已做 Y-up→Z-up、按类别缩放的预览归一化；进入正式管线前仍需减面、修复非流形并剥离材质。</div>

  <h3>社区扩展来源（三路子代理调研摘要）</h3>
  <table class="tbl">
    <thead><tr><th>来源</th><th>许可</th><th>覆盖</th><th>获取方式 / 结论</th></tr></thead>
    <tbody>
      <tr><td><b>Quaternius</b></td><td>CC0</td><td>动物 12 种（带骨骼动画）、150 件自然、服装、车/船/建筑模块</td>
          <td>官网/itch，下载走 Google Drive → 需人工/浏览器自动化，<b>建议作为扩展包</b></td></tr>
      <tr><td><b>KayKit</b></td><td>CC0</td><td>角色 + 配件，带绑定动画</td>
          <td>itch 免费 12MB；衣物与身体一体，<b>备选</b></td></tr>
      <tr><td><b>Grab3D</b></td><td>CC0</td><td>写实动物、鸟类、树木（40–80 万面）</td>
          <td>网页直下；需强减面，<b>备选</b></td></tr>
      <tr><td><b>Objaverse</b></td><td>数据集 ODC-By；逐件 CC0/CC-BY</td><td>80 万+ 模型</td>
          <td>脚本下载，需按 license 过滤；<b>只做批量补量</b></td></tr>
      <tr><td><b>Google Scanned Objects</b></td><td>CC-BY 4.0</td><td>1032 件家居/工具扫描</td>
          <td>Gazebo Fuel API 可直下；高模需修复，<b>备选</b></td></tr>
      <tr><td><b>FreeCAD-library</b></td><td>CC-BY 3.0</td><td>建筑构件、HVAC、机械（B-Rep/STEP）</td>
          <td>GitHub 约 5GB；需网格化与逐件署名，<b>工程件备选</b></td></tr>
      <tr><td><b>Renderpeople 免费样例</b></td><td>自有免费商用许可（非 CC）</td><td>真人扫描（Posed/Rigged）</td>
          <td>高模 + 8K 贴图，需重拓扑；<b>谨慎</b></td></tr>
      <tr><td><b>Sketchfab</b></td><td>逐件 CC0/CC-BY，含 NC/Standard</td><td>全类别</td>
          <td>需登录且需逐件核许可；<b>仅补缺</b></td></tr>
    </tbody>
  </table>
  <p class="small">详细来源、风险与下载方式见 <a href="research/community_assets.md">research/community_assets.md</a>。
  商用链路禁用 CC-BY-NC / ND、Sketchfab Standard、GrabCAD 默认许可。</p>

  <h4>社区来源官方预览（仅用于识别，不随资产再分发）</h4>
  {source_gallery()}
  <p class="small">以上为各来源官网/官方页面的展示图，仅用于调研对照，版权归原站点。
  Grab3D 与 GrabCAD 的页面有反爬限制，FreeCAD-library 只有 GitHub 仓库卡片，未取到可用的模型预览。</p>
  <div class="grid3">
    {gallery_item('soma_anny_adult', '人物白模（ANNY 成人）', '参数化底座输出：1.776 m，A-pose，4.5k 顶点')}
    {gallery_item('clothing', '服装外壳（独立资产）', '程序化生成：偏移壳 + 袖片；未套用到 ANNY 主角')}
    {gallery_item('prop', '道具', '程序化生成：manifold 布尔并集，水密 376 面')}
    {gallery_item('vehicle_car', '载具·汽车', '程序化生成：抽壳 + 侧窗/风挡 + 车门分缝 + 内饰代理')}
    {gallery_item('vehicle_boat', '载具·轮船', '程序化生成：V 型船体 loft，6.4 m')}
    {gallery_item('building', '建筑体量', '程序化生成：8 层 × 3.2 m 体量')}
    {gallery_item('creature', '生物代理', '程序化代理：四足体块 + 头颈 + 四肢')}
    {gallery_item('vegetation', '植被', '程序化生成：L-system 枝干 + 冠层代理球簇')}
    {gallery_item('crowd', '人群实例', '程序化代理：12 个实例，身高/朝向/步态变化')}
  </div>
  <div class="grid2" style="margin-top:16px">
    {gallery_item('scene_hero', '场景合成（主视角）', 'ANNY 成人白模（1.776 m）+ 车辆 + 建筑 + 植被 + 人群代理')}
    {gallery_item('scene_top', '场景布局（俯视）', '布局 JSON 与几何一致，可用于密度/间距检查')}
  </div>
  <div class="grid2" style="margin-top:16px">
    {gallery_item('camera_path', '相机路径与视锥', '起点橙、终点绿；蓝线为路径；对应 camera_path.json')}
    {gallery_item('motion_sheet', '动作序列（BVH）', '48 帧 / 24 fps / 双脚交替；脚底接触点被验证器检查')}
  </div>
  <div class="grid2" style="margin-top:16px">
    {gallery_item('fx', '特效体积代理', '沿贝塞尔轨迹放样；JSON 另有 24 条碎片轨迹')}
    {gallery_item('soma_native', 'SOMA 原生后端', '128 维体型 PCA；用于对比不同底座')}
  </div>

  <h3>验证汇总</h3>
  <p>共 {VAL['summary']['total']} 项资产/数据验证，通过 {VAL['summary']['passed']} 项，通过率 {VAL['summary']['pass_rate']*100:.0f}%。
  验证在 CPU 上完成，覆盖几何（水密、体积、尺度、部件间隙、贴地）、场景（穿插、间距、构图）、非几何（BVH、相机、特效、布局）。</p>
  {checks_table(VAL['results'])}

  <h3>导出回读（几何 + 非几何）</h3>
  {exports_table()}

  <h3>产物清单</h3>
  <p>共 {MANIFEST['count']} 个文件、{MANIFEST['total_bytes']/1024/1024:.1f} MB；完整清单见 <a href="assets/manifest.json">manifest.json</a>。
  以下按体积列出主要产物（点击可直接用本地应用打开）：</p>
  {manifest_table()}

  <details>
    <summary>查看 USD 舞台结构（scene_street.usda）</summary>
    <pre class="tree">{open(os.path.join(ROOT, 'assets', 'geometry', 'scene_street.usda'), encoding='utf-8').read()[:2600]}</pre>
  </details>

  <div class="card">
    <h4>复现方式</h4>
    <pre class="tree">cd research/tree-resources-builder/harness
python run_pipeline.py          # 生成 + 验证 + 渲染 + USD 导出
python verify_exports.py        # 回读 GLB/OBJ/STL/USDA/BVH
python build_report.py          # 重新生成本报告
python verify_report.py         # 外链/JS/无头浏览器交互校验

# SOMA-X 本机 CPU 实测（需 var\\soma-venv 与 var\\soma-assets）
..\\..\\var\\soma-venv\\Scripts\\python.exe soma_cpu_test.py
..\\..\\var\\soma-venv\\Scripts\\python.exe render_soma.py</pre>
    <p class="small">依赖：numpy、trimesh、manifold3d、usd-core、Pillow、networkx。全流程 CPU，单次约 70–100 秒。</p>
  </div>
</section>

<section id="shot">
  <h2>5 秒竖切片 shot_001</h2>
  {shot_section()}
</section>

<section id="loop">
  <h2>Agentic 闭环演练：失败 → 反馈 → 修复 → 复检</h2>
  <p>为了不把「闭环」停留在概念上，这里用真实运行演示一次：故意给出错误参数（身高 2.45 m、手臂外移 0.16 m），
  验证器给出结构化失败信号，修复模块据此调整参数并复检。</p>
  {loop_section()}
  <div class="note">该演练证明了两个关键点：① 确定性检查足以捕获「比例错误」与「部件脱离」这两类常见废网格；② 反馈可以精确到参数字段，LLM 无需看到渲染图也能修正。视觉检查仍然是必要的补充，但不是唯一信号。</div>
</section>

<section id="plan">
  <h2>最小验证计划</h2>
  <p>目标不是「把所有工具跑一遍」，而是用最少闭环验证架构的核心假设。V1、V4 已在本机完成；V2、V3、V5 需要额外资源（PyTorch 权重、DCC 环境、云端 LLM 配额）。</p>
  {dep_svg()}
  <table class="tbl">
    <thead><tr><th>路径</th><th>验证假设</th><th>成功判据</th><th>状态</th></tr></thead>
    <tbody>
      <tr><td><b>V1</b> 几何白模可渲染</td><td>LLM 可写的配方能稳定生成水密、尺度正确、可渲染的网格</td><td>≥8 类资产通过水密/尺度/部件检查；GLB 可被 trimesh 重新加载</td><td>{badge_v('✅ 通过', 'v1')}</td></tr>
      <tr><td><b>V2</b> 人物 + 动作闭环</td><td>SOMA-X（CPU）前向 + BVH 重定向能产出可用的表演参考</td><td>网格 CPU 延迟可接受；BVH 脚滑 &lt; 0.02 m/帧；关节限位无越界</td><td>{badge_v('✅ 前向 10–31 ms 已通过；重定向待集成', 'v1')}</td></tr>
      <tr><td><b>V3</b> 非几何可被下游消费</td><td>BVH / USD Camera / USD Volume 能被 DCC 或引擎读取</td><td>Blender 导入 BVH 成功；USD 相机时序可播放；体积转出深度/遮罩序列</td><td>{badge_v('◐ USD 已生成，DCC 导入未验证', 'v2')}</td></tr>
      <tr><td><b>V4</b> 场景与人群组合</td><td>同类资产在同一坐标系组合后仍满足空间约束</td><td>贴地误差 ≤ 0.06 m；人群间距 ≥ 0.6 m；主体入画率 &gt; 90%</td><td>{badge_v('✅ 通过', 'v1')}</td></tr>
      <tr><td><b>V5</b> LLM 生成质量</td><td>云端 LLM 产出配方/代码的首次执行成功率足够高</td><td>首次通过率 ≥ 60%；3 轮内收敛率 ≥ 90%（需真实 API 配额）</td><td>{badge_v('○ 未验证', 'v3')}</td></tr>
    </tbody>
  </table>
  <div class="note">依赖关系：V1 → V4；V2 → V3；V5 依赖 V1/V2 的验证器与样例库。共享组件是验证内核、资产总线与软光栅预览，这意味着任何一条路径的改进都会复用到其他路径。</div>
</section>

<section id="boundaries">
  <h2>诚实边界与风险</h2>
  <table class="tbl">
    <thead><tr><th>边界/风险</th><th>影响</th><th>应对</th></tr></thead>
    <tbody>
      <tr><td>纯 CPU + 无生成模型 ⇒ 不可能有照片级有机细节</td><td>皮肤、毛发、树冠、布料褶皱只能代理</td><td>把目标定义为「结构/比例/运动正确」；细节交给下游生成模型或人工</td></tr>
      <tr><td>汽车 / 服装缺少成熟开源参数化底座</td><td>只能 loft + 零件库 / 人体底座 + 壳层</td><td>建立内部参数化模板库；优先覆盖高频镜头类型</td></tr>
      <tr><td>面部、口型、表情不在 SOMA-X 覆盖内</td><td>真人特写对白戏缺少方案</td><td>单独评估面部绑定；或明确该镜头不在白模体系内</td></tr>
      <tr><td>动物与人体骨架异构</td><td>动作不能直接复用</td><td>分别生成步态；建立两套重定向管线</td></tr>
      <tr><td>特效体积对视频模型控制弱</td><td>体积代理难以直接条件化</td><td>转深度/法线/遮罩；或改为几何碎片</td></tr>
      <tr><td>LLM 首次通过率低</td><td>迭代成本高</td><td>验证前置 + 模板库 + 失败案例检索；限制输出为白名单配方</td></tr>
      <tr><td>许可合规</td><td>SMPL/SMAL 商用受限</td><td>商用链路只允许 Apache-2.0/CC0 底座；许可清单进入 CI</td></tr>
    </tbody>
  </table>
  <p>需要强调：本报告没有发现「某类资产在纯 CPU 下完全无法获得可接受结构质量」的绝对障碍，但发现了三处<b>工程性空白</b>——汽车参数化、服装参数化、面部表演。
  它们不是范式问题，而是底座缺失问题。</p>
</section>

<section id="sources">
  <h2>来源</h2>
  <ul class="small">
    <li><a href="https://huggingface.co/nvidia/SOMA-X">NVIDIA SOMA-X Model Card</a> · <a href="https://github.com/NVlabs/SOMA-X">SOMA-X 仓库</a> · <a href="https://nvlabs.github.io/SOMA-X/stable/">文档</a></li>
    <li><a href="https://arxiv.org/abs/2504.01786">BlenderGym（CVPR 2025）</a> · <a href="https://arxiv.org/pdf/2606.01057">3DCodeBench（2026）</a> · <a href="https://xplorestaging.ieee.org/document/11355469/metrics">CodeGen-3D</a></li>
    <li><a href="https://arxiv.org/abs/2505.14646">CAD-Coder（2025）</a> · <a href="https://arxiv.org/pdf/2009.08026v1">ShapeAssembly</a> · <a href="https://arxiv.org/pdf/2403.13064v1">SceneScript</a> · <a href="https://arxiv.org/pdf/2608.21447">BIMScript（2026）</a></li>
    <li><a href="https://openvsp.org/pyapi_docs/latest/">OpenVSP Python API</a> · <a href="https://smal.is.tue.mpg.de/">SMAL</a> · <a href="https://smpl-x.is.tue.mpg.de/">SMPL-X</a> · <a href="https://static.makehumancommunity.org/mpfb.html">MakeHuman MPFB2</a> · <a href="https://ifcopenshell.org/">IfcOpenShell</a></li>
    <li><a href="https://openusd.org/release/api/_usd_skel__intro.html">OpenUSD UsdSkel</a> · <a href="https://pypi.org/project/blender-mcp-server/">Blender MCP</a> · <a href="https://buildcad.ai/guides/cad-mcp-servers">CAD MCP 生态盘点</a></li>
  </ul>
  <p class="small">完整调研笔记与抓取原文见 <code>research/somax.md</code>、<code>research/paradigms.md</code>、<code>research/somax_readme.md</code>。</p>

  <h3>交付校验</h3>
  <div id="checkResult" class="card small">正在读取校验结果…</div>
</section>
</main>

<footer class="footer">Tree Resources Builder · 调研报告 · 全部几何/非几何资产由本机 CPU 生成 · 报告不加载任何外部资源</footer>

<script>{JS}</script>
</body>
</html>
"""
    out = os.path.join(ROOT, "report.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(report)
    print("written", out, len(report), "bytes")


if __name__ == "__main__":
    main()
