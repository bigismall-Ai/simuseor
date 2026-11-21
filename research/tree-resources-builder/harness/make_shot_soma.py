"""生成 5 秒竖切片的 SOMA/ANNY 行走序列（CPU，逐帧顶点 + 关节）。

输出 assets/nongeometry/shot001_hero.npz 与 shot001_meta.json。
需在 var/soma-venv 下运行。

存储格式（--store）
--------------------
baked（默认，向后兼容）：每帧存全量烘焙顶点 (N, V, 3)。
pose（新增）：只存每帧的 77 关节轴角 + 根位移，顶点由 SOMA 前向**逐点无损重建**。
为什么 pose 更合适：顶点是神经网络的**前向输出**，不是独立资产；
烘焙顶点让体积涨了 57 倍（6.19 MB -> 108 KB），却没有任何额外信息量。
两种格式并存：默认行为不变，新格式是并行的第二条路。
"""
from __future__ import annotations

import argparse
import json
import math
import os

import numpy as np
import torch
from scipy.spatial.transform import Rotation as Rot
from soma import SOMALayer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROJ = os.path.abspath(os.path.join(ROOT, "..", ".."))
DATA = os.path.join(PROJ, "var", "soma-assets")
NGEO = os.path.join(ROOT, "assets", "nongeometry")

FPS, DUR, CYCLE = 24, 5.0, 2.0
FRAMES = int(round(FPS * DUR))

layer = SOMALayer(data_root=DATA, device="cpu", mode="dense",
                  identity_model_type="anny", lod="low", correctives_model_path=None)
NAMES = [str(x) for x in layer._public_joint_names]
IDX = {n: i for i, n in enumerate(NAMES[1:])}
IDENT = torch.tensor([[0.5, 0.85, 0.5, 0.5, 0.45, 0.5]], dtype=torch.float32)


def pose_at(phase: float):
    p = torch.zeros(1, 77, 3)

    def rot(name, axis, deg):
        p[0, IDX[name], axis] = math.radians(deg)

    s = math.sin(phase)
    rot("Hips", 1, 2.5 * s)
    rot("Spine2", 1, -1.2 * s)
    rot("Chest", 1, 1.0 * s)
    rot("LeftLeg", 0, 20.0 * s)
    rot("RightLeg", 0, -20.0 * s)
    rot("LeftShin", 0, 26.0 * max(0.0, math.sin(phase + math.pi / 2)))
    rot("RightShin", 0, 26.0 * max(0.0, math.sin(phase + 3 * math.pi / 2)))
    rot("LeftFoot", 0, -8.0 * s)
    rot("RightFoot", 0, 8.0 * s)
    # 手臂：先绕 Z 放下（A-pose），再绕 X 前后摆
    def arm_aa(zdeg, xdeg):
        r = Rot.from_euler("z", zdeg, degrees=True) * Rot.from_euler("x", xdeg, degrees=True)
        return r.as_rotvec()
    p[0, IDX["LeftArm"]] = torch.tensor(arm_aa(-58, -11 * s), dtype=torch.float32)
    p[0, IDX["RightArm"]] = torch.tensor(arm_aa(58, 11 * s), dtype=torch.float32)
    return p


def forward(phase):
    with torch.no_grad():
        out = layer(pose_at(phase), IDENT, apply_correctives=False)
    v = out.vertices[0].numpy().astype(np.float64)
    j = out.joints[0].numpy().astype(np.float64)
    # Y-up -> Z-up: (x, -z, y)
    v = np.column_stack([v[:, 0], -v[:, 2], v[:, 1]])
    j = np.column_stack([j[:, 0], -j[:, 2], j[:, 1]])
    # 逐帧落地：保证最低点 z=0（把腿部摆动带来的身体起伏保留下来）
    dz = float(v[:, 2].min())
    v[:, 2] -= dz
    j[:, 2] -= dz
    return v, j


def main():
    ap = argparse.ArgumentParser(description="生成 SOMA/ANNY 行走序列")
    ap.add_argument("--store", choices=("baked", "pose"), default="baked",
                    help="帧序列存储格式：baked=每帧烘焙顶点（默认）；pose=只存姿态+根位移")
    ap.add_argument("--name", default="shot001",
                    help="输出名：baked -> <name>_hero.npz，pose -> <name>_pose.npz")
    ap.add_argument("--lateral-sway", type=float, default=None,
                    help="每帧横向平移（米）。默认 baked=0.012 / pose=0；"
                         "pose 存储要求 0：横向平移不属于姿态，存不进 pose 就无法重建"
                         "（shot003 用 0，摆动由 Hips 偏航承担）")
    args = ap.parse_args()

    # 横向平移是烘焙在顶点上的，不是姿态的一部分：pose 存储必须为 0，否则无法重建
    sway = args.lateral_sway
    if sway is None:
        sway = 0.0 if args.store == "pose" else 0.012
    if args.store == "pose" and sway != 0.0:
        raise SystemExit("--store pose 要求 --lateral-sway 0：顶点必须只由 pose+root_y 决定")

    # 1) 中性帧与脚趾索引
    v0, j0 = forward(0.0)
    ground = 0.0
    TOE_L, TOE_R = NAMES.index("LeftToeBase"), NAMES.index("RightToeBase")
    ANK_L, ANK_R = NAMES.index("LeftFoot"), NAMES.index("RightFoot")

    # 2) 逐帧生成局部坐标（脚底落地）+ 记录姿态（pose 存储的源数据）
    local_v, local_j, poses = [], [], []
    for f in range(FRAMES):
        ph = 2 * math.pi * (f / FPS) / CYCLE
        v, j = forward(ph)
        local_v.append(v)
        local_j.append(j)
        poses.append(pose_at(ph)[0].numpy().astype(np.float32))

    # 3) 脚锁式根位移：用「踝关节」判断支撑脚，避免脚趾滚动带来的假位移
    root_y = [0.0]
    vel = 0.0
    for f in range(1, FRAMES):
        al = ANK_L if local_j[f][ANK_L, 2] <= local_j[f][ANK_R, 2] else ANK_R
        ap = ANK_L if local_j[f - 1][ANK_L, 2] <= local_j[f - 1][ANK_R, 2] else ANK_R
        if al == ap:
            vel = -(local_j[f][al, 1] - local_j[f - 1][ap, 1])
        root_y.append(root_y[-1] + vel)

    # 轻微平滑根速度（2 帧），再积分回位置
    vy = np.diff(np.array(root_y), prepend=root_y[0])
    vy = np.convolve(vy, np.ones(2) / 2, mode="same")
    root_y = np.cumsum(vy)
    root_y -= root_y[0]

    speed = float(abs(root_y[-1]) / ((FRAMES - 1) / FPS))
    speed = max(0.05, min(1.5, speed))
    print("foot-lock root travel", round(float(root_y[-1]), 3), "m, speed", round(speed, 3), "m/s")

    verts, joints = [], []
    for f in range(FRAMES):
        ph = 2 * math.pi * (f / FPS) / CYCLE
        v = local_v[f].copy()
        j = local_j[f].copy()
        dx = sway * math.sin(ph)
        v[:, 0] += dx
        j[:, 0] += dx
        v[:, 1] += root_y[f]
        j[:, 1] += root_y[f]
        verts.append(v.astype(np.float32))
        joints.append(j.astype(np.float32))

    faces = layer.faces.numpy().astype(np.int32)
    os.makedirs(NGEO, exist_ok=True)

    meta = {"kind": f"{args.name}_hero", "backend": "anny", "fps": FPS, "duration_s": DUR,
            "frames": FRAMES, "cycle_s": CYCLE, "root_speed_mps": round(speed, 3),
            "root_travel_m": round(float(root_y[-1]), 3),
            "ground_offset_m": 0.0, "vertices": int(verts[0].shape[0]),
            "faces": int(faces.shape[0]), "joints": int(joints[0].shape[0]),
            "lateral_sway_m": sway,
            "note": "SOMA 姿态空间直接生成步态；根节点沿 -Y（面向摄像机）前进"}

    if args.store == "pose":
        # pose 存储：顶点不落盘，用 pose + 根位移可逐点无损重建
        from pose_store import save_pose_sequence
        meta = {"kind": f"{args.name}_pose", "store": "pose", "backend": "anny",
                "identity_model_type": "anny", "lod": "low",
                "identity_coeffs": [0.5, 0.85, 0.5, 0.5, 0.45, 0.5],
                "data_root": os.path.relpath(DATA, PROJ).replace("\\", "/"),
                "fps": FPS, "duration_s": DUR, "frames": FRAMES, "cycle_s": CYCLE,
                "root_speed_mps": round(speed, 3),
                "root_travel_m": round(float(root_y[-1]), 3),
                "vertices": int(verts[0].shape[0]), "faces": int(faces.shape[0]),
                "joints": int(joints[0].shape[0]),
                "coordinate": "SOMA Y-up -> 项目 Z-up (x,-z,y)；逐帧贴地 z-=min(z)；根位移 +Y",
                "note": "pose 版帧序列：顶点 = SOMA 前向输出，可由 poses+root_y 逐点无损重建"}
        out = os.path.join(NGEO, f"{args.name}_pose.npz")
        save_pose_sequence(out, np.stack(poses), np.stack(joints), faces,
                           np.array(root_y, dtype=np.float32), meta)
        print(json.dumps(meta, ensure_ascii=False))
        print("saved", out, os.path.getsize(out), "bytes")
        return

    np.savez_compressed(os.path.join(NGEO, f"{args.name}_hero.npz"),
                        vertices=np.stack(verts), joints=np.stack(joints), faces=faces,
                        root_y=np.array(root_y, dtype=np.float32))
    with open(os.path.join(NGEO, f"{args.name}_meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(json.dumps(meta, ensure_ascii=False))


if __name__ == "__main__":
    main()
