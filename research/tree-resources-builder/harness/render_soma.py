"""渲染 SOMA-X 三个后端的结果预览（复用 CPU 软光栅）。"""
import json
import os

import numpy as np
import trimesh

from geomlib import camera_fit, render, save
from previews import grid_lines

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREV = os.path.join(ROOT, "assets", "previews")
GEO = os.path.join(ROOT, "assets", "geometry")

items = [
    ("soma_native", "soma_native_low.glb", "SOMA 原生后端（PCA 128）"),
    ("soma_mhr", "soma_mhr_low.glb", "MHR 后端（45 体型 + 68 尺度）"),
    ("soma_anny", "soma_anny_low.glb", "ANNY 后端（6 体型表型）"),
    ("soma_anny_adult", "soma_anny_adult.glb", "ANNY 成人 A-pose（场景主角）"),
]
paths = {}
for key, fn, label in items:
    p = os.path.join(GEO, fn)
    if not os.path.exists(p):
        print("missing", p)
        continue
    m = trimesh.load(p, force="mesh")
    cam = camera_fit(m.vertices, (0.9, -1.45, 0.35), 32, 1.25, 860, 640)
    img = render([(m, (0.90, 0.90, 0.92))], cam, ground=(0.0, 40.0, (0.91, 0.915, 0.928)),
                 lines=grid_lines(), ss=2)
    out = os.path.join(PREV, f"{key}.png")
    save(img, out)
    paths[key] = os.path.relpath(out, ROOT)
    print("rendered", out, len(m.faces), "faces", label)

with open(os.path.join(ROOT, "assets", "validation", "soma_previews.json"), "w", encoding="utf-8") as f:
    json.dump(paths, f, ensure_ascii=False, indent=2)
