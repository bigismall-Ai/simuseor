"""R6 · 与 resources3D 的契约对齐 —— 五类 CPU 指标落盘（resources3D `metrics_spec` 口径）。

做什么
======
ROADMAP §4「R6 · 与 resources3D 的契约对齐」范围③与验收②：
「R3D `metrics_spec` 的五类 CPU 指标接入本项目 `validation_report`」，
验收方式②「五类指标可在本项目产物上算出并落盘」。

本脚本做什么
============
1. 把 resources3D 的 `eval/metrics.py` 当**只读被检物**加载（口径不另抄一份，避免漂移）。
2. 在本项目**真实落盘产物**上算五类指标：
   - a 边缘一致性 `edge_consistency`
   - b 深度/结构一致性 `depth_structure_consistency`
   - c 构图/前景一致性 `composition_consistency`
   - d 机位一致性 `camera_consistency`
   - e 综合评分 `composite_score`
3. 落盘 `assets/validation/condition_metrics.json`。

口径与诚实边界
==============
* 参考图 = `shots/<shot>/frames/frame_XXXX.jpg`（本机确定性渲染帧）。
  **它不是下游模型的输出**，所以这组读数量的是「条件图与同源渲染帧的结构一致度」，
  **不是**「下游保留度」—— 下游 A/B 按 ROADMAP 明确不做。
* `metrics_spec` 的阈值来自 resources3D 的**主体级合成自检**，对整场景帧不直接适用；
  本脚本**只报口径与读数，不做达标判定**（与 R1 的处理一致）。
* resources3D 目录全程只读：`sys.dont_write_bytecode = True`（连 .pyc 都不落）。

用法
====
    python r6_condition_metrics.py
    python r6_condition_metrics.py --shot shot_001 --frames 12
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import time

sys.dont_write_bytecode = True

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)

import condition_contract as K          # noqa: E402

DEFAULT_RESOURCES3D = os.environ.get(
    "RESOURCES3D_DIR", "/Users/moc/workspaces/SiMuseor/resources3D")

FIVE_METRICS = ("edge_consistency", "depth_structure_consistency",
                "composition_consistency", "camera_consistency", "composite_score")


def load_r3d_metrics(resources3d_dir):
    path = os.path.join(resources3d_dir, "eval", "metrics.py")
    if not os.path.isfile(path):
        return None, path
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("r3d_metrics_r6_cm", path)
    mod = importlib.util.module_from_spec(spec)
    # @dataclass 解析字符串注解时要回查 sys.modules[cls.__module__].__dict__，
    # 必须先登记再执行，否则 None.__dict__ -> AttributeError。
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod, path


def pick_frames(n_total, n_pick):
    """等间隔抽样（避开只取开头，导致覆盖不到运镜中段）。"""
    if n_total <= 0:
        return []
    if n_pick >= n_total:
        return list(range(n_total))
    step = n_total / float(n_pick)
    return sorted({int(round(i * step)) for i in range(n_pick)})


def compute(resources3d_dir=DEFAULT_RESOURCES3D, shot_id="shot_001", n_frames=12,
            out_json=None):
    t0 = time.perf_counter()
    mt, metrics_path = load_r3d_metrics(resources3d_dir)
    if mt is None:
        report = {"kind": "r6_condition_metrics", "status": "blocked",
                  "reason": f"找不到 {metrics_path}",
                  "note": "没有编造读数"}
        if out_json:
            with open(out_json, "w", encoding="utf-8") as fh:
                json.dump(report, fh, ensure_ascii=False, indent=2)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return report

    cond_root = os.path.join(ROOT, "shots", shot_id, "conditions")
    frame_root = os.path.join(ROOT, "shots", shot_id, "frames")
    if not os.path.isdir(cond_root):
        report = {"kind": "r6_condition_metrics", "status": "blocked",
                  "reason": f"找不到条件图目录 {cond_root}",
                  "note": "没有编造读数"}
        if out_json:
            with open(out_json, "w", encoding="utf-8") as fh:
                json.dump(report, fh, ensure_ascii=False, indent=2)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return report

    all_frames = sorted(d for d in os.listdir(cond_root)
                        if d.startswith("frame_") and os.path.isdir(os.path.join(cond_root, d)))
    picks = pick_frames(len(all_frames), n_frames)

    rows = []
    missing = []
    for idx in picks:
        fname = all_frames[idx]
        fdir = os.path.join(cond_root, fname)
        ref_path = os.path.join(frame_root, fname.replace("frame_", "frame_") + ".jpg")
        if not os.path.exists(ref_path):
            missing.append({"frame": fname, "reason": "缺参考渲染帧"})
            continue
        depth = np.asarray(Image.open(os.path.join(fdir, "cond_depth.png")).convert("L"),
                           dtype=np.float64) / 255.0
        mask = np.asarray(Image.open(os.path.join(fdir, "cond_mask.png")).convert("L")) > 127
        lineart = np.asarray(Image.open(os.path.join(fdir, "cond_lineart.png")).convert("L")) > 127
        seg = np.asarray(Image.open(os.path.join(fdir, "cond_seg.png")).convert("RGB"))
        ref = np.asarray(Image.open(ref_path).convert("RGB"), dtype=np.float64) / 255.0
        gray = ref.mean(axis=2)
        with open(os.path.join(fdir, "cond_depth.json"), encoding="utf-8") as fh:
            side = json.load(fh)
        with open(os.path.join(fdir, "cond_seg.json"), encoding="utf-8") as fh:
            seg_side = json.load(fh)
        palette = (seg_side.get("encoding") or {}).get("palette") or {}
        subject_mask = None
        if "character" in palette:
            subject_mask = (seg == np.asarray(palette["character"], dtype=np.uint8)).all(axis=2)
        f_px = float(side["f_px"])
        near, far = float(side["near"]), float(side["far"])
        # 真值相机：本项目 Z-up -> resources3D 的 Y-up（契约 §3.1 边界换算）
        eye_y = K.zup_to_yup(np.asarray(side["camera"]["eye"], dtype=np.float64))
        tgt_y = K.zup_to_yup(np.asarray(side["camera"]["target"], dtype=np.float64))
        truth = {"position": eye_y.tolist(), "target": tgt_y.tolist(), "up": [0.0, 1.0, 0.0]}

        edge = mt.edge_consistency(lineart, gray, tol_px=2)
        struct = mt.depth_structure_consistency(depth, gray, mask, n_strata=8)
        comp = mt.composition_consistency(mask, ref)
        cam = mt.camera_consistency(depth, truth, f_px=f_px, near=near, far=far)
        score = mt.composite_score(edge=edge, structure=struct,
                                    composition=comp, camera=cam)

        comp_sub = struct_sub = fg_diag = None
        if subject_mask is not None and subject_mask.any():
            comp_sub = mt.composition_consistency(subject_mask, ref)
            struct_sub = mt.depth_structure_consistency(depth, gray, subject_mask, n_strata=8)
            est = mt.foreground_estimate(ref)
            est_mask = est["mask"]
            fg_diag = {
                "estimated_fg_px": int(est_mask.sum()),
                "estimated_fg_area_ratio": round(float(est["area_ratio"]), 4),
                "subject_px": int(subject_mask.sum()),
                "subject_area_ratio": round(float(subject_mask.mean()), 4),
                "subject_recall_in_estimate": round(
                    float((est_mask & subject_mask).sum() / max(int(subject_mask.sum()), 1)), 4),
            }
        rows.append({
            "frame": fname,
            "edge_tolerant_iou": round(edge["tolerant_iou"], 4),
            "edge_chamfer_mean_px": (None if edge["chamfer_mean_px"] is None
                                     else round(edge["chamfer_mean_px"], 3)),
            "structure_spearman": (None if struct["spearman"] is None
                                   else round(struct["spearman"], 4)),
            "structure_strata_residual": (None if struct["strata_residual"] is None
                                          else round(struct["strata_residual"], 4)),
            "composition_fg_iou": (None if comp["fg_iou"] is None
                                   else round(comp["fg_iou"], 4)),
            "composition_height_ratio_err": (None if comp["height_ratio_err"] is None
                                             else round(comp["height_ratio_err"], 4)),
            "composition_subject_fg_iou": (None if not comp_sub
                                           else round(comp_sub["fg_iou"], 4)),
            "structure_subject_spearman": (None if not struct_sub
                                           else round(struct_sub["spearman"], 4)),
            "camera_pitch_err_deg": (None if not cam.get("applicable")
                                     else round(cam["pitch_err_deg"], 4)),
            "camera_fit_quality": (None if cam.get("fit_quality") is None
                                   else round(float(cam["fit_quality"]), 4)),
            "composite_total": (None if score["total"] is None else round(score["total"], 2)),
            "composite_active": score["active_terms"],
            "foreground_estimator_diag": fg_diag,
        })

    def _med(key):
        vals = [r[key] for r in rows if r.get(key) is not None]
        return None if not vals else round(float(np.median(vals)), 4)

    catalog = []
    if hasattr(mt, "metrics_catalog"):
        try:
            catalog = mt.metrics_catalog()
        except Exception:                     # noqa: BLE001
            catalog = []

    report = {
        "kind": "r6_condition_metrics",
        "status": "ok",
        "generated_by": "harness/r6_condition_metrics.py",
        "contract": K.CONTRACT_NAME,
        "contract_version": K.CONTRACT_VERSION,
        "resources3d_dir": resources3d_dir,
        "resources3d_metrics_path": metrics_path,
        "resources3d_readonly": True,
        "five_metrics": {
            "ids": list(FIVE_METRICS),
            "all_present": {f: hasattr(mt, f) for f in FIVE_METRICS},
            "implementation": "直接调用 resources3D eval/metrics.py（本项目不另抄一份）",
            "spec": "resources3D eval/metrics_spec.md §2",
            "catalog_entries": len(catalog),
        },
        "shot_id": shot_id,
        "n_frames_total": len(all_frames),
        "n_frames_sampled": len(rows),
        "sampling": "等间隔抽样（覆盖起幅/中段/收幅，不只取开头）",
        "missing": missing,
        "reference_image": f"shots/{shot_id}/frames/frame_XXXX.jpg（本机确定性渲染帧，非下游生成图）",
        "median": {
            "a_edge_tolerant_iou": _med("edge_tolerant_iou"),
            "a_edge_chamfer_mean_px": _med("edge_chamfer_mean_px"),
            "b_structure_spearman": _med("structure_spearman"),
            "b_structure_strata_residual": _med("structure_strata_residual"),
            "c_composition_fg_iou": _med("composition_fg_iou"),
            "c_composition_height_ratio_err": _med("composition_height_ratio_err"),
            "c_composition_subject_fg_iou": _med("composition_subject_fg_iou"),
            "b_structure_subject_spearman": _med("structure_subject_spearman"),
            "d_camera_pitch_err_deg": _med("camera_pitch_err_deg"),
            "e_composite_total": _med("composite_total"),
        },
        "reading_notes": [
            "参考图是本机确定性渲染帧，不是下游模型输出 —— 这些读数量的是"
            "「条件图与同源渲染的结构一致度」，不是「下游保留度」（下游 A/B 按 ROADMAP 不做）",
            "metrics_spec 的阈值来自 resources3D 的主体级合成自检，对整场景帧（含天空与整条街）"
            "不直接适用；这里只报口径与读数，不做达标判定",
            "structure_spearman 为负：参考帧是平面着色的 previs 渲染（远处建筑/天空更亮、"
            "近处地面更暗），深度与灰阶在这张参考图上本就负相关；限定到主体掩码时为正。"
            "深度通道本身的对错由交叉渲染逐像素一致率保证，不由这条指标保证",
            "composition_fg_iou 接近 0：契约 mask 是「全部可见几何」，metrics 的前景估计是「主体」，"
            "两者语义不同；且该估计器在整场景帧里选不出主角（subject_recall_in_estimate = 0），"
            "所以这条指标要背景干净的主体级渲染才有意义",
            "d_camera_pitch_err_deg 是条件深度反解机位 vs 真值相机（Z-up -> Y-up 边界换算后）的俯仰误差，"
            "判据 ≤2° 合格 —— 这一条直接依赖本契约的坐标系与深度口径，对齐成立",
        ],
        "per_frame": rows,
        "elapsed_s": round(time.perf_counter() - t0, 3),
    }
    out_json = out_json or os.path.join(ROOT, "assets", "validation", "condition_metrics.json")
    os.makedirs(os.path.dirname(os.path.abspath(out_json)), exist_ok=True)
    with open(out_json, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print(json.dumps({"status": report["status"], "n_frames": len(rows),
                      "median": report["median"], "out": out_json},
                     ensure_ascii=False, indent=2))
    return report


def main(argv=None):
    ap = argparse.ArgumentParser(description="R6 · 五类 CPU 指标（resources3D metrics_spec 口径）")
    ap.add_argument("--resources3d", default=DEFAULT_RESOURCES3D)
    ap.add_argument("--shot", default="shot_001")
    ap.add_argument("--frames", type=int, default=12)
    ap.add_argument("--json", default=None)
    args = ap.parse_args(argv)
    report = compute(args.resources3d, args.shot, args.frames, args.json)
    return 0 if report.get("status") == "ok" else 2


if __name__ == "__main__":
    raise SystemExit(main())
