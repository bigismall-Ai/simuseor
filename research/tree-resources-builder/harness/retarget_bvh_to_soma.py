"""V2b：把 BVH（21 关节）的语义动作重定向到 SOMA 77 关节，生成 2 秒序列。

说明：这是「语义映射」而非通用骨骼 IK 重定向——BVH 与本项目 SOMA 都是人形、Y-up，
因此按关节语义复制髋/膝/踝角度，手臂用 A-pose 基座 + 反向摆臂合成。

存储格式（--store）
--------------------
baked（默认，向后兼容）：每帧存全量烘焙顶点 (N, V, 3)。
pose（新增）：只存每帧 77 关节轴角 + 根位移，顶点由 SOMA 前向**逐点无损重建**。
本脚本没有额外的顶点后处理（没有横向平移），所以 pose + root_y 就完全决定顶点。
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

from validate import parse_bvh

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROJ = os.path.abspath(os.path.join(ROOT, "..", ".."))
DATA = os.path.join(PROJ, "var", "soma-assets")
NGEO = os.path.join(ROOT, "assets", "nongeometry")
BVH = os.path.join(NGEO, "motion_walk_2s.bvh")
FPS = 24

bvh = parse_bvh(BVH)
NODES = bvh["nodes"]
FRAMES = bvh["frames"]
DUR = FRAMES / FPS

layer = SOMALayer(data_root=DATA, device="cpu", mode="dense",
                  identity_model_type="anny", lod="low", correctives_model_path=None)
NAMES = [str(x) for x in layer._public_joint_names]
IDX = {n: i for i, n in enumerate(NAMES[1:])}
IDENT = torch.tensor([[0.5, 0.85, 0.5, 0.5, 0.45, 0.5]], dtype=torch.float32)
ANK_L, ANK_R = NAMES.index("LeftFoot"), NAMES.index("RightFoot")


def frame_channels(row):
    out = {}
    p = 0
    for n in NODES:
        c = n["channels"]
        out[n["name"]] = dict(zip(c, row[p:p + len(c)]))
        p += len(c)
    return out


def aa(z=0.0, x=0.0, y=0.0):
    return np.radians([x, y, z])


def build_pose(ch):
    p = torch.zeros(1, 77, 3)

    def put(name, vec):
        p[0, IDX[name]] = torch.tensor(vec, dtype=torch.float32)

    # 躯干：直接复制 Z/X/Y
    put("Hips", aa(ch["Hips"].get("Zrotation", 0), ch["Hips"].get("Xrotation", 0), ch["Hips"].get("Yrotation", 0)))
    put("Spine1", aa(ch["Spine"].get("Zrotation", 0) * 0.7, ch["Spine"].get("Xrotation", 0) * 0.7,
                     ch["Spine"].get("Yrotation", 0) * 0.7))
    put("Spine2", aa(ch["Chest"].get("Zrotation", 0) * 0.6, ch["Chest"].get("Xrotation", 0) * 0.6,
                     ch["Chest"].get("Yrotation", 0) * 0.6))
    put("Chest", aa(ch["Chest"].get("Zrotation", 0) * 0.4, 0, 0))
    put("Neck1", aa(ch["Neck"].get("Zrotation", 0) * 0.5, ch["Neck"].get("Xrotation", 0) * 0.5, 0))
    put("Head", aa(ch["Head"].get("Zrotation", 0), ch["Head"].get("Xrotation", 0), 0))

    # 腿：BVH 的 X 通道对应 SOMA 的前后摆
    for side in ("Left", "Right"):
        hip = ch[f"{side}Hip"].get("Xrotation", 0)
        knee = ch[f"{side}Knee"].get("Xrotation", 0)
        ankle = ch[f"{side}Ankle"].get("Xrotation", 0)
        put(f"{side}Leg", aa(x=hip))
        put(f"{side}Shin", aa(x=knee))
        put(f"{side}Foot", aa(x=ankle))

    # 手臂：A-pose 基座 + 与对侧腿反向摆动
    lswing = 0.9 * ch["RightHip"].get("Xrotation", 0)
    rswing = 0.9 * ch["LeftHip"].get("Xrotation", 0)
    lr = Rot.from_euler("z", -58, degrees=True) * Rot.from_euler("x", lswing, degrees=True)
    rr = Rot.from_euler("z", 58, degrees=True) * Rot.from_euler("x", rswing, degrees=True)
    p[0, IDX["LeftArm"]] = torch.tensor(lr.as_rotvec(), dtype=torch.float32)
    p[0, IDX["RightArm"]] = torch.tensor(rr.as_rotvec(), dtype=torch.float32)
    return p


def forward(ch):
    """前向一帧，返回 (世界坐标顶点, 世界坐标关节, 该帧姿态)。"""
    p = build_pose(ch)
    with torch.no_grad():
        out = layer(p, IDENT, apply_correctives=False)
    v = out.vertices[0].numpy().astype(np.float64)
    j = out.joints[0].numpy().astype(np.float64)
    v = np.column_stack([v[:, 0], -v[:, 2], v[:, 1]])
    j = np.column_stack([j[:, 0], -j[:, 2], j[:, 1]])
    dz = float(v[:, 2].min())
    v[:, 2] -= dz
    j[:, 2] -= dz
    return v, j, p[0].numpy().astype(np.float32)


def main():
    ap = argparse.ArgumentParser(description="BVH -> SOMA 语义重定向并生成帧序列")
    ap.add_argument("--store", choices=("baked", "pose"), default="baked",
                    help="帧序列存储格式：baked=每帧烘焙顶点（默认）；pose=只存姿态+根位移")
    ap.add_argument("--name", default="shot002",
                    help="输出名：baked -> <name>_hero.npz，pose -> <name>_pose.npz")
    args = ap.parse_args()

    local_v, local_j, poses = [], [], []
    for row in bvh["rows"]:
        v, j, p = forward(frame_channels(row))
        local_v.append(v)
        local_j.append(j)
        poses.append(p)

    # 踝关节脚锁（与 shot_001 同策略）
    root_y = [0.0]
    vel = 0.0
    for f in range(1, FRAMES):
        al = ANK_L if local_j[f][ANK_L, 2] <= local_j[f][ANK_R, 2] else ANK_R
        ap = ANK_L if local_j[f - 1][ANK_L, 2] <= local_j[f - 1][ANK_R, 2] else ANK_R
        if al == ap:
            vel = -(local_j[f][al, 1] - local_j[f - 1][ap, 1])
        root_y.append(root_y[-1] + vel)
    vy = np.diff(np.array(root_y), prepend=root_y[0])
    vy = np.convolve(vy, np.ones(2) / 2, mode="same")
    root_y = np.cumsum(vy)
    root_y -= root_y[0]

    verts, joints = [], []
    for f in range(FRAMES):
        v = local_v[f].copy()
        j = local_j[f].copy()
        v[:, 1] += root_y[f]
        j[:, 1] += root_y[f]
        verts.append(v.astype(np.float32))
        joints.append(j.astype(np.float32))

    faces = layer.faces.numpy().astype(np.int32)
    os.makedirs(NGEO, exist_ok=True)
    meta = {
        "kind": "shot002_bvh_retarget", "source_bvh": "assets/nongeometry/motion_walk_2s.bvh",
        "backend": "anny", "fps": FPS, "duration_s": round(DUR, 3), "frames": FRAMES,
        "root_speed_mps": round(float(abs(root_y[-1]) / ((FRAMES - 1) / FPS)), 3),
        "root_travel_m": round(float(root_y[-1]), 3), "vertices": int(verts[0].shape[0]),
        "faces": int(faces.shape[0]), "joints": int(joints[0].shape[0]),
        "method": "semantic_replay",
        "note": "BVH 的髋/膝/踝角度按语义复制到 SOMA；手臂用 A-pose 基座 + 对侧腿反向摆动；根位移用踝关节脚锁",
    }

    # 支撑脚滑步（与 make_shot_soma 同口径）
    slides = []
    for f in range(1, FRAMES):
        a = ANK_L if joints[f - 1][ANK_L, 2] <= joints[f - 1][ANK_R, 2] else ANK_R
        b = ANK_L if joints[f][ANK_L, 2] <= joints[f][ANK_R, 2] else ANK_R
        if a == b:
            pa, pb = joints[f - 1][a], joints[f][a]
            slides.append(float(np.hypot(pb[0] - pa[0], pb[1] - pa[1])))
    slides = np.array(slides) if slides else np.array([0.0])
    out = {"kind": "retarget_bvh", "frames": FRAMES, "duration_s": round(DUR, 3),
           "foot_slide_mean_m": round(float(slides.mean()), 4),
           "foot_slide_max_m": round(float(slides.max()), 4),
           "ground_min_z": round(float(min(v[:, 2].min() for v in verts)), 4),
           "method": "semantic_replay",
           "native_comparison": "shot_001: 0.47 cm mean / 3.03 cm max"}

    if args.store == "pose":
        from pose_store import rebuild_vertices, save_pose_sequence
        meta = {"kind": f"{args.name}_pose", "store": "pose", "backend": "anny",
                "identity_model_type": "anny", "lod": "low",
                "identity_coeffs": [0.5, 0.85, 0.5, 0.5, 0.45, 0.5],
                "data_root": os.path.relpath(DATA, PROJ).replace("\\", "/"),
                "source_bvh": "assets/nongeometry/motion_walk_2s.bvh",
                "fps": FPS, "duration_s": round(DUR, 3), "frames": FRAMES,
                "root_speed_mps": round(float(abs(root_y[-1]) / ((FRAMES - 1) / FPS)), 3),
                "root_travel_m": round(float(root_y[-1]), 3),
                "vertices": int(verts[0].shape[0]), "faces": int(faces.shape[0]),
                "joints": int(joints[0].shape[0]),
                "method": "semantic_replay",
                "coordinate": "SOMA Y-up -> 项目 Z-up (x,-z,y)；逐帧贴地 z-=min(z)；根位移 +Y",
                "note": "pose 版帧序列：顶点 = SOMA 前向输出，可由 poses+root_y 逐点无损重建"}
        path = os.path.join(NGEO, f"{args.name}_pose.npz")
        save_pose_sequence(path, np.stack(poses), np.stack(joints), faces,
                           np.array(root_y, dtype=np.float32), meta)
        # 自检：刚存下的 pose 必须能还原出刚才那份烘焙顶点
        rebuilt = rebuild_vertices(np.stack(poses), layer, IDENT,
                                   np.array(root_y, dtype=np.float32))
        err = float(np.abs(rebuilt - np.stack(verts)).max())
        meta["rebuild_max_err_m"] = err
        print(json.dumps(meta, ensure_ascii=False))
        print("saved", path, os.path.getsize(path), "bytes",
              "rebuild_max_err_m", err)
        return

    np.savez_compressed(os.path.join(NGEO, f"{args.name}_hero.npz"),
                        vertices=np.stack(verts), joints=np.stack(joints), faces=faces,
                        root_y=np.array(root_y, dtype=np.float32))
    with open(os.path.join(NGEO, f"{args.name}_meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    # 默认名 shot002 保持原来的产物路径；换名时验证文件跟着换名，避免覆盖别人的产物
    val_name = "retarget_bvh.json" if args.name == "shot002" else f"{args.name}_validation.json"
    with open(os.path.join(ROOT, "assets", "validation", val_name), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(json.dumps(meta, ensure_ascii=False))
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
