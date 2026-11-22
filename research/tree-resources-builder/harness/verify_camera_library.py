"""R2 · 镜头库台账 —— 9 类镜头的参数化 + 校验读数落盘。

产出：assets/validation/shot_library.json

这是「镜头库台账」：每类镜头一条，记录
* 参数化表达（ROADMAP §2.4.1 的统一 move 形式，已解成绝对角）
* 该类的阈值（通用项 + 类型专有覆盖）
* 逐条校验读数（构图 6 项 + 运动 8 项 + 类型专有量）
* 与镜头包 validation_report.json 的**一致性对账**（台账不是重算一遍就算数，
  必须和落盘的镜头包读数吻合）

用法：
    python verify_camera_library.py
"""
from __future__ import annotations

import json
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import camera_moves as CM        # noqa: E402
import shot_package as SP        # noqa: E402

OUT_PATH = os.path.join(ROOT, "assets", "validation", "shot_library.json")
W, H = SP.DEFAULT_WIDTH, SP.DEFAULT_HEIGHT


def build_ledger():
    verts, joints, faces, root_y = SP.load_sequence()
    subj = SP.build_subject(verts, root_y)
    entries = []
    for cat in CM.move_catalog():
        spec, note = CM.resolve_move_spec(cat["spec"], subj)
        plan = CM.build_move(spec)
        frames = CM.sample_move(plan, subj)
        ev = CM.evaluate_move(plan, frames, subj, W, H, cat.get("limits"))
        shot_dir = os.path.join(ROOT, "shots", cat["shot_id"])
        report_path = os.path.join(shot_dir, "validation_report.json")
        pkg = None
        pkg_agrees = None
        if os.path.exists(report_path):
            with open(report_path, "r", encoding="utf-8") as fh:
                pkg = json.load(fh)
            pkg_checks = {c["id"]: c for c in
                          pkg.get("composition", []) + pkg.get("motion", []) + pkg.get("conditions", [])}
            same = True
            for c in ev["checks"]:
                pc = pkg_checks.get(c["id"])
                if pc is None or bool(pc["pass"]) != bool(c["pass"]):
                    same = False
                    break
            pkg_agrees = bool(same and pkg.get("pass"))
        entries.append({
            "type": cat["type"],
            "label_zh": plan["label_zh"],
            "shot_id": cat["shot_id"],
            "title_zh": cat.get("title_zh", ""),
            "shot_dir": SP._rel(shot_dir),
            "parameterization": {
                "frame": plan["frame"],
                "duration_s": plan["duration_s"],
                "fps": plan["fps"],
                "easing": plan["easing"],
                "focal_mm": plan["focal_mm"],
                "sensor_width_mm": plan["sensor_width_mm"],
                "start": plan["start"],
                "end": plan["end"],
                "params": plan["params"],
                "mount": plan["mount"],
                "handheld": plan["handheld"],
                "resolution_note": note,
            },
            "limits": cat.get("limits") or {},
            "n_checks": ev["n_total"],
            "n_pass": ev["n_pass"],
            "all_pass": ev["all_pass"],
            "checks": ev["checks"],
            "metrics": ev["metrics"],
            "package_report": SP._rel(report_path) if pkg else None,
            "package_report_agrees": pkg_agrees,
        })
    n_green = sum(1 for e in entries if e["all_pass"] and e["package_report_agrees"] is not False)
    handheld = next((e for e in entries if e["type"] == "handheld"), None)
    fft = None
    if handheld:
        for c in handheld["checks"]:
            if c["id"] == "handheld_noise_band":
                fft = {"dominant_hz": c["value"], "band": c["limit"],
                       "pass": c["pass"], "detail": c["detail"]}
    doc = {
        "kind": "shot_library",
        "version": "1.0.0",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "generator": "harness/verify_camera_library.py",
        "up_axis": "Z",
        "convention": SP.CONVENTION,
        "resolution": [W, H],
        "fps": SP.DEFAULT_FPS,
        "duration_s": SP.DEFAULT_DURATION_S,
        "move_types": list(CM.MOVE_TYPES),
        "summary": {
            "n_types": len(entries),
            "n_types_all_checks_pass": sum(1 for e in entries if e["all_pass"]),
            "min_checks_passed": min(e["n_pass"] for e in entries) if entries else 0,
            "total_checks": sum(e["n_checks"] for e in entries),
            "total_passed": sum(e["n_pass"] for e in entries),
            "acceptance_min_checks_per_type": 5,
            "all_types_ge_5_checks": all(e["n_pass"] >= 5 for e in entries),
            "packages_agree": all(e["package_report_agrees"] is not False for e in entries),
            "handheld_fft_dominant_hz": fft["dominant_hz"] if fft else None,
            "handheld_fft_band_hz": fft["band"] if fft else None,
        },
        "all_green": bool(n_green == len(entries)
                          and all(e["n_pass"] >= 5 for e in entries)),
        "entries": entries,
    }
    return doc


def main():
    doc = build_ledger()
    SP._write_json(OUT_PATH, doc)
    s = doc["summary"]
    print(json.dumps({
        "out": SP._rel(OUT_PATH),
        "types": s["n_types"],
        "all_green": doc["all_green"],
        "min_checks_passed": s["min_checks_passed"],
        "total_passed": s["total_passed"],
        "total_checks": s["total_checks"],
        "handheld_fft_hz": s["handheld_fft_dominant_hz"],
    }, ensure_ascii=False, indent=2))
    return 0 if doc["all_green"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
