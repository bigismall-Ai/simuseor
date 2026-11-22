# R4 资产生成器（二）：人物 10 个身份变体（部件级拆分 + 贴合服装壳）。

"""口径来自 r4_common。命名沿用 conditions.resolve_category 的词表：
  人物部件节点用 "hero_*" 前缀 —— 语义表里 hero* 映射到 character（"character" 自己
  不是合法前缀，直接用 character_* 会落进 other）。服装壳用 "jacket_*" 前缀映射到 clothing。
  注意：名里的 "hero" 是「语义类别词」，与用途分级（hero/mid/low）是两套东西。

部件级拆分
----------
一个变体 = 一个多节点 GLB：躯干/骨盆/颈/头 + 左右上下肢各段 + 手/脚。
拆分不是为了好看，是为了让下游能按部件做绑定与替换（白模路线要「可学的结构」）。

贴合服装壳
----------
外套不是套一个通用壳，而是按该变体自己的躯干截面生成（外扩 35 mm），
所以壳与身体逐变体贴合；校验里量 Z 覆盖率与水平偏移、壳-身间隙。

纯 CPU、纯参数化几何：不跑生成式模型、不下模型权重、不引 Blender。
"""
from __future__ import annotations

import argparse
import math
import os

import numpy as np

import r4_common as C
from geomlib import T, box, ellipse_ring, loft, merge, place, segment, sphere

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CHAR_DIR = os.path.join(ROOT, "assets", "geometry", "soma_variants")

# 10 个身份变体：身高 / 体格 / 肩宽 / 肢体粗细 / 头身比
CHAR_VARIANTS = [
    dict(name="worker", variant="broad", height=1.82, torso=1.12, shoulder=1.10,
         hip=1.06, limb=1.12, head=1.02, level="hero", note="工装主线，近景"),
    dict(name="worker", variant="lean", height=1.76, torso=0.94, shoulder=0.96,
         hip=0.94, limb=0.96, head=1.00, level="hero", note="工装副线，近景"),
    dict(name="office", variant="slim", height=1.73, torso=0.92, shoulder=0.94,
         hip=0.93, limb=0.92, head=1.00, level="hero", note="办公主线，近景"),
    dict(name="office", variant="tall", height=1.88, torso=0.96, shoulder=1.00,
         hip=0.95, limb=0.98, head=0.98, level="hero", note="办公高个，近景"),
    dict(name="student", variant="short", height=1.62, torso=0.96, shoulder=0.92,
         hip=0.98, limb=0.90, head=1.08, level="mid", note="学生，中景"),
    dict(name="student", variant="round", height=1.65, torso=1.10, shoulder=0.96,
         hip=1.06, limb=0.98, head=1.10, level="mid", note="学生圆脸，中景"),
    dict(name="vendor", variant="lean", height=1.70, torso=0.98, shoulder=0.98,
         hip=0.96, limb=0.96, head=1.00, level="mid", note="摊贩，中景"),
    dict(name="courier", variant="slim", height=1.79, torso=0.90, shoulder=0.92,
         hip=0.90, limb=0.90, head=0.98, level="mid", note="快递员，中景"),
    dict(name="elder", variant="stout", height=1.66, torso=1.14, shoulder=1.02,
         hip=1.08, limb=1.06, head=1.04, level="mid", note="长者，中景"),
    dict(name="child", variant="small", height=1.24, torso=0.88, shoulder=0.86,
         hip=0.90, limb=0.80, head=1.22, level="mid", note="儿童，中景"),
]

# 关节布局（沿用 R3 的 HUMAN_JOINTS 比例，保证与既有主角同源）
SKELETON = [
    ("Hips", None, (0.00, 0.00, 0.98)),
    ("Spine", "Hips", (0.00, 0.00, 0.13)),
    ("Chest", "Spine", (0.00, 0.00, 0.18)),
    ("Neck", "Chest", (0.00, 0.00, 0.18)),
    ("Head", "Neck", (0.00, 0.00, 0.15)),
    ("L_Shoulder", "Chest", (0.19, 0.00, 0.14)),
    ("L_Elbow", "L_Shoulder", (0.23, 0.01, -0.27)),
    ("L_Wrist", "L_Elbow", (0.16, 0.03, -0.25)),
    ("L_Hand", "L_Wrist", (0.03, 0.03, -0.09)),
    ("R_Shoulder", "Chest", (-0.19, 0.00, 0.14)),
    ("R_Elbow", "R_Shoulder", (-0.23, 0.01, -0.27)),
    ("R_Wrist", "R_Elbow", (-0.16, 0.03, -0.25)),
    ("R_Hand", "R_Wrist", (-0.03, 0.03, -0.09)),
    ("L_Hip", "Hips", (0.10, 0.00, -0.05)),
    ("L_Knee", "L_Hip", (0.01, 0.01, -0.43)),
    ("L_Ankle", "L_Knee", (0.00, 0.01, -0.42)),
    ("L_Toe", "L_Ankle", (0.00, 0.14, -0.04)),
    ("R_Hip", "Hips", (-0.10, 0.00, -0.05)),
    ("R_Knee", "R_Hip", (-0.01, 0.01, -0.43)),
    ("R_Ankle", "R_Knee", (0.00, 0.01, -0.42)),
    ("R_Toe", "R_Ankle", (0.00, 0.14, -0.04)),
]


def _joints(v):
    """按变体参数缩放骨架：身高整体缩放，肩/胯横向加宽。"""
    s = v["height"] / 1.75
    raw = {k: np.asarray(o, float) for k, _, o in SKELETON}
    parent = {k: p for k, p, _ in SKELETON}
    out = {}

    def walk(name):
        if name in out:
            return out[name]
        p = parent[name]
        base = np.zeros(3) if p is None else walk(p).copy()
        off = raw[name].copy() * s
        if name.endswith("Shoulder"):
            off[0] *= v["shoulder"]
        elif name.endswith("Hip"):
            off[0] *= v["hip"]
        out[name] = base + off
        return out[name]

    for k, _, _ in SKELETON:
        walk(k)
    return out


def _build_body(v):
    """按变体生成部件字典（部件级拆分）。"""
    j = _joints(v)
    s = v["height"] / 1.75
    seg = 12
    parts = {}

    # 躯干：椭圆截面 loft（按变体加宽）
    rings = []
    for z, rx, ry in ((0.93, 0.150, 0.100), (1.03, 0.142, 0.096),
                      (1.16, 0.165, 0.104), (1.32, 0.200, 0.112), (1.43, 0.180, 0.100)):
        rings.append(ellipse_ring(rx * s * v["torso"], ry * s * v["torso"],
                                   z * s, seg, 2.6))
    parts["torso"] = loft(rings)
    parts["pelvis"] = sphere(0.14 * s * v["hip"], center=(0, 0, 0.94 * s), subdiv=1,
                             scale=(1.10 * v["hip"], 0.80, 0.72))
    parts["neck"] = segment((0, 0, 1.40 * s), (0, 0, 1.52 * s),
                            0.050 * s, 0.046 * s, seg)
    parts["head"] = sphere(0.105 * s * v["head"], center=(0, 0.005 * s, 1.625 * s),
                           subdiv=2, scale=(0.92, 1.0, 1.10))
    for side in ("L", "R"):
        sh = j["%s_Shoulder" % side]
        el = j["%s_Elbow" % side]
        wr = j["%s_Wrist" % side]
        hp = j["%s_Hip" % side]
        kn = j["%s_Knee" % side]
        an = j["%s_Ankle" % side]
        parts["shoulder_%s" % side] = sphere(0.075 * s * v["limb"], center=sh, subdiv=1)
        parts["upperarm_%s" % side] = segment(sh, el, 0.058 * s * v["limb"],
                                               0.048 * s * v["limb"], seg)
        parts["elbow_%s" % side] = sphere(0.047 * s * v["limb"], center=el, subdiv=1)
        parts["forearm_%s" % side] = segment(el, wr, 0.047 * s * v["limb"],
                                              0.037 * s * v["limb"], seg)
        parts["hand_%s" % side] = box((0.055 * s, 0.075 * s, 0.095 * s),
                                       center=(wr[0], wr[1], wr[2] - 0.05 * s))
        parts["thigh_%s" % side] = segment(hp, kn, 0.085 * s * v["limb"],
                                            0.061 * s * v["limb"], seg)
        parts["knee_%s" % side] = sphere(0.060 * s * v["limb"], center=kn, subdiv=1)
        parts["shin_%s" % side] = segment(kn, an, 0.058 * s * v["limb"],
                                           0.041 * s * v["limb"], seg)
        parts["foot_%s" % side] = box((0.092 * s, 0.235 * s, 0.075 * s),
                                       center=(an[0], an[1] + 0.065 * s, 0.038 * s))
    return parts, j


def _build_jacket(v, j):
    """贴合服装壳：按该变体躯干外扩 35 mm 生成外套体 + 袖 + 领。"""
    s = v["height"] / 1.75
    off = 0.035
    rings = []
    for z, rx, ry in ((0.98, 0.185, 0.135), (1.10, 0.180, 0.130),
                      (1.24, 0.205, 0.140), (1.36, 0.235, 0.145), (1.45, 0.210, 0.130)):
        rings.append(ellipse_ring((rx + off) * s * v["torso"], (ry + off) * s * v["torso"],
                                   z * s, 16, 2.6))
    body = loft(rings)
    out = {"body": body}
    for side in ("L", "R"):
        sh, el, wr = j["%s_Shoulder" % side], j["%s_Elbow" % side], j["%s_Wrist" % side]
        sleeve = merge([
            segment(sh + np.array([0, 0, 0.01]), el,
                    (0.090 + off) * s * v["limb"], (0.077 + off) * s * v["limb"], 12),
            segment(el, wr, (0.074 + off) * s * v["limb"],
                    (0.060 + off) * s * v["limb"], 12)])
        out["sleeve_%s" % side.lower()] = sleeve
    out["collar"] = segment((0, 0, 1.40 * s), (0, 0, 1.45 * s),
                            (0.075 + off) * s, (0.070 + off) * s, 12)
    return out


def gen_characters():
    os.makedirs(CHAR_DIR, exist_ok=True)
    rows = []
    variants = []
    for v in CHAR_VARIANTS:
        asset = "hero_%s_%s" % (v["name"], v["variant"])
        parts, j = _build_body(v)
        jacket = _build_jacket(v, j)
        items = []
        for part, mesh in parts.items():
            items.append(("hero_%s_%s" % (asset, part), mesh, T(0, 0, 0)))
        for part, mesh in jacket.items():
            items.append(("jacket_%s_%s" % (asset, part), mesh, T(0, 0, 0)))
        out = os.path.join(CHAR_DIR, asset + ".glb")
        C.export_scene_glb(items, out)
        stats = C.scene_stats(items)
        budget = C.budget_for(v["level"])
        lic = {
            "spdx": "LicenseRef-Proprietary",
            "source_url": None,
            "license_url": None,
            "attribution_required": True,
            "credit": "程序化生成（harness/r4_generate_characters.py，纯 CPU，无生成式模型）",
        }
        prov = {
            "origin": "procedural",
            "statement": "本仓库 harness 参数化生成（纯 CPU），非扫描、非 AI 生成",
            "source_url": None,
            "is_ai": 0,
            "generator": "harness/r4_generate_characters.py",
        }
        recipe = {"recipe_id": "character_identities", "variant": v["name"],
                  "params": {k: x for k, x in v.items() if k != "level"},
                  "level": v["level"]}
        C.sidecar(os.path.join(CHAR_DIR, asset + ".json"),
                  asset_id="geometry/soma_variants/" + asset, name=asset,
                  category="character", usage_level=v["level"], files=[out],
                  license_block=lic, provenance=prov, recipe=recipe,
                  geometry=stats,
                  extra={"nodes": [n for n, _, _ in items],
                         "part_count": len(parts),
                         "clothing_shell": "jacket_%s_body" % asset,
                         "clothing_parts": ["jacket_%s_%s" % (asset, k) for k in jacket],
                         "note": v["note"]})
        rows.append({"asset": asset, "identity": v["name"], "variant": v["variant"],
                     "level": v["level"], "parts": len(parts),
                     "faces": stats["faces"], "vertices": stats["vertices"],
                     "budget_faces": budget,
                     "within_budget": stats["faces"] <= budget,
                     "height_m": round(float(stats["bbox_max"][2]), 3),
                     "ground_offset_m": stats["ground_offset_m"],
                     "file": C.rel(out), "bytes": os.path.getsize(out)})
        variants.append({
            "variant": v["name"], "name": asset, "identity": v["name"],
            "build": v["variant"], "usage_level": v["level"],
            "budget_faces": budget,
            "params": {k: x for k, x in v.items() if k != "level"},
            "outputs": [C.rel(out)],
        })
        print("[char] %-26s parts=%2d faces=%6d budget=%5d h=%.2f"
              % (asset, len(parts), stats["faces"], budget,
                 rows[-1]["height_m"]))
    C.write_json(os.path.join(C.R4META, "character_variants_recipe.json"), {
        "kind": "r4_recipe", "schema": C.RECIPE_SCHEMA,
        "recipe_id": "character_identities", "category": "character",
        "semantic_category": "character",
        "note": ("10 个身份变体：部件级拆分（躯干/四肢分段）＋ 贴合服装壳。"
                 "名里的 hero 是语义类别词（conditions 表 hero*->character），"
                 "与用途分级 hero/mid/low 无关。"),
        "variants": variants,
    })
    C.write_json(os.path.join(C.R4META, "character_variants_build.json"), {
        "kind": "r4_character_variants", "items": rows, "total": len(rows),
        "all_within_budget": all(r["within_budget"] for r in rows),
    })
    return rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="R4 资产生成：人物身份变体")
    ap.add_argument("--characters", action="store_true")
    args = ap.parse_args()
    if args.characters:
        gen_characters()
