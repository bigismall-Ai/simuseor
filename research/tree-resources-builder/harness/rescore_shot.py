"""不重渲染，重算 shot_001 的支撑脚滑步与构图指标。

口径（与原实现一致，pose 序列也按同一口径算）
----------------------------------------------
* 支撑脚 = 两踝中**较低**的那个（`support = argmin(ankle_z)`）。
* 脚滑只统计「连续两帧支撑脚相同」时的水平位移。
* 构图指标：主角包围盒 8 个角点投影后有多少落在画面内（inside）、
  画面内高度占比（height_ratio）。

新增 `--source pose`：读 pose 序列（必要时用 soma-venv 重建顶点）后按同一口径重算。
"""
from __future__ import annotations

import argparse
import json
import os

import numpy as np

from render_shot import CAM_KEYS, FPS, N, OUT_JSON, W, H, cam_at, load_pose

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NGEO = os.path.join(ROOT, "assets", "nongeometry")


def rescore_sequence(verts, joints, root_y, meta, frames=None, kind="shot_001",
                     duration_s=5.0, frames_dir="shots/shot_001/frames"):
    """按既有口径重算脚滑与构图指标，返回 (summary, per_frame)。"""
    ANK_L, ANK_R = 70, 75
    n = int(verts.shape[0]) if frames is None else len(frames)

    vals = []
    for i in range(n):
        t = i / FPS
        hero_v = verts[i].copy()
        hero_v[:, 1] -= 1.6
        lo, hi = hero_v.min(0), hero_v.max(0)
        cam = cam_at(t, float(root_y[i]))
        pts = np.array([[x, y, zz] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for zz in (lo[2], hi[2])])
        px, _ = cam.project(pts)
        inside = ((px[:, 0] > 0) & (px[:, 0] < W) & (px[:, 1] > 0) & (px[:, 1] < H)).mean()
        hratio = (px[:, 1].max() - px[:, 1].min()) / H
        ankle = joints[i][[ANK_L, ANK_R]]
        sup = int(np.argmin(ankle[:, 2]))
        vals.append({"frame": i, "t": round(t, 3), "support": sup,
                     "support_z": round(float(ankle[sup, 2]), 4),
                     "inside": round(float(inside), 3),
                     "height_ratio": round(float(hratio), 3),
                     "ground_min_z": round(float(hero_v[:, 2].min()), 4)})

    slides = []
    for k in range(1, len(vals)):
        a, b = vals[k - 1], vals[k]
        if a["support"] == b["support"]:
            pa = joints[a["frame"], [ANK_L, ANK_R][a["support"]]]
            pb = joints[b["frame"], [ANK_L, ANK_R][b["support"]]]
            slides.append(float(np.hypot(pb[0] - pa[0], pb[1] - pa[1])))
    slides = np.array(slides) if slides else np.array([0.0])
    summary = {
        "kind": kind, "fps": FPS, "duration_s": duration_s, "frames": n,
        "resolution": [W, H], "root_speed_mps": meta.get("root_speed_mps", 0.0),
        "foot_slide_mean_m": round(float(slides.mean()), 4),
        "foot_slide_max_m": round(float(slides.max()), 4),
        "foot_slide_note": "仅统计连续两帧同一支撑脚（较低踝）的位移",
        "ground_min_z": round(float(min(v["ground_min_z"] for v in vals)), 4),
        "subject_inside_min": round(float(min(v["inside"] for v in vals)), 3),
        "subject_height_ratio_mean": round(float(np.mean([v["height_ratio"] for v in vals])), 3),
        "pass": bool(slides.max() < 0.035 and min(v["ground_min_z"] for v in vals) > -0.02
                     and min(v["inside"] for v in vals) > 0.9),
        "frames_dir": frames_dir,
    }
    return summary, vals


def main():
    ap = argparse.ArgumentParser(description="重算脚滑/构图指标")
    ap.add_argument("--source", choices=("baked", "pose"), default="baked",
                    help="序列来源：baked=读烘焙顶点（默认）；pose=读 pose 并重建顶点")
    ap.add_argument("--seq", default=None, help="序列 npz 路径")
    ap.add_argument("--shot", default="shot_001", help="镜头名（写进 summary 的 kind）")
    ap.add_argument("--out", default=None, help="输出 json（默认 assets/validation/<shot>.json）")
    ap.add_argument("--frames", type=int, default=0, help="统计帧数（0=全部）")
    ap.add_argument("--soma-python", default=None, help="有 torch 的解释器（跨环境重建顶点用）")
    args = ap.parse_args()

    seq_path = args.seq
    if seq_path is None:
        if args.source == "pose":
            raise SystemExit("--source pose 必须给 --seq")
        seq_path = os.path.join(NGEO, "shot001_hero.npz")
    out_path = args.out or os.path.join(ROOT, "assets", "validation", f"{args.shot}.json")

    if args.source == "pose":
        verts, joints, faces, root_y, meta = load_pose(seq_path, python_exe=args.soma_python)
    else:
        z = np.load(seq_path)
        verts, joints, root_y = z["vertices"], z["joints"], z["root_y"]
        meta_path = os.path.join(NGEO, os.path.basename(seq_path).replace("_hero.npz", "_meta.json"))
        if not os.path.exists(meta_path):
            meta_path = os.path.join(NGEO, "shot001_meta.json")
        meta = json.load(open(meta_path, encoding="utf-8")) if os.path.exists(meta_path) else {}

    frames = list(range(int(verts.shape[0])))
    if args.frames > 0:
        frames = frames[:args.frames]
    summary, vals = rescore_sequence(verts[frames], joints[frames], root_y[frames], meta,
                                     kind=args.shot, duration_s=len(frames) / FPS,
                                     frames_dir=f"shots/{args.shot}/frames")
    mp4 = os.path.join(ROOT, "shots", args.shot, "previs.mp4")
    summary["mp4"] = f"shots/{args.shot}/previs.mp4" if os.path.exists(mp4) else None
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "per_frame": vals}, f, ensure_ascii=False, indent=2)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
