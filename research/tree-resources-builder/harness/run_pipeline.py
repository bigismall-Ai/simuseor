"""端到端流水线：生成 → 验证 → 反馈 → 修复 → 复检 → 预览 → USD 汇合。

运行：python run_pipeline.py
"""
from __future__ import annotations

import json
import os
import time

import numpy as np
import trimesh

import export_usd
import previews
import validate as V
from generate_assets import GEO, NGEO, ROOT, generate_all, human_proxy, wjson
from geomlib import export_glb, save
from geomlib import camera_fit, render

VAL = os.path.join(ROOT, "assets", "validation")


def iteration_demo():
    """验证闭环演练：坏参数 → 结构化反馈 → 参数修复 → 复检。"""
    os.makedirs(VAL, exist_ok=True)
    expect = {"z": [1.60, 1.86], "max_parts": 40}
    extra = {"check_floating": True, "ground": True}
    results = []

    bad_mesh, _ = human_proxy(2.45, arm_offset=0.16)
    r0 = V.validate_geometry("character_iter0", bad_mesh, expect, extra)
    export_glb(bad_mesh, os.path.join(VAL, "iter0_character.glb"))
    results.append({"iteration": 0, "params": {"height": 2.45, "arm_offset": 0.16},
                    "result": r0})

    # 修复策略由反馈自动推导（此处映射为参数动作，模拟 LLM 按 hint 改参数）
    actions = []
    for c in r0["checks"]:
        if c["ok"]:
            continue
        if c["code"].startswith("SCALE_Z"):
            actions.append({"action": "set_param", "param": "height", "value": 1.75,
                            "reason": c["message"]})
        if c["code"] == "FLOATING_PART":
            actions.append({"action": "set_param", "param": "arm_offset", "value": 0.0,
                            "reason": c["message"]})
    good_mesh, _ = human_proxy(1.75, arm_offset=0.0)
    r1 = V.validate_geometry("character_iter1", good_mesh, expect, extra)
    export_glb(good_mesh, os.path.join(VAL, "iter1_character.glb"))
    results.append({"iteration": 1, "params": {"height": 1.75, "arm_offset": 0.0},
                    "actions": actions, "result": r1})

    # 对比图
    for tag, mesh in (("iter0", bad_mesh), ("iter1", good_mesh)):
        cam = camera_fit(mesh.vertices, (1.0, -1.4, 0.4), 32, 1.2, 760, 560)
        save(render([(mesh, (0.90, 0.90, 0.92))], cam,
                    ground=(0.0, 60.0, (0.91, 0.915, 0.928)),
                    lines=previews.grid_lines(), ss=2),
             os.path.join(VAL, f"{tag}_character.png"))

    wjson(os.path.join(VAL, "iteration_log.json"),
          {"kind": "agentic_loop_demo", "iterations": results,
           "note": "反馈信号来自 CPU 验证器（尺度 + 部件间隙），无需 GPU/渲染模型"})
    return results


def main():
    t0 = time.time()
    loop = iteration_demo()
    print(f"[loop] iter0 pass={loop[0]['result']['pass']} -> iter1 pass={loop[1]['result']['pass']}")

    out = generate_all()
    cam_data = out["camera"]["data"]
    results = {}

    geo_meta = {
        "character": ({"check_floating": True, "ground": True}),
        "clothing": ({}),
        "prop": ({"ground": True}),
        "vehicle_car": ({"ground": True}),
        "vehicle_boat": ({}),
        "building": ({"ground": True}),
        "creature": ({"ground": True}),
        "vegetation": ({"ground": True}),
    }
    for key, extra in geo_meta.items():
        item = out[key]
        results[key] = V.validate_geometry(key, item["mesh"], item.get("expect"), extra)

    results["scene"] = V.validate_scene(out, cam_data, out["scene"]["layout"])

    # SOMA/ANNY 成人白模（如已生成）：单独验证，并作为场景主角
    anny_path = os.path.join(GEO, "soma_anny_adult.glb")
    if os.path.exists(anny_path):
        anny_mesh = trimesh.load(anny_path, force="mesh", process=False)
        results["character_soma_anny"] = V.validate_geometry(
            "character_soma_anny", anny_mesh, {"z": [1.70, 1.86], "max_parts": 4}, {"ground": True})
    results["motion"] = V.validate_motion(os.path.join(ROOT, "assets", "nongeometry", "motion_walk_2s.bvh"))
    results["camera"] = V.validate_camera(os.path.join(NGEO, "camera_path.json"))
    results["fx"] = V.validate_fx(os.path.join(NGEO, "fx_proxy.json"))
    results["crowd"] = V.validate_crowd(os.path.join(NGEO, "crowd_layout.json"))
    results["layout"] = V.validate_layout(os.path.join(NGEO, "scene_layout.json"),
                                          {"character": 1, "building": 2, "vehicle": 2, "crowd": 5})
    results["rig"] = V.validate_rig(os.path.join(NGEO, "character_rig.json"))

    summary = V.summarize(results)
    report = {"kind": "validation_report", "cpu_only": True, "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
              "summary": summary, "results": results, "agentic_loop": loop}
    wjson(os.path.join(VAL, "validation_report.json"), report)
    print("[validate]", json.dumps(summary, ensure_ascii=False))

    previews_paths = previews.render_all(out, cam_data)
    usd = export_usd.export_usd(out, cam_data, os.path.join(GEO, "scene_street.usda"))
    print("[usd]", usd)

    files = []
    for base in (os.path.join(ROOT, "assets"),):
        for dirpath, _, names in os.walk(base):
            for n in names:
                p = os.path.join(dirpath, n)
                files.append({"path": os.path.relpath(p, ROOT), "bytes": os.path.getsize(p)})
    files.sort(key=lambda x: x["path"])
    manifest = {"kind": "manifest", "root": "research/tree-resources-builder",
                "cpu_only": True, "count": len(files),
                "total_bytes": sum(f["bytes"] for f in files), "files": files,
                "elapsed_s": round(time.time() - t0, 2)}
    wjson(os.path.join(ROOT, "assets", "manifest.json"), manifest)

    data = {"validation": report, "previews": previews_paths, "usd": usd,
            "manifest": manifest, "assets": {
                k: {"path": out[k].get("path"), "meta": out[k].get("meta")}
                for k in ("character", "clothing", "prop", "vehicle_car", "vehicle_boat",
                          "building", "creature", "vegetation", "crowd", "fx", "motion", "camera")
            }, "fps_note": "所有网格为米制；+Z 向上；动作 BVH 为 Y-up 标准格式"}
    wjson(os.path.join(ROOT, "assets", "pipeline_data.json"), data)
    print(f"[done] {time.time() - t0:.1f}s, files={manifest['count']}, bytes={manifest['total_bytes']}")
    return data


if __name__ == "__main__":
    main()
