"""分件载具辅助：判断资产是否「分件」、按连通分量拆件、按部件分别减面。

用途
----
- ``split_vehicle_parts(obj)``：从 geometry 名或连通分量推断语义标签，返回
  ``{label: Trimesh}``。标签集：door_left / door_right / wheel_* / headlight /
  taillight / windshield / glass / body / mirror / other。
- ``parted_report(obj)``：输出 ``parted`` / ``parted_parts`` 与每个部件的面数，
  供下游筛掉「没有独立车门」的载具（门漂移只能靠真分件来治）。
- ``connected_components`` / ``split_components``：手写并查集求连通分量。
- ``decimate_by_part``：按部件分别减面，每个部件带面数下限。

设计理由
--------
1. **门必须是独立 mesh。** 治图/视频生成里的「车门漂移」根因不是精度不够，而是
   参考图里根本没有「门」这个可学结构：模型只看到「一整块车皮」，于是把门画在
   任意位置。白模把门/轮/灯做成独立部件，参考图里才会出现能学的门结构。
2. **分件判定以「独立 geometry」为单位，而不是以连通分量为单位。**
   导出/渲染时同一个 geometry 内的连通分量仍然是一整块 mesh；ToyCar 虽然在网格
   内部有上千个连通分量（含车轮），但整台车只导出一个 geometry，参考图里并不会
   出现「可分件的车」，因此判 parted=false。
3. **玻璃/车窗单独存在不算分件。** ToyCar 有独立的 Glass 几何，但车身 ToyCar
   仍是单网格、门依旧只是表面贴图，参考图照样学不出车门——必须判成 parted=false，
   否则下游会误以为它能治门漂移。（规格里「独立 window/glass 即视为分件」那条
   会误判 ToyCar，故按结构件收紧。）
4. **减面必须按部件做。** ``fast_simplification`` 对整网格一次性折叠会跨部件塌陷：
   实测 building_office.glb（252 面 = 21 个 12 面盒子）整体减面只减到 240 面，
   却造成 61% 深度漂移、剪影 IoU 掉到 0.75。每个部件再设面数下限（默认 12 面），
   盒子类最小部件才不会被减塌成一个点。
5. **本环境没有 scipy**，``trimesh`` 的 ``split()`` / ``body_count`` 不可用，
   因此连通分量用手写并查集实现（不依赖 scipy / networkx）。

纯 CPU，无外部网络依赖。
"""
from __future__ import annotations

import os
import re

import numpy as np
import trimesh

# ------------------------------------------------------------------ 常量

#: 结构件：这些部件独立存在才说明资产是「分件」的（门漂移能否被治好的关键）。
STRUCTURAL_LABELS = ("door_left", "door_right", "wheel", "headlight", "taillight")

#: 表面件：玻璃/车窗独立存在不足以说明分件（见模块 docstring 第 3 条）。
SURFACE_LABELS = ("glass", "windshield")

#: 单个 geometry 拆成超过这么多连通分量，就不再按「零件」解读
#: （高面数细节网格切出来是碎片，不是结构件）。
FRAGMENT_LIMIT = 64

# 名字 → 标签的关键词表。先匹配到的先算。
_NAME_RULES = (
    ("door", ("door",)),
    ("wheel", ("wheel", "tire", "tyre")),
    ("headlight", ("headlight", "head_lamp", "headlamp", "front_light", "frontlight")),
    ("taillight", ("taillight", "tail_lamp", "taillamp", "rear_light", "rearlight",
                   "brake_light", "brakelight", "brake_lamp")),
    ("windshield", ("windshield", "windscreen", "front_glass", "front_window")),
    ("mirror", ("mirror",)),
    ("glass", ("glass", "window", "glazing", "pane")),
    ("body", ("body", "chassis", "hull", "shell", "car", "cab", "cabin", "roof")),
)

_LEFT_WORDS = ("left", "lft", "l")
_RIGHT_WORDS = ("right", "rgt", "r")


# ------------------------------------------------------------------ 连通分量（无 scipy）
def connected_components(faces, n_vertices):
    """并查集求连通分量，返回每个分量所含的面索引列表。

    为什么不用 ``trimesh.split()``：本环境没装 scipy，trimesh 的连通分量实现会
    直接抛 ModuleNotFoundError；并查集只依赖 numpy，纯 CPU 且结果确定。
    """
    parent = list(range(int(n_vertices)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for f in np.asarray(faces, dtype=np.int64):
        a, b, c = (int(v) for v in f)
        ra, rb, rc = find(a), find(b), find(c)
        if ra != rb:
            parent[rb] = ra
        if ra != rc:
            parent[rc] = ra

    groups = {}
    for fi, f in enumerate(np.asarray(faces, dtype=np.int64)):
        groups.setdefault(find(int(f[0])), []).append(fi)
    return list(groups.values())


def split_components(mesh):
    """把单个 mesh 按连通分量拆成若干 Trimesh（面数从大到小）。"""
    mesh = trimesh.Trimesh(vertices=np.asarray(mesh.vertices),
                            faces=np.asarray(mesh.faces), process=False)
    if len(mesh.faces) == 0:
        return []
    groups = connected_components(mesh.faces, len(mesh.vertices))
    out = [mesh.submesh([g], append=True, repair=False) for g in groups]
    out.sort(key=lambda m: -len(m.faces))
    return out


# ------------------------------------------------------------------ 名字 → 标签
def _tokens(name):
    return [t for t in re.split(r"[^a-z0-9]+", str(name).lower()) if t]


def _side_of(tokens):
    """从名字的词元里判断左右（+Y 为左，-Y 为右，与项目米制坐标系一致）。"""
    for t in tokens:
        if t in ("rl", "fl", "lf"):
            return "left"
        if t in ("rr", "fr", "rf"):
            return "right"
    for t in tokens:
        if t in _LEFT_WORDS:
            return "left"
        if t in _RIGHT_WORDS:
            return "right"
    return None


def classify_name(name):
    """按 geometry 名推断语义标签。返回 (label, kind)，kind ∈ {structural, surface, other}。"""
    n = str(name).lower().replace("_", "-")
    toks = _tokens(n)
    for label, keys in _NAME_RULES:
        if not any(k in n for k in keys):
            continue
        if label == "door":
            side = _side_of(toks)
            return (f"door_{side}" if side else "door"), "structural"
        if label == "wheel":
            axle = None
            side = _side_of(toks)
            for t in toks:
                if t in ("front", "fwd", "fr", "fl"):
                    axle = "front"
                elif t in ("rear", "back", "rr", "rl"):
                    axle = "rear"
            if axle is None and side is None:
                return "wheel", "structural"
            if axle is None:
                axle = "rear" if side == "right" else "front"  # 只有 RR/RL 这类缩写时的兜底
            return f"wheel_{axle}_{side}" if side else f"wheel_{axle}", "structural"
        if label in ("headlight", "taillight"):
            return label, "structural"
        if label in ("windshield", "glass"):
            return label, "surface"
        if label == "mirror":
            return label, "other"
        return label, "other"
    return "other", "other"


# ------------------------------------------------------------------ 几何 → 标签
def classify_component(mesh, hull_lo, hull_hi):
    """没有名字线索时，按连通分量的形状 + 在整车中的位置推断标签。

    hull_* 是「整车主体」的 AABB（由能叫出名字的几何取并集得到）。

    判据（按优先级）：
    1. 不落在主体范围内 → other（摄影棚布景之类，不是载具零件）；
    2. 比主体还大 → body（主体自身）；
    3. 轮子：某个水平轴明显更薄、且位于整车底部 → wheel_*；
    4. 车门：沿 Y 很薄、贴在车身侧面中段 → door_left / door_right；
    5. 前/后灯：沿 X 很薄、贴在车头/车尾 → headlight / taillight；
    6. 玻璃/风挡：位于车身上部且是薄片 → glass / windshield；
    7. 其余 → other。
    """
    lo, hi = np.asarray(mesh.bounds, float)
    size = hi - lo
    hull_lo = np.asarray(hull_lo, float)
    hull_hi = np.asarray(hull_hi, float)
    hull_size = np.maximum(hull_hi - hull_lo, 1e-9)
    diag = float(np.linalg.norm(size))
    hull_diag = float(np.linalg.norm(hull_size))
    if hull_diag <= 1e-9 or diag <= 1e-9 or len(mesh.faces) == 0:
        return "other"

    # 1 摄影棚布景等：不在主体范围内（允许外扩 30%，覆盖贴边的小零件）
    slack = 0.30 * hull_size
    if np.any(lo < hull_lo - slack) or np.any(hi > hull_hi + slack):
        return "other"
    # 2 主体自身
    if diag > 0.88 * hull_diag:
        return "body"

    z_frac = (0.5 * (lo[2] + hi[2]) - hull_lo[2]) / hull_size[2]

    # 3 轮子：水平轴里有一个特别薄 + 位置低
    horiz = sorted([(float(size[0]), 0), (float(size[1]), 1)])
    thin, fat = horiz[0][0], horiz[1][0]
    if thin < 0.62 * fat and z_frac < 0.36:
        front = "front" if 0.5 * (lo[0] + hi[0]) > 0.5 * (hull_lo[0] + hull_hi[0]) else "rear"
        left = "left" if 0.5 * (lo[1] + hi[1]) > 0 else "right"
        return f"wheel_{front}_{left}"

    # 4 车门：沿 Y 薄、贴侧面、位于中段高度
    if size[1] < 0.34 * max(size[0], 1e-9) and 0.16 < z_frac < 0.72:
        at_left = hi[1] >= hull_hi[1] - 0.10 * hull_size[1]
        at_right = lo[1] <= hull_lo[1] + 0.10 * hull_size[1]
        if at_left and not at_right:
            return "door_left"
        if at_right and not at_left:
            return "door_right"
        if at_left and at_right:
            return "door_left" if 0.5 * (lo[1] + hi[1]) > 0 else "door_right"

    # 5 前灯 / 尾灯：沿 X 薄、贴车头 / 车尾
    if size[0] < 0.34 * max(size[1], 1e-9):
        if (hull_lo[0] - lo[0]) < 0.18 * hull_size[0]:
            return "headlight"
        if (hi[0] - hull_hi[0]) < 0.18 * hull_size[0]:
            return "taillight"

    # 6 玻璃 / 风挡：车身上部 + 薄片
    if (z_frac > 0.62 and size[2] > 0.12 * hull_size[2]
            and min(size) < 0.25 * max(size)):
        return "windshield" if (hull_lo[0] - lo[0]) < 0.25 * hull_size[0] else "glass"

    return "other"


# ------------------------------------------------------------------ 载入
def _scene_geometries(obj):
    """把各种输入统一成 [(name, Trimesh)]（已烘焙节点变换）。"""
    if isinstance(obj, (str, os.PathLike)):
        obj = trimesh.load(str(obj), force="scene", process=False)
    if isinstance(obj, trimesh.Scene):
        out = []
        for node in obj.graph.nodes_geometry:
            transform, geom_name = obj.graph[node]
            geom = obj.geometry[geom_name].copy()
            geom.apply_transform(transform)
            out.append((geom_name, geom))
        if not out:  # 有些场景把网格挂在根节点上
            for name, geom in obj.geometry.items():
                out.append((name, geom.copy()))
        return out
    if isinstance(obj, trimesh.Trimesh):
        return [("mesh", obj)]
    raise TypeError(f"不支持的输入类型：{type(obj)!r}")


def _hull_bounds(geoms, labels):
    """整车主体的 AABB：取「能叫出名字」的几何的并集；全叫不出名字就用面数最多的那个。"""
    hull_geoms = [m for (n, m), lab in zip(geoms, labels) if lab != "other"]
    if not hull_geoms:
        hull_geoms = [max((m for _, m in geoms), key=lambda m: len(m.faces))]
    lo = np.min([m.bounds[0] for m in hull_geoms], axis=0)
    hi = np.max([m.bounds[1] for m in hull_geoms], axis=0)
    return lo, hi


# ------------------------------------------------------------------ 主接口
def split_vehicle_parts(obj, category="vehicle"):
    """把载具拆成语义部件，返回 ``{label: Trimesh}``。

    先按 geometry 名判；名字没线索的几何再按连通分量 + 几何位置判。

    category 非 "vehicle" 时不做几何兜底：植被/道具的连通分量没有载具语义，
    硬分类只会产生「把树叶认成车门」这类噪音。
    """
    geoms = _scene_geometries(obj)
    labels = [classify_name(n)[0] for n, _ in geoms]
    hull_lo, hull_hi = _hull_bounds(geoms, labels)

    buckets = {}
    for (name, mesh), label in zip(geoms, labels):
        if label != "other":
            buckets.setdefault(label, []).append(mesh)
            continue
        subs = split_components(mesh) if category == "vehicle" else []
        if len(subs) <= 1 or len(subs) > FRAGMENT_LIMIT:
            # 碎片网格（高面数细节模型）不按零件解读
            buckets.setdefault("other", []).append(mesh)
            continue
        for sub in subs:
            buckets.setdefault(classify_component(sub, hull_lo, hull_hi), []).append(sub)

    out = {}
    for label, meshes in buckets.items():
        meshes = [m for m in meshes if len(m.faces)]
        if not meshes:
            continue
        out[label] = (meshes[0] if len(meshes) == 1
                      else trimesh.util.concatenate(meshes))
    return out


def parted_report(obj, category="vehicle"):
    """判断资产是否分件，列出部件名与面数。

    返回 ``parted``（bool）、``parted_parts``（结构件名字列表）、
    ``surface_parts``（玻璃/车窗类）、``has_door``（是否有独立车门——
    这是「能不能治门漂移」的真正判据）、``parts``（逐部件明细）。

    判定规则：存在独立 door / wheel / light 命名的 geometry → parted=true；
    单网格且无独立结构件 → parted=false。仅玻璃/车窗独立**不算**分件
    （见模块 docstring 第 3 条：玻璃学不出车门）。

    category 非 "vehicle" 时只认 geometry 名字，不做几何兜底。
    """
    geoms = _scene_geometries(obj)
    labels = [classify_name(n)[0] for n, _ in geoms]
    hull_lo, hull_hi = _hull_bounds(geoms, labels)

    parts = []
    for (name, mesh), label in zip(geoms, labels):
        kind = classify_name(name)[1]
        if label == "other" and category == "vehicle":
            subs = split_components(mesh)
            if len(subs) > 1 and len(subs) <= FRAGMENT_LIMIT:
                for k, sub in enumerate(subs):
                    sub_label = classify_component(sub, hull_lo, hull_hi)
                    sub_kind = ("structural" if sub_label in STRUCTURAL_LABELS
                                else "surface" if sub_label in SURFACE_LABELS else "other")
                    parts.append(_part_record(f"{name}#{k}", sub_label, sub_kind, sub))
                continue
        parts.append(_part_record(name, label, kind, mesh))

    structural = [p["name"] for p in parts if p["kind"] == "structural"]
    surface = [p["name"] for p in parts if p["kind"] == "surface"]
    doors = [p["name"] for p in parts if p["label"].startswith("door")]
    parted = bool(structural)

    if parted:
        reason = "存在独立结构件（门/轮/灯），参考图里能出现可学的车门结构"
    elif surface:
        reason = (f"只有玻璃/车窗类独立件（{', '.join(surface)}），车身仍是单网格；"
                  "玻璃学不出车门，不能治门漂移")
    else:
        reason = "单网格且无独立结构件"
    if parted and not doors:
        reason += "；但没有独立车门（轮/灯独立而已），只能治车轮漂移"

    labels_map = {}
    for p in parts:
        labels_map.setdefault(p["label"], []).append(p["name"])

    return {
        "kind": "vehicle_parts_report",
        "parted": parted,
        "parted_parts": structural,
        "surface_parts": surface,
        "door_parts": doors,
        "has_door": bool(doors),
        "reason": reason,
        "geometry_count": len(geoms),
        "component_count": len(parts),
        "faces_total": int(sum(p["faces"] for p in parts)),
        "labels": labels_map,
        "parts": parts,
    }


def _part_record(name, label, kind, mesh):
    lo, hi = mesh.bounds
    return {
        "name": name,
        "label": label,
        "kind": kind,
        "faces": int(len(mesh.faces)),
        "vertices": int(len(mesh.vertices)),
        "bbox_min": [round(float(v), 5) for v in lo],
        "bbox_max": [round(float(v), 5) for v in hi],
    }


# ------------------------------------------------------------------ 按部件减面
def decimate_by_part(parts, target_total, min_faces=12, passes=(7.0, 10.0, 10.0)):
    """按部件分别减面，每部件带面数下限。

    parts: ``[(name, Trimesh)]``；返回 ``(新 parts, stats)``。

    为什么不能整网格一次性减：实测 building_office.glb 整体减面只减到 240 面，
    却造成 61% 深度漂移、剪影 IoU 掉到 0.75——折叠会跨部件把盒子压塌。
    为什么每部件要有下限：盒子类最小部件只有 12 面，再减就塌成一个点，
    轮廓与深度都会跳变。
    """
    import fast_simplification

    total = int(sum(len(m.faces) for _, m in parts))
    stats = {"faces_before": total, "target_total": int(target_total),
             "min_faces": int(min_faces), "parts": []}
    if total <= target_total:
        stats["faces_after"] = total
        stats["skipped"] = True
        return list(parts), stats

    ratio = float(target_total) / float(total)
    out = []
    for name, mesh in parts:
        faces = int(len(mesh.faces))
        if faces <= min_faces:
            # 已经在下限之下：保持原样，宁可超预算也不把部件减塌
            out.append((name, mesh))
            stats["parts"].append({"name": name, "faces_before": faces,
                                   "faces_after": faces, "floored": True, "passes": []})
            continue
        target = int(max(min_faces, min(faces, round(faces * ratio))))
        v = np.asarray(mesh.vertices, np.float32)
        f = np.asarray(mesh.faces, np.int32)
        attempts = []
        new = mesh
        try:
            for a in passes:
                if len(f) <= target:
                    break
                v, f = fast_simplification.simplify(v, f, target_count=int(target), agg=float(a))
                attempts.append({"agg": float(a), "faces": int(len(f))})
            cand = trimesh.Trimesh(vertices=np.asarray(v, np.float64),
                                   faces=np.asarray(f, np.int64), process=False)
            if len(cand.faces) >= min_faces:
                new = cand
            else:
                attempts.append({"agg": None, "faces": int(len(cand.faces)),
                                 "note": "低于面数下限，回退原部件"})
        except Exception as exc:
            # fast_simplification 失败 → 退到 trimesh 的四边形误差减面
            attempts.append({"agg": None, "error": f"{type(exc).__name__}: {exc}"})
            try:
                cand = mesh.simplify_quadric_decimation(face_count=target)
                if len(cand.faces) >= min_faces:
                    new = cand
                    attempts.append({"method": "trimesh.simplify_quadric_decimation",
                                     "faces": int(len(cand.faces))})
            except Exception as exc2:
                attempts.append({"method": "trimesh.simplify_quadric_decimation",
                                 "error": f"{type(exc2).__name__}: {exc2}"})
        out.append((name, new))
        stats["parts"].append({"name": name, "faces_before": faces,
                               "faces_after": int(len(new.faces)),
                               "floored": bool(len(new.faces) >= faces),
                               "passes": attempts})
    stats["faces_after"] = int(sum(len(m.faces) for _, m in out))
    return out, stats
