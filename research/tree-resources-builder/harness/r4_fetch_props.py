"""R4 道具零件库：Kenney 取材 + Poly Haven hero 取材 + 水密化 + 归一化落盘（20 件）。

来源与许可
----------
* Kenney（主，17 件）：https://kenney.nl/assets/<pack>，逐包 CC0 1.0。
* Poly Haven（少量 hero，3 件）：https://polyhaven.com/a/<id>，CC0 1.0。
两者都是 CC0（attribution_required=false），但仍逐件记来源页、源件路径、sha256。

两条处理链（为什么不能直接拷贝源件）
------------------------------------
1) Kenney 视觉资产 -> 水密化：源件是「给渲染用」的开放曲面（锥桶没底、桶是敞口），
   而本项目既有口径（validate.py 的 MESH_WATERTIGHT）要求水密。
   处理：合并顶点 -> 封边界环 -> 去退化面 -> 修绕向（见 r4_common.make_watertight）。
   选件依据落 assets/validation/r4_source_scan.json（1033 个源件扫描，206 个过判据）。
2) Poly Haven hero -> 体素重采样：源件是多层薄板拼装的扫描资产，边界环太多，
   封口封不干净（实测 0/3 可水密）。处理：体素填充 + marching cubes 重采样成
   水密实体（体素边长逐件调，面数压在 hero 档 50000 预算内）。
   这是**确定性几何重采样**（纯 CPU），不是扩散/SDS 重建、不是生成式模型。

归一化（其余三步）
------------------
* 剥材质贴图（白模只要结构）：源件单件 100 KB–2 MB -> 剥后 KB 级；
* 标定到米制：各包尺度差 8 倍（路锥 0.094 m vs 木桶 0.760 m），按最大边真实尺寸标定；
* 贴地：最低点归零（z=0），场景混排时贴地偏移 = 0。

纪律：自报 UA、>=2 秒间隔、被拒即停；纯 CPU、无生成式模型、无模型权重。
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import time
import urllib.request

import r4_common as C

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROJ = os.path.abspath(os.path.join(ROOT, "..", ".."))
KENNY_DEST = os.path.join(PROJ, "var", "public-assets", "kenney")
PH_DEST = os.path.join(PROJ, "var", "public-assets", "polyhaven")
PROPS_DIR = os.path.join(ROOT, "assets", "geometry", "props")
SCAN_OUT = os.path.join(ROOT, "assets", "validation", "r4_prop_scan.json")
BUILD_OUT = os.path.join(ROOT, "assets", "validation", "r4_prop_build.json")
RECIPE_OUT = os.path.join(C.R4META, "prop_library_recipe.json")

UA = "MCode-R4/1.0 (SiMuseor asset research; white-model asset pipeline)"
SITE = "https://kenney.nl"
MIN_INTERVAL_S = 2.0
RETRY = 3

KENNY_LICENSE = {
    "spdx": "CC0-1.0",
    "source_url": None,
    "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
    "attribution_required": False,
    "credit": "Kenney（CC0 1.0）",
}
PH_LICENSE = {
    "spdx": "CC0-1.0",
    "source_url": None,
    "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
    "attribution_required": False,
    "credit": "Poly Haven（CC0 1.0）",
}

# ------------------------------------------------------------------ 零件库白名单（20 件）
# tier     = 用途分级（hero 近景主线 / mid 中景 / low 远景占位）
# target_m = 该件最大边的真实尺寸（米），用来把源件标定到米制
# voxel_m  = Poly Haven hero 件的体素重采样边长（米）
LIB = [
    # ---- Kenney 主库（17 件）：全部通过既有水密口径（读数见 r4_source_scan.json）
    dict(asset="prop_cone_traffic", name="cone", variant="traffic", tier="low",
         pack="city-kit-roads", model="construction-cone", target_m=0.75),
    dict(asset="prop_barrier_construction", name="barrier", variant="construction",
         tier="low", pack="city-kit-roads", model="construction-barrier", target_m=2.00),
    dict(asset="prop_fence_construction", name="fence", variant="construction",
         tier="low", pack="city-kit-roads", model="construction-fence", target_m=2.00),
    dict(asset="prop_sign_empty", name="sign", variant="empty", tier="low",
         pack="city-kit-roads", model="road-sign-empty", target_m=2.00),
    dict(asset="prop_tool_pickaxe", name="tool", variant="pickaxe", tier="low",
         pack="survival-kit", model="tool-pickaxe", target_m=0.95),
    dict(asset="prop_pipe_metal", name="pipe", variant="metal", tier="low",
         pack="prototype-kit", model="pipe", target_m=1.50),
    dict(asset="prop_bridge_pillar", name="pillar", variant="bridge", tier="low",
         pack="city-kit-roads", model="bridge-pillar", target_m=3.00),
    dict(asset="prop_awning_shop", name="awning", variant="shop", tier="low",
         pack="city-kit-commercial", model="detail-awning-wide", target_m=2.50),
    dict(asset="prop_fence_wood", name="fence", variant="wood", tier="low",
         pack="survival-kit", model="fence", target_m=2.00),
    dict(asset="prop_fence_fortified", name="fence", variant="fortified", tier="low",
         pack="survival-kit", model="fence-fortified", target_m=2.00),
    dict(asset="prop_signpost_wood", name="signpost", variant="wood", tier="low",
         pack="survival-kit", model="signpost", target_m=2.00),
    dict(asset="prop_tool_axe", name="tool", variant="axe", tier="low",
         pack="survival-kit", model="tool-axe", target_m=0.90),
    dict(asset="prop_tool_hammer", name="tool", variant="hammer", tier="low",
         pack="survival-kit", model="tool-hammer", target_m=0.70),
    dict(asset="prop_barrel_wood", name="barrel", variant="wood", tier="mid",
         pack="survival-kit", model="barrel", target_m=0.90),
    dict(asset="prop_dumpster_street", name="dumpster", variant="street", tier="mid",
         pack="city-kit-roads", model="dumpster", target_m=2.40),
    dict(asset="prop_pole_utility", name="pole", variant="utility", tier="mid",
         pack="city-kit-roads", model="electricity-pole", target_m=6.00),
    dict(asset="prop_ladder_wood", name="ladder", variant="wood", tier="mid",
         pack="prototype-kit", model="ladder", target_m=2.00),
    # ---- Poly Haven hero（3 件）：体素重采样成水密实体
    dict(asset="prop_crate_military", name="crate", variant="military", tier="hero",
         poly_id="old_military_crate", target_m=1.82, voxel_m=0.022),
    dict(asset="prop_armchair_lounge", name="armchair", variant="lounge", tier="hero",
         poly_id="ArmChair_01", target_m=1.07, voxel_m=0.016),
    dict(asset="prop_crate_wooden", name="crate", variant="wooden", tier="hero",
         poly_id="wooden_crate_01", target_m=1.20, voxel_m=0.020),
]

_last_call = [0.0]


# ------------------------------------------------------------------ HTTP
def _fetch(url, referer=None, timeout=240):
    """带节流与重试的 GET。自报 UA；被拒（401/403/429）立即抛错，不绕过。"""
    last = None
    for attempt in range(RETRY):
        dt = time.time() - _last_call[0]
        if dt < MIN_INTERVAL_S:
            time.sleep(MIN_INTERVAL_S - dt)
        _last_call[0] = time.time()
        headers = {"User-Agent": UA, "Accept": "*/*"}
        if referer:
            headers["Referer"] = referer
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                status = getattr(r, "status", 200)
                body = r.read()
            if status in (401, 403, 429):
                raise RuntimeError("被站点拒绝（HTTP %s），停止不绕过：%s" % (status, url))
            return body
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403, 429):
                raise RuntimeError("HTTP %s（站点拒绝，不绕过）：%s" % (exc.code, url)) from exc
            last = exc
        except Exception as exc:
            last = exc
        time.sleep(2.0 * (attempt + 1))
    raise RuntimeError("重试 %d 次仍失败：%s（%s）" % (RETRY, url, last))


# ------------------------------------------------------------------ 源件定位
def kenney_source(pack, model):
    """各包的网格目录名不统一（GLB format / GLTF format），逐个找。"""
    models_dir = os.path.join(KENNY_DEST, pack, "Models")
    for sub in ("GLB format", "GLTF format", "OBJ format"):
        p = os.path.join(models_dir, sub, model + ".glb")
        if os.path.exists(p):
            return p
        p = os.path.join(models_dir, sub, model + ".obj")
        if os.path.exists(p):
            return p
    raise RuntimeError("源件不存在（先跑 --probe 下载包）：%s/%s.*" % (pack, model))


def polyhaven_source(poly_id):
    """下 Poly Haven 的 1k glTF bundle（.gltf + .bin + 贴图），落 var/ 缓存。"""
    base = os.path.join(PH_DEST, poly_id)
    os.makedirs(base, exist_ok=True)
    gltf_path = os.path.join(base, "%s_1k.gltf" % poly_id)
    if not os.path.exists(gltf_path):
        meta = json.loads(_fetch("https://api.polyhaven.com/files/%s" % poly_id).decode("utf-8"))
        inner = meta["gltf"]["1k"]["gltf"]
        main = os.path.join(base, os.path.basename(inner["url"]))
        if not os.path.exists(main):
            with open(main, "wb") as fh:
                fh.write(_fetch(inner["url"]))
        if os.path.abspath(main) != os.path.abspath(gltf_path):
            shutil.copyfile(main, gltf_path)
        for rel_path, info in (inner.get("include") or {}).items():
            p = os.path.join(base, rel_path)
            if not os.path.exists(p):
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p, "wb") as fh:
                    fh.write(_fetch(info["url"]))
    return gltf_path


def source_path_of(entry):
    if entry.get("poly_id"):
        return polyhaven_source(entry["poly_id"]), "Poly Haven"
    return kenney_source(entry["pack"], entry["model"]), "Kenney"


# ------------------------------------------------------------------ 处理链
def load_merged(path):
    """读源件 -> 合并成一个网格（剥材质，白模只要结构）。"""
    import numpy as np
    import trimesh

    scene = trimesh.load(path, force="scene", process=False)
    geoms = list(scene.geometry.values()) if hasattr(scene, "geometry") else [scene]
    meshes = []
    for g in geoms:
        if hasattr(g, "to_mesh") and g is not scene:
            g = g.to_mesh()
        if len(getattr(g, "faces", [])) == 0:
            continue
        meshes.append(trimesh.Trimesh(vertices=np.asarray(g.vertices, float),
                                      faces=np.asarray(g.faces, np.int64),
                                      process=False))
    if not meshes:
        raise RuntimeError("源件里没有可用网格：%s" % path)
    if len(meshes) == 1:
        return meshes[0]
    verts = []
    faces = []
    for m in meshes:
        off = len(verts)
        verts.extend(np.asarray(m.vertices, float).tolist())
        faces.extend((np.asarray(m.faces, np.int64) + off).tolist())
    return trimesh.Trimesh(vertices=np.asarray(verts, float),
                            faces=np.asarray(faces, np.int64), process=False)


def voxel_remesh(mesh, voxel_m):
    """体素填充 + marching cubes：把视觉资产重采样成水密实体。

    这是确定性几何重采样（纯 CPU、无生成式模型、无权重下载），
    代价是丢失锐利边缘 —— 白模只要体量与结构，够用。
    """
    import numpy as np
    import trimesh

    v = mesh.voxelized(voxel_m)
    filled = v.fill()
    mat = filled.marching_cubes
    if isinstance(mat, tuple):
        return trimesh.Trimesh(vertices=mat[0], faces=mat[1], process=False)
    return mat


def measure(mesh):
    import numpy as np

    lo, hi = mesh.bounds
    size = hi - lo
    return {
        "faces": int(len(mesh.faces)),
        "vertices": int(len(mesh.vertices)),
        "bbox_min": [round(float(v), 4) for v in lo],
        "bbox_max": [round(float(v), 4) for v in hi],
        "size_m": [round(float(v), 4) for v in size],
        "max_dim_m": round(float(size.max()), 4),
        "watertight": bool(mesh.is_watertight),
        "winding_consistent": bool(mesh.is_winding_consistent),
        "degenerate_faces": int(np.sum(np.asarray(mesh.area_faces) < 1e-10)),
    }


def scan():
    rows = []
    for entry in LIB:
        rec = dict(entry)
        try:
            path, origin = source_path_of(entry)
            rec["source_file"] = os.path.relpath(path, PROJ)
            rec["origin"] = origin
            mesh = load_merged(path)
            raw = measure(mesh)
            rec["raw"] = raw
            rec["ok"] = True
            print("%-28s %-10s faces=%5d maxdim=%7.3f"
                  % (entry["asset"], origin, raw["faces"], raw["max_dim_m"]))
        except Exception as exc:
            rec["ok"] = False
            rec["error"] = "%s: %s" % (type(exc).__name__, exc)
            print("%-28s FAIL %s" % (entry["asset"], exc))
        rows.append(rec)
    C.write_json(SCAN_OUT, {"kind": "r4_prop_scan", "items": rows})
    return rows


def build():
    """归一化落盘：GLB（纯几何、贴地、标定到米制）+ 随图 sidecar + 库级配方。"""
    import numpy as np

    os.makedirs(PROPS_DIR, exist_ok=True)
    os.makedirs(C.R4META, exist_ok=True)
    rows = []
    recipe_variants = []
    for entry in LIB:
        asset = entry["asset"]
        path, origin = source_path_of(entry)
        mesh = load_merged(path)
        raw = measure(mesh)
        process = {"mode": "watertight_repair"}
        if entry.get("poly_id"):
            # Poly Haven hero：体素重采样（源件是扫描资产，边界环封不干净）
            voxel = entry["voxel_m"]
            mesh = voxel_remesh(mesh, voxel)
            while len(mesh.faces) > 48000 and voxel < 0.06:
                voxel *= 1.25
                mesh = voxel_remesh(load_merged(path), voxel)
            process = {"mode": "voxel_remesh", "voxel_m": round(voxel, 4),
                       "note": "扫描资产体素重采样成水密实体（确定性几何重采样）"}
        else:
            mesh, stats = C.make_watertight(mesh)
            process = {"mode": "watertight_repair",
                       "capped_loops": stats["capped_loops"],
                       "rounds": stats["rounds"]}
        fixed = measure(mesh)
        scale = entry["target_m"] / max(fixed["max_dim_m"], 1e-6)
        mesh.apply_scale(float(scale))
        mesh.apply_translation([0.0, 0.0, -float(mesh.bounds[0][2])])
        out = os.path.join(PROPS_DIR, asset + ".glb")
        C.export_clean_glb(mesh, out)
        stats = measure(mesh)
        lic = dict(PH_LICENSE if origin == "Poly Haven" else KENNY_LICENSE)
        if origin == "Kenney":
            lic["source_url"] = "%s/assets/%s" % (SITE, entry["pack"])
        else:
            lic["source_url"] = "https://polyhaven.com/a/%s" % entry["poly_id"]
        prov = {
            "origin": "public-download",
            "statement": "%s 官方包下载，剥材质后按米制标定" % origin,
            "source_url": lic["source_url"],
            "is_ai": 0,
            "source_pack": entry.get("pack") or entry.get("poly_id"),
            "source_model": entry.get("model") or entry.get("poly_id"),
            "source_file": os.path.relpath(path, PROJ).replace(os.sep, "/"),
            "source_sha256": C.sha256_file(path),
            "source_faces": raw["faces"],
            "scale_factor": round(float(scale), 5),
            "target_max_dim_m": entry["target_m"],
            "process": process,
        }
        recipe = {"recipe_id": "prop_library_street", "variant": asset,
                  "params": {"scale_factor": round(float(scale), 5),
                             "target_max_dim_m": entry["target_m"],
                             "process": process}}
        C.sidecar(os.path.join(PROPS_DIR, asset + ".json"),
                  asset_id="geometry/props/" + asset, name=asset, category="prop",
                  usage_level=entry["tier"], files=[out], license_block=lic,
                  provenance=prov, recipe=recipe, geometry=stats,
                  extra={"origin": origin})
        rows.append({"asset": asset, "origin": origin, "tier": entry["tier"],
                     "source_faces": raw["faces"], "faces": stats["faces"],
                     "vertices": stats["vertices"], "size_m": stats["size_m"],
                     "watertight": stats["watertight"],
                     "winding_consistent": stats["winding_consistent"],
                     "degenerate_faces": stats["degenerate_faces"],
                     "budget_faces": C.budget_for(entry["tier"]),
                     "process": process,
                     "file": C.rel(out), "bytes": os.path.getsize(out)})
        recipe_variants.append({
            "variant": asset, "name": entry["name"], "tier": entry["tier"],
            "usage_level": entry["tier"], "budget_faces": C.budget_for(entry["tier"]),
            "origin": origin, "source": entry.get("pack") or entry.get("poly_id"),
            "source_model": entry.get("model") or entry.get("poly_id"),
            "params": {"scale_factor": round(float(scale), 5),
                       "target_max_dim_m": entry["target_m"],
                       "process": process},
            "outputs": [C.rel(out)],
        })
        print("[build] %-28s %-10s tier=%-4s src=%6d -> faces=%6d %6.1f KB"
              % (asset, origin, entry["tier"], raw["faces"], stats["faces"],
                 os.path.getsize(out) / 1024.0))
    C.write_json(RECIPE_OUT, {
        "kind": "r4_recipe", "schema": C.RECIPE_SCHEMA,
        "recipe_id": "prop_library_street", "category": "prop",
        "semantic_category": "prop",
        "note": ("R4 道具零件库：Kenney 为主（17 件）＋ 少量 Poly Haven hero（3 件）。"
                 "variant 字段即资产名后缀；usage_level 即用途分级。"),
        "variants": recipe_variants,
    })
    C.write_json(BUILD_OUT, {"kind": "r4_prop_build", "items": rows,
                              "total": len(rows)})
    print("[build] 共 %d 件，配方：%s" % (len(rows), C.rel(RECIPE_OUT)))
    return rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="R4 道具零件库取材")
    ap.add_argument("--scan", action="store_true", help="清点白名单源件")
    ap.add_argument("--build", action="store_true", help="归一化落盘（GLB + sidecar + 配方）")
    args = ap.parse_args()
    if args.scan:
        scan()
    if args.build:
        build()
