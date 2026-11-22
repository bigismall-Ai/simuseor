"""R0 契约验收：同一场景导出六通道 PNG + 每通道 sidecar，并静态扫描七字段。

用途
====
ROADMAP §4 R0 的验收①「同一场景导出六通道 PNG + sidecar」与
验收②「静态扫描 sidecar 必含 resolution/f_px/near/far/encoding/up_axis/mask_semantics」
的落盘出口。

用法
====
    python condition_pack.py
    python condition_pack.py --width 512 --height 512

产出
====
* assets/conditions/r0_pack/cond_<channel>.png   六个通道
* assets/conditions/r0_pack/cond_<channel>.json  六份 sidecar
* assets/validation/condition_pack.json          静态扫描读数

设计理由
========
1. sidecar 必须**紧挨着图**：下游按目录取图时顺带拿到契约，不依赖另一份清单。
2. 静态扫描走 condition_contract.scan_sidecar_dir()，与契约文档表格用同一份
   SIDECAR_REQUIRED_FIELDS —— 文档和机器判定不会分叉。
3. pose 关节取自项目自己的具名骨架（generate_assets.HUMAN_JOINTS，
   与 assets/nongeometry/character_rig.json 同源），**不装任何下游检测器权重**。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)

import condition_contract as K  # noqa: E402
import conditions as C  # noqa: E402


# ------------------------------------------------------------------ 骨架
def _load_scene():
    """返回 (items, hero_tf, source)。

    items    : [{"mesh":..., "name":...}]，变换已烘进网格
    hero_tf  : 主角的世界 4x4 变换
    source   : 场景来源说明

    用 @@street_scene()@@ 而不是 @@generate_all()@@：前者**只在内存里装配场景**，
    不写任何资产文件。后者会顺带把 assets/geometry/* 全量重写一遍，在与产出
    时不同的 numpy/trimesh 版本下产生**纯浮点噪声 diff**（0.0 -> -0.0、末位 ulp）
    ——那不是 R0 要交付的东西。兜底场景（conditions._fallback_scene）把变换直接
    烘进网格，主角固定在 (0, -1.6, 0)。
    """
    try:
        from generate_assets import street_scene
        raw_items, _layout = street_scene()
    except Exception as exc:                      # noqa: BLE001
        items = C._fallback_scene()
        m = np.eye(4)
        m[1, 3] = -1.6
        return items, m, f"fallback_minimal_scene ({type(exc).__name__}: {exc})"

    items = []
    hero_tf = np.eye(4)
    for name, mesh, tf in raw_items:
        mm = mesh.copy()
        if tf is not None:
            mm.apply_transform(np.asarray(tf, dtype=np.float64).reshape(4, 4))
            if name == "hero":
                hero_tf = np.asarray(tf, dtype=np.float64)
        items.append({"mesh": mm, "name": name})
    return items, hero_tf, "generate_assets.street_scene() (in-memory, no files written)"


def _rest_joints_from_rig_file():
    """从 assets/nongeometry/character_rig.json 取 22 个具名关节的静止位置。

    备用来源：generate_assets 不可导入时用（同一套关节、同一个世界坐标系）。
    """
    path = os.path.join(ROOT, "assets", "nongeometry", "character_rig.json")
    with open(path, "r", encoding="utf-8") as fh:
        doc = json.load(fh)
    return {j["name"]: tuple(float(v) for v in j["rest"])
            for j in doc.get("joints", []) if j.get("name") != "Root"}


def build_pose_joints(hero_tf):
    """主角骨架的世界坐标（Z-up、米制）。

    返回 (joints, source)。joints 是 `{"Hips": (x, y, z), ...}`；
    键点闭集 id = human_rig_21（见 condition_contract.POSE_KEYPOINT_SET_ID）。
    """
    base = None
    source = ""
    tf = np.asarray(hero_tf, dtype=np.float64)
    try:
        from generate_assets import HUMAN_JOINTS, joint_world_positions
        base = joint_world_positions()
        source = "generate_assets.HUMAN_JOINTS (rest pose)"
    except Exception as exc:                      # noqa: BLE001
        base = _rest_joints_from_rig_file()
        source = f"assets/nongeometry/character_rig.json (rest pose) [{type(exc).__name__}]"
    out = {}
    for name in K.POSE_JOINT_NAMES:
        p = base.get(name)
        if p is None:
            continue
        w = tf @ np.append(np.asarray(p, dtype=np.float64), 1.0)
        out[name] = (round(float(w[0]), 6), round(float(w[1]), 6), round(float(w[2]), 6))
    return out, source


# ------------------------------------------------------------------ 主流程
def run_pack(width=512, height=512, out_dir=None, json_path=None):
    """导出六通道 + sidecar，做静态扫描，落盘读数。"""
    out_dir = out_dir or os.path.join(ROOT, "assets", "conditions", "r0_pack")
    json_path = json_path or os.path.join(ROOT, "assets", "validation", "condition_pack.json")
    t0 = time.perf_counter()

    items, hero_tf, scene_source = _load_scene()
    joints, joint_source = build_pose_joints(hero_tf)
    cam = C._demo_camera(width, height)
    res = C.render_conditions(items, cam, width=width, height=height,
                              channels=K.CHANNELS, pose_joints=joints)

    extra = {
        "scene": {
            "source": scene_source,
            "objects": len(items),
            "labels": res["meta"]["labels"],
            "hidden_meshes": res["meta"]["hidden_labels"],
        },
        "pose_joints": {
            "source": joint_source,
            "count": len(joints),
            "keypoint_set": K.POSE_KEYPOINT_SET_ID,
        },
        "frame": {
            "note": "同一场景同一相机，六通道共享同一前景集合与同一 depth 归一化区间",
            "near_far_m": [round(res["depth_range_m"][0], 6), round(res["depth_range_m"][1], 6)],
        },
    }
    paths = C.save_condition_pack(res, out_dir, prefix="cond", extra=extra)

    scan = K.scan_sidecar_dir(out_dir)
    sel = res["mask"]
    report = {
        "kind": "condition_pack",
        "generated_by": "harness/condition_pack.py",
        "contract": K.CONTRACT_NAME,
        "contract_version": K.CONTRACT_VERSION,
        "resolution": [int(width), int(height)],
        "scene_source": scene_source,
        "pose_joint_source": joint_source,
        "channels": list(K.CHANNELS),
        "up_axis": K.UP_AXIS,
        "units": K.UNITS,
        "depth_polarity": K.DEPTH_POLARITY,
        "f_px": res["meta"]["camera"]["f_px"],
        "near_far_m": [round(res["depth_range_m"][0], 6), round(res["depth_range_m"][1], 6)],
        "sidecar_scan": scan,
        "sidecar_required_fields": list(K.SIDECAR_REQUIRED_FIELDS),
        "outputs": {
            ch: {
                "png": os.path.relpath(paths["files"][ch], ROOT),
                "sidecar": os.path.relpath(paths["sidecars"][ch], ROOT),
            }
            for ch in K.CHANNELS
        },
        "extra_pngs": {
            k: os.path.relpath(v, ROOT) for k, v in paths["files"].items()
            if k not in K.CHANNELS
        },
        "channel_stats": {
            "foreground_px": int(res["mask"].sum()),
            "background_px": int((~res["mask"]).sum()),
            "lineart_px": int((res["lineart"] > 0).sum()),
            "pose_px": int((res["pose"].sum(axis=-1) > 0).sum()),
            "seg_labels": res["meta"]["labels"],
            "keypoints_drawn": len(res["keypoints"]),
        },
        "depth_readings": {
            "encoding": K.DEPTH_ENCODING,
            "polarity": K.DEPTH_POLARITY,
            "near_value": K.DEPTH_NEAR_VALUE,
            "far_value": K.DEPTH_FAR_VALUE,
            "background_value": K.DEPTH_BACKGROUND,
            "foreground_min": float(res["depth"][sel].min()) if sel.any() else None,
            "foreground_max": float(res["depth"][sel].max()) if sel.any() else None,
            "background_unique": (bool(len(np.unique(res["depth"][~sel])) == 1)
                                  if (~sel).any() else True),
        },
        "timing_ms": {
            "rasterize": res["meta"]["rasterize_ms"],
            "total_render_conditions": res["meta"]["total_ms"],
            "pack_total": round((time.perf_counter() - t0) * 1000.0, 2),
        },
        "pass": bool(scan["all_ok"] and scan["n_files"] == len(K.CHANNELS)),
    }
    os.makedirs(os.path.dirname(os.path.abspath(json_path)), exist_ok=True)
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print(json.dumps({
        "pass": report["pass"],
        "resolution": report["resolution"],
        "f_px": report["f_px"],
        "near_far_m": report["near_far_m"],
        "sidecar_scan": {k: scan[k] for k in ("n_files", "n_ok", "all_ok")},
        "timing_ms": report["timing_ms"],
    }, ensure_ascii=False, indent=2))
    print("wrote", json_path)
    print("wrote", out_dir)
    return report


def main(argv=None):
    ap = argparse.ArgumentParser(description="R0 契约验收：六通道 PNG + sidecar + 静态扫描")
    ap.add_argument("--width", type=int, default=512)
    ap.add_argument("--height", type=int, default=512)
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--json", default=None)
    args = ap.parse_args(argv)
    run_pack(args.width, args.height, args.out_dir, args.json)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
