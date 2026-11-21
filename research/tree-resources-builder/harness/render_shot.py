"""渲染 5 秒竖切片 shot_001：街景 + ANNY 行走 + 推镜，输出帧序列/MP4/验证。

用法：
  python render_shot.py                                   # 现状：shot_001 烘焙顶点（默认行为不变）
  python render_shot.py --test                            # 只渲染第 30 帧做姿态检查
  python render_shot.py --source pose --seq assets/nongeometry/shot003_pose.npz \
      --scene glb --out-dir var/pose_cache/frames_pose \
      --out-json var/pose_cache/shot003.json --frames 24 --no-mp4 --no-sheet
                                                        # pose 存储：读 pose -> 重建顶点 -> 渲染

跨解释器说明
------------
渲染跑在 .venv（numpy/trimesh/PIL/imageio_ffmpeg，没有 torch），而顶点重建需要
soma-venv（torch + soma 权重）。所以 pose 分支把「重建」这一步交给 soma-venv：
* 当前解释器有 torch 就直接在本进程重建；
* 没有就起子进程 `python pose_store.py --rebuild`（soma-venv 的解释器）。
渲染本身始终留在当前解释器，MP4 编码也留在有 imageio_ffmpeg 的那一侧。
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os
import subprocess
import sys

import numpy as np
import trimesh

import previews
from geomlib import Camera, render, save

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROJ = os.path.abspath(os.path.join(ROOT, "..", ".."))
NGEO = os.path.join(ROOT, "assets", "nongeometry")
SHOT = os.path.join(ROOT, "shots", "shot_001")
FRAMES_DIR = os.path.join(SHOT, "frames")
OUT_JSON = os.path.join(ROOT, "assets", "validation", "shot_001.json")
CACHE_DIR = os.path.join(PROJ, "var", "pose_cache")

FPS, DUR = 24, 5.0
N = int(FPS * DUR)
W, H = 720, 404

CAM_KEYS = [
    (0.0, (3.2, -5.4, 2.20), (-0.2, 1.0, 1.12), 42.0),
    (2.5, (2.2, -5.9, 1.95), (0.0, 0.90, 1.15), 45.0),
    (5.0, (1.0, -6.2, 1.60), (0.0, 0.70, 1.20), 50.0),
]


def cam_at(t, root_dy):
    seg = 0 if t <= 2.5 else 1
    t0, e0, g0, f0 = CAM_KEYS[seg]
    t1, e1, g1, f1 = CAM_KEYS[seg + 1]
    u = (t - t0) / (t1 - t0)
    u = u * u * (3 - 2 * u)
    eye = np.array(e0) * (1 - u) + np.array(e1) * u
    tgt = np.array(g0) * (1 - u) + np.array(g1) * u
    focal = f0 * (1 - u) + f1 * u
    eye[1] += root_dy
    tgt[1] += root_dy
    fov = math.degrees(2 * math.atan(36.0 / (2 * focal)))
    return Camera(tuple(eye), tuple(tgt), (0, 0, 1), fov, W, H, focal, 36.0)


def _item_color(n):
    """场景物件配色（抽出来给两条场景来源共用，规则与原来完全一致）。"""
    return (previews.BLDG if n.startswith("building") else
            (previews.CAR if n.startswith("car") else
             (previews.WOOD if n.startswith("tree") and "canopy" not in n else
              (previews.LEAF if "canopy" in n else
               (previews.CROWD if n.startswith("crowd") else (0.86, 0.87, 0.89))))))


def scene_world(out):
    items = []
    for n, m, tf in out["scene"]["items"]:
        if n in ("hero", "hero_jacket"):
            continue
        mm = m.copy()
        if tf is not None:
            mm.apply_transform(np.asarray(tf).reshape(4, 4))
        items.append((mm, _item_color(n)))
    return items


def scene_world_from_glb(path=None):
    """只读地装配场景：从已生成的 scene_street.glb 取几何与变换。

    为什么要有这条路径：generate_all() 会重写共享产物（几何/预览/非几何 json），
    并行开发时渲染分支不该顺手改别人的东西；而 pose 分支只需要「和 shot_001 同一套」的背景。
    """
    path = path or os.path.join(ROOT, "assets", "geometry", "scene_street.glb")
    scn = trimesh.load(path, force="scene")
    items = []
    for name in scn.geometry.keys():
        if name in ("hero", "hero_jacket"):
            continue
        tf, gname = scn.graph.get(name)
        mm = scn.geometry[gname].copy()
        mm.apply_transform(np.asarray(tf).reshape(4, 4))
        items.append((mm, _item_color(name)))
    return items


def ffmpeg_exe():
    """找一个可用的 ffmpeg。

    soma-venv 里没装 imageio_ffmpeg，但 .venv 里有——借用它的可执行文件即可，
    这样 pose 分支在哪个解释器里跑都能出 MP4。
    """
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    pats = [os.path.join(PROJ, ".venv", "Lib", "site-packages", "imageio_ffmpeg",
                         "binaries", "ffmpeg*.exe"),
            os.path.join(PROJ, ".venv", "lib", "python*", "site-packages",
                         "imageio_ffmpeg", "binaries", "ffmpeg*")]
    for pat in pats:
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[0]
    return None


def load_baked(seq_path):
    z = np.load(seq_path)
    return z["vertices"], z["joints"], z["faces"], z["root_y"]


def load_pose(seq_path, python_exe=None):
    """读 pose 序列并重建顶点（跨解释器时起 soma-venv 子进程）。"""
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    from pose_store import ensure_rebuilt, load_pose_sequence
    seq = load_pose_sequence(seq_path)
    cache = os.path.join(CACHE_DIR,
                         os.path.splitext(os.path.basename(seq_path))[0] + "_verts.npz")
    ensure_rebuilt(seq_path, cache, python_exe=python_exe)
    with np.load(cache) as z:
        verts, joints, faces = z["vertices"], z["joints"], z["faces"]
    return verts, joints, faces, seq["root_y"], seq["meta"]


def render_frames(verts, joints, faces, root_y, static, frames_dir, frame_indices,
                  fps, test_png=None):
    """逐帧渲染并采集指标（脚/构图口径与 shot_001 一致）。"""
    vals = []
    # 关节名（与 make_shot_soma 一致）
    # SOMA 公共关节：LeftFoot=70, RightFoot=75（踝关节）
    ANK_L, ANK_R = 70, 75

    for i in frame_indices:
        t = i / fps
        root_dy = float(root_y[i])
        hero = trimesh.Trimesh(vertices=verts[i].copy(), faces=faces, process=False)
        hero.apply_translation((0, -1.6, 0))
        shadow = trimesh.creation.cylinder(radius=0.34, height=0.002, sections=24)
        hb = hero.bounds
        shadow.apply_translation(((hb[0][0] + hb[1][0]) / 2, (hb[0][1] + hb[1][1]) / 2, 0.003))
        cam = cam_at(t, root_dy)
        img = render(static + [(shadow, (0.70, 0.71, 0.74)), (hero, (0.93, 0.93, 0.94))], cam,
                     ground=None, wire=False, ss=1,
                     lines=previews.grid_lines(z=0.012, n=10, step=2.0, color=(0.74, 0.76, 0.79)))
        path = os.path.join(frames_dir, f"frame_{i:04d}.jpg")
        img.save(path, "JPEG", quality=90)
        if test_png:
            save(img, test_png)

        # 指标（踝关节）
        j = joints[i]
        ankle = j[[ANK_L, ANK_R]]
        thr = float(ankle[:, 2].min()) + 0.06
        stance = ankle[:, 2] < thr
        bbox = hero.bounds
        pts = np.array([[x, y, zz] for x in (bbox[0][0], bbox[1][0])
                        for y in (bbox[0][1], bbox[1][1]) for zz in (bbox[0][2], bbox[1][2])])
        px, dep = cam.project(pts)
        inside = ((px[:, 0] > 0) & (px[:, 0] < W) & (px[:, 1] > 0) & (px[:, 1] < H)).mean()
        hratio = (px[:, 1].max() - px[:, 1].min()) / H
        vals.append({"frame": i, "t": round(t, 3), "stance": stance.tolist(),
                     "ankle_z": [round(float(x), 4) for x in ankle[:, 2]],
                     "ground_min_z": round(float(hero.bounds[0][2]), 4),
                     "inside": round(float(inside), 3), "height_ratio": round(float(hratio), 3)})
    return vals


def foot_slides(vals, joints):
    """脚滑：连续两帧都在支撑相时，脚的水平位移。"""
    slides = []
    for k in range(1, len(vals)):
        a, b = vals[k - 1], vals[k]
        for foot in (0, 1):
            if a["stance"][foot] and b["stance"][foot]:
                pa = joints[a["frame"], [70, 75][foot]]
                pb = joints[b["frame"], [70, 75][foot]]
                slides.append(float(np.hypot(pb[0] - pa[0], pb[1] - pa[1])))
    return np.array(slides) if slides else np.array([0.0])


def make_contact_sheet(frames_dir, out_path, rendered):
    """联系表：默认沿用 shot_001 的 8 帧挑选，帧数不足时改成等距挑选。"""
    from PIL import Image, ImageDraw
    picks = [0, 17, 34, 51, 68, 85, 102, 119]
    if not all(p in rendered for p in picks):
        picks = [rendered[int(round(k * (len(rendered) - 1) / 7.0))] for k in range(8)]
    thumbs = [Image.open(os.path.join(frames_dir, f"frame_{i:04d}.jpg")) for i in picks]
    tw, th = thumbs[0].size
    sheet = Image.new("RGB", (tw * 4, (th + 26) * 2), (250, 250, 251))
    dr = ImageDraw.Draw(sheet)
    for k, (i, im) in enumerate(zip(picks, thumbs)):
        x, y = (k % 4) * tw, (k // 4) * (th + 26)
        sheet.paste(im, (x, y))
        dr.text((x + 8, y + th + 6), f"frame {i:03d}  t={i / FPS:.2f}s", fill=(60, 65, 75))
    sheet.save(out_path, "JPEG", quality=88)


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description="渲染 shot 帧序列")
    ap.add_argument("--test", action="store_true", help="只渲染第 30 帧做姿态检查")
    ap.add_argument("--source", choices=("baked", "pose"), default="baked",
                    help="序列来源：baked=读烘焙顶点（默认）；pose=读 pose 并重建顶点")
    ap.add_argument("--seq", default=None, help="序列 npz 路径")
    ap.add_argument("--shot", default="shot_001", help="镜头名（决定默认输出目录与验证 json）")
    ap.add_argument("--out-dir", default=None, help="帧输出目录（默认 shots/<shot>/frames）")
    ap.add_argument("--out-json", default=None,
                    help="验证 json 输出路径（默认 assets/validation/<shot>.json）")
    ap.add_argument("--start", type=int, default=0, help="起始帧")
    ap.add_argument("--frames", type=int, default=0, help="渲染帧数（0=全部）")
    ap.add_argument("--no-mp4", action="store_true", help="不编码 MP4")
    ap.add_argument("--no-sheet", action="store_true", help="不生成联系表")
    ap.add_argument("--scene", choices=("generate", "glb"), default="generate",
                    help="场景来源：generate=调用 generate_all()（默认，保持现状）；"
                         "glb=只读已生成的 scene_street.glb，不改共享产物")
    ap.add_argument("--soma-python", default=None, help="有 torch 的解释器（跨环境重建顶点用）")
    return ap.parse_args(argv)


def main():
    args = parse_args()
    seq_path = args.seq
    if seq_path is None:
        if args.source == "pose":
            raise SystemExit("--source pose 必须给 --seq")
        seq_path = os.path.join(NGEO, "shot001_hero.npz")
    frames_dir = args.out_dir or os.path.join(ROOT, "shots", args.shot, "frames")
    out_json = args.out_json or os.path.join(ROOT, "assets", "validation", f"{args.shot}.json")

    if args.source == "pose":
        verts, joints, faces, root_y, meta = load_pose(seq_path, python_exe=args.soma_python)
        speed = float(meta.get("root_speed_mps", 0.0))
    else:
        verts, joints, faces, root_y = load_baked(seq_path)
        meta_path = os.path.join(NGEO, os.path.basename(seq_path).replace("_hero.npz", "_meta.json"))
        if not os.path.exists(meta_path):
            meta_path = os.path.join(NGEO, "shot001_meta.json")
        meta = json.load(open(meta_path, encoding="utf-8")) if os.path.exists(meta_path) else {}
        speed = float(meta.get("root_speed_mps", 0.0))
    print("hero frames", verts.shape, "speed", speed)

    if args.scene == "generate":
        from generate_assets import generate_all
        static = scene_world(generate_all())
    else:
        static = scene_world_from_glb()
    os.makedirs(frames_dir, exist_ok=True)

    total = int(verts.shape[0])
    if args.test:
        frame_indices = [30]
    else:
        count = args.frames if args.frames > 0 else max(0, total - args.start)
        frame_indices = list(range(args.start, min(args.start + count, total)))

    test_png = os.path.join(ROOT, "assets", "validation", "ui", "_shot_test.png") if args.test else None
    vals = render_frames(verts, joints, faces, root_y, static, frames_dir, frame_indices,
                         FPS, test_png=test_png)
    if args.test:
        print("test frame saved", os.path.join(frames_dir, f"frame_{frame_indices[0]:04d}.jpg"))
        return

    slides = foot_slides(vals, joints)
    summary = {
        "kind": args.shot, "fps": FPS, "duration_s": DUR, "frames": total,
        "resolution": [W, H], "root_speed_mps": round(speed, 3),
        "foot_slide_mean_m": round(float(slides.mean()), 4),
        "foot_slide_max_m": round(float(slides.max()), 4),
        "ground_min_z": round(float(min(v["ground_min_z"] for v in vals)), 4),
        "subject_inside_min": round(float(min(v["inside"] for v in vals)), 3),
        "subject_height_ratio_mean": round(float(np.mean([v["height_ratio"] for v in vals])), 3),
        "pass": bool(slides.max() < 0.035 and min(v["ground_min_z"] for v in vals) > -0.02
                     and min(v["inside"] for v in vals) > 0.9),
        "frames_dir": os.path.relpath(frames_dir, ROOT),
    }
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "per_frame": vals}, f, ensure_ascii=False, indent=2)

    # 联系表：8 帧
    if not args.no_sheet:
        make_contact_sheet(frames_dir, os.path.join(ROOT, "shots", args.shot, "contact_sheet.jpg"),
                           set(frame_indices))

    # MP4
    if not args.no_mp4:
        try:
            ff = ffmpeg_exe()
            if not ff:
                raise RuntimeError("找不到 ffmpeg（imageio_ffmpeg 未安装）")
            mp4 = os.path.join(ROOT, "shots", args.shot, "previs.mp4")
            subprocess.run([ff, "-y", "-framerate", str(FPS), "-i",
                            os.path.join(frames_dir, "frame_%04d.jpg"),
                            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", mp4],
                           check=True, capture_output=True)
            summary["mp4"] = os.path.relpath(mp4, ROOT)
            print("mp4", mp4)
        except Exception as exc:
            print("mp4 failed", exc)

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "per_frame": vals}, f, ensure_ascii=False, indent=2)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
