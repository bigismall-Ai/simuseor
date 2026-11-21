"""公共资产减面/归一化（纯 CPU）：Poly Haven 树 + Khronos ToyCar + Kenney 救护车 → Z-up 白模 GLB。

三条关键改动（都为「分件载具」服务）：
1. **按部件分别减面**：``fast_simplification`` 对整网格一次性折叠会**跨部件塌陷**
   （实测 building_office.glb 252 面整体减面只减到 240 面，却造成 61% 深度漂移、
   剪影 IoU 掉到 0.75）。所以这里逐个 geometry 减面，并给每个部件保底
   ``MIN_PART_FACES``（12 面）——盒子类最小部件再减就塌成一个点。
2. **分件信息进清单**：输出 ``parted`` / ``parted_parts`` / ``has_door``，
   下游据此筛掉「没有独立车门」的载具（治图/视频生成里的车门漂移，
   根因是参考图里没有「门」这个独立结构，而不是精度不够）。
3. **保持分件结构**：输出仍是多 geometry 的 Scene，部件名原样保留，
   减面后仍然能单独取用门/轮。

原始资产留在 var/public-assets，结果写入 assets/public_normalized/，
清单写入 assets/validation/public_decimated.json。
"""
from __future__ import annotations

import json
import os
import time
import traceback

import numpy as np
import trimesh

from vehicle_parts import decimate_by_part, parted_report

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROJ = os.path.abspath(os.path.join(ROOT, "..", ".."))
PUB = os.path.join(PROJ, "var", "public-assets")
OUT_DIR = os.path.join(ROOT, "assets", "public_normalized")
MANIFEST = os.path.join(ROOT, "assets", "validation", "public_decimated.json")

# 与 preview_public.normalize 一致：glTF 的 Y-up → 项目约定的 Z-up
Z_UP = np.array([[1, 0, 0, 0],
                 [0, 0, -1, 0],
                 [0, 1, 0, 0],
                 [0, 0, 0, 1]], dtype=float)

# 每轮先按 agg=7 收敛，再逐轮增大到 10；最多 4 轮
PASS_AGGRESSION = (7.0, 10.0, 10.0, 10.0)

# 每个部件的面数下限：低于这个数再减就会塌（盒子 12 面，减到 8 面就变形）
MIN_PART_FACES = 12

ASSETS = [
    {
        "name": "ToyCar",
        "category": "vehicle",
        "source": os.path.join(PUB, "khronos", "ToyCar.glb"),
        "output": "ToyCar.glb",
        "target_faces": 30000,
        "weld_digits": None,  # 精确焊接（顶点已是分裂点，无需容差）
        "source_url": "https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ToyCar",
        "license": "CC0 1.0",
        "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
        "credit": "© 2020 Guido Odendahl（模型）/ Eric Chadwick（扩展与场景）",
        "notes": "含 ToyCar / Glass / Fabric(摄影棚布景) 三个网格；白模导出剥离全部纹理。",
    },
    {
        "name": "island_tree_01",
        "category": "vegetation",
        "source": os.path.join(PUB, "polyhaven", "island_tree_01", "island_tree_01_1k.gltf"),
        "output": "island_tree_01.glb",
        "target_faces": 60000,
        "weld_digits": 3,  # 1 mm 容差焊接，合并叶片卡片接缝后可达目标面数
        "source_url": "https://polyhaven.com/a/island_tree_01",
        "license": "CC0 1.0",
        "license_url": "https://polyhaven.org/license",
        "credit": "Poly Haven",
        "notes": "约 160 万面，3 个网格（树干/枝叶）；白模导出剥离全部纹理。",
    },
    {
        "name": "ambulance",
        "category": "vehicle",
        "source": os.path.join(PUB, "kenney", "car-kit", "Models", "GLB format", "ambulance.glb"),
        "output": "ambulance.glb",
        "target_faces": 1500,
        "weld_digits": None,
        "source_url": "https://kenney.nl/assets/car-kit",
        "license": "CC0 1.0",
        "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
        "credit": "© Kenney (kenney.nl) — Car Kit",
        "notes": "Kenney Car Kit 救护车：7 个 geometry（body + door-left/door-right + 四轮），"
                 "是少数「车门独立」的载具，可用于验证分件链路。",
    },
]


def load_parts(path):
    """读取场景，应用节点变换，返回 [(part_name, Trimesh)]。"""
    scene = trimesh.load(path, force="scene", process=False)
    parts = []
    for node in scene.graph.nodes_geometry:
        transform, geom_name = scene.graph[node]
        geom = scene.geometry[geom_name].copy()
        geom.apply_transform(transform)
        parts.append((geom_name, geom))
    if not parts:
        raise RuntimeError("场景中没有网格")
    return parts


def join_parts(parts):
    meshes = []
    for _, geom in parts:
        geom.visual = trimesh.visual.ColorVisuals(mesh=geom)  # 丢弃纹理/UV
        meshes.append(geom)
    mesh = trimesh.util.concatenate(meshes)
    if len(mesh.faces) == 0:
        raise RuntimeError("空网格")
    return mesh


def to_z_up(mesh):
    out = mesh.copy()
    out.apply_transform(Z_UP)
    return out


def weld(mesh, digits):
    if digits is None:
        mesh.merge_vertices()
    else:
        trimesh.grouping.merge_vertices(mesh, digits_vertex=digits,
                                        merge_tex=True, merge_norm=True)
    mesh.update_faces(mesh.nondegenerate_faces())
    return mesh


def _fast_simplify(vertices, faces, target, agg):
    import fast_simplification
    v, f = fast_simplification.simplify(np.asarray(vertices, np.float32),
                                        np.asarray(faces, np.int32),
                                        target_count=int(target), agg=float(agg))
    return np.asarray(v, np.float64), np.asarray(f, np.int64)


def decimate(mesh, target):
    """整网格一次性减面（保留旧接口，仅用于对照/回退）。

    返回 (mesh, method, fallback_used, attempts)。
    ⚠️ 不要用它做正式产物：跨部件折叠会造成深度漂移（见 decimate_by_part）。
    """
    attempts = []
    v = np.asarray(mesh.vertices)
    f = np.asarray(mesh.faces)
    try:
        import fast_simplification  # noqa: F401
    except Exception as exc:
        print(f"  [!] fast_simplification 不可用（{exc}），回退 trimesh")
        out = mesh.simplify_quadric_decimation(face_count=target)
        attempts.append({"method": "trimesh.simplify_quadric_decimation",
                         "faces": int(len(out.faces))})
        return out, "trimesh.simplify_quadric_decimation", True, attempts

    for i, agg in enumerate(PASS_AGGRESSION):
        if len(f) <= target:
            break
        t = time.perf_counter()
        v, f = _fast_simplify(v, f, target, agg)
        attempts.append({"pass": i + 1, "agg": agg, "faces": int(len(f)),
                         "seconds": round(time.perf_counter() - t, 2)})
        print(f"  pass {i + 1}: agg={agg} → {len(f)} 面")
    out = trimesh.Trimesh(vertices=v, faces=f, process=False)
    return out, "fast_simplification.simplify (quadric edge collapse, CPU)", False, attempts


def place_on_ground(mesh):
    """水平居中，最低点落到 z=0。"""
    lo, hi = mesh.bounds
    offset = np.array([-(lo[0] + hi[0]) * 0.5, -(lo[1] + hi[1]) * 0.5, -lo[2]])
    out = mesh.copy()
    out.apply_translation(offset)
    return out, offset


def white_material():
    return trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
        name="white_model", baseColorFactor=[0.82, 0.82, 0.82, 1.0],
        metallicFactor=0.0, roughnessFactor=0.75))


def bundle_bytes(path):
    if path.lower().endswith(".gltf"):
        return sum(os.path.getsize(os.path.join(dp, n))
                   for dp, _, ns in os.walk(os.path.dirname(path))
                   for n in ns)
    return os.path.getsize(path)


def bbox_record(mesh):
    lo, hi = mesh.bounds
    return {"min": [round(float(x), 6) for x in lo],
            "max": [round(float(x), 6) for x in hi],
            "size_m": [round(float(x), 6) for x in (hi - lo)]}


def export_scene(parts, path):
    """按部件导出多 geometry 的 GLB（部件名保留 → 下游仍能单独取用门/轮）。"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scene = trimesh.Scene()
    for name, mesh in parts:
        scene.add_geometry(mesh, node_name=name, geom_name=name)
    scene.export(path, file_type="glb")


def process(spec):
    t0 = time.perf_counter()
    rec = {
        "name": spec["name"],
        "category": spec.get("category", "unknown"),
        "status": "ok",
        "source": os.path.relpath(spec["source"], PROJ),
        "source_url": spec["source_url"],
        "license": spec["license"],
        "license_url": spec["license_url"],
        "credit": spec["credit"],
        "target_faces": spec["target_faces"],
        "notes": spec["notes"],
    }
    print(f"[{spec['name']}] 读取 {rec['source']}")
    parts = load_parts(spec["source"])
    rec["parts"] = [{"name": n, "faces": int(len(g.faces)), "vertices": int(len(g.vertices))}
                    for n, g in parts]

    mesh = join_parts(parts)
    rec["faces"] = {"original": int(len(mesh.faces))}
    rec["vertices"] = {"original": int(len(mesh.vertices))}
    rec["watertight"] = {"original": bool(mesh.is_watertight)}
    rec["source_bundle_bytes"] = int(bundle_bytes(spec["source"]))

    # ---------------------------------------------------------- 分件判定
    # 在「原始场景」上判，保留 geometry 名：同一个 geometry 里的连通分量在
    # 导出/渲染时仍是一整块 mesh，不算独立件。
    pr = parted_report(os.path.abspath(spec["source"]), category=spec.get("category", "vehicle"))
    rec["parted"] = bool(pr["parted"])
    rec["parted_parts"] = pr["parted_parts"]
    rec["has_door"] = bool(pr["has_door"])
    rec["parted_detail"] = {
        "surface_parts": pr["surface_parts"],
        "door_parts": pr["door_parts"],
        "geometry_count": pr["geometry_count"],
        "component_count": pr["component_count"],
        "labels": pr["labels"],
        "reason": pr["reason"],
    }
    print(f"  分件：parted={rec['parted']} 结构件={rec['parted_parts']} "
          f"独立车门={rec['has_door']}")

    # ---------------------------------------------------------- 归一化 + 按部件减面
    dec_parts = []
    for name, geom in parts:
        m = to_z_up(geom)
        m = weld(m, spec["weld_digits"])
        dec_parts.append((name, m))
    rec["faces"]["after_weld"] = int(sum(len(m.faces) for _, m in dec_parts))
    rec["vertices"]["after_weld"] = int(sum(len(m.vertices) for _, m in dec_parts))
    print(f"  焊接后: {rec['faces']['after_weld']} 面 / {rec['vertices']['after_weld']} 顶点")

    dec_parts, dec_stats = decimate_by_part(dec_parts, spec["target_faces"],
                                            min_faces=MIN_PART_FACES)
    for name, m in dec_parts:
        print(f"  部件 {name}: {dec_stats_by_part(dec_stats, name)} 面")
    rec["method"] = ("fast_simplification.simplify per part (quadric edge collapse, CPU); "
                     f"每部件面数下限 {MIN_PART_FACES}")
    rec["fallback_used"] = False
    rec["attempts"] = dec_stats["parts"]
    rec["decimate_stats"] = dec_stats

    # 整体贴地（偏移量按合并后的包围盒算，套到每个部件上）
    all_mesh = trimesh.util.concatenate([m for _, m in dec_parts])
    offset = np.array([-(all_mesh.bounds[0][0] + all_mesh.bounds[1][0]) * 0.5,
                       -(all_mesh.bounds[0][1] + all_mesh.bounds[1][1]) * 0.5,
                       -all_mesh.bounds[0][2]])
    final = []
    for name, m in dec_parts:
        m = m.copy()
        m.apply_translation(offset)
        m.visual = white_material()
        final.append((name, m))

    out_path = os.path.join(OUT_DIR, spec["output"])
    export_scene(final, out_path)

    dec = trimesh.util.concatenate([m for _, m in final])
    rec.update({
        "output": os.path.relpath(out_path, ROOT),
        "faces": {"original": rec["faces"]["original"],
                  "after_weld": rec["faces"]["after_weld"],
                  "decimated": int(len(dec.faces))},
        "vertices": {"original": rec["vertices"]["original"],
                     "after_weld": rec["vertices"]["after_weld"],
                     "decimated": int(len(dec.vertices))},
    })
    rec["reduction_pct"] = round(100.0 * (1.0 - len(dec.faces) / rec["faces"]["original"]), 2)
    rec["target_reached"] = bool(len(dec.faces) <= spec["target_faces"])
    if not rec["target_reached"]:
        # 按部件减面**不允许跨部件折叠**，所以总面数可能高于目标：
        # 整网格减面能压到更低，但代价是把部件之间的连接压塌（深度漂移 61%）。
        rec["target_note"] = (
            f"按部件减面后 {rec['faces']['decimated']} 面 > 目标 {spec['target_faces']}；"
            "这是「保结构」的代价：整网格减面能压到目标以下，但会跨部件塌陷")
    rec["bbox"] = bbox_record(dec)
    rec["placement"] = {
        "up": "Z", "units": "m", "rotation": "Y-up → Z-up (+90° about X)",
        "centered_xy": True,
        "translation": [round(float(x), 6) for x in offset],
    }
    rec["watertight"]["decimated"] = bool(dec.is_watertight)
    rec["files"] = {"source_bundle_bytes": rec["source_bundle_bytes"],
                    "output_bytes": int(os.path.getsize(out_path))}

    # 回读校验
    check = trimesh.load(out_path, force="scene", process=False)
    rec["verify"] = {"reload_ok": True,
                     "faces": int(sum(len(g.faces) for g in check.geometry.values())),
                     "geometries": len(check.geometry),
                     "geometry_names": sorted(check.geometry.keys())}
    rec["elapsed_s"] = round(time.perf_counter() - t0, 2)
    print(f"  输出 {rec['output']}: {rec['faces']['decimated']} 面, "
          f"{rec['files']['output_bytes'] / 1024 / 1024:.2f} MB, "
          f"{rec['verify']['geometries']} 个 geometry, {rec['elapsed_s']} s")
    return rec


def dec_stats_by_part(stats, name):
    for p in stats["parts"]:
        if p["name"] == name:
            return f"{p['faces_before']} → {p['faces_after']}"
    return "?"


def main():
    records = []
    tools = {"trimesh": trimesh.__version__, "numpy": np.__version__}
    try:
        import fast_simplification
        tools["fast_simplification"] = getattr(fast_simplification, "__version__", "unknown")
    except Exception:
        tools["fast_simplification"] = None

    def dump():
        payload = {
            "kind": "public_decimated",
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "cpu_only": True,
            "tools": tools,
            "targets": {s["name"]: s["target_faces"] for s in ASSETS},
            "min_part_faces": MIN_PART_FACES,
            "decimation_policy": "per-part；每部件保底 %d 面，避免跨部件折叠与最小件塌陷"
                                 % MIN_PART_FACES,
            "assets": records,
        }
        os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
        with open(MANIFEST, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print(f"[清单] {os.path.relpath(MANIFEST, ROOT)}")

    for spec in ASSETS:  # ToyCar 先做，树失败时仍能保留结果
        try:
            records.append(process(spec))
        except BaseException as exc:  # noqa: BLE001 - 内存/中断也要如实记录
            print(f"[fail] {spec['name']}: {type(exc).__name__}: {exc}")
            records.append({
                "name": spec["name"], "status": "failed",
                "source": os.path.relpath(spec["source"], PROJ),
                "source_url": spec["source_url"], "license": spec["license"],
                "license_url": spec["license_url"], "target_faces": spec["target_faces"],
                "error": f"{type(exc).__name__}: {exc}",
                "traceback": traceback.format_exc()[-2000:],
                "attempts": [],
            })
            if isinstance(exc, KeyboardInterrupt):
                dump()
                raise
        dump()

    ok = sum(1 for r in records if r.get("status") == "ok")
    print(f"[完成] {ok}/{len(records)} 个资产减面成功")
    for r in records:
        if r.get("status") == "ok":
            print(f"  - {r['name']}: parted={r['parted']} 结构件={r['parted_parts']}")


if __name__ == "__main__":
    main()
