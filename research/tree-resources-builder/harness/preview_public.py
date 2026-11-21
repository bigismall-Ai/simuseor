"""把下载的公共资产归一化为白模并渲染预览（Y-up → Z-up，按类别缩放）。"""
from __future__ import annotations

import json
import os

import numpy as np
import trimesh

from geomlib import camera_fit, render, save
from previews import grid_lines

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJ = os.path.abspath(os.path.join(ROOT, "..", ".."))
PUB = os.path.join(PROJ, "var", "public-assets")
PREV = os.path.join(ROOT, "assets", "previews")


def load(path):
    sc = trimesh.load(path, force="scene", process=False)
    mesh = sc.to_geometry() if hasattr(sc, "to_geometry") else sc
    if mesh is None or len(mesh.faces) == 0:
        raise RuntimeError("empty mesh")
    return mesh


def normalize(mesh, target=None, axis="longest", up="y"):
    if up == "y":
        m = np.eye(4)
        m[1, 1], m[1, 2], m[2, 1], m[2, 2] = 0, -1, 1, 0
        mesh = mesh.copy()
        mesh.apply_transform(m)
    size = mesh.bounds[1] - mesh.bounds[0]
    base = {"longest": max(size[0], size[1]), "height": size[2]}[axis]
    scale = target / max(base, 1e-6)
    mesh = mesh.copy()
    mesh.apply_scale(scale)
    mesh.apply_translation((0, 0, -mesh.bounds[0][2]))
    return mesh, {"up": up, "scale": round(float(scale), 4)}


items = [
    ("public_crate", os.path.join(PUB, "polyhaven", "old_military_crate", "old_military_crate_1k.gltf"),
     "Poly Haven · 军用箱", 1.1, "longest", "y", (0.88, 0.86, 0.80)),
    ("public_chair", os.path.join(PUB, "polyhaven", "ArmChair_01", "ArmChair_01_1k.gltf"),
     "Poly Haven · 扶手椅", 1.0, "height", "y", (0.84, 0.82, 0.78)),
    ("public_sedan", os.path.join(PUB, "kenney", "car-kit", "Models", "GLB format", "sedan.glb"),
     "Kenney · 轿车（CC0）", 4.5, "longest", "y", (0.84, 0.87, 0.91)),
    ("public_car_ccby", os.path.join(PUB, "polypizza", "5zUWP5UsLg-.glb"),
     "Poly Pizza · 跑车（CC-BY）", 4.6, "longest", "y", (0.86, 0.88, 0.92)),
    ("public_fox", os.path.join(PUB, "khronos", "Fox.glb"),
     "Khronos · Fox（CC-BY 4.0）", 1.3, "longest", "y", (0.90, 0.86, 0.82)),
    ("public_shirt", os.path.join(PUB, "makehuman", "shirts01", "clothes", "elvs_crude_t-shirt_male", "crude_male_shirt.obj"),
     "MakeHuman · T 恤（CC0）", 0.75, "height", "y", (0.76, 0.80, 0.88)),
]
out = {}
for key, path, label, target, axis, up, color in items:
    if not os.path.exists(path):
        print("missing", path)
        continue
    mesh = load(path)
    mesh, meta = normalize(mesh, target, axis, up)
    cam = camera_fit(mesh.vertices, (1.0, -1.5, 0.5), 34, 1.25, 940, 660)
    img = render([(mesh, color)], cam, ground=(0.0, 40.0, (0.91, 0.915, 0.928)),
                 lines=grid_lines(), wire=len(mesh.faces) < 12000, ss=2)
    p = os.path.join(PREV, f"{key}.png")
    save(img, p)
    out[key] = {"path": os.path.relpath(p, ROOT), "label": label,
                "faces": int(len(mesh.faces)), "size_m": [round(float(x), 2) for x in (mesh.bounds[1] - mesh.bounds[0])],
                **meta}
    print("rendered", key, len(mesh.faces), out[key]["size_m"])

with open(os.path.join(ROOT, "assets", "validation", "public_previews.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
