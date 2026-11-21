"""OpenUSD 汇合层：几何 + 相机时序 + 骨骼 + 特效代理写入单一 USDA 舞台（CPU）。

USD 不是渲染器，而是「几何白模 / 非几何参考 / 时序」的统一容器。
"""
from __future__ import annotations

import os

import numpy as np
from pxr import Gf, Sdf, Usd, UsdGeom, UsdSkel, Vt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _mesh_prim(stage, path, mesh, color=(0.85, 0.86, 0.88), transform=None):
    prim = UsdGeom.Mesh.Define(stage, path)
    v = mesh.vertices.astype(np.float32)
    prim.CreatePointsAttr([Gf.Vec3f(*map(float, p)) for p in v])
    prim.CreateFaceVertexCountsAttr([3] * len(mesh.faces))
    prim.CreateFaceVertexIndicesAttr([int(i) for i in mesh.faces.reshape(-1)])
    prim.CreateExtentAttr([Gf.Vec3f(*map(float, mesh.bounds[0])), Gf.Vec3f(*map(float, mesh.bounds[1]))])
    prim.CreateDoubleSidedAttr(True)
    pv = UsdGeom.PrimvarsAPI(prim).CreatePrimvar(
        "displayColor", Sdf.ValueTypeNames.Color3fArray, UsdGeom.Tokens.constant)
    pv.Set([Gf.Vec3f(*color)])
    if transform is not None:
        m = np.asarray(transform, float).reshape(4, 4)
        xf = UsdGeom.Xformable(prim.GetPrim())
        xf.AddTranslateOp().Set(Gf.Vec3d(*m[:3, 3]))
    return prim


def export_usd(out, cam_data, path):
    stage = Usd.Stage.CreateNew(path)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    world = UsdGeom.Xform.Define(stage, "/World")
    stage.SetDefaultPrim(world.GetPrim())

    # 1) 场景几何（只放白模主对象，避免文件过大）
    geo = UsdGeom.Xform.Define(stage, "/World/Geo")
    items = {n: (m, tf) for n, m, tf in out["scene"]["items"]}
    keep = [("hero", (0.93, 0.93, 0.94)), ("hero_jacket", (0.74, 0.79, 0.88)),
            ("building_a", (0.88, 0.88, 0.87)), ("building_b", (0.88, 0.88, 0.87)),
            ("car_a", (0.84, 0.87, 0.91)), ("car_b", (0.84, 0.87, 0.91)),
            ("tree_a", (0.78, 0.75, 0.70)), ("tree_b", (0.78, 0.75, 0.70)),
            ("ground", (0.90, 0.91, 0.92))]
    for name, color in keep:
        if name not in items:
            continue
        m, tf = items[name]
        _mesh_prim(stage, f"/World/Geo/{name}", m, color, tf)

    # 2) 相机 + 时序（非几何参考的核心）
    cam = UsdGeom.Camera.Define(stage, "/World/Camera")
    s0 = cam_data["samples"][0]
    cam.CreateFocalLengthAttr(float(s0["focal_mm"]))
    cam.CreateHorizontalApertureAttr(36.0)
    cam.CreateClippingRangeAttr(Gf.Vec2f(0.1, 200.0))
    xf = UsdGeom.Xformable(cam.GetPrim())
    tr = xf.AddTranslateOp()
    rt = xf.AddRotateXYZOp()
    tr.Set(Gf.Vec3d(*s0["eye"]))
    rt.Set(Gf.Vec3f(*_look_at_rot(s0["eye"], s0["target"])))
    for sp in cam_data["samples"][::6]:
        t = Usd.TimeCode(sp["t"])
        tr.Set(Gf.Vec3d(*sp["eye"]), t)
        rt.Set(Gf.Vec3f(*_look_at_rot(sp["eye"], sp["target"])), t)
        cam.GetFocalLengthAttr().Set(float(sp["focal_mm"]), t)

    # 3) 骨骼（UsdSkel，供动作/人群管线消费）
    try:
        rig_path = os.path.join(ROOT, "assets", "nongeometry", "character_rig.json")
        import json
        rig = json.load(open(rig_path, encoding="utf-8"))
        names = [j["name"] for j in rig["joints"]]
        skel = UsdSkel.Skeleton.Define(stage, "/World/Character/Skeleton")
        skel.CreateJointsAttr(Vt.TokenArray(names))
        rest = []
        for j in rig["joints"]:
            q = np.eye(4)
            q[:3, 3] = j["rest"]
            rest.append(Gf.Matrix4d(*[float(x) for x in q.T.reshape(-1)]))
        if hasattr(skel, "CreateRestTransformsAttr"):
            skel.CreateRestTransformsAttr(Vt.Matrix4dArray(rest))
        skel_ok = True
    except Exception as exc:  # 诚实记录，不掩盖失败
        skel_ok = str(exc)

    # 4) 特效体积代理（球串）
    fx = out["fx"]["data"]
    for i, s in enumerate(fx["volume_series"][::4]):
        sph = UsdGeom.Sphere.Define(stage, f"/World/FX/VolumeProxy_{i:02d}")
        sph.CreateRadiusAttr(float(s["radius"]))
        UsdGeom.Xformable(sph.GetPrim()).AddTranslateOp().Set(Gf.Vec3d(*s["center"]))
        UsdGeom.Gprim(sph.GetPrim()).CreateDisplayColorAttr([Gf.Vec3f(0.86, 0.82, 0.88)])

    stage.GetRootLayer().Save()
    return {"path": os.path.relpath(path, ROOT), "skeleton": skel_ok,
            "prims": len(stage.GetPrimAtPath("/World").GetChildren()),
            "camera_keys": len(cam_data["samples"])}


def _look_at_rot(eye, target):
    """USD 相机看向 -Z、+Y 为上：返回 XYZ 欧拉角（度）。"""
    eye = np.asarray(eye, float)
    tgt = np.asarray(target, float)
    f = tgt - eye
    f /= np.linalg.norm(f)
    z = -f
    up = np.array([0.0, 0.0, 1.0])
    x = np.cross(up, z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    m = np.stack([x, y, z], axis=1)
    sy = -m[2, 0]
    ry = np.arcsin(np.clip(sy, -1, 1))
    rx = np.arctan2(m[2, 1], m[2, 2])
    rz = np.arctan2(m[1, 0], m[0, 0])
    return np.degrees([rx, ry, rz])
