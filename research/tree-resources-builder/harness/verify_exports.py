"""回读校验：确认交付的 GLB/OBJ/STL/USDA/BVH 能被独立解析，而不是只存在于内存。"""
from __future__ import annotations

import json
import os
import struct

import trimesh
from pxr import Usd, UsdGeom, UsdSkel

from validate import parse_bvh

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO = os.path.join(ROOT, "assets", "geometry")
NGEO = os.path.join(ROOT, "assets", "nongeometry")
OUT = os.path.join(ROOT, "assets", "validation", "exports.json")


def glb_header(path):
    with open(path, "rb") as f:
        magic, version, length = struct.unpack("<4sII", f.read(12))
        chunk_len, chunk_type = struct.unpack("<I4s", f.read(8))
        chunk = f.read(min(chunk_len, 4096))
    return {"magic": magic.decode("ascii", "replace"), "version": version,
            "declared_bytes": length, "json_chunk": chunk_type.decode("ascii", "replace"),
            "has_nodes": b'"nodes"' in chunk, "has_meshes": b'"meshes"' in chunk}


def check_gltf(path):
    hdr = glb_header(path)
    scene = trimesh.load(path, force="scene")
    geoms = list(scene.geometry.values()) if hasattr(scene, "geometry") else [scene]
    faces = int(sum(len(g.faces) for g in geoms))
    verts = int(sum(len(g.vertices) for g in geoms))
    lo, hi = scene.bounds if hasattr(scene, "bounds") else (geoms[0].bounds[0], geoms[0].bounds[1])
    return {"file": os.path.relpath(path, ROOT), "type": "glb", "ok": hdr["magic"] == "glTF" and faces > 0,
            "nodes": len(scene.graph.nodes_geometry) if hasattr(scene, "graph") else 1,
            "geometries": len(geoms), "faces": faces, "vertices": verts,
            "bbox_m": [round(float(v), 3) for v in [*lo, *hi]], **hdr}


def check_obj(path):
    m = trimesh.load(path, force="mesh", process=False)
    return {"file": os.path.relpath(path, ROOT), "type": "obj", "ok": len(m.faces) > 0,
            "faces": int(len(m.faces)), "vertices": int(len(m.vertices))}


def check_stl(path):
    m = trimesh.load(path, force="mesh", process=False)
    return {"file": os.path.relpath(path, ROOT), "type": "stl", "ok": len(m.faces) > 0,
            "faces": int(len(m.faces)), "watertight": bool(m.is_watertight)}


def check_usd(path):
    stage = Usd.Stage.Open(path)
    prims = [p for p in stage.Traverse()]
    types = {}
    for p in prims:
        t = p.GetTypeName()
        types[t] = types.get(t, 0) + 1
    cam = stage.GetPrimAtPath("/World/Camera")
    skel = stage.GetPrimAtPath("/World/Character/Skeleton")
    joints = 0
    if skel and skel.IsValid():
        attr = UsdSkel.Skeleton(skel).GetJointsAttr()
        joints = len(attr.Get() or [])
    focal = None
    if cam and cam.IsValid():
        focal = UsdGeom.Camera(cam).GetFocalLengthAttr().Get()
    return {"file": os.path.relpath(path, ROOT), "type": "usda", "ok": len(prims) > 10 and joints > 0,
            "prims": len(prims), "types": {str(k): v for k, v in types.items()},
            "camera_focal_mm": focal, "skeleton_joints": joints,
            "up_axis": str(UsdGeom.GetStageUpAxis(stage))}


def main():
    rows = []
    for name in sorted(os.listdir(GEO)):
        p = os.path.join(GEO, name)
        if name.endswith(".glb"):
            rows.append(check_gltf(p))
        elif name.endswith(".obj"):
            rows.append(check_obj(p))
        elif name.endswith(".stl"):
            rows.append(check_stl(p))
        elif name.endswith(".usda"):
            rows.append(check_usd(p))
    bvh = parse_bvh(os.path.join(NGEO, "motion_walk_2s.bvh"))
    rows.append({"file": "assets/nongeometry/motion_walk_2s.bvh", "type": "bvh",
                 "ok": bvh["frames"] == 48 and len(bvh["nodes"]) >= 18,
                 "frames": bvh["frames"], "joints": len(bvh["nodes"]),
                 "frame_time": round(bvh["frame_time"], 6)})
    summary = {"total": len(rows), "passed": sum(1 for r in rows if r["ok"]),
               "failed": [r["file"] for r in rows if not r["ok"]]}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "files": rows}, f, ensure_ascii=False, indent=2)
    print(json.dumps(summary, ensure_ascii=False))
    for r in rows:
        print(f'  [{"OK" if r["ok"] else "FAIL"}] {r["file"]} ({r["type"]})')


if __name__ == "__main__":
    main()
