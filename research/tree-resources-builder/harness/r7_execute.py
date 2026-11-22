# R7 执行器：把 JSON 配方**确定性**地执行成几何（纯 CPU、无生成式模型）。
#
# 口径
# ----
# * 执行器只认配方里的参数，不认模型说什么：同一份配方 → 同一个网格
#   （judge 里的 DETERMINISM 检查会跑两遍对哈希）；
# * 几何一律走仓库既有的确定性生成器（R4 的植被/载具/人物生成器 + R4 的
#   街区块装配），不在 R7 里另立一套建模口径；
# * 道具走 R4 已落盘的 Kenney/Poly Haven 源件：配方给的是「缩放系数 +
#   目标最大边长」，执行 = 等比缩放既有源件（不重新下载、不重新生成）；
# * 产物只在内存里：R7 不往 R0–R5 的资产目录写任何文件。
from __future__ import annotations

import os
from typing import Any

import numpy as np
import trimesh

import r4_generate_assets as GA
import r4_generate_characters as GC
import r4_generate_scenes as GS
from geomlib import T, box, merge

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GEO = os.path.join(ROOT, "assets", "geometry")

#: 场景块常量（与 R4 一致）
BLOCK_LEN = GS.BLOCK_LEN
BLOCK_HALF_Y = 23.0
ROAD_HALF = GS.ROAD_HALF
SW_INNER = GS.SW_INNER
SW_OUTER = GS.SW_OUTER
BUILD_Y = GS.BUILD_Y

#: 场景里摆的固定公共件/车型/人物（R4 台账里的既有资产，不下载）
SCENE_PROP = "prop_cone_traffic"   # 小件（0.6 m 见方），不挡路面车流
SCENE_TREE_SPEC = dict(GA.SPECIES[0])
SCENE_TREE_LOD = GA.LODS["mid"]
SCENE_CAR = dict(GA.VEHICLE_VARIANTS[0])
SCENE_CHAR = dict(GC.CHAR_VARIANTS[2])


def _aabb(mesh) -> list[list[float]]:
    lo, hi = mesh.bounds
    return [[round(float(v), 4) for v in lo], [round(float(v), 4) for v in hi]]


def _topology_hash(mesh) -> str:
    import hashlib

    faces = np.asarray(mesh.faces, dtype=np.int64)
    h = hashlib.sha256()
    h.update(b"faces=%d,verts=%d\n" % (faces.shape[0], len(mesh.vertices)))
    h.update(faces.tobytes())
    return h.hexdigest()


def _merge(parts: dict[str, Any]) -> trimesh.Trimesh:
    meshes = [m for m in parts.values() if m is not None and hasattr(m, "faces")]
    if not meshes:
        raise ValueError("没有可合并的网格")
    return merge(meshes)


# ------------------------------------------------------------------ 分类执行

def _exec_prop(task, params):
    src = os.path.join(ROOT, task["source"]["prop_glb"])
    mesh = trimesh.load(src, force="mesh", process=False)
    scale = float(params.get("scale_factor") or 1.0)
    mesh = mesh.copy()
    mesh.apply_scale(scale)
    parts = {"prop": mesh}
    return {"parts": parts, "instances": [{"name": "prop", "aabb": _aabb(mesh),
                                           "layer": "above"}],
            "meta": {"source": os.path.relpath(src, ROOT), "scale": scale}}


def _exec_tree(task, params):
    spec = {
        "name": str(params.get("name") or "tree"),
        "height": float(params.get("height") or 5.0),
        "trunk_r": float(params.get("trunk_r") or 0.2),
        "canopy_r": float(params.get("canopy_r") or 2.0),
        "canopy_h": float(params.get("canopy_h") or 2.0),
        "shape": str(params.get("shape") or "round"),
        "branches": int(params.get("branches") or 3),
        "levels": int(params.get("levels") or 3),
        "seed": int(params.get("seed") or 11),
    }
    lod_raw = params.get("lod") or {}
    lod = {
        "segments": int(lod_raw.get("segments") or 6),
        "levels": int(lod_raw.get("levels") or 2),
        "canopy_blobs": int(lod_raw.get("canopy_blobs") or 4),
        "canopy_subdiv": int(lod_raw.get("canopy_subdiv") or 1),
        "branch_ratio": float(lod_raw.get("branch_ratio") or 0.38),
    }
    trunk, tips = GA._grow_branches(spec, lod, spec["seed"])
    canopy = GA._canopy_mesh(spec, lod, tips)
    parts = {"trunk": trunk}
    if canopy is not None:
        parts["canopy"] = canopy
    return {"parts": parts,
            "instances": [{"name": k, "aabb": _aabb(v), "layer": "above"}
                          for k, v in parts.items()],
            "meta": {"spec": spec, "lod": lod}}


def _exec_vehicle(task, params):
    roof = [float(x) for x in (params.get("roof") or [])]
    cabin = [float(x) for x in (params.get("cabin") or [3.0, 8.0])]
    wheelbase = [float(x) for x in (params.get("wheelbase") or [1.3, -1.3])]
    v = {
        "name": str(params.get("name") or "car"),
        "length": float(params.get("length") or 4.3),
        "width": float(params.get("width") or 1.8),
        "clearance": float(params.get("clearance") or 0.16),
        "roof": roof,
        "cabin": cabin,
        "cabin_h": float(params.get("cabin_h") or 0.52),
        "wheel_r": float(params.get("wheel_r") or 0.33),
        "wheelbase": wheelbase,
        "track": float(params.get("track") or 0.80),
    }
    parts = GA._car_parts(v)
    return {"parts": parts,
            "instances": [{"name": k, "aabb": _aabb(m), "layer": "above"}
                          for k, m in parts.items()],
            "meta": {"params": v}}


def _exec_character(task, params):
    v = {
        "name": str(params.get("name") or "hero"),
        "variant": str(params.get("variant") or "base"),
        "height": float(params.get("height") or 1.75),
        "torso": float(params.get("torso") or 1.0),
        "shoulder": float(params.get("shoulder") or 1.0),
        "hip": float(params.get("hip") or 1.0),
        "limb": float(params.get("limb") or 1.0),
        "head": float(params.get("head") or 1.0),
    }
    parts, joints = GC._build_body(v)
    jacket = GC._build_jacket(v, joints)
    out = {}
    for k, m in parts.items():
        out["body_" + k] = m
    for k, m in jacket.items():
        out["jacket_" + k] = m
    return {"parts": out,
            "instances": [{"name": k, "aabb": _aabb(m), "layer": "above"}
                          for k, m in out.items()],
            "meta": {"params": v}}


def _exec_scene(task, params):
    floors = max(1, int(params.get("floors") or 4))
    width = float(params.get("width") or 10.0)
    depth = float(params.get("depth") or 8.0)
    building_count = max(1, int(params.get("building_count") or 6))
    tree_count = max(0, int(params.get("tree_count") or 0))
    prop_count = max(0, int(params.get("prop_count") or 0))
    vehicle_count = max(0, int(params.get("vehicle_count") or 0))
    char_count = max(0, int(params.get("char_count") or 0))
    seed = int(params.get("seed") or 13)

    placer = GS.Placer()
    parts: dict[str, Any] = {}
    instances: list[dict[str, Any]] = []

    def place(name, mesh, candidates, collide=True, layer="above"):
        moved, cand = placer.place([(name, mesh)], list(candidates), collide=collide)
        if moved is None:
            return None
        cx, cy, cyaw = cand
        m = mesh.copy()
        m.apply_transform(T(cx, cy, 0.0) @ GS._yaw_mat(cyaw))
        parts[name] = m
        instances.append({"name": name, "aabb": _aabb(m), "layer": layer})
        return m

    # 地面层：顶面统一 z=0（与 R4 街区块同口径）
    place("ground_block", box((BLOCK_LEN, BLOCK_HALF_Y * 2, 0.20),
                              center=(0, 0, -0.10)), [(0, 0, 0.0)],
          collide=False, layer="ground")
    place("road_block", box((BLOCK_LEN, ROAD_HALF * 2, 0.06),
                            center=(0, 0, -0.03)), [(0, 0, 0.0)],
          collide=False, layer="ground")
    for side, sy in (("south", -1.0), ("north", 1.0)):
        place("sidewalk_block_%s" % side,
              box((BLOCK_LEN, SW_OUTER - SW_INNER, 0.12),
                  center=(0, sy * (SW_OUTER + SW_INNER) / 2, -0.06)),
              [(0, 0, 0.0)], collide=False, layer="ground")

    # 楼体：南北两排（每排 building_count/2 栋）
    per_side = max(1, (building_count + 1) // 2)
    for side, sy in (("south", -1.0), ("north", 1.0)):
        for i in range(per_side):
            x = -BLOCK_LEN / 2 + 12.0 + i * 20.0
            mesh, _h = GS._building(floors, width, depth, True)
            place("building_%s_%d" % (side, i), mesh,
                  [(x, sy * BUILD_Y, 0.0), (x + 1.5, sy * BUILD_Y, 0.0),
                   (x - 1.5, sy * BUILD_Y, 0.0)])

    # 行道树：北侧人行道（冠层悬到路面上方，避开楼体与南侧公共件）
    trunk, tips = GA._grow_branches(SCENE_TREE_SPEC, SCENE_TREE_LOD, seed)
    canopy = GA._canopy_mesh(SCENE_TREE_SPEC, SCENE_TREE_LOD, tips)
    tree_parts = {"trunk": trunk}
    if canopy is not None:
        tree_parts["canopy"] = canopy
    tree_mesh = merge(list(tree_parts.values()))
    for i in range(tree_count):
        x = -BLOCK_LEN / 2 + 8.0 + i * (BLOCK_LEN - 16.0) / max(1, tree_count)
        place("tree_%d" % i, tree_mesh,
              [(x, 5.0, 0.3 * i), (x + 1.2, 5.0, 0.0), (x - 1.2, 5.0, 0.0),
               (x, 5.6, 0.0)])

    # 公共件：南侧人行道
    prop_mesh = trimesh.load(os.path.join(GEO, "props", SCENE_PROP + ".glb"),
                              force="mesh", process=False)
    for i in range(prop_count):
        x = -BLOCK_LEN / 2 + 14.0 + i * (BLOCK_LEN - 28.0) / max(1, prop_count)
        place("prop_%d" % i, prop_mesh,
              [(x, -5.6, 0.0), (x + 1.0, -5.6, 0.0), (x - 1.0, -5.6, 0.0),
               (x, -4.4, 0.0)])

    # 车：路面
    car_parts = GA._car_parts(SCENE_CAR)
    car_mesh = merge(list(car_parts.values()))
    for i in range(vehicle_count):
        x = -18.0 + i * 14.0
        place("vehicle_%d" % i, car_mesh,
              [(x, 0.0, 0.0), (x + 2.0, 0.0, 0.0), (x - 2.0, 0.0, 0.0)])

    # 人：南侧路缘
    char_parts, _j = GC._build_body(SCENE_CHAR)
    char_mesh = merge(list(char_parts.values()))
    for i in range(char_count):
        x = -12.0 + i * 9.0
        place("char_%d" % i, char_mesh,
              [(x, -3.4, 0.0), (x + 1.2, -3.4, 0.0), (x - 1.2, -3.4, 0.0)])

    return {"parts": parts, "instances": instances,
            "meta": {"floors": floors, "width": width, "depth": depth,
                     "seed": seed}}


# ------------------------------------------------------------------ 入口

EXECUTORS = {
    "prop": _exec_prop,
    "tree": _exec_tree,
    "vehicle": _exec_vehicle,
    "scene": _exec_scene,
    "character": _exec_character,
}


def execute(task: dict[str, Any], recipe: dict[str, Any]) -> dict[str, Any]:
    """执行一份配方。返回 {ok, parts, instances, meta} 或 {ok: False, error}。"""
    category = task.get("category")
    fn = EXECUTORS.get(category)
    if fn is None:
        return {"ok": False, "error": "没有该类别的执行器：%s" % category}
    params = recipe.get("params") if isinstance(recipe, dict) else None
    if not isinstance(params, dict):
        return {"ok": False, "error": "配方里没有 params"}
    try:
        out = fn(task, params)
    except Exception as exc:
        return {"ok": False, "error": "%s: %s" % (type(exc).__name__, str(exc)[:200])}
    try:
        merged = _merge(out["parts"])
    except Exception as exc:
        return {"ok": False, "error": "合并失败 %s: %s" % (type(exc).__name__, str(exc)[:160])}
    out["ok"] = True
    out["merged"] = merged
    out["metrics"] = {
        "faces": int(len(merged.faces)),
        "vertices": int(len(merged.vertices)),
        "parts": len(out["parts"]),
        "topology_hash": _topology_hash(merged),
        "bbox_min": [round(float(v), 4) for v in merged.bounds[0]],
        "bbox_max": [round(float(v), 4) for v in merged.bounds[1]],
    }
    return out


def execute_deterministic(task: dict[str, Any], recipe: dict[str, Any]) -> dict[str, Any]:
    """跑两遍并对比：证明「同配方 → 同几何」。"""
    a = execute(task, recipe)
    b = execute(task, recipe)
    if not (a.get("ok") and b.get("ok")):
        return {"ok": False, "built": a, "same": False,
                "error": a.get("error") or b.get("error") or "执行失败"}
    same = (a["metrics"]["topology_hash"] == b["metrics"]["topology_hash"]
            and a["metrics"]["faces"] == b["metrics"]["faces"]
            and a["metrics"]["bbox_min"] == b["metrics"]["bbox_min"]
            and a["metrics"]["bbox_max"] == b["metrics"]["bbox_max"])
    return {"ok": True, "built": a, "same": same,
            "hash_a": a["metrics"]["topology_hash"],
            "hash_b": b["metrics"]["topology_hash"]}
