"""Pose 序列存储层：帧序列的中间表示从「烘焙顶点」改为「pose + 根位移」。

用途
----
* ``save_pose_sequence`` / ``load_pose_sequence``：读写 pose 版帧序列（npz）。
* ``rebuild_vertices`` / ``rebuild_joints`` / ``rebuild_sequence``：用 pose 逐帧重建顶点。
* 命令行 ``--rebuild``：给「没有 torch 的解释器」用（渲染侧 .venv），
  由 soma-venv 子进程把 pose 还原成顶点。

用法
----
    from pose_store import save_pose_sequence, load_pose_sequence, rebuild_vertices
    save_pose_sequence(path, poses, joints, faces, root_y, meta)
    seq = load_pose_sequence(path)
    verts = rebuild_vertices(seq["poses"], layer, ident, seq["root_y"])

    # 跨解释器（渲染在 .venv，重建在 soma-venv）
    python pose_store.py --rebuild seq.npz --out verts.npz

设计理由
--------
1. **pose 才是源数据，顶点只是前向输出的缓存。**
   SOMA-X 是神经网络：顶点 = f(pose)。烘焙顶点是把「结果」当「资产」存，
   体积 = N x V x 3 x 4B（120 帧 x 4505 顶点 = 6.19 MB）；
   只存 pose = N x 77 x 3 x 4B（108 KB），约 57x，且可逐点无损重建。

2. **重建必须与直接前向逐位一致，否则画面会漂移。**
   * 逐帧前向（batch=1）。批量前向与逐帧前向**数值不等价**（实测差 ~3e-5 m）：
     蒙皮走稀疏矩阵乘法，批量规模会改变浮点求和顺序，误差远大于 float32 精度极限。
   * 坐标变换顺序照抄已验证路径：Y-up -> Z-up (x, -z, y) -> 逐帧贴地 (z -= min z)
     -> 根位移沿 +Y。
   * 中间量用 float64，最后一步才降到 float32（与生成脚本保持一致）。

3. **跨解释器**：渲染跑在 .venv（无 torch），重建跑在 soma-venv（有 torch）。
   渲染侧用子进程调用本模块的 CLI 拿顶点，渲染本身仍在 .venv 完成
   （imageio_ffmpeg 只装在 .venv，MP4 编码留在那里最省事）。
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROJ = os.path.abspath(os.path.join(ROOT, "..", ".."))

DEFAULT_DATA_ROOT = os.path.join(PROJ, "var", "soma-assets")
IDENT_ANNY = [0.5, 0.85, 0.5, 0.5, 0.45, 0.5]

# 关节索引约定：SOMA 输出的 joints 是 77 个公共关节（不含 Root），
# 顺序与 layer._public_joint_names[1:] 一致。
# 项目里「踝关节」统一取 70/75（make_shot_soma / render_shot / rescore_shot 口径一致）。
ANK_L, ANK_R = 70, 75


# ------------------------------------------------------------------ 存取
def save_pose_sequence(path, poses, joints, faces, root_y, meta):
    """保存 pose 版帧序列。

    参数
    ----
    path   : npz 路径
    poses  : (N, 77, 3) float32，每帧 77 关节的轴角
    joints : (N, 77, 3) float32，世界坐标下的关节位置（已含根位移）
    faces  : (F, 3) int32，网格拓扑（所有帧共用）
    root_y : (N,) float32，根节点沿 +Y 的位移
    meta   : dict 或 str；dict 会被序列化成 JSON 字符串存进 npz
    """
    poses = np.ascontiguousarray(poses, dtype=np.float32)
    joints = np.ascontiguousarray(joints, dtype=np.float32)
    faces = np.ascontiguousarray(faces, dtype=np.int32)
    root_y = np.ascontiguousarray(root_y, dtype=np.float32).reshape(-1)
    if poses.ndim != 3 or poses.shape[1:] != (77, 3):
        raise ValueError(f"poses 形状应为 (N,77,3)，实际 {poses.shape}")
    if joints.shape != poses.shape:
        raise ValueError(f"joints 形状应与 poses 一致，实际 {joints.shape}")
    if root_y.shape[0] != poses.shape[0]:
        raise ValueError(f"root_y 长度应为 {poses.shape[0]}，实际 {root_y.shape}")
    meta_text = meta if isinstance(meta, str) else json.dumps(meta, ensure_ascii=False)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    np.savez_compressed(path, poses=poses, joints=joints, faces=faces,
                        root_y=root_y, meta=meta_text)
    return path


def load_pose_sequence(path):
    """读取 pose 版帧序列，返回 dict(poses, joints, faces, root_y, meta)。"""
    with np.load(path, allow_pickle=False) as z:
        poses = z["poses"]
        joints = z["joints"]
        faces = z["faces"]
        root_y = z["root_y"]
        raw = z["meta"]
    text = raw.item() if getattr(raw, "shape", ()) == () else str(raw)
    try:
        meta = json.loads(text)
    except (TypeError, ValueError):
        meta = {"raw": text}
    return {"poses": poses, "joints": joints, "faces": faces,
            "root_y": root_y, "meta": meta}


# ------------------------------------------------------------------ 重建
def make_layer(meta=None, data_root=None, device="cpu"):
    """按 meta 里的身份参数构造 SOMA 层（延迟 import soma，.venv 下也能 import 本模块）。"""
    from soma import SOMALayer

    meta = meta or {}
    root = data_root or meta.get("data_root") or DEFAULT_DATA_ROOT
    if not os.path.isabs(root):  # meta 里存的是相对仓库根的路径
        root = os.path.join(PROJ, root)
    return SOMALayer(data_root=root, device=device, mode="dense",
                     identity_model_type=meta.get("identity_model_type", "anny"),
                     lod=meta.get("lod", "low"), correctives_model_path=None)


def identity_tensor(meta=None, batch=1):
    """构造 (batch, K) 身份系数张量。"""
    import torch

    coeffs = np.asarray((meta or {}).get("identity_coeffs", IDENT_ANNY), dtype=np.float32)
    ident = torch.tensor(coeffs, dtype=torch.float32).reshape(1, -1)
    return ident.repeat(batch, 1)


def _yup_to_zup(arr):
    """SOMA 原生 Y-up -> 项目 Z-up：(x, y, z) -> (x, -z, y)。"""
    return np.column_stack([arr[:, 0], -arr[:, 2], arr[:, 1]])


def to_world(vertices, joints, root_y=None):
    """把一帧的前向输出搬到项目世界坐标：Y-up->Z-up、逐帧贴地、根位移。

    顺序与生成脚本（make_shot_soma / retarget_bvh_to_soma）**逐行一致**，
    任何一步换序都会让重建结果与烘焙结果对不上。
    """
    v = np.asarray(vertices, dtype=np.float64)
    j = np.asarray(joints, dtype=np.float64)
    v = _yup_to_zup(v)
    j = _yup_to_zup(j)
    dz = float(v[:, 2].min())
    v[:, 2] -= dz
    j[:, 2] -= dz
    if root_y is not None:
        v[:, 1] += float(root_y)
        j[:, 1] += float(root_y)
    return v, j


def _forward_frame(layer, ident, pose):
    """逐帧前向。

    为什么逐帧而不是批量：批量前向与逐帧前向在浮点上不等价（稀疏蒙皮的求和顺序随
    批量规模变化，实测顶点差 ~3e-5 m），会破坏「pose 重建 == 直接前向」的无损前提。
    """
    import torch

    p = torch.as_tensor(np.asarray(pose, dtype=np.float32)).reshape(1, 77, 3)
    with torch.no_grad():
        out = layer(p, ident, apply_correctives=False)
    return (out.vertices[0].numpy().astype(np.float64),
            out.joints[0].numpy().astype(np.float64))


def rebuild_sequence(poses, layer, ident, root_y=None):
    """用 pose 重建整段序列，返回 dict(vertices (N,V,3), joints (N,77,3))，float32。"""
    poses = np.asarray(poses, dtype=np.float32)
    if poses.ndim != 3 or poses.shape[1:] != (77, 3):
        raise ValueError(f"poses 形状应为 (N,77,3)，实际 {poses.shape}")
    n = poses.shape[0]
    verts, joints = [], []
    for f in range(n):
        v, j = _forward_frame(layer, ident, poses[f])
        ry = None if root_y is None else float(np.asarray(root_y).reshape(-1)[f])
        v, j = to_world(v, j, ry)
        verts.append(v.astype(np.float32))
        joints.append(j.astype(np.float32))
    return {"vertices": np.stack(verts), "joints": np.stack(joints)}


def rebuild_vertices(poses, layer, ident, root_y=None):
    """重建顶点，返回 (N, V, 3) float32。root_y 传入时附加根位移。"""
    return rebuild_sequence(poses, layer, ident, root_y)["vertices"]


def rebuild_joints(poses, layer, ident, root_y=None):
    """重建关节，返回 (N, 77, 3) float32。"""
    return rebuild_sequence(poses, layer, ident, root_y)["joints"]


# ------------------------------------------------------------------ 跨解释器
def default_soma_python():
    """soma-venv 的解释器路径（有 torch + soma 的那个环境）。"""
    exe = "python.exe" if os.name == "nt" else "python"
    for rel in (("var", "soma-venv", "Scripts", exe),
                ("var", "soma-venv", "bin", exe)):
        p = os.path.join(PROJ, *rel)
        if os.path.exists(p):
            return p
    return None


def rebuild_file(seq_path, out_path, data_root=None):
    """读 pose 序列 -> 重建顶点 -> 写 npz(vertices/joints/faces/root_y)。"""
    seq = load_pose_sequence(seq_path)
    meta = seq["meta"]
    layer = make_layer(meta, data_root=data_root)
    ident = identity_tensor(meta, batch=1)
    out = rebuild_sequence(seq["poses"], layer, ident, seq["root_y"])
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    np.savez_compressed(out_path, vertices=out["vertices"], joints=out["joints"],
                        faces=seq["faces"], root_y=seq["root_y"])
    return out_path


def ensure_rebuilt(seq_path, out_path, python_exe=None, data_root=None):
    """确保有顶点可渲染：当前解释器有 torch 就直接重建，否则起 soma-venv 子进程。

    为什么需要这一步：渲染脚本跑在 .venv（只有 numpy/trimesh/PIL，没有 torch），
    而顶点重建需要 soma-venv 的 torch + soma 权重。两条路都保留，
    这样同一个渲染脚本在哪个解释器里都能跑。
    """
    try:
        import torch  # noqa: F401
        import soma  # noqa: F401
    except Exception:
        torch = None
    if torch is not None:
        return rebuild_file(seq_path, out_path, data_root=data_root)
    exe = python_exe or default_soma_python()
    if not exe or not os.path.exists(exe):
        raise RuntimeError(
            "当前解释器没有 torch，且找不到 soma-venv 解释器；"
            "请用 --soma-python 指定 var/soma-venv/Scripts/python.exe")
    subprocess.run([exe, os.path.join(HERE, "pose_store.py"),
                    "--rebuild", seq_path, "--out", out_path], check=True)
    return out_path


# ------------------------------------------------------------------ CLI
def main(argv=None):
    ap = argparse.ArgumentParser(description="pose 序列存储工具")
    ap.add_argument("--rebuild", metavar="SEQ.npz", help="把 pose 序列重建为顶点 npz")
    ap.add_argument("--out", metavar="VERTS.npz", help="重建结果输出路径")
    ap.add_argument("--info", metavar="SEQ.npz", help="打印序列信息")
    ap.add_argument("--data-root", default=None, help="SOMA 权重目录（默认取 meta）")
    args = ap.parse_args(argv)

    if args.info:
        seq = load_pose_sequence(args.info)
        meta = seq["meta"]
        print(json.dumps({
            "path": args.info, "frames": int(seq["poses"].shape[0]),
            "poses": list(seq["poses"].shape), "joints": list(seq["joints"].shape),
            "faces": list(seq["faces"].shape), "root_y": list(seq["root_y"].shape),
            "bytes": os.path.getsize(args.info), "meta": meta,
        }, ensure_ascii=False, indent=2))
        return 0

    if args.rebuild:
        if not args.out:
            ap.error("--rebuild 需要 --out")
        rebuild_file(args.rebuild, args.out, data_root=args.data_root)
        print("rebuilt", args.out, os.path.getsize(args.out), "bytes")
        return 0

    ap.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
