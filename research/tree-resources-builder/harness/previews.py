"""离线预览渲染：纯 CPU 软光栅，输出 PNG（供 HTML 报告内嵌）。"""
from __future__ import annotations

import math
import os

import numpy as np
import trimesh
from PIL import Image, ImageDraw

from geomlib import Camera, R_axis, T, camera_fit, render, save
from validate import fk, parse_bvh

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREV = os.path.join(ROOT, "assets", "previews")

BODY = (0.93, 0.93, 0.94)
CLOTH = (0.74, 0.79, 0.88)
PROP = (0.88, 0.86, 0.80)
CAR = (0.84, 0.87, 0.91)
BOAT = (0.80, 0.86, 0.90)
BLDG = (0.88, 0.88, 0.87)
ANIMAL = (0.91, 0.88, 0.84)
WOOD = (0.78, 0.75, 0.70)
LEAF = (0.80, 0.86, 0.79)
CROWD = (0.89, 0.89, 0.90)
FX = (0.86, 0.82, 0.88)


def grid_lines(z=0.0, n=12, step=2.0, color=(0.76, 0.78, 0.81)):
    lines = []
    for i in range(-n, n + 1):
        p = i * step
        lines.append(((p, -n * step, z), (p, n * step, z), color, 1))
        lines.append(((-n * step, p, z), (n * step, p, z), color, 1))
    return lines


def _cam(mesh, direction=(1.0, -1.4, 0.55), fov=35, margin=1.25, w=1000, h=680):
    return camera_fit(mesh.vertices, direction, fov, margin, w, h)


def render_all(out, cam_data):
    os.makedirs(PREV, exist_ok=True)
    paths = {}

    def one(key, meshes, direction=(1.0, -1.4, 0.55), fov=35, margin=1.25, wire=True, lines=None, ss=1):
        pts = np.vstack([m.vertices for m, _ in meshes])
        cam = camera_fit(pts, direction, fov, margin, 1000, 680)
        img = render(meshes, cam, ground=(0.0, 60.0, (0.905, 0.912, 0.925)),
                     lines=grid_lines() + (lines or []), wire=wire, ss=ss)
        p = os.path.join(PREV, f"{key}.png")
        save(img, p)
        paths[key] = os.path.relpath(p, ROOT)
        return p

    one("character", [(out["character"]["mesh"], BODY)], (1.0, -1.5, 0.45), 32, 1.15, ss=2)
    one("character_front", [(out["character"]["mesh"], BODY)], (0.05, -1.0, 0.18), 32, 1.15)
    one("clothing", [(out["clothing"]["mesh"], CLOTH), (out["character"]["mesh"], (0.95, 0.95, 0.96))],
        (1.0, -1.5, 0.45), 32, 1.15)
    one("prop", [(out["prop"]["mesh"], PROP)], (1.0, -1.1, 0.75), 30, 1.2, ss=2)
    one("vehicle_car", [(out["vehicle_car"]["mesh"], CAR)], (1.1, -1.5, 0.55), 33, 1.2, ss=2)
    one("vehicle_boat", [(out["vehicle_boat"]["mesh"], BOAT)], (1.0, -1.35, 0.6), 33, 1.2)
    one("building", [(out["building"]["mesh"], BLDG)], (1.0, -1.25, 0.35), 35, 1.22)
    one("creature", [(out["creature"]["mesh"], ANIMAL)], (1.2, -1.4, 0.45), 33, 1.2)
    one("vegetation", [(out["vegetation"]["mesh"], WOOD), (out["vegetation"]["canopy"], LEAF)],
        (1.0, -1.3, 0.4), 35, 1.2)

    crowd_meshes = []
    for _, m, tf in out["crowd"]["items"]:
        mm = m.copy()
        if tf is not None:
            mm.apply_transform(np.asarray(tf).reshape(4, 4))
        crowd_meshes.append((mm, CROWD))
    one("crowd", crowd_meshes, (1.0, -1.2, 0.6), 35, 1.15, wire=False)

    # 特效：体积代理 + 轨迹
    fx_mesh = out["fx"]["mesh"]
    data = out["fx"]["data"]
    pts = data["trajectory"]["samples"]
    lines = [(pts[i], pts[i + 1], (0.72, 0.55, 0.30), 3) for i in range(len(pts) - 1)]
    lines += [((d["p0"][0], d["p0"][1], d["p0"][2]), (d["p1"][0], d["p1"][1], d["p1"][2]),
               (0.80, 0.62, 0.35), 2) for d in data["debris"]]
    one("fx", [(fx_mesh, FX)], (1.1, -1.3, 0.5), 38, 1.18, wire=False, lines=lines)

    # 场景主视图：自定义构图，兼顾主体与街道关系
    s = {"eye": (5.2, -9.2, 2.7), "target": (-0.4, 1.0, 1.15), "focal_mm": 36}
    fov = math.degrees(2 * math.atan(36.0 / (2 * s["focal_mm"])))
    cam = Camera(tuple(s["eye"]), tuple(s["target"]), (0, 0, 1), fov, 1200, 720)
    scene_world = []
    for n, m, tf in out["scene"]["items"]:
        mm = m.copy()
        if tf is not None:
            mm.apply_transform(np.asarray(tf).reshape(4, 4))
        color = (BLDG if n.startswith("building") else
                 (CAR if n.startswith("car") else
                  (WOOD if n.startswith("tree") and "canopy" not in n else
                   (LEAF if "canopy" in n else
                    (CLOTH if n == "hero_jacket" else
                     (BODY if n in ("hero", "ground") else
                      (CROWD if n.startswith("crowd") else
                       ((0.80, 0.81, 0.84) if n == "road" else
                        ((0.88, 0.89, 0.90) if n.startswith("sidewalk") else (0.86, 0.87, 0.89))))))))))
        scene_world.append((mm, color))
    img = render(scene_world, cam, ground=None, wire=False, ss=1,
                 lines=grid_lines(z=0.015, n=10, step=2.0, color=(0.72, 0.74, 0.78)))
    save(img, os.path.join(PREV, "scene_hero.png"))
    paths["scene_hero"] = os.path.relpath(os.path.join(PREV, "scene_hero.png"), ROOT)

    # 场景俯视
    top = Camera((0.0, 7.0, 34.0), (0.0, 7.0, 0.0), (0, 1, 0), 45, 1000, 800)
    img = render(scene_world, top, ground=None, wire=False, ss=1)
    save(img, os.path.join(PREV, "scene_top.png"))
    paths["scene_top"] = os.path.relpath(os.path.join(PREV, "scene_top.png"), ROOT)

    # 相机路径 + 视锥
    path_pts = np.array([sp["eye"] for sp in cam_data["samples"]])
    style_lines = [(path_pts[i], path_pts[i + 1], (0.20, 0.42, 0.75), 3) for i in range(0, len(path_pts) - 1, 2)]
    for tag, idx in (("start", 0), ("end", len(cam_data["samples"]) - 1)):
        sp = cam_data["samples"][idx]
        c = Camera(tuple(sp["eye"]), tuple(sp["target"]), (0, 0, 1),
                   math.degrees(2 * math.atan(36.0 / (2 * sp["focal_mm"]))), 1200, 720)
        eye, fwd, right, upv = c.basis()
        tanv = math.tan(math.radians(c.fov_y) * 0.5)
        tana = tanv * c.width / c.height
        corners = []
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            d = fwd + right * (sx * tana) + upv * (sy * tanv)
            corners.append(eye + d * 6.0)
        for cp in corners:
            style_lines.append((tuple(eye), tuple(cp), (0.85, 0.35, 0.25) if tag == "start" else (0.25, 0.55, 0.35), 2))
        for i in range(4):
            style_lines.append((tuple(corners[i]), tuple(corners[(i + 1) % 4]),
                                (0.85, 0.35, 0.25) if tag == "start" else (0.25, 0.55, 0.35), 2))
    cam = Camera((14.0, -20.0, 16.0), (1.0, 3.0, 0.8), (0, 0, 1), 40, 1100, 760)
    img = render(scene_world, cam, ground=None, wire=False, lines=style_lines, ss=1)
    save(img, os.path.join(PREV, "camera_path.png"))
    paths["camera_path"] = os.path.relpath(os.path.join(PREV, "camera_path.png"), ROOT)

    # 动作：骨架序列
    paths["motion_sheet"] = _motion_sheet(os.path.join(ROOT, "assets", "nongeometry", "motion_walk_2s.bvh"))
    return paths


def _motion_sheet(bvh_path):
    bvh = parse_bvh(bvh_path)
    frames, _ = fk(bvh)
    nodes = bvh["nodes"]
    parents = {n["name"]: n["parent"] for n in nodes}
    W, H = 1240, 420
    img = Image.new("RGB", (W, H), (250, 250, 251))
    dr = ImageDraw.Draw(img)
    picks = [6, 15, 27, 39]
    scale = 150.0
    for k, fi in enumerate(picks):
        ox = 40 + k * (W - 60) / len(picks)
        oy = H - 55
        dr.line([(ox - 20, oy), (ox + 160, oy)], fill=(200, 202, 208), width=2)
        fr = frames[fi]
        root = fr["Hips"][:3, 3].copy()
        pts = {}
        for n in nodes:
            p = fr[n["name"]][:3, 3] - root
            pts[n["name"]] = (ox + (p[2] + 0.55 * p[0]) * scale + 55, oy - p[1] * scale)
        for n in nodes:
            par = parents[n["name"]]
            if par:
                dr.line([pts[par], pts[n["name"]]], fill=(70, 92, 130), width=5)
        for name, p in pts.items():
            r = 5 if name in ("Hips", "Head") else 3
            dr.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=(40, 55, 80))
        dr.text((ox, H - 34), f"frame {fi}   t={fi / (bvh['frames'] - 1) * 2:.2f}s", fill=(90, 95, 105))
    dr.text((20, 16), "motion_walk_2s.bvh  |  procedural keyframe bake  |  CPU only", fill=(60, 65, 75))
    p = os.path.join(PREV, "motion_sheet.png")
    img.save(p)
    return os.path.relpath(p, ROOT)
