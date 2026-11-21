"""验证 pose 存储路径：重建无损、体积压缩、渲染等价。

跑法（需要有 torch + soma，即 soma-venv）：
    python test_pose_store.py

三项检查
--------
1. 重建无损：用 pose 重建 shot003 的顶点，与「同参数直接前向」逐点比对（最大误差 < 1e-6 m），
   同时与烘焙产物 shot003_hero.npz 的顶点比对。
2. 体积压缩：pose 序列 vs 同帧数的 baked 序列（要求 >= 40x）。
3. 端到端渲染等价：pose 路径渲染 24 帧 vs 同源 baked 路径渲染的 24 帧，逐像素 PSNR（> 35 dB）。
   渲染在 .venv 里跑（没有 torch），正好验证跨解释器那条路是通的。

产物：assets/validation/pose_store.json
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROJ = os.path.abspath(os.path.join(ROOT, "..", ".."))
NGEO = os.path.join(ROOT, "assets", "nongeometry")
VAL = os.path.join(ROOT, "assets", "validation")
CACHE = os.path.join(PROJ, "var", "pose_cache")

POSE_SEQ = os.path.join(NGEO, "shot003_pose.npz")
BAKED_SEQ = os.path.join(NGEO, "shot003_hero.npz")
REPORT = os.path.join(VAL, "pose_store.json")

TEST_FRAMES = 24
ERR_LIMIT = 1e-6
PSNR_LIMIT = 35.0
RATIO_LIMIT = 40.0

# 需要保证不被本次验证改动的既有产物
GUARDED = [
    os.path.join(NGEO, "shot001_hero.npz"),
    os.path.join(NGEO, "shot002_hero.npz"),
    os.path.join(ROOT, "shots", "shot_001", "previs.mp4"),
    os.path.join(VAL, "shot_001.json"),
]


def venv_python():
    for rel in ((".venv", "Scripts", "python.exe"), (".venv", "bin", "python")):
        p = os.path.join(PROJ, *rel)
        if os.path.exists(p):
            return p
    return None


def stamps(paths):
    out = {}
    for p in paths:
        if os.path.exists(p):
            st = os.stat(p)
            out[os.path.relpath(p, ROOT)] = {"size": st.st_size, "mtime": st.st_mtime}
        else:
            out[os.path.relpath(p, ROOT)] = None
    return out


def direct_forward(poses, root_y, meta):
    """独立实现的「已验证过的重建路径」（不调用 pose_store 的重建函数）。

    out = layer(pose, IDENT) -> v -> Y-up->Z-up -> 贴地 dz -> 根位移
    """
    import torch
    from soma import SOMALayer

    root = meta.get("data_root", "var/soma-assets")
    if not os.path.isabs(root):
        root = os.path.join(PROJ, root)
    layer = SOMALayer(data_root=root, device="cpu", mode="dense",
                      identity_model_type=meta.get("identity_model_type", "anny"),
                      lod=meta.get("lod", "low"), correctives_model_path=None)
    ident = torch.tensor([meta.get("identity_coeffs", [0.5, 0.85, 0.5, 0.5, 0.45, 0.5])],
                         dtype=torch.float32)
    out = []
    for f in range(poses.shape[0]):
        p = torch.as_tensor(np.asarray(poses[f], dtype=np.float32)).reshape(1, 77, 3)
        with torch.no_grad():
            o = layer(p, ident, apply_correctives=False)
        v = o.vertices[0].numpy().astype(np.float64)
        v = np.column_stack([v[:, 0], -v[:, 2], v[:, 1]])
        dz = float(v[:, 2].min())
        v[:, 2] -= dz
        v[:, 1] += float(root_y[f])
        out.append(v.astype(np.float32))
    return np.stack(out)


def check_rebuild():
    """检查 1：pose 重建 == 直接前向 == 烘焙顶点。"""
    from pose_store import identity_tensor, load_pose_sequence, make_layer, rebuild_vertices

    seq = load_pose_sequence(POSE_SEQ)
    meta = seq["meta"]
    layer = make_layer(meta)
    ident = identity_tensor(meta)
    t0 = time.time()
    rebuilt = rebuild_vertices(seq["poses"], layer, ident, seq["root_y"])
    dt = time.time() - t0
    direct = direct_forward(seq["poses"], seq["root_y"], meta)
    err_direct = float(np.abs(rebuilt - direct).max())
    res = {"frames": int(seq["poses"].shape[0]), "vertices": int(rebuilt.shape[1]),
           "rebuild_seconds": round(dt, 2),
           "max_err_vs_direct_forward_m": err_direct,
           "limit_m": ERR_LIMIT, "pass": bool(err_direct < ERR_LIMIT)}
    if os.path.exists(BAKED_SEQ):
        baked = np.load(BAKED_SEQ)["vertices"]
        err_baked = float(np.abs(rebuilt - baked).max())
        res["max_err_vs_baked_npz_m"] = err_baked
        res["baked_identical"] = bool(np.array_equal(rebuilt, baked))
        res["pass"] = bool(res["pass"] and err_baked < ERR_LIMIT)
    return res


def check_size():
    """检查 2：体积压缩比。"""
    size_pose = os.path.getsize(POSE_SEQ)
    size_baked = os.path.getsize(BAKED_SEQ)
    ratio = size_baked / size_pose
    return {"pose_bytes": size_pose, "baked_bytes": size_baked,
            "ratio": round(ratio, 2), "limit": RATIO_LIMIT,
            "pass": bool(ratio >= RATIO_LIMIT)}


def render_with(python_exe, source, seq, tag):
    """跑一次渲染（.venv：没有 torch，正好走跨解释器那条路）。"""
    out_dir = os.path.join(CACHE, f"frames_{tag}")
    out_json = os.path.join(CACHE, f"render_{tag}.json")
    cmd = [python_exe, os.path.join(HERE, "render_shot.py"),
           "--source", source, "--seq", seq, "--shot", f"shot003_{tag}",
           "--scene", "glb", "--out-dir", out_dir, "--out-json", out_json,
           "--frames", str(TEST_FRAMES), "--no-mp4", "--no-sheet"]
    t0 = time.time()
    # errors="replace"：子进程输出是本地编码（GBK），直接按 UTF-8 解码会抛异常
    proc = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True, errors="replace")
    if proc.returncode != 0:
        raise RuntimeError(f"渲染失败({source}):\n{proc.stdout}\n{proc.stderr}")
    return out_dir, round(time.time() - t0, 1)


def check_render(python_exe):
    """检查 3：pose 路径渲染 vs 同源 baked 路径渲染，逐像素 PSNR。"""
    from PIL import Image

    pose_dir, t_pose = render_with(python_exe, "pose", POSE_SEQ, "pose")
    baked_dir, t_baked = render_with(python_exe, "baked", BAKED_SEQ, "baked")
    names = sorted(n for n in os.listdir(pose_dir) if n.endswith(".jpg"))
    psnrs, maxdiffs = [], []
    for n in names:
        a = np.asarray(Image.open(os.path.join(pose_dir, n)).convert("RGB"), dtype=np.float64)
        b = np.asarray(Image.open(os.path.join(baked_dir, n)).convert("RGB"), dtype=np.float64)
        diff = a - b
        maxdiffs.append(float(np.abs(diff).max()))
        mse = float((diff ** 2).mean())
        psnrs.append(float("inf") if mse == 0 else 10.0 * math.log10(255.0 ** 2 / mse))
    finite = [p for p in psnrs if math.isfinite(p)]
    return {"frames": len(names),
            "psnr_db_min": (round(min(finite), 2) if finite else "inf"),
            "psnr_db_mean": (round(sum(finite) / len(finite), 2) if finite else "inf"),
            "identical_frames": int(sum(1 for p in psnrs if not math.isfinite(p))),
            "max_pixel_diff": (round(max(maxdiffs), 3) if maxdiffs else 0.0),
            "limit_db": PSNR_LIMIT,
            "pose_render_seconds": t_pose, "baked_render_seconds": t_baked,
            "pass": bool(all(p > PSNR_LIMIT for p in psnrs))}


def check_rescore(python_exe):
    """附加检查：pose 序列按既有口径重算脚滑/构图指标（同样在 .venv 里跑）。"""
    out_json = os.path.join(CACHE, "rescore_shot003_pose.json")
    cmd = [python_exe, os.path.join(HERE, "rescore_shot.py"),
           "--source", "pose", "--seq", POSE_SEQ, "--shot", "shot003_pose",
           "--out", out_json]
    proc = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True, errors="replace")
    if proc.returncode != 0:
        raise RuntimeError(f"rescore 失败:\n{proc.stdout}\n{proc.stderr}")
    with open(out_json, encoding="utf-8") as f:
        return json.load(f)["summary"]


def main():
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    before = stamps(GUARDED)
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(VAL, exist_ok=True)
    python_exe = venv_python()
    if not python_exe:
        raise SystemExit("找不到 .venv 解释器，渲染对比无法进行")

    report = {"kind": "pose_store", "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
              "python": sys.executable, "render_python": python_exe,
              "sequences": {"pose": os.path.relpath(POSE_SEQ, ROOT),
                            "baked": os.path.relpath(BAKED_SEQ, ROOT)}}

    report["rebuild"] = check_rebuild()
    report["size"] = check_size()
    report["render"] = check_render(python_exe)
    report["rescore_pose"] = check_rescore(python_exe)

    after = stamps(GUARDED)
    report["guarded_files"] = {"before": before, "after": after,
                               "unchanged": bool(before == after)}
    report["pass"] = bool(report["rebuild"]["pass"] and report["size"]["pass"]
                          and report["render"]["pass"] and before == after)

    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
