"""用 ANNY 表型生成成人白模，并摆成 A-pose（手臂自然下垂），供场景主角使用。

表型顺序固定为 [gender, age, muscle, weight, height, proportions]（ANNY anchors 均为 0–1，
age 的锚点从 -0.333 起）。这里用身高搜索把结果压到 1.70–1.78 m。
"""
from __future__ import annotations

import json
import math
import os
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

J = None  # 关节名，延迟获取


def to_zup(mesh, joints):
    lo, hi = mesh.bounds
    if (hi - lo)[1] > (hi - lo)[2] * 1.2:
        m = np.eye(4)
        m[1, 1], m[1, 2], m[2, 1], m[2, 2] = 0, -1, 1, 0
        mesh = mesh.copy()
        mesh.apply_transform(m)
        joints = np.column_stack([joints[:, 0], -joints[:, 2], joints[:, 1]])
    return mesh, joints


def main():
    global J
    layer = SOMALayer(data_root=DATA, device="cpu", mode="dense",
                      identity_model_type="anny", lod="low", correctives_model_path=None)
    J = list(layer._public_joint_names)
    idx = {n: i for i, n in enumerate(J[1:])}  # 去掉 Root，poses 从 Hips 开始

    best = None
    for h in (0.35, 0.40, 0.45, 0.50, 0.55, 0.60):
        ident = torch.tensor([[0.5, 0.85, 0.5, 0.5, h, 0.5]], dtype=torch.float32)
        with torch.no_grad():
            out = layer(torch.zeros(1, 77, 3), ident, apply_correctives=False)
        v = out.vertices[0].numpy()
        height = float(v[:, 1].max() - v[:, 1].min())  # Y-up
        print(f"[height] param={h} -> {height:.3f} m", flush=True)
        if best is None or abs(height - 1.75) < abs(best[1] - 1.75):
            best = (h, height, ident)

    h, height, ident = best
    print(f"[pick] height param={h}, measured={height:.3f} m", flush=True)

    poses = torch.zeros(1, 77, 3)
    # A-pose：模型为 Y-up，绕 Z（前后轴）旋转才能把手臂放下
    poses[0, idx["LeftArm"], 2] = math.radians(-58)
    poses[0, idx["RightArm"], 2] = math.radians(58)

    t0 = time.perf_counter()
    with torch.no_grad():
        out = layer(poses, ident, apply_correctives=False)
    ms = (time.perf_counter() - t0) * 1000
    times = [ms]
    with torch.no_grad():
        for _ in range(4):
            t = time.perf_counter()
            out = layer(poses, ident, apply_correctives=False)
            times.append((time.perf_counter() - t) * 1000)

    v = out.vertices[0].numpy()
    j = out.joints[0].numpy()
    mesh = trimesh.Trimesh(vertices=v, faces=layer.faces.numpy(), process=False)
    mesh, j = to_zup(mesh, j)
    ground = float(mesh.bounds[0][2])
    mesh.apply_translation((0, 0, -ground))
    j = j - np.array([0, 0, ground])

    path = os.path.join(GEO, "soma_anny_adult.glb")
    mesh.export(path, file_type="glb")
    np.save(os.path.join(NGEO, "soma_anny_adult_joints.npy"), j)
    with open(os.path.join(NGEO, "soma_anny_adult_joints.json"), "w", encoding="utf-8") as f:
        json.dump({"joints": np.round(j, 4).tolist(), "names": [str(x) for x in J]}, f, ensure_ascii=False)

    info = {"backend": "anny_adult", "vertices": int(len(mesh.vertices)), "faces": int(len(mesh.faces)),
            "watertight": bool(mesh.is_watertight),
            "bounds_m": [round(float(x), 3) for x in np.r_[mesh.bounds[0], mesh.bounds[1]]],
            "height_m": round(float(mesh.bounds[1][2] - mesh.bounds[0][2]), 3),
            "pose": "A-pose", "identity": [0.5, 0.85, 0.5, 0.5, h, 0.5],
            "forward_ms_median": round(float(np.median(times)), 2), "file": os.path.relpath(path, ROOT)}
    p = os.path.join(ROOT, "assets", "validation", "soma_anny_adult.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(info, f, ensure_ascii=False, indent=2)
    print(json.dumps(info, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
