# R4 资产生成器（三）：3 种街区 + 分块 LOD + 公共件混排。

"""口径来自 r4_common；场景内节点名沿用 conditions.resolve_category 的前缀词表
（ground/road/sidewalk/building/prop/tree/tree_canopy/vehicle/hero/jacket）。

分块 LOD
--------
一个街区沿 X 切成 3 块：near / mid / far。
  near：完整楼体（层线 + 窗带）+ 公共件 + 树 + 车 + 人
  mid ：简化楼体（无窗带）+ 公共件 + 树（mid 档）+ 车 + 人
  far ：最简楼体 + 低档树 + 少量公共件
远块刻意减面：白模路线的远景只需要占位体量。

混排纪律
--------
* 地面/道路/路缘的顶面统一在 z=0，其余实例底面也落在 z=0 -> 贴地偏移 = 0。
* 摆位走「成组 AABB 判重叠 + 候选位兜底」的确定性算法 -> 无穿插。
* 同一资产的多部件（车 25 件、人 23 件、树 2 件）成组判重叠，否则会自己撞自己。
* 公共件（Kenney 归一化件）与人/车/树/楼同场混排，这是 R4 的验收④。

纯 CPU、纯参数化几何：不跑生成式模型、不下模型权重、不引 Blender。
"""
from __future__ import annotations

import argparse
import os

import numpy as np
import trimesh

import r4_common as C
import r4_generate_assets as GA
import r4_generate_characters as GC
from geomlib import T, box, merge

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GEO = os.path.join(ROOT, "assets", "geometry")
VEG_DIR = os.path.join(GEO, "vegetation")
PROPS_DIR = os.path.join(GEO, "props")

BLOCK_LEN = 64.0
ROAD_HALF = 3.5
SW_INNER = 4.2
SW_OUTER = 6.4
BUILD_Y = 15.0

BLOCKS = [
    dict(name="downtown", floors=(9, 12), width=(10.0, 13.0), depth=9.0,
         trees=["oak_broad", "maple_wide"],
         props=["prop_pole_utility", "prop_dumpster_street", "prop_sign_empty",
                "prop_ladder_wood"],
         vehicles=["sedan", "suv"], chars=["hero_worker_broad", "hero_office_slim"],
         note="商业主街：高楼 + 密集公共件"),
    dict(name="residential", floors=(4, 6), width=(8.0, 10.0), depth=7.5,
         trees=["birch_slim", "oak_broad"],
         props=["prop_fence_wood", "prop_barrel_wood", "prop_cone_traffic",
                "prop_tool_hammer"],
         vehicles=["hatch"], chars=["hero_student_short", "hero_elder_stout"],
         note="住宅街：低层 + 绿化"),
    dict(name="industrial", floors=(3, 4), width=(14.0, 18.0), depth=11.0,
         trees=["dead_bare", "pine_conical"],
         props=["prop_dumpster_street", "prop_barrier_construction",
                "prop_pipe_metal", "prop_tool_axe"],
         vehicles=["pickup"], chars=["hero_vendor_lean", "hero_courier_slim"],
         note="工业区：厂房 + 围挡 + 裸树"),
]


def _building(floors, w, d, detail=True):
    """楼体：主体 + 层线 + 窗带（detail=False 时只留体量，供远块用）。"""
    fh = 3.2
    total = floors * fh
    parts = [box((w, d, total), center=(0, 0, total / 2))]
    if detail:
        for i in range(1, floors):
            parts.append(box((w + 0.28, d + 0.28, 0.22), center=(0, 0, i * fh)))
        for x in (-w / 2, 0.0, w / 2):
            for y in (-d / 2, d / 2):
                parts.append(box((0.16, 0.16, total), center=(x, y, total / 2)))
        for y in (-d / 2, 0.0, d / 2):
            for x in (-w / 2, w / 2):
                parts.append(box((0.16, 0.16, total), center=(x, y, total / 2)))
    parts.append(box((w + 0.40, d + 0.40, 0.30), center=(0, 0, total + 0.10)))
    return merge(parts), total + 0.25


def _load_prop(asset):
    return trimesh.load(os.path.join(PROPS_DIR, asset + ".glb"),
                        force="mesh", process=False)


def _spec_by_name(name):
    for s in GA.SPECIES:
        if s["name"] == name:
            return s
    raise KeyError(name)


def _char_by_name(asset):
    for v in GC.CHAR_VARIANTS:
        if "hero_%s_%s" % (v["name"], v["variant"]) == asset:
            return v
    raise KeyError(asset)


def _yaw_mat(yaw):
    a = np.radians(yaw)
    return np.array([[np.cos(a), -np.sin(a), 0, 0],
                      [np.sin(a), np.cos(a), 0, 0],
                      [0, 0, 1, 0], [0, 0, 0, 1]], float)


class Placer:
    """确定性摆位：成组算 AABB，组间重叠就换候选位（保证无穿插）。"""

    def __init__(self, margin=0.05):
        self.items = []
        self.boxes = []
        self.margin = margin

    def _try_at(self, named_meshes, x, y, z, yaw, check=True):
        tf = T(x, y, z) @ _yaw_mat(yaw)
        moved = []
        lo = np.array([1e9] * 3)
        hi = np.array([-1e9] * 3)
        for name, mesh in named_meshes:
            m = mesh.copy()
            m.apply_transform(tf)
            # 导出时用「原网格 + 变换」，不要用已变换的网格再叠一次变换
            # （叠加会让世界里每个实例的位置翻倍）。
            moved.append((name, mesh, tf))
            blo, bhi = m.bounds
            lo = np.minimum(lo, blo)
            hi = np.maximum(hi, bhi)
        if check:
            for (blo, bhi) in self.boxes:
                ov = np.minimum(hi, bhi) - np.maximum(lo, blo)
                if ov[0] > self.margin and ov[1] > self.margin and ov[2] > self.margin:
                    return None
        self.items.extend(moved)
        if check:
            self.boxes.append((lo, hi))
        return moved

    def place(self, named_meshes, candidates, collide=True):
        """candidates: [(x, y, yaw)]，按序取第一个不与已摆件重叠的位。

        collide=False 用于地面层（地面/道路/路缘）：它们本来就是叠放的板，
        互判穿插会把整块地都判掉；地面层顶面统一在 z=0，不与地上物相交。
        """
        if not collide:
            for cand in candidates:
                x, y, yaw = cand
                out = self._try_at(named_meshes, x, y, 0.0, yaw, check=False)
                if out is not None:
                    return out, cand
            return None, None
        for cand in candidates:
            x, y, yaw = cand
            out = self._try_at(named_meshes, x, y, 0.0, yaw)
            if out is not None:
                return out, cand
        return None, None


def _chunk_of(x):
    if x < -BLOCK_LEN / 6.0:
        return "near"
    if x < BLOCK_LEN / 6.0:
        return "mid"
    return "far"


def _tree_lod_for(chunk):
    return {"near": "hero", "mid": "mid", "far": "low"}[chunk]


def gen_scene(block):
    """生成一个街区：返回 (items, 实例表)。"""
    placer = Placer()
    name = block["name"]
    instances = []

    # 地面 / 道路 / 路缘（顶面统一 z=0）
    placer.place([("ground_block_%s" % name,
                   box((BLOCK_LEN, 46.0, 0.20), center=(0, 0, -0.10)))], [(0, 0, 0)],
                  collide=False)
    placer.place([("road_block_%s" % name,
                   box((BLOCK_LEN, ROAD_HALF * 2, 0.06), center=(0, 0, -0.03)))],
                  [(0, 0, 0)], collide=False)
    for side, sy in (("south", -1.0), ("north", 1.0)):
        placer.place([("sidewalk_block_%s_%s" % (name, side),
                       box((BLOCK_LEN, SW_OUTER - SW_INNER, 0.12),
                           center=(0, sy * (SW_OUTER + SW_INNER) / 2, -0.06)))],
                      [(0, 0, 0)], collide=False)

    # 楼体：两侧各 3 栋，按 X 分块给不同细节档
    idx = 0
    for side, sy in (("south", -1.0), ("north", 1.0)):
        for i in range(3):
            idx += 1
            x = -BLOCK_LEN / 2 + 12.0 + i * 20.0
            floors = int(block["floors"][0]
                         + (block["floors"][1] - block["floors"][0]) * (i / 2.0))
            w = float(block["width"][0]
                      + (block["width"][1] - block["width"][0]) * ((i % 2) / 1.0))
            chunk = _chunk_of(x)
            detail = chunk != "far"
            mesh, h = _building(floors, w, block["depth"], detail)
            node = "building_block_%s_%02d" % (name, idx)
            placed, cand = placer.place([(node, mesh)], [(x, sy * BUILD_Y, 0.0)])
            if placed is None:
                continue
            instances.append({"instance": node, "kind": "building", "chunk": chunk,
                              "lod": "hero" if detail else "low", "asset": node,
                              "group": "%s@%.1f,%.1f" % (node, cand[0], cand[1]),
                              "transform": [cand[0], cand[1], 0.0],
                              "faces": int(len(mesh.faces)), "height_m": round(h, 2)})

    # 树：沿路缘种，块位决定 LOD 档（分块 LOD）
    species_cycle = block["trees"]
    tree_x = [-24.0, -8.0, 8.0, 24.0]
    for i, x in enumerate(tree_x):
        spec = _spec_by_name(species_cycle[i % len(species_cycle)])
        chunk = _chunk_of(x)
        lod = _tree_lod_for(chunk)
        trunk, tips = GA._grow_branches(spec, GA.LODS[lod], spec["seed"] + len(lod))
        canopy = GA._canopy_mesh(spec, GA.LODS[lod], tips)
        named = [("tree_%s_%s_trunk" % (spec["name"], lod), trunk)]
        if canopy is not None:
            named.append(("tree_canopy_%s_%s" % (spec["name"], lod), canopy))
        cands = []
        for dx in (0.0, 1.8, -1.8, 3.6, -3.6, 5.4, -5.4):
            for sy in (1.0, -1.0):
                cands.append((x + dx, sy * (SW_INNER + 0.9), 0.0))
        placed, cand = placer.place(named, cands)
        if placed is None:
            continue
        for node, mesh, _ in placed:
            kind = "foliage" if node.startswith("tree_canopy_") else "tree"
            instances.append({"instance": node, "kind": kind, "chunk": chunk,
                              "lod": lod,
                              "group": "tree_%s_%s@%.1f,%.1f" % (spec["name"], lod, cand[0], cand[1]),
                              "asset": "tree_%s_%s" % (spec["name"], lod),
                              "transform": [cand[0], cand[1], 0.0],
                              "faces": int(len(mesh.faces))})

    # 公共件（Kenney 归一化件）：人行道外侧
    prop_x = [-20.0, -6.5, 6.5, 20.0]
    for i, prop in enumerate(block["props"]):
        mesh = _load_prop(prop)
        x = prop_x[i % len(prop_x)]
        chunk = _chunk_of(x)
        cands = []
        for dx in (0.0, 1.6, -1.6, 3.2, -3.2):
            for sy in (1.0, -1.0):
                cands.append((x + dx, sy * (SW_OUTER - 0.8), 90.0 * (i % 4)))
        placed, cand = placer.place([(prop, mesh)], cands)
        if placed is None:
            continue
        instances.append({"instance": prop, "kind": "prop", "chunk": chunk,
                          "lod": "low", "asset": prop,
                          "group": "%s@%.1f,%.1f" % (prop, cand[0], cand[1]),
                          "transform": [cand[0], cand[1], 0.0],
                          "faces": int(len(mesh.faces))})

    # 载具：路上两车道
    veh_x = [-20.0, 6.5]
    for i, var in enumerate(block["vehicles"]):
        v = [vv for vv in GA.VEHICLE_VARIANTS if vv["name"] == var][0]
        parts = GA._car_parts(v)
        named = [("%s_%s" % ("vehicle_car_%s" % var, pname), mesh)
                 for pname, mesh in parts.items()]
        x = veh_x[i % len(veh_x)]
        chunk = _chunk_of(x)
        yaw = 0.0 if i % 2 == 0 else 180.0
        cands = []
        for dx in (0.0, 4.0, -4.0, 8.0, -8.0):
            for y in (1.55, -1.55):
                cands.append((x + dx, y, yaw))
        placed, cand = placer.place(named, cands)
        if placed is None:
            continue
        for node, mesh, _ in placed:
            instances.append({"instance": node, "kind": "vehicle", "chunk": chunk,
                              "lod": "hero", "asset": "vehicle_car_%s" % var,
                              "group": "vehicle_car_%s@%.1f,%.1f" % (var, cand[0], cand[1]),
                              "transform": [cand[0], cand[1], 0.0], "yaw_deg": yaw,
                              "faces": int(len(mesh.faces))})

    # 人物：人行道靠路缘
    char_x = [-26.0, -13.0, 13.0, 26.0]
    for i, asset in enumerate(block["chars"]):
        cv = _char_by_name(asset)
        parts, j = GC._build_body(cv)
        jacket = GC._build_jacket(cv, j)
        named = [("%s_%s" % (asset, pname), mesh) for pname, mesh in parts.items()]
        for jname, jmesh in jacket.items():
            named.append(("jacket_%s_%s" % (asset, jname), jmesh))
        x = char_x[i % len(char_x)]
        chunk = _chunk_of(x)
        cands = []
        for dx in (0.0, 2.0, -2.0, 4.0, -4.0):
            for y in (-4.0, 4.0):
                cands.append((x + dx, y, (15.0 * i) % 360.0))
        placed, cand = placer.place(named, cands)
        if placed is None:
            continue
        for node, mesh, _ in placed:
            kind = "clothing" if node.startswith("jacket_") else "character"
            instances.append({"instance": node, "kind": kind, "chunk": chunk,
                              "lod": cv["level"],
                              "group": "%s@%.1f,%.1f" % (asset, cand[0], cand[1]),
                              "asset": "jacket_%s_body" % asset if kind == "clothing" else asset,
                              "transform": [cand[0], cand[1], 0.0],
                              "faces": int(len(mesh.faces))})
    return placer.items, instances


def gen_scenes():
    rows = []
    all_instances = []
    veg_instances = []
    for block in BLOCKS:
        items, instances = gen_scene(block)
        asset = "scene_block_%s" % block["name"]
        out = os.path.join(GEO, asset + ".glb")
        C.export_scene_glb(items, out)
        stats = C.scene_stats(items)
        lic = {
            "spdx": "LicenseRef-Proprietary",
            "source_url": None,
            "license_url": None,
            "attribution_required": True,
            "credit": "程序化生成（harness/r4_generate_scenes.py，纯 CPU，无生成式模型）",
        }
        prov = {
            "origin": "procedural",
            "statement": "本仓库 harness 参数化生成并混排公共件（纯 CPU）",
            "source_url": None,
            "is_ai": 0,
            "generator": "harness/r4_generate_scenes.py",
        }
        recipe = {"recipe_id": "scene_blocks", "variant": block["name"],
                  "params": {k: v for k, v in block.items() if k != "name"},
                  "chunks": ["near", "mid", "far"]}
        C.sidecar(os.path.join(GEO, asset + ".json"),
                  asset_id="geometry/" + asset, name=asset, category="scene",
                  usage_level="hero", files=[out], license_block=lic,
                  provenance=prov, recipe=recipe, geometry=stats,
                  extra={"nodes": [n for n, _, _ in items],
                         "instances": len(instances),
                         "note": block["note"]})
        for inst in instances:
            inst["scene"] = asset
        all_instances.extend(instances)
        veg_instances.extend([i for i in instances if i["kind"] in ("tree", "foliage")])
        rows.append({"asset": asset, "instances": len(instances),
                     "faces": stats["faces"], "nodes": len(items),
                     "ground_offset_m": stats["ground_offset_m"],
                     "bbox_m": [stats["bbox_min"], stats["bbox_max"]],
                     "kinds": sorted({i["kind"] for i in instances}),
                     "file": C.rel(out), "bytes": os.path.getsize(out)})
        print("[scene] %-24s nodes=%3d faces=%7d instances=%3d"
              % (asset, len(items), stats["faces"], len(instances)))
    C.write_json(os.path.join(C.R4META, "vegetation_instances.json"), {
        "kind": "r4_instance_table", "schema": C.RECIPE_SCHEMA,
        "recipe_id": "vegetation_instances", "category": "tree",
        "semantic_category": "tree",
        "note": "植被实例化表：树种 × LOD 档 × 街区 × 变换（分块 LOD 随块走）。",
        "instances": veg_instances,
    })
    C.write_json(os.path.join(C.R4META, "scene_instances.json"), {
        "kind": "r4_instance_table", "schema": C.RECIPE_SCHEMA,
        "recipe_id": "scene_mix_instances",
        "note": "三个街区的全量实例表（楼/树/冠/公共件/车/人/服装壳）。",
        "instances": all_instances,
    })
    C.write_json(os.path.join(C.R4META, "scene_blocks.json"), {
        "kind": "r4_scene_blocks", "schema": C.RECIPE_SCHEMA,
        "recipe_id": "scene_blocks",
        "note": "三种街区配方：分块（near/mid/far）→ 分块 LOD 档。",
        "blocks": [{"variant": b["name"],
                    "params": {k: v for k, v in b.items() if k != "name"},
                    "outputs": [C.rel(os.path.join(GEO, "scene_block_%s.glb" % b["name"]))]}
                   for b in BLOCKS],
    })
    return rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="R4 资产生成：街区场景")
    ap.add_argument("--scenes", action="store_true")
    args = ap.parse_args()
    if args.scenes:
        gen_scenes()
