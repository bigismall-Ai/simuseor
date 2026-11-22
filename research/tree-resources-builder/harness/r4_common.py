# R4 共享口径模块：命名规范、用途分级、面数预算、配方 schema、水密化、导出与 sidecar。
#
# 为什么单独一个模块
# ------------------
# R4 要落五类资产（人物/载具/建筑/植被/道具），四类生成器（植被/载具/人物/场景）
# 加一个取材器（道具）都要用同一套口径：命名、用途分级、面数预算、水密化、sidecar。
# 口径散在五个文件里必然分叉，所以收在一处；R3 的既有脚本一律不改。
#
# 命名规范（用户拍板）
# --------------------
#   <category>_<name>_<variant>
#   category 取自 conditions.resolve_category 的语义表词元，不另造类别词表：
#     prop -> prop / tree -> tree / vehicle -> vehicle / building -> building
#     hero -> character（conditions.PREFIX_CATEGORIES 里 hero* 映射到 character）
#   scene_block_* 归 other（场景是容器，不是渲染类别）——与既有 scene_street 同口径。
#
# 用途分级（用户拍板：按用途，不按镜头距离）
# ----------------------------------------
#   hero = 近景主线 / mid = 中景 / low = 远景占位
#   面数预算按档位统一：low<=500 / mid<=5000 / hero<=50000（ROADMAP R4 验收②）。
#
# 变体管理
# --------
#   没有几何节点，改用 JSON 配方 schema（r4-recipe/1）。载具四车身同拓扑是第一个样例。

from __future__ import annotations

import hashlib
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GEO = os.path.join(ROOT, "assets", "geometry")
NGEO = os.path.join(ROOT, "assets", "nongeometry")
VAL = os.path.join(ROOT, "assets", "validation")

# ------------------------------------------------------------------ 口径常量
USAGE_LEVELS = ("hero", "mid", "low")

#: 用途分级 -> 面数上限（ROADMAP §4 R4 验收方式②）
FACE_BUDGET = {"hero": 50000, "mid": 5000, "low": 500}

#: 语义类别 -> 命名里的 category 词（必须与 conditions.resolve_category 的前缀表一致）
CATEGORY_WORD = {
    "prop": "prop",
    "tree": "tree",
    "foliage": "tree_canopy",
    "vehicle": "vehicle",
    "building": "building",
    "character": "hero",
    "clothing": "clothing",
    "scene": "scene",
}

#: 语义类别 -> conditions.resolve_category 期望解析到的结果（用于命名自检）
EXPECTED_SEMANTIC = {
    "prop": "prop",
    "tree": "tree",
    "foliage": "foliage",
    "vehicle": "vehicle",
    "building": "building",
    "character": "character",
    "clothing": "clothing",
    "scene": "other",
}

#: R4 的非几何契约（配方 / 实例表 / 拓扑读数）统一放 assets/nongeometry/r4/
R4META = os.path.join(NGEO, "r4")

RECIPE_SCHEMA = "r4-recipe/1"
ASSET_SCHEMA = "r4-asset/1"

#: 退化面判定阈值（与既有 validate.py 的 DEGENERATE_FACES 口径一致）
DEGENERATE_AREA = 1e-10


# ------------------------------------------------------------------ 小工具
def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2)
    return path


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def rel(path):
    return os.path.relpath(path, ROOT).replace(os.sep, "/")


def budget_for(usage_level):
    return FACE_BUDGET[usage_level]


def name_of(category, name, variant):
    """<category>_<name>_<variant>；category 词来自语义表。"""
    cat_word = CATEGORY_WORD[category]
    return "%s_%s_%s" % (cat_word, name, variant)


def resolve_semantic(name):
    """走 conditions.resolve_category 真表（不另造词表）。"""
    import conditions
    return conditions.resolve_category(name)


def semantic_of(category, name, variant):
    return resolve_semantic(name_of(category, name, variant))


# ------------------------------------------------------------------ 网格读数
def _split_ok(mesh):
    """trimesh.split() 在无 scipy 的环境会抛异常（ENV.md §6.3），静默退化。"""
    try:
        mesh.split(only_watertight=False)
        return True
    except Exception:
        return False


def mesh_stats(mesh):
    """单网格统计：面数/点数/包围盒/水密/退化面。"""
    import numpy as np

    faces = np.asarray(mesh.faces)
    area = np.asarray(mesh.area_faces)
    lo, hi = mesh.bounds
    return {
        "faces": int(len(faces)),
        "vertices": int(len(mesh.vertices)),
        "watertight": bool(mesh.is_watertight),
        "winding_consistent": bool(mesh.is_winding_consistent),
        "degenerate_faces": int(np.sum(area < DEGENERATE_AREA)),
        "volume_m3": round(float(abs(mesh.volume)), 6),
        "bbox_min": [round(float(v), 4) for v in lo],
        "bbox_max": [round(float(v), 4) for v in hi],
        "size_m": [round(float(v), 4) for v in (hi - lo)],
        "components": int(len(mesh.split(only_watertight=False)))
        if _split_ok(mesh) else None,
    }


def topology_hash(mesh):
    """顶点拓扑哈希：只取面索引表（不含坐标）——同拓扑资产的判定依据。

    为什么要剔除坐标：同拓扑 = 同一套骨架换比例，顶点位置允许不同，
    面索引表必须逐字节一致。
    """
    import numpy as np

    faces = np.asarray(mesh.faces, dtype=np.int64)
    h = hashlib.sha256()
    h.update(b"faces=%d,verts=%d\n" % (faces.shape[0], len(mesh.vertices)))
    h.update(faces.tobytes())
    return h.hexdigest()


# ------------------------------------------------------------------ 水密化
def make_watertight(mesh, max_rounds=6):
    """把「视觉资产」（开放曲面）封成水密实体。

    为什么需要这一步
    ----------------
    Kenney / Poly Haven 的模型是给渲染用的视觉资产：锥桶没有底、桶是敞口、
    椅子是薄板拼的 —— 它们**本来就不是水密**。而本项目的既有校验口径
    （validate.py 的 MESH_WATERTIGHT）要求水密：下游要算体积、要做布尔、
    要按部件算间隙，不水密就没法算。

    做法（确定性、纯几何，不改形状）
    --------------------------------
    每轮做两件事，交替进行直到收敛：
      1) 找边界边（只被 1 个面引用），串成闭合环，用三角扇封盖；
         扇面朝向按「相邻面的平均法线」定向（避免翻面）。
      2) 去掉零面积（退化）三角形与孤立顶点。
    顺序很关键：先封口再去退化面 —— 反过来会刚封好的洞又被退化面拆开。
    最后修绕向（下游渲染要靠它，出黑面就是错）。

    返回 (网格, 读数)。读数里记封了几道环、剩多少退化面。
    """
    from collections import defaultdict

    import numpy as np
    import trimesh
    from trimesh import repair

    m = mesh.copy()
    m.merge_vertices()
    m.remove_unreferenced_vertices()
    capped_loops = 0
    rounds = 0
    for _ in range(max_rounds):
        rounds += 1
        faces = np.asarray(m.faces)
        verts = np.asarray(m.vertices, float)

        # ---- 1) 封边界环
        edge_faces = defaultdict(list)
        for fi, (a, b, c) in enumerate(faces):
            for e_ in ((int(a), int(b)), (int(b), int(c)), (int(c), int(a))):
                edge_faces[tuple(sorted(e_))].append(fi)
        boundary = [e_ for e_, fs in edge_faces.items() if len(fs) == 1]
        n_loops = 0
        if boundary:
            adj = defaultdict(list)
            for a, b in boundary:
                adj[a].append(b)
                adj[b].append(a)
            loops = []
            used = set()
            for start in sorted(adj.keys()):
                if start in used:
                    continue
                loop = [start]
                used.add(start)
                cur = start
                while True:
                    nxts = [n for n in adj[cur] if n not in used]
                    if not nxts:
                        break
                    nxt = nxts[0]
                    loop.append(nxt)
                    used.add(nxt)
                    cur = nxt
                    if cur == start:
                        break
                if len(loop) >= 3:
                    loops.append(loop)
            new_faces = [list(f) for f in faces]
            for loop in loops:
                nbr = set()
                for a, b in zip(loop, loop[1:] + loop[:1]):
                    for fi in edge_faces.get(tuple(sorted((a, b))), []):
                        nbr.add(fi)
                if nbr:
                    avg = np.asarray(m.face_normals)[sorted(nbr)].mean(axis=0)
                    lv = verts[loop]
                    newell = np.zeros(3)
                    for i in range(len(loop)):
                        p = lv[i]
                        q = lv[(i + 1) % len(loop)]
                        newell[0] += (p[1] - q[1]) * (p[2] + q[2])
                        newell[1] += (p[2] - q[2]) * (p[0] + q[0])
                        newell[2] += (p[0] - q[0]) * (p[1] + q[1])
                    if float(np.dot(newell, avg)) < 0:
                        loop = list(reversed(loop))
                for i in range(1, len(loop) - 1):
                    new_faces.append([loop[0], loop[i], loop[i + 1]])
            n_loops = len(loops)
            capped_loops += n_loops
            m = trimesh.Trimesh(vertices=verts,
                                 faces=np.array(new_faces, np.int64), process=False)
            if float(m.volume) < 0:
                m.invert()

        # ---- 2) 去退化面与孤立顶点
        faces = np.asarray(m.faces)
        area = np.asarray(m.area_faces)
        keep = area > DEGENERATE_AREA
        n_removed = int((~keep).sum())
        if n_removed:
            m = trimesh.Trimesh(vertices=np.asarray(m.vertices, float),
                                 faces=faces[keep], process=False)
            m.remove_unreferenced_vertices()
        if n_loops == 0 and n_removed == 0:
            break

    # ---- 收尾：修绕向（下游渲染要靠它，出黑面就是错）
    try:
        if not m.is_winding_consistent:
            out = repair.fix_winding(m)
            if out is not None:
                m = out
        if float(m.volume) < 0:
            out = repair.fix_inversion(m)
            if out is not None:
                m = out
    except Exception:
        pass

    deg = int(np.sum(np.asarray(m.area_faces) < DEGENERATE_AREA))
    stats = {"capped_loops": capped_loops, "rounds": rounds,
             "watertight": bool(m.is_watertight),
             "winding_consistent": bool(m.is_winding_consistent),
             "degenerate_faces": deg,
             "faces": int(len(m.faces)),
             "components": int(len(m.split(only_watertight=False)))
             if _split_ok(m) else None}
    return m, stats


# ------------------------------------------------------------------ 导出
def export_clean_glb(mesh, path):
    """导出纯几何 GLB：剥掉材质与贴图（白模路线不需要显示色彩）。

    为什么剥材质：Kenney / Poly Haven 的源件带嵌入贴图（单件 100 KB–2 MB），
    白模只要结构；剥掉后文件小一个量级，也避免「显示色彩混进条件图」。
    """
    import numpy as np
    import trimesh

    clean = trimesh.Trimesh(vertices=np.asarray(mesh.vertices, float),
                            faces=np.asarray(mesh.faces, np.int64),
                            process=False)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    clean.export(path, file_type="glb")
    return path


def export_scene_glb(items, path):
    """items: [(node_name, mesh, transform4x4)] -> 带节点层级的 GLB。"""
    import trimesh

    scene = trimesh.Scene()
    for nm, mesh, tf in items:
        scene.add_geometry(mesh, node_name=nm, geom_name=nm, transform=tf)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scene.export(path, file_type="glb")
    return path


def scene_stats(items):
    """场景级统计：逐部件面数 + 整体包围盒 + 贴地偏移。"""
    import numpy as np

    faces = 0
    verts = 0
    lo = [1e9] * 3
    hi = [-1e9] * 3
    parts = []
    for nm, mesh, tf in items:
        m = mesh.copy()
        if tf is not None:
            m.apply_transform(np.asarray(tf, dtype=float).reshape(4, 4))
        faces += int(len(m.faces))
        verts += int(len(m.vertices))
        blo, bhi = m.bounds
        lo = [min(a, b) for a, b in zip(lo, blo)]
        hi = [max(a, b) for a, b in zip(hi, bhi)]
        parts.append({"node": nm, "faces": int(len(m.faces)),
                      "vertices": int(len(m.vertices)),
                      "bbox_min": [round(float(v), 4) for v in blo],
                      "bbox_max": [round(float(v), 4) for v in bhi]})
    return {"faces": faces, "vertices": verts, "parts": parts,
            "bbox_min": [round(float(v), 4) for v in lo],
            "bbox_max": [round(float(v), 4) for v in hi],
            "ground_offset_m": round(float(abs(lo[2])), 4)}


# ------------------------------------------------------------------ sidecar
def sidecar(path, *, asset_id, name, category, usage_level, files,
            license_block, provenance, recipe=None, extra=None,
            geometry=None):
    """写随图 sidecar（<name>.json）：台账与校验都读它。

    files: [落盘文件绝对路径]；license/provenance 用 manifest v2 的同名字段。
    """
    file_rows = []
    for f in files:
        if not os.path.exists(f):
            continue
        file_rows.append({"path": rel(f), "bytes": os.path.getsize(f),
                          "sha256": sha256_file(f)})
    doc = {
        "kind": "r4_asset",
        "schema": ASSET_SCHEMA,
        "id": asset_id,
        "name": name,
        "category": category,
        "semantic_category": EXPECTED_SEMANTIC.get(category, category),
        "usage_level": usage_level,
        "budget_faces": budget_for(usage_level),
        "files": file_rows,
        "license": license_block,
        "provenance": provenance,
        "lod": {"level": usage_level, "faces": (geometry or {}).get("faces")},
    }
    if geometry:
        doc["geometry"] = geometry
    if recipe:
        doc["recipe"] = recipe
    if extra:
        doc.update(extra)
    return write_json(path, doc)
