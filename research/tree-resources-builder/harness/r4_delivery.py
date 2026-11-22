"""R4 交付汇总：五类资产的缺口/补全清单 + 校验读数 + 台账读数 + 遗留与未做到。

产出
----
* assets/validation/r4_delivery.json  —— 交付总表（机器可读）
* assets/nongeometry/r4/color_independence.json —— 「深度/线稿/法线与显示色彩无关」的固定约定

缺口清单是**人工策展**的（哪些类缺什么、R4 补到哪），读数是**机器实测**的
（面数、预算、许可、sha256、校验结论），两者在总表里分开摆，不混。
"""
from __future__ import annotations

import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VAL = os.path.join(ROOT, "assets", "validation")

import r4_common as C  # noqa: E402

# ------------------------------------------------------------------ 五类资产缺口（人工策展）
# before = R3 收案时的存量；after = R4 补全后的存量；gap = 本阶段补了什么
CLASS_GAPS = [
    {
        "class": "prop",
        "title": "道具",
        "before": "1 件（prop_crate，程序化）",
        "after": "20 件 CC0 零件库（17 Kenney + 3 Poly Haven hero）",
        "gap_filled": "19 件净增；覆盖街道（锥桶/施工护栏/施工围挡/路牌/电线杆/桥墩）、"
                      "工区（货箱/工具/铁桶/梯子/废料桶）、商业（雨棚）与自然（围栏/木桩）",
        "source_policy": "Kenney 为主 + 少量 Poly Haven hero（用户拍板口径）",
        "processing": "Kenney 视觉资产 -> 边界封环水密化；Poly Haven hero -> 体素重采样",
    },
    {
        "class": "tree",
        "title": "植被",
        "before": "1 件（vegetation_tree，单档、无配方、无实例表）",
        "after": "6 树种 × 三档 LOD = 18 件 + JSON 配方 + 实例化表",
        "gap_filled": "17 件净增；6 树种（阔叶/针叶/白桦/枫/棕榈/枯枝）各有 hero/mid/low 三档，"
                      "面数 80–4960，全部在预算内",
        "source_policy": "程序化生成（配方驱动；Kenney 树是单件固定模型，给不出 LOD 阶梯）",
        "processing": "递归分枝 + 冠层代理；LOD 降级靠枝级数/冠球数/截面数三档参数",
    },
    {
        "class": "vehicle",
        "title": "载具",
        "before": "2 件（vehicle_car 单拓扑 + vehicle_boat）",
        "after": "4 种同拓扑车身（sedan/hatch/suv/pickup）+ 语义零件库（25 部件）+ 4 类动力学预设",
        "gap_filled": "4 件同拓扑车身；门/轮/灯/镜/座/仪表台/方向盘全部独立成件；"
                      "四车身的顶点拓扑哈希逐字节一致",
        "source_policy": "程序化生成（JSON 配方 r4-recipe/1，无几何节点）",
        "processing": "站位数/截面数/部件集固定，只换顶点坐标；变体参数在配方里",
    },
    {
        "class": "scene",
        "title": "建筑/场景",
        "before": "2 件（building_office 单体 + scene_street 单场景）",
        "after": "3 种街区（downtown/residential/industrial）+ 分块 LOD（near/mid/far）+ 公共件混排",
        "gap_filled": "3 个街区；每街区 3 块 LOD 分区；楼/树/公共件/车/人同场混排且互不穿插",
        "source_policy": "程序化生成 + 公共件混排（Kenney 归一化件直接入场景）",
        "processing": "成组 AABB 判穿插 + 候选位兜底；地面层顶面统一 z=0",
    },
    {
        "class": "character",
        "title": "人物",
        "before": "1 件程序化主角 + 3 件 SOMA 低模（无身份变体、无部件拆分、无服装壳）",
        "after": "10 个身份变体（26 个独立部件节点 + 贴合服装壳 4 件）",
        "gap_filled": "10 件身份变体（worker/office/student/vendor/courier/elder/child 七类身份）；"
                      "每个变体部件级拆分（躯干/骨盆/颈/头/四肢分段/手/脚）+ 外套壳（体/袖×2/领）",
        "source_policy": "程序化生成（骨骼比例沿用 R3 的 HUMAN_JOINTS，口径同源）",
        "processing": "身高/体格/肩宽/肢体粗细/头身比五个参数化维度",
    },
]

# ------------------------------------------------------------------ 遗留与未做到（人工策展）
OPEN_ITEMS = [
    {
        "item": "Poly Haven hero 件是扫描资产，经体素重采样（0.016–0.022 m 网格）成水密实体",
        "why": "源件是多层薄板拼装的扫描件，边界环太多，边界封环封不干净（实测 0/3 可水密）；"
               "体素重采样是确定性几何重采样（纯 CPU、无生成式模型、无权重下载），不是扩散/SDS 重建",
        "cost": "锐利边缘被抹平（白模只取体量与结构，够用）；面数从 5.6k–10.5k 升到 8.3k–35k",
    },
    {
        "item": "道具库是策展出来的：1033 个 Kenney 源件里只有 206 个能过既有水密口径",
        "why": "视觉资产大量是开放曲面（锥桶没底、薄板家具），过不了 MESH_WATERTIGHT；"
               "本阶段只收能过口径的件，选件依据落在 assets/validation/r4_source_scan.json",
        "cost": "库内没有长椅/垃圾桶/路灯这类家具件（furniture-kit 0 件通过）",
    },
    {
        "item": "场景混排的公共件只到 13 个不同件（每街区 4 件）",
        "why": "R4 的验收口径是「混排后人/车/植被无穿插、贴地为 0」，不是场景丰富度；"
               "扩库要等 R5 导演台定稿了镜头清单再补",
        "cost": "街区视觉重复度偏高",
    },
    {
        "item": "没有做资产浏览界面（ROADMAP 把界面放在 R5）",
        "why": "R4 范围只到「资产件 + 台账 + 校验」，界面是 R5 的活",
        "cost": "R4 新件目前只能靠台账与读数检索",
    },
    {
        "item": "没有做飞机/轮船参数化底座、没有面部表情、没有 AI 生成件、没有 GPU 依赖、"
                 "没有下载模型权重、没有引入 Blender、没有做下游图/视频 A/B 验证",
        "why": "ROADMAP §5 明确不做清单（C1–C5）",
        "cost": "（按计划排除，不计为缺口）",
    },
]


def _read(rel):
    return C.read_json(os.path.join(ROOT, rel), {}) or {}


def _asset_rows():
    """五类资产的逐件清单（名称/用途分级/面数/预算/来源/许可）。"""
    rows = []
    for sub in ("props", "vegetation", "soma_variants"):
        d = os.path.join(ROOT, "assets", "geometry", sub)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if not name.endswith(".json"):
                continue
            doc = C.read_json(os.path.join(d, name))
            if not isinstance(doc, dict) or doc.get("kind") != "r4_asset":
                continue
            rows.append(doc)
    for name in sorted(os.listdir(os.path.join(ROOT, "assets", "geometry"))):
        if not name.endswith(".json"):
            continue
        doc = C.read_json(os.path.join(ROOT, "assets", "geometry", name))
        if isinstance(doc, dict) and doc.get("kind") == "r4_asset":
            rows.append(doc)
    return rows


def build():
    sidecars = _asset_rows()
    by_class = {}
    for doc in sidecars:
        by_class.setdefault(doc.get("category"), []).append({
            "asset": doc.get("name"),
            "id": doc.get("id"),
            "usage_level": doc.get("usage_level"),
            "budget_faces": doc.get("budget_faces"),
            "faces": (doc.get("geometry") or {}).get("faces"),
            "vertices": (doc.get("geometry") or {}).get("vertices"),
            "size_m": (doc.get("geometry") or {}).get("size_m"),
            "watertight": (doc.get("geometry") or {}).get("watertight"),
            "license": (doc.get("license") or {}).get("spdx"),
            "license_url": (doc.get("license") or {}).get("license_url"),
            "source_url": (doc.get("license") or {}).get("source_url"),
            "origin": (doc.get("provenance") or {}).get("origin"),
            "source_model": (doc.get("provenance") or {}).get("source_model"),
            "sha256": (doc.get("files") or [{}])[0].get("sha256"),
            "bytes": (doc.get("files") or [{}])[0].get("bytes"),
            "recipe_id": (doc.get("recipe") or {}).get("recipe_id"),
        })

    validation = _read("assets/validation/r4_summary.json")
    manifest = _read("assets/manifest.json")
    manifest_report = _read("assets/validation/manifest_report.json")
    scan = _read("assets/validation/r4_source_scan.json")

    # 颜色无关约定：固定条款 + 机器检查口径
    color_doc = {
        "kind": "r4_convention",
        "id": "color_independence",
        "statement": ("深度/线稿/法线与显示色彩无关：R4 资产一律纯几何 GLB"
                      "（无 images / textures / materials），条件通道只能由几何算出，"
                      "不存在显示色彩污染条件图的路径。"),
        "scope": "R4 新增资产（assets/geometry/**）",
        "machine_check": {
            "code": "COLOR_INDEPENDENT",
            "where": "harness/r4_validate.py::_glb_has_color",
            "rule": "GLB 的 JSON 块里不得出现 images / textures / materials",
        },
        "note": ("本阶段不做影视色彩变换（ACES/AgX）——那是 R1 条件图阶段的事；"
                 "这里只固定「通道与显示色彩解耦」这条约定，并给它一条可判定的检查。"),
    }
    C.write_json(os.path.join(C.R4META, "color_independence.json"), color_doc)

    report = {
        "kind": "r4_delivery",
        "cpu_only": True,
        "stage": "R4 · 五类资产补全（道具优先）",
        "classes": CLASS_GAPS,
        "assets_by_class": by_class,
        "counts": {k: len(v) for k, v in by_class.items()},
        "validation": {
            "summary": validation.get("summary"),
            "reports": validation.get("reports"),
            "classes": validation.get("classes"),
        },
        "manifest": {
            "version": manifest.get("version"),
            "asset_count": manifest.get("asset_count"),
            "files": manifest.get("count"),
            "total_bytes": manifest.get("total_bytes"),
            "summary": manifest_report.get("summary"),
            "cross_pass": manifest_report.get("cross_pass"),
        },
        "source_scan": scan.get("summary"),
        "conventions": [color_doc],
        "open_items": OPEN_ITEMS,
    }
    C.write_json(os.path.join(VAL, "r4_delivery.json"), report)
    print("[delivery] 五类资产 %d 件 -> assets/validation/r4_delivery.json"
          % sum(len(v) for v in by_class.values()))
    return report


if __name__ == "__main__":
    build()
