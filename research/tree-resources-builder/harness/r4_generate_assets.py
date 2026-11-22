# R4 资产生成器（一）：植被 6 树种 × 三档 LOD、载具 4 种同拓扑车身。

"""命名与口径全部来自 r4_common（<category>_<name>_<variant>、用途分级、面数预算）。
纯 CPU、纯参数化几何：不跑生成式模型、不下模型权重、不引 Blender。

同拓扑口径
----------
载具四车身共用一套骨架：站位数、截面点数、部件集、连接关系全部固定，
只有顶点坐标随配方参数变化。因此四件的「顶点拓扑哈希」（面索引表 sha256）
逐字节一致 —— 这正是「同拓扑」的可机器判定形式。
"""
from __future__ import annotations

import argparse
import math
import os

import numpy as np
import trimesh

import r4_common as C
from geomlib import (T, box, cylinder, ellipse_ring, loft, merge, place,
                     segment, sphere)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VEG_DIR = os.path.join(ROOT, "assets", "geometry", "vegetation")
VEH_DIR = os.path.join(ROOT, "assets", "geometry")


# ================================================================== 植被
# 6 个树种配方（形态差异：冠形、枝型、高度比）
SPECIES = [
    dict(name="oak_broad", height=6.2, trunk_r=0.30, canopy_r=3.10, canopy_h=2.6,
         shape="round", branches=3, levels=3, seed=11,
         note="阔叶球冠，行道树主力"),
    dict(name="pine_conical", height=8.6, trunk_r=0.24, canopy_r=2.40, canopy_h=5.2,
         shape="conical", branches=3, levels=2, seed=23,
         note="针叶锥冠，街角点缀"),
    dict(name="birch_slim", height=7.2, trunk_r=0.16, canopy_r=1.55, canopy_h=3.4,
         shape="column", branches=3, levels=3, seed=37,
         note="细高白桦，窄巷背景"),
    dict(name="maple_wide", height=5.4, trunk_r=0.26, canopy_r=3.60, canopy_h=2.2,
         shape="wide", branches=4, levels=3, seed=53,
         note="宽冠枫，广场遮荫"),
    dict(name="palm_tall", height=7.6, trunk_r=0.22, canopy_r=2.30, canopy_h=1.3,
         shape="palm", branches=8, levels=1, seed=67,
         note="棕榈，无球冠（叶面辐射）"),
    dict(name="dead_bare", height=4.6, trunk_r=0.28, canopy_r=0.0, canopy_h=0.0,
         shape="bare", branches=3, levels=3, seed=79,
         note="枯枝，无冠层（构图用负形）"),
]

# 三档 LOD：hero 近景主线 / mid 中景 / low 远景占位
LODS = {
    "hero": dict(segments=8, levels=3, canopy_blobs=7, canopy_subdiv=2, branch_ratio=0.45),
    "mid": dict(segments=6, levels=2, canopy_blobs=4, canopy_subdiv=1, branch_ratio=0.38),
    "low": dict(segments=5, levels=1, canopy_blobs=2, canopy_subdiv=1, branch_ratio=0.30),
}


def _grow_branches(spec, lod, seed):
    """递归分枝（L-system 风格），返回 (分枝网格, 枝梢列表)。"""
    rng = np.random.default_rng(seed)
    parts = []
    tips = []

    levels = min(spec["levels"], lod["levels"])

    def grow(p, direction, length, radius, depth):
        if depth > levels or radius < 0.02:
            tips.append(p)
            return
        d = direction / (np.linalg.norm(direction) + 1e-9)
        if depth == 0:
            # 主干首段必须竖直向上：否则随机扰动会把树基压到 z<0，
            # 场景混排时整棵树会被判「沉进地面」/ 与地面板穿插。
            d = np.array([0.0, 0.0, 1.0])
        else:
            d = d + np.array([0.0, 0.0, 0.22]) + rng.normal(0.0, 0.18, 3)
            d /= np.linalg.norm(d)
        q = p + d * length
        parts.append(segment(p, q, radius, radius * 0.66, lod["segments"]))
        n = spec["branches"] if depth < levels else max(2, spec["branches"] - 1)
        for i in range(n):
            ang = 2 * math.pi * i / n + rng.uniform(-0.5, 0.5)
            axis = np.array([math.cos(ang), math.sin(ang), 0.0])
            nd = d * 0.55 + axis * 0.75 + np.array([0.0, 0.0, 0.25])
            grow(q, nd, length * lod["branch_ratio"], radius * 0.60, depth + 1)

    grow(np.zeros(3), np.array([0.0, 0.0, 1.0]),
         spec["height"] * 0.42, spec["trunk_r"], 0)
    return merge(parts) if parts else None, tips


def _canopy_mesh(spec, lod, tips):
    """冠层代理：按树种形态生成（球冠 / 锥冠 / 柱冠 / 棕榈叶 / 无冠）。"""
    shape = spec["shape"]
    if shape == "bare" or spec["canopy_r"] <= 0.0:
        return None
    blobs = lod["canopy_blobs"]
    subdiv = lod["canopy_subdiv"]
    if shape == "palm":
        # 棕榈：辐射状下垂叶片（扁平盒体，不用退化 loft）
        parts = []
        n = spec["branches"]
        top = np.array([0.0, 0.0, spec["height"]])
        for i in range(n):
            ang = 2 * math.pi * i / n
            out = np.array([math.cos(ang), math.sin(ang), 0.0])
            leaf_len = spec["canopy_r"] * 0.95
            c = top + out * (leaf_len * 0.5) - np.array([0.0, 0.0, spec["canopy_h"] * 0.25])
            leaf = box((leaf_len, 0.26, 0.045), center=tuple(c))
            # 绕 Z 转到出向，再绕 Y 压出下垂
            m = np.eye(4)
            m[:2, :2] = [[math.cos(ang), -math.sin(ang)], [math.sin(ang), math.cos(ang)]]
            leaf = place(leaf, m)
            parts.append(leaf)
        return merge(parts)
    if shape == "conical":
        # 针叶：三层锥冠
        parts = []
        layers = 3
        for i in range(layers):
            frac = 1.0 - i / layers
            z = spec["height"] * (0.42 + 0.20 * i)
            r = spec["canopy_r"] * (0.55 + 0.45 * frac)
            h = spec["canopy_h"] * 0.42
            cone = trimesh.creation.cone(radius=r, height=h, sections=max(6, 4 * blobs),
                                         transform=trimesh.transformations.translation_matrix(
                                             [0.0, 0.0, z + h * 0.5]))
            parts.append(cone)
        return merge(parts)
    # 球冠 / 柱冠 / 宽冠：枝梢上挂球体
    sel = tips[:: max(1, len(tips) // blobs)][:blobs] if tips else []
    parts = []
    for i, t in enumerate(sel):
        r = spec["canopy_r"] * (0.45 + 0.25 * ((i % 3) / 2.0))
        if shape == "column":
            r *= 0.85
        c = t.copy()
        # 冠层球心夹在冠半径内：否则枝梢外扩会让树冠散开，场景里与相邻树互相判穿插
        flat = math.hypot(float(c[0]), float(c[1]))
        if flat > spec["canopy_r"] * 0.60:
            k = spec["canopy_r"] * 0.60 / flat
            c[0] *= k
            c[1] *= k
        c[2] = min(c[2], spec["height"] * 0.92)
        parts.append(sphere(r, center=tuple(c), subdiv=subdiv,
                            scale=(1.0, 1.0, 0.78 if shape != "column" else 1.25)))
    if not parts:
        parts.append(sphere(spec["canopy_r"] * 0.8,
                            center=(0, 0, spec["height"] * 0.62), subdiv=subdiv))
    return merge(parts)


def gen_vegetation():
    os.makedirs(VEG_DIR, exist_ok=True)
    recipes = []
    rows = []
    for spec in SPECIES:
        variants = []
        for lod_name in ("hero", "mid", "low"):
            lod = LODS[lod_name]
            trunk, tips = _grow_branches(spec, lod, spec["seed"] + len(lod_name))
            canopy = _canopy_mesh(spec, lod, tips)
            asset = "tree_%s_%s" % (spec["name"], lod_name)
            items = []
            trunk_node = asset + "_trunk"
            canopy_node = "tree_canopy_%s_%s" % (spec["name"], lod_name)
            items.append((trunk_node, trunk, T(0, 0, 0)))
            if canopy is not None:
                items.append((canopy_node, canopy, T(0, 0, 0)))
            out = os.path.join(VEG_DIR, asset + ".glb")
            C.export_scene_glb(items, out)
            stats = C.scene_stats(items)
            budget = C.budget_for(lod_name)
            lic = {
                "spdx": "LicenseRef-Proprietary",
                "source_url": None,
                "license_url": None,
                "attribution_required": True,
                "credit": "程序化生成（harness/r4_generate_assets.py，纯 CPU，无生成式模型）",
            }
            prov = {
                "origin": "procedural",
                "statement": "由本仓库 harness 参数化生成（纯 CPU），非扫描、非 AI 生成",
                "source_url": None,
                "is_ai": 0,
                "generator": "harness/r4_generate_assets.py",
            }
            recipe = {
                "recipe_id": "vegetation_species",
                "variant": lod_name,
                "params": dict(spec),
                "lod": dict(lod),
            }
            C.sidecar(os.path.join(VEG_DIR, asset + ".json"),
                      asset_id="geometry/vegetation/" + asset, name=asset,
                      category="tree", usage_level=lod_name, files=[out],
                      license_block=lic, provenance=prov, recipe=recipe,
                      geometry=stats,
                      extra={"nodes": [n for n, _, _ in items],
                             "semantic_categories": {
                                 trunk_node: C.resolve_semantic(trunk_node),
                                 canopy_node: C.resolve_semantic(canopy_node)
                                 if canopy is not None else None}})
            rows.append({"asset": asset, "species": spec["name"], "lod": lod_name,
                         "faces": stats["faces"], "vertices": stats["vertices"],
                         "budget_faces": budget,
                         "within_budget": stats["faces"] <= budget,
                         "height_m": round(float(stats["bbox_max"][2]), 3),
                         "file": C.rel(out), "bytes": os.path.getsize(out)})
            variants.append({
                "variant": lod_name, "name": spec["name"],
                "usage_level": lod_name, "budget_faces": budget,
                "params": dict(spec), "lod": dict(lod),
                "outputs": [C.rel(out)],
            })
            print("[veg] %-26s lod=%-4s faces=%6d budget=%5d %s"
                  % (asset, lod_name, stats["faces"], budget,
                     "OK" if stats["faces"] <= budget else "OVER"))
        recipes.append({
            "species": spec["name"], "category": "tree",
            "semantic_category": "tree", "note": spec["note"],
            "variants": variants,
        })
    C.write_json(os.path.join(C.R4META, "vegetation_recipes.json"), {
        "kind": "r4_recipe", "schema": C.RECIPE_SCHEMA,
        "recipe_id": "vegetation_species", "category": "tree",
        "semantic_category": "tree",
        "note": ("6 个树种配方 × 三档 LOD（hero/mid/low）。"
                 "变体名即 LOD 档；面数预算按用途分级统一。"),
        "species": recipes,
    })
    C.write_json(os.path.join(C.R4META, "vegetation_lod_build.json"), {
        "kind": "r4_vegetation_lod", "items": rows,
        "total": len(rows),
        "all_within_budget": all(r["within_budget"] for r in rows),
    })
    return rows


# ================================================================== 载具
# 四车身共用骨架：12 站位 × 24 截面 + 固定部件集
CAR_STATIONS = 12
CAR_SECTIONS = 24
CABIN_RINGS = 5
CABIN_SECTIONS = 20
DOOR_ROWS_LEFT = (23, 0, 1, 2, 3, 4)
DOOR_ROWS_RIGHT = (13, 12, 11, 10, 9, 8)
DOOR_STATIONS = ((3, 5), (5, 7))
CAR_DOOR_OUT = 0.010
CAR_DOOR_IN = 0.002

# 车身配方：比例 + 顶线剖面（每站位顶高）+ 座舱跨度
VEHICLE_VARIANTS = [
    dict(name="sedan", length=4.30, width=1.80, clearance=0.16,
         roof=[0.62, 0.80, 1.02, 1.30, 1.45, 1.46, 1.42, 1.32, 1.18, 1.05, 0.98, 0.92],
         cabin=(3.0, 8.0), cabin_h=0.52,
         wheel_r=0.33, wheelbase=(1.36, -1.36), track=0.80),
    dict(name="hatch", length=3.95, width=1.75, clearance=0.15,
         roof=[0.60, 0.78, 1.02, 1.32, 1.48, 1.50, 1.48, 1.44, 1.36, 1.22, 1.05, 0.90],
         cabin=(3.0, 8.6), cabin_h=0.54,
         wheel_r=0.31, wheelbase=(1.25, -1.25), track=0.76),
    dict(name="suv", length=4.70, width=1.88, clearance=0.24,
         roof=[0.72, 0.96, 1.24, 1.52, 1.70, 1.74, 1.74, 1.72, 1.68, 1.60, 1.48, 1.34],
         cabin=(2.6, 8.4), cabin_h=0.58,
         wheel_r=0.37, wheelbase=(1.48, -1.48), track=0.82),
    dict(name="pickup", length=5.20, width=1.95, clearance=0.26,
         roof=[0.76, 1.02, 1.30, 1.58, 1.72, 1.74, 1.74, 1.10, 1.06, 1.06, 1.06, 1.02],
         cabin=(2.6, 6.6), cabin_h=0.56,
         wheel_r=0.39, wheelbase=(1.62, -1.62), track=0.86),
]


def _ring(x, half_w, z0, z1, sections=CAR_SECTIONS):
    """车身截面环（超椭圆，n=4）：固定点数 -> 四车身拓扑一致。"""
    t = np.linspace(0, 2 * np.pi, sections, endpoint=False)
    cy, sy = np.cos(t), np.sin(t)
    yy = half_w * np.sign(cy) * np.abs(cy) ** 0.5
    hh = (z1 - z0) * 0.5
    zz = hh * np.sign(sy) * np.abs(sy) ** 0.5 + (z0 + z1) * 0.5
    return np.column_stack([np.full_like(t, x), yy, zz])


def _width_profile(s):
    """车身横向收放：中间宽、两端收（s ∈ [-1,1]）。"""
    return 0.72 + 0.28 * math.cos(s * math.pi * 0.5) ** 0.6


def _car_body(v):
    """车身壳体：12 站位 × 24 截面的 loft（四车身同拓扑）。"""
    s_all = np.linspace(-1.0, 1.0, CAR_STATIONS)
    rings = []
    zcs = []
    for s, roof in zip(s_all, v["roof"]):
        x = float(s) * v["length"] * 0.5
        half_w = v["width"] * 0.5 * _width_profile(float(s))
        z0 = v["clearance"]
        rings.append(_ring(x, half_w, z0, roof))
        zcs.append((z0 + roof) * 0.5)
    body = loft(rings)
    return body, rings, s_all, zcs


def _car_cabin(v, s_all, zcs):
    """座舱：固定 5 环 × 20 截面（位置随配方移动 -> 拓扑不变）。"""
    a, b = v["cabin"]
    idx = np.linspace(a, b, CABIN_RINGS)
    rings = []
    for k, t in enumerate(idx):
        s = float(s_all[int(round(t))])
        x = s * v["length"] * 0.5
        frac = abs(k - (CABIN_RINGS - 1) / 2.0) / ((CABIN_RINGS - 1) / 2.0)
        half_w = v["width"] * 0.5 * _width_profile(s) * (0.92 - 0.10 * frac)
        belt = v["roof"][int(round(t))] - v["cabin_h"] * 0.92
        top = v["roof"][int(round(t))]
        tt = np.linspace(0, 2 * np.pi, CABIN_SECTIONS, endpoint=False)
        cy, sy = np.cos(tt), np.sin(tt)
        yy = half_w * np.sign(cy) * np.abs(cy) ** 0.72
        hh = (top - belt) * 0.5
        zz = hh * np.sign(sy) * np.abs(sy) ** 0.72 + (top + belt) * 0.5
        rings.append(np.column_stack([np.full_like(tt, x), yy, zz]))
    return loft(rings)


def _car_parts(v):
    """四车身共用的部件集：名字、数量、连接关系完全一致。"""
    from generate_assets import _panel_from_grid

    body, rings, s_all, zcs = _car_body(v)
    cabin = _car_cabin(v, s_all, zcs)
    parts = {"body": body, "cabin": cabin}

    # 车窗：独立薄板（不做布尔切口，白模要「可学的窗结构」而不是挖洞）
    cw = v["width"] * 0.5
    belt = min(v["roof"]) + v["cabin_h"] * 0.10
    parts["windshield"] = box((0.06, cw * 1.45, v["cabin_h"] * 0.80),
                              center=(v["length"] * 0.30, 0.0, belt + v["cabin_h"] * 0.38))
    parts["window_rear"] = box((0.06, cw * 1.30, v["cabin_h"] * 0.72),
                               center=(-v["length"] * 0.34, 0.0, belt + v["cabin_h"] * 0.36))
    parts["window_side_left"] = box((v["length"] * 0.46, 0.05, v["cabin_h"] * 0.66),
                                    center=(0.02, cw * 0.90, belt + v["cabin_h"] * 0.34))
    parts["window_side_right"] = box((v["length"] * 0.46, 0.05, v["cabin_h"] * 0.66),
                                     center=(0.02, -cw * 0.90, belt + v["cabin_h"] * 0.34))

    # 车门：从车身网格切出（沿法线加厚成闭合板）
    for (i0, i1), tag in zip(DOOR_STATIONS, ("front", "rear")):
        parts["door_%s_left" % tag] = _panel_from_grid(
            rings, zcs, i0, i1, DOOR_ROWS_LEFT, CAR_DOOR_OUT, CAR_DOOR_IN)
        parts["door_%s_right" % tag] = _panel_from_grid(
            rings, zcs, i0, i1, DOOR_ROWS_RIGHT, CAR_DOOR_OUT, CAR_DOOR_IN)

    # 车轮
    for sx, axle in zip(v["wheelbase"], ("front", "rear")):
        for sy, side in ((v["track"], "left"), (-v["track"], "right")):
            wheel = cylinder(v["wheel_r"], 0.22, sections=20)
            parts["wheel_%s_%s" % (axle, side)] = place(
                wheel, T(sx, sy, v["wheel_r"]) @ np.array(
                    [[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], float))
            hub = cylinder(v["wheel_r"] * 0.42, 0.24, sections=14)
            parts["wheel_%s_%s" % (axle, side)] = merge(
                [parts["wheel_%s_%s" % (axle, side)],
                 place(hub, T(sx, sy, v["wheel_r"]) @ np.array(
                     [[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], float))])

    # 后视镜
    for sy, side in ((v["width"] * 0.34, "left"), (-v["width"] * 0.34, "right")):
        parts["mirror_%s" % side] = box((0.09, 0.11, 0.05),
                                        center=(v["length"] * 0.18, sy, belt + v["cabin_h"] * 0.12))

    # 前后灯
    for sy, side in ((v["width"] * 0.25, "left"), (-v["width"] * 0.25, "right")):
        parts["headlight_%s" % side] = box(
            (0.05, 0.22, 0.10),
            center=(v["length"] * 0.485, sy, v["clearance"] + 0.22))
    for sy, side in ((v["width"] * 0.18, "left"), (-v["width"] * 0.18, "right")):
        parts["taillight_%s" % side] = box(
            (0.05, 0.16, 0.10),
            center=(-v["length"] * 0.485, sy, v["clearance"] + 0.24))

    # 内饰代理
    for sy, side in ((v["width"] * 0.18, "left"), (-v["width"] * 0.18, "right")):
        parts["seat_%s" % side] = box((0.44, 0.42, 0.46),
                                      center=(-v["length"] * 0.04, sy, v["clearance"] + 0.30))
    parts["dashboard"] = box((0.22, v["width"] * 0.72, 0.16),
                              center=(v["length"] * 0.14, 0.0, v["clearance"] + 0.32))
    sw = cylinder(0.15, 0.03, sections=18)
    parts["steering_wheel"] = place(
        sw, T(v["length"] * 0.10, -v["width"] * 0.18, v["clearance"] + 0.44) @ np.array(
            [[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], float))
    parts["chassis"] = box((v["length"] * 0.86, v["width"] * 0.70, 0.10),
                            center=(0.0, 0.0, v["clearance"] + 0.02))
    return parts


def gen_vehicles():
    rows = []
    topo = {}
    for v in VEHICLE_VARIANTS:
        parts = _car_parts(v)
        asset = "vehicle_car_%s" % v["name"]
        items = [(k, m, T(0, 0, 0)) for k, m in parts.items()]
        out = os.path.join(VEH_DIR, asset + ".glb")
        C.export_scene_glb(items, out)
        stats = C.scene_stats(items)
        budget = C.budget_for("hero")
        # 同拓扑判定：四车身的「面索引表」逐字节一致
        body_faces = np.asarray(parts["body"].faces, dtype=np.int64)
        import hashlib
        h = hashlib.sha256()
        h.update(b"body faces=%d verts=%d\n" % (body_faces.shape[0], len(parts["body"].vertices)))
        h.update(body_faces.tobytes())
        topo[asset] = h.hexdigest()
        lic = {
            "spdx": "LicenseRef-Proprietary",
            "source_url": None,
            "license_url": None,
            "attribution_required": True,
            "credit": "程序化生成（harness/r4_generate_assets.py，纯 CPU，无生成式模型）",
        }
        prov = {
            "origin": "procedural",
            "statement": "本仓库 harness 参数化生成（纯 CPU），非扫描、非 AI 生成",
            "source_url": None,
            "is_ai": 0,
            "generator": "harness/r4_generate_assets.py",
        }
        recipe = {"recipe_id": "vehicle_car_family", "variant": v["name"],
                  "params": {k: (list(x) if isinstance(x, tuple) else x)
                             for k, x in v.items()},
                  "topology": {"scope": "body",
                               "hash": topo[asset],
                               "stations": CAR_STATIONS,
                               "sections": CAR_SECTIONS}}
        C.sidecar(os.path.join(VEH_DIR, asset + ".json"),
                  asset_id="geometry/" + asset, name=asset, category="vehicle",
                  usage_level="hero", files=[out], license_block=lic,
                  provenance=prov, recipe=recipe, geometry=stats,
                  extra={"nodes": [n for n, _, _ in items],
                         "part_semantics": {k: C.resolve_semantic(k) for k in parts}})
        rows.append({"asset": asset, "variant": v["name"], "faces": stats["faces"],
                     "vertices": stats["vertices"], "budget_faces": budget,
                     "within_budget": stats["faces"] <= budget,
                     "parts": len(parts), "body_topology_hash": topo[asset],
                     "length_m": v["length"], "width_m": v["width"],
                     "height_m": round(float(stats["bbox_max"][2]), 3),
                     "file": C.rel(out), "bytes": os.path.getsize(out)})
        print("[veh] %-24s parts=%2d faces=%6d budget=%5d topo=%s"
              % (asset, len(parts), stats["faces"], budget, topo[asset][:12]))
    same = len(set(topo.values())) == 1
    # 语义零件库
    parts = _car_parts(VEHICLE_VARIANTS[0])
    part_lib = {}
    for k in parts:
        part_lib[k] = {
            "semantic_category": C.resolve_semantic(k),
            "count_per_body": 1,
            "present_in_variants": {v["name"]: (k in _car_parts(v)) for v in VEHICLE_VARIANTS},
        }
    C.write_json(os.path.join(C.R4META, "vehicle_car_parts.json"), {
        "kind": "r4_part_library", "schema": C.RECIPE_SCHEMA,
        "recipe_id": "vehicle_car_family", "category": "vehicle",
        "semantic_category": "vehicle",
        "note": ("载具语义零件库：部件名 -> conditions.resolve_category 语义类别。"
                 "四车身部件集一致（这是同拓扑的前提）。"),
        "parts": part_lib,
    })
    C.write_json(os.path.join(C.R4META, "vehicle_car_recipe.json"), {
        "kind": "r4_recipe", "schema": C.RECIPE_SCHEMA,
        "recipe_id": "vehicle_car_family", "category": "vehicle",
        "semantic_category": "vehicle",
        "note": ("载具四车身同拓扑配方：站位数/截面数/部件集固定，只换顶点坐标。"
                 "body 顶点拓扑哈希四件一致才算通过。"),
        "topology": {"scope": "body", "stations": CAR_STATIONS,
                     "sections": CAR_SECTIONS,
                     "hash": topo["vehicle_car_%s" % VEHICLE_VARIANTS[0]["name"]],
                     "all_variants_identical": same},
        "variants": [
            {"variant": v["name"], "name": "car",
             "usage_level": "hero", "budget_faces": C.budget_for("hero"),
             "params": {k: (list(x) if isinstance(x, tuple) else x) for k, x in v.items()},
             "outputs": [C.rel(os.path.join(VEH_DIR, "vehicle_car_%s.glb" % v["name"]))],
             "body_topology_hash": topo["vehicle_car_%s" % v["name"]]}
            for v in VEHICLE_VARIANTS],
    })
    C.write_json(os.path.join(C.R4META, "vehicle_topology_build.json"), {
        "kind": "r4_vehicle_topology", "items": rows,
        "body_topology_hashes": topo,
        "all_variants_identical": same,
    })
    if not same:
        raise SystemExit("四车身拓扑哈希不一致：%s" % topo)
    return rows


# 4 类动力学预设：每种车身一套（与 vehicle_dynamics.py 的参数词表对齐）
DYNAMICS_PRESETS = [
    dict(variant="sedan", mass_kg=1380, max_speed_mps=48.0, power_kw=110,
         steer_max_deg=32.0, drag_coeff=0.31, brake_decel_mps2=9.5,
         wheel_radius_m=0.33, note="轿车：均衡，胎噪低，转向轻"),
    dict(variant="hatch", mass_kg=1180, max_speed_mps=44.0, power_kw=82,
         steer_max_deg=36.0, drag_coeff=0.33, brake_decel_mps2=9.0,
         wheel_radius_m=0.31, note="两厢：轻，转向灵，制动略弱"),
    dict(variant="suv", mass_kg=1860, max_speed_mps=42.0, power_kw=140,
         steer_max_deg=28.0, drag_coeff=0.36, brake_decel_mps2=8.5,
         wheel_radius_m=0.37, note="SUV：重心高，俯仰大，侧倾抑制弱"),
    dict(variant="pickup", mass_kg=2240, max_speed_mps=38.0, power_kw=160,
         steer_max_deg=26.0, drag_coeff=0.42, brake_decel_mps2=7.5,
         wheel_radius_m=0.39, note="皮卡：载重，惯性大，制动距离最长"),
]


def gen_vehicle_dynamics():
    """4 类动力学预设 -> assets/nongeometry/r4_vehicle_dynamics.json。

    参数词表与 harness/vehicle_dynamics.py 保持一致（wheel_radius_m /
    brake_accel_threshold_mps2 / turn_signal_* / suspension_tau_s /
    pitch_gain / roll_gain），这样下游读同一套字段名，不用再翻译一遍。
    """
    presets = []
    for p in DYNAMICS_PRESETS:
        row = dict(p)
        row.update({
            "wheelbase_m": None,
            "brake_accel_threshold_mps2": -2.0,
            "turn_signal_yaw_rate_degps": 8.0,
            "turn_signal_hz": 1.2,
            "suspension_tau_s": 0.25,
            "pitch_gain_deg_per_mps2": 1.0,
            "roll_gain_deg_per_mps2": 0.45,
        })
        presets.append(row)
    for v in VEHICLE_VARIANTS:
        wb = v["wheelbase"]
        for row in presets:
            if row["variant"] == v["name"]:
                row["wheelbase_m"] = round(float(wb[0] - wb[1]), 3)
                row["track_m"] = round(float(v["track"] * 2), 3)
                row["dimensions_m"] = [v["length"], v["width"], round(v["roof"][4], 3)]
    doc = {
        "kind": "r4_vehicle_dynamics",
        "note": ("R4 载具四类动力学预设。字段名与 harness/vehicle_dynamics.py 的"
                 "参数词表对齐，下游可直接消费；未做动力仿真，纯参数预设。"),
        "asset": "vehicle_car_family",
        "fps": 24,
        "presets": presets,
    }
    out = os.path.join(ROOT, "assets", "nongeometry", "r4_vehicle_dynamics.json")
    C.write_json(out, doc)
    print("[dyn] %d 类动力学预设 -> %s" % (len(presets), C.rel(out)))
    return presets


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="R4 资产生成：植被 / 载具")
    ap.add_argument("--vegetation", action="store_true")
    ap.add_argument("--vehicles", action="store_true")
    ap.add_argument("--dynamics", action="store_true")
    args = ap.parse_args()
    if args.vegetation:
        gen_vegetation()
    if args.vehicles:
        gen_vehicles()
    if args.dynamics:
        gen_vehicle_dynamics()
