"""R4 道具库选件扫描：把 Kenney / Poly Haven 源件跑一遍「水密化 + 既有口径」，
输出可入库存清单。

为什么需要扫描而不是照单全收
----------------------------
Kenney / Poly Haven 的模型是**视觉资产**：锥桶没底、桶是敞口、薄板拼的家具 ——
它们本来就不是水密件。而本项目既有口径（validate.py 的 MESH_WATERTIGHT）要求
水密：下游要算体积、要做布尔、要按部件算间隙。

所以库是「策展」出来的：只有能通过既有口径的源件才入库存。
本脚本把判定跑一遍，落读数 assets/validation/r4_source_scan.json，
让「为什么选这 20 件」可回查。

纯 CPU、纯几何；不跑生成式模型、不下模型权重。
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys

import numpy as np
import trimesh

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PROJ = os.path.abspath(os.path.join(ROOT, "..", ".."))
KENNY = os.path.join(PROJ, "var", "public-assets", "kenney")
PH = os.path.join(PROJ, "var", "public-assets", "polyhaven")
OUT = os.path.join(ROOT, "assets", "validation", "r4_source_scan.json")

sys.path.insert(0, HERE)
import r4_common as C  # noqa: E402


def scan_kenney():
    rows = []
    for pack in sorted(os.listdir(KENNY)):
        models_dir = os.path.join(KENNY, pack, "Models")
        if not os.path.isdir(models_dir):
            continue
        for sub in ("GLB format", "GLTF format"):
            d = os.path.join(models_dir, sub)
            if not os.path.isdir(d):
                continue
            for name in sorted(os.listdir(d)):
                if not name.endswith(".glb"):
                    continue
                path = os.path.join(d, name)
                try:
                    raw = trimesh.load(path, force="mesh", process=False)
                    fixed, st = C.make_watertight(raw)
                    rows.append({
                        "origin": "Kenney", "pack": pack,
                        "model": name[:-4], "path": path,
                        "faces": st["faces"],
                        "watertight": st["watertight"],
                        "winding_consistent": st["winding_consistent"],
                        "degenerate_faces": st["degenerate_faces"],
                        "components": st["components"],
                        "capped_loops": st["capped_loops"],
                        "ok": bool(st["watertight"] and st["winding_consistent"]
                                   and st["degenerate_faces"] == 0),
                    })
                except Exception as exc:
                    rows.append({"origin": "Kenney", "pack": pack,
                                 "model": name[:-4], "path": path,
                                 "ok": False, "error": "%s: %s" % (type(exc).__name__, exc)})
    return rows


def scan_polyhaven():
    rows = []
    if not os.path.isdir(PH):
        return rows
    for pid in sorted(os.listdir(PH)):
        d = os.path.join(PH, pid)
        gltf = os.path.join(d, "%s_1k.gltf" % pid)
        if not os.path.exists(gltf):
            continue
        try:
            raw = trimesh.load(gltf, force="mesh", process=False)
            fixed, st = C.make_watertight(raw)
            rows.append({
                "origin": "Poly Haven", "pack": pid, "model": pid, "path": gltf,
                "faces": st["faces"],
                "watertight": st["watertight"],
                "winding_consistent": st["winding_consistent"],
                "degenerate_faces": st["degenerate_faces"],
                "components": st["components"],
                "capped_loops": st["capped_loops"],
                "ok": bool(st["watertight"] and st["winding_consistent"]
                           and st["degenerate_faces"] == 0),
            })
        except Exception as exc:
            rows.append({"origin": "Poly Haven", "pack": pid, "model": pid,
                         "path": gltf, "ok": False,
                         "error": "%s: %s" % (type(exc).__name__, exc)})
    return rows


def main():
    ap = argparse.ArgumentParser(description="R4 道具源件扫描（选件依据）")
    ap.add_argument("--scan", action="store_true")
    args = ap.parse_args()
    rows = scan_kenney() + scan_polyhaven()
    ok = [r for r in rows if r.get("ok")]
    report = {
        "kind": "r4_source_scan", "cpu_only": True,
        "criterion": ("入库存判据：源件经「封边界环 + 去退化面 + 修绕向」后"
                      "水密、绕向一致、无退化面（即既有 validate.py 口径）。"),
        "summary": {"total": len(rows), "ok": len(ok),
                    "kenney_total": sum(1 for r in rows if r.get("origin") == "Kenney"),
                    "kenney_ok": sum(1 for r in ok if r.get("origin") == "Kenney"),
                    "polyhaven_total": sum(1 for r in rows if r.get("origin") == "Poly Haven"),
                    "polyhaven_ok": sum(1 for r in ok if r.get("origin") == "Poly Haven")},
        "items": rows,
    }
    C.write_json(OUT, report)
    print("[scan] %d 个源件，%d 个通过入库判据" % (len(rows), len(ok)))
    for r in sorted(ok, key=lambda x: x.get("origin", "")):
        print("   OK %-10s %-22s %-26s faces=%s" % (r.get("origin"), r.get("pack"),
                                                    r.get("model"), r.get("faces")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
