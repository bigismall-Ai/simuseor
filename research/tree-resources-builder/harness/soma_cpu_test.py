"""本机 CPU 实测 SOMA-X：原生 SOMA 后端 + MHR 低模后端。

用法（需 var/soma-venv 与 var/soma-assets）：
  var\\soma-venv\\Scripts\\python.exe soma_cpu_test.py
"""
from __future__ import annotations

import json
import os
import statistics
import time

import numpy as np
import torch
import trimesh
from soma import SOMALayer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ = os.path.abspath(os.path.join(ROOT, "..", ".."))
DATA = os.path.join(PROJ, "var", "soma-assets")
GEO = os.path.join(ROOT, "assets", "geometry")
NGEO = os.path.join(ROOT, "assets", "nongeometry")


def to_zup(mesh):
    lo, hi = mesh.bounds
    size = hi - lo
    if size[1] > size[2] * 1.2:  # Y-up → Z-up
        m = np.eye(4)
        m[1, 1] = 0
        m[1, 2] = -1
        m[2, 1] = 1
        m[2, 2] = 0
        mesh = mesh.copy()
        mesh.apply_transform(m)
        return mesh, True
    return mesh, False


def build_and_run(identity_model_type, lod, out_name, identity_dim=None, scale_dim=None):
    print(f"[build] backend={identity_model_type} lod={lod}", flush=True)
    t0 = time.time()
    layer = SOMALayer(
        data_root=DATA,
        device="cpu",
        mode="dense",
        identity_model_type=identity_model_type,
        lod=lod,
        correctives_model_path=None,
    )
    print(f"[build] ok in {time.time() - t0:.2f}s, shape_components={layer.num_shape_components}", flush=True)
    poses = torch.zeros(1, 77, 3)
    identity = torch.zeros(1, identity_dim or layer.num_shape_components)
    scale = torch.zeros(1, scale_dim) if scale_dim else None
    with torch.no_grad():
        out = layer(poses, identity, scale_params=scale, apply_correctives=False)
    v = out.vertices[0].detach().cpu().numpy()
    j = out.joints[0].detach().cpu().numpy()
    verts = torch.as_tensor(v)
    print(f"[fwd] verts={verts.shape} joints={j.shape}", flush=True)

    # 计时（热身后 5 次）
    times = []
    with torch.no_grad():
        for _ in range(6):
            t = time.perf_counter()
            layer(poses, identity, scale_params=scale, apply_correctives=False)
            times.append((time.perf_counter() - t) * 1000)
    med = statistics.median(times[1:])
    print(f"[time] median={med:.1f} ms, all={[round(x,1) for x in times]}", flush=True)

    mesh = trimesh.Trimesh(vertices=v, faces=layer.faces.detach().cpu().numpy() if hasattr(layer, "faces")
                           else out.faces if hasattr(out, "faces") else None, process=False)
    if mesh.faces is None or len(mesh.faces) == 0:
        raise RuntimeError("无法获取面片索引")
    mesh, conv = to_zup(mesh)
    if conv:
        j = np.column_stack([j[:, 0], -j[:, 2], j[:, 1]])
    ground = float(mesh.bounds[0][2])
    if abs(ground) > 1e-3:
        mesh.apply_translation((0, 0, -ground))
        j = j - np.array([0, 0, ground])
    os.makedirs(GEO, exist_ok=True)
    path = os.path.join(GEO, out_name)
    mesh.export(path, file_type="glb")
    info = {
        "backend": identity_model_type,
        "lod": lod,
        "vertices": int(len(mesh.vertices)),
        "faces": int(len(mesh.faces)),
        "watertight": bool(mesh.is_watertight),
        "bounds_m": [round(float(x), 3) for x in np.r_[mesh.bounds[0], mesh.bounds[1]]],
        "axis_converted_to_zup": bool(conv),
        "ground_offset_m": round(ground, 3),
        "forward_ms_median": round(med, 2),
        "forward_ms_all": [round(x, 2) for x in times],
        "shape_components": int(layer.num_shape_components),
        "joints": int(j.shape[0]),
        "file": os.path.relpath(path, ROOT),
    }
    return info, mesh, j


def main():
    result = {"cpu_only": True, "torch": torch.__version__, "cuda_available": bool(torch.cuda.is_available()),
              "data_root": os.path.relpath(DATA, ROOT), "runs": []}
    info, mesh, joints = build_and_run("soma", "low", "soma_native_low.glb")
    result["runs"].append(info)
    np.save(os.path.join(NGEO, "soma_joints_low.npy"), joints)
    with open(os.path.join(NGEO, "soma_joints_low.json"), "w", encoding="utf-8") as f:
        json.dump({"joints": np.round(joints, 4).tolist()}, f)

    try:
        info2, mesh2, joints2 = build_and_run("mhr", "low", "soma_mhr_low.glb", identity_dim=45, scale_dim=68)
        result["runs"].append(info2)
    except Exception as exc:
        result["mhr_error"] = f"{type(exc).__name__}: {exc}"
        print("[mhr] failed:", exc, flush=True)

    try:
        info3, mesh3, joints3 = build_and_run("anny", "low", "soma_anny_low.glb", identity_dim=6)
        result["runs"].append(info3)
        np.save(os.path.join(NGEO, "soma_anny_joints_low.npy"), joints3)
    except Exception as exc:
        result["anny_error"] = f"{type(exc).__name__}: {exc}"
        print("[anny] failed:", exc, flush=True)

    out = os.path.join(ROOT, "assets", "validation", "soma_cpu_test.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
