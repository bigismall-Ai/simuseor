"""R0 验收③：与 resources3D 同相机同场景交叉渲染比对。

目的
====
ROADMAP §4 R0 的验收方式③：「与 resources3D 同相机同场景交叉渲染比对（深度极性对齐后
逐像素一致率 ≥ 99%），比对脚本落盘读数」。

怎么做
======
两边**共用同一份几何与同一个相机**，只换渲染器：

* 几何：街景（generate_assets.generate_all()）合并成单一 (V, F)，
  本项目这一侧用 Z-up 世界坐标，resources3D 那一侧用 Y-up。
* 相机：用同一个 f_px（焦距像素值）定义，本项目按垂直 FOV 推导，
  resources3D 按水平 sensor-fit 推导，两边 f_px 严格相等 -> 投影逐像素可比。
* 坐标换算：p_yup = (x, z, -y)（行列式 +1 的真旋转），相机基在两个坐标系里逐项对应，
  camera-space 坐标完全相同 -> 深度逐像素可比。
* 极性：resources3D 的 wmcore.depth_to_unit 本身就是「近=1 远=0」，
  R0 裁定后本项目这一侧也是「近=1 远=0」，**不需要再做极性翻转**。

比对三个通道
============
* depth   —— 归一化深度逐像素差（主指标）
* mask    —— 前景二值逐像素一致
* lineart —— 线稿逐像素一致（两侧用同一个 face_id 边界算法）

只读纪律
========
resources3D 目录**只读**：脚本 import 它的 wmcore 之前会设
`sys.dont_write_bytecode = True`，绝不在对方目录里落 __pycache__ 或任何文件。
所有读数与比对图都写回本项目的 assets/。

用法
====
    python cross_render_compare.py
    python cross_render_compare.py --resources3d /path/to/resources3D --width 512

产出
====
* assets/validation/cross_render_compare.json   读数
* assets/previews/cross_render/*.png             双方深度图 + 差异图
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np
import trimesh
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)

import condition_contract as K  # noqa: E402
import conditions as C  # noqa: E402

DEFAULT_RESOURCES3D = os.environ.get(
    "RESOURCES3D_DIR", "/Users/moc/workspaces/SiMuseor/resources3D")

# 交叉比对用的相机（Z-up 定义）。f_px 是权威内参，两边都由它反推各自的口径。
CAM_EYE = (4.6, -11.5, 1.35)
CAM_TARGET = (-1.2, 2.0, 1.10)
CAM_UP = (0.0, 0.0, 1.0)
CAM_SENSOR_MM = 36.0
CAM_NEAR = 0.05
CAM_FAR = 2000.0

# 深度一致率的主判据容差（归一化单位）。
#
# 为什么是 1e-4 而不是 0：两侧光栅器的数值精度不同——本项目 conditions.py 的
# 光栅化用 float32（像素坐标/深度），resources3D 的 wmcore.rasterize 用 float64。
# 残差因此是**浮点舍入**，不是语义差异：实测最大归一化差 ~5.7e-6、
# 最大度量深度差 ~0.21 mm（37 m 量程）。
# 1e-4 归一化 = 该帧量程的 3.7 mm，比交付产物自身的 8bit PNG 量化（1/255≈3.9e-3）
# 细 25 倍。严格档（1e-6 / 1e-5）也一并报出，不藏。
TOL_MAIN = 1e-4
TOL_REPORT = (1e-6, 1e-5, 1e-4, 1e-3)
THRESHOLD = 0.99
TOL_RATIONALE = (
    "主容差 1e-4（归一化）：两侧光栅器精度不同（本项目 float32 / resources3D float64），"
    "残差是浮点舍入而非语义差异；实测最大归一化差 ~5.7e-6、最大度量深度差 ~0.21 mm。"
    "该容差比交付产物自身的 8bit PNG 量化（1/255≈3.9e-3）细 25 倍。严格档一并报出。"
)


# ------------------------------------------------------------------ resources3D 只读加载
def load_wmcore(resources3d_dir):
    """把 resources3D 的 wmcore 读进来（只读；不在对方目录写任何东西）。"""
    harness = os.path.join(resources3d_dir, "research", "harness")
    target = os.path.join(harness, "wmcore.py")
    if not os.path.isfile(target):
        raise FileNotFoundError(
            f"在 {resources3d_dir} 下找不到 research/harness/wmcore.py；"
            f"resources3D 目录结构与预期不符，无法完成交叉渲染比对")
    # 关键：禁止在对方目录里生成 __pycache__（那等于修改了只读目录）
    sys.dont_write_bytecode = True
    if harness not in sys.path:
        sys.path.insert(0, harness)
    import wmcore                                  # noqa: PLC0415
    return wmcore, harness


# ------------------------------------------------------------------ 场景
def build_merged_scene():
    """街景 -> 单一合并网格（Z-up 世界坐标）。

    返回 (V, F, n_objects)。两个渲染器共用同一份 V/F，保证几何完全一致。
    """
    # street_scene() 只在内存里装配场景，不写资产文件（generate_all() 会重写
    # assets/geometry/*，产生纯浮点噪声 diff）。
    from generate_assets import street_scene
    raw, _layout = street_scene()
    vs, fs, off = [], [], 0
    for _name, mesh, tf in raw:
        m = mesh.copy()
        if tf is not None:
            m.apply_transform(np.asarray(tf, dtype=np.float64).reshape(4, 4))
        v = np.asarray(m.vertices, dtype=np.float64)
        f = np.asarray(m.faces, dtype=np.int64)
        vs.append(v)
        fs.append(f + off)
        off += len(v)
    return np.vstack(vs), np.vstack(fs), len(raw)


# ------------------------------------------------------------------ 主流程
def run_compare(resources3d_dir=DEFAULT_RESOURCES3D, width=512, height=512, f_px=512.0,
                out_dir=None, json_path=None):
    out_dir = out_dir or os.path.join(ROOT, "assets", "previews", "cross_render")
    json_path = json_path or os.path.join(ROOT, "assets", "validation",
                                          "cross_render_compare.json")
    os.makedirs(out_dir, exist_ok=True)
    t_start = time.perf_counter()

    try:
        wmcore, harness_path = load_wmcore(resources3d_dir)
    except Exception as exc:                       # noqa: BLE001
        report = {
            "kind": "cross_render_compare",
            "status": "blocked",
            "blocked_at": "load_resources3d_wmcore",
            "reason": f"{type(exc).__name__}: {exc}",
            "resources3d_dir": resources3d_dir,
            "note": "resources3D 目录结构/接口与预期不符，未能完成交叉渲染比对；"
                    "本报告不含任何伪造的一致率数字",
        }
        os.makedirs(os.path.dirname(os.path.abspath(json_path)), exist_ok=True)
        with open(json_path, "w", encoding="utf-8") as fh:
            json.dump(report, fh, ensure_ascii=False, indent=2)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return report

    V, F, n_objects = build_merged_scene()

    # ---- 相机：同一个 f_px，两边各自反推
    fov_y = K.fov_y_from_f_px(f_px, height)
    focal_mm = f_px * CAM_SENSOR_MM / height          # 本项目：垂直 FOV 口径
    cam_ours = C.Camera(CAM_EYE, CAM_TARGET, CAM_UP, fov_y, width, height,
                         focal_mm, CAM_SENSOR_MM)
    eye_y = K.zup_to_yup(CAM_EYE)
    target_y = K.zup_to_yup(CAM_TARGET)
    up_y = K.zup_to_yup(CAM_UP)
    cam_r3d = wmcore.Camera(
        position=tuple(float(v) for v in eye_y),
        target=tuple(float(v) for v in target_y),
        up=tuple(float(v) for v in up_y),
        focal_mm=f_px * CAM_SENSOR_MM / width,        # resources3D：水平 sensor-fit 口径
        sensor_width_mm=CAM_SENSOR_MM,
        res=(width, height),
        near=CAM_NEAR,
        far=CAM_FAR,
    )

    # ---- 本项目这一侧（Z-up，cull_backfaces=False 对齐 resources3D 的「不剔除背面」）
    mesh_ours = trimesh.Trimesh(vertices=V, faces=F, process=False)
    t0 = time.perf_counter()
    res = C.render_conditions([{"mesh": mesh_ours, "label": "scene"}], cam_ours,
                              width=width, height=height,
                              channels=("depth", "mask", "lineart"),
                              near=CAM_NEAR, cull_backfaces=False)
    t_ours = time.perf_counter() - t0

    # ---- resources3D 那一侧（Y-up）
    V_y = K.zup_to_yup(V)
    t0 = time.perf_counter()
    out_r3d = wmcore.rasterize(V_y, F, cam_r3d)
    t_r3d = time.perf_counter() - t0
    d_r3d = wmcore.depth_to_unit(out_r3d["depth"], out_r3d["mask"])
    line_r3d = wmcore.line_art_from_face_id(out_r3d["face_id"])

    # ---- 逐像素比对
    a_depth = np.asarray(res["depth"], dtype=np.float64)
    b_depth = np.asarray(d_r3d, dtype=np.float64)
    a_mask = np.asarray(res["mask"], dtype=bool)
    b_mask = np.asarray(out_r3d["mask"], dtype=bool)

    both_fg = a_mask & b_mask
    only_ours = int((a_mask & ~b_mask).sum())
    only_r3d = int((b_mask & ~a_mask).sum())
    bg_both = int((~a_mask & ~b_mask).sum())

    diff = np.zeros_like(a_depth)
    diff[both_fg] = np.abs(a_depth[both_fg] - b_depth[both_fg])
    max_abs_diff = float(diff.max()) if both_fg.any() else 0.0
    mean_abs_diff = float(diff[both_fg].mean()) if both_fg.any() else 0.0

    depth_rates = {}
    for tol in TOL_REPORT:
        consistent = (~a_mask & ~b_mask) | (both_fg & (diff <= tol))
        depth_rates[f"tol_{tol:g}"] = float(consistent.mean())

    # 度量深度（米）差：z-buffer 逐像素
    z_ours = np.asarray(res["zbuf"], dtype=np.float64)
    z_r3d = np.asarray(out_r3d["depth"], dtype=np.float64)
    z_diff = np.abs(z_ours[both_fg] - z_r3d[both_fg]) if both_fg.any() else np.zeros(1)
    max_z_diff_m = float(z_diff.max())
    mean_z_diff_m = float(z_diff.mean())

    mask_rate = float((a_mask == b_mask).mean())
    a_line = np.asarray(res["lineart"], dtype=np.uint8) > 0
    b_line = np.asarray(line_r3d, dtype=bool)
    lineart_rate = float((a_line == b_line).mean())
    lineart_mismatch = int((a_line != b_line).sum())

    headline = depth_rates[f"tol_{TOL_MAIN:g}"]

    # ---- 比对图落盘
    vis = {}
    p = os.path.join(out_dir, "depth_ours.png")
    Image.fromarray(np.clip(a_depth * 255, 0, 255).astype(np.uint8), mode="L").save(p)
    vis["depth_ours"] = p
    p = os.path.join(out_dir, "depth_resources3d.png")
    Image.fromarray(np.clip(b_depth * 255, 0, 255).astype(np.uint8), mode="L").save(p)
    vis["depth_resources3d"] = p
    p = os.path.join(out_dir, "depth_diff_x1000.png")
    Image.fromarray(np.clip(diff * 1000.0, 0, 255).astype(np.uint8), mode="L").save(p)
    vis["depth_diff_x1000"] = p
    p = os.path.join(out_dir, "mask_diff.png")
    md = (a_mask != b_mask).astype(np.uint8) * 255
    Image.fromarray(md, mode="L").save(p)
    vis["mask_diff"] = p
    p = os.path.join(out_dir, "lineart_diff.png")
    ld = (a_line != b_line).astype(np.uint8) * 255
    Image.fromarray(ld, mode="L").save(p)
    vis["lineart_diff"] = p

    report = {
        "kind": "cross_render_compare",
        "status": "ok",
        "generated_by": "harness/cross_render_compare.py",
        "contract": K.CONTRACT_NAME,
        "contract_version": K.CONTRACT_VERSION,
        "resources3d_dir": resources3d_dir,
        "resources3d_wmcore": harness_path,
        "resources3d_readonly": True,
        "resolution": [int(width), int(height)],
        "scene": {
            "source": "generate_assets.generate_all() (merged single mesh)",
            "objects": n_objects,
            "vertices": int(len(V)),
            "faces": int(len(F)),
            "merged": True,
        },
        "camera": {
            "source": "single f_px definition; each side derives its own convention",
            "eye_zup": list(CAM_EYE),
            "target_zup": list(CAM_TARGET),
            "up_zup": list(CAM_UP),
            "f_px": float(f_px),
            "principal_point": list(K.principal_point((width, height))),
            "ours": {
                "convention": "vertical FOV / square pixels",
                "fov_y_deg": round(fov_y, 6),
                "focal_mm": round(focal_mm, 6),
                "sensor_mm": CAM_SENSOR_MM,
                "computed_f_px": round(K.f_px_from_fov(fov_y, height), 6),
            },
            "resources3d": {
                "convention": "horizontal sensor-fit",
                "focal_mm": round(cam_r3d.focal_mm, 6),
                "sensor_width_mm": cam_r3d.sensor_width_mm,
                "computed_f_px": round(float(cam_r3d.intrinsics()[0]), 6),
                "eye_yup": [float(v) for v in eye_y],
                "target_yup": [float(v) for v in target_y],
                "up_yup": [float(v) for v in up_y],
            },
            "up_axis_ours": K.UP_AXIS,
            "up_axis_resources3d": "Y",
            "axis_conversion": "p_yup = (x, z, -y)；det=+1 真旋转，相机基逐项对应",
        },
        "depth_polarity": {
            "ours": K.DEPTH_POLARITY,
            "resources3d": "near_1_far_0 (wmcore.depth_to_unit: 1 - (d-lo)/(hi-lo))",
            "aligned": True,
            "note": "R0 裁定后两边同极性，比对前不需要任何翻转",
        },
        "results": {
            "headline_metric": "depth_pixel_consistency_rate",
            "headline_tolerance": TOL_MAIN,
            "tolerance_rationale": TOL_RATIONALE,
            "headline_rate": headline,
            "threshold": THRESHOLD,
            "pass": bool(headline >= THRESHOLD),
            "depth_consistency_rate_by_tolerance": depth_rates,
            "depth_max_abs_diff_normalized": max_abs_diff,
            "depth_mean_abs_diff_normalized": mean_abs_diff,
            "depth_max_abs_diff_meters": max_z_diff_m,
            "depth_mean_abs_diff_meters": mean_z_diff_m,
            "mask_pixel_agreement": mask_rate,
            "lineart_pixel_agreement": lineart_rate,
            "lineart_mismatch_px": lineart_mismatch,
            "pixel_counts": {
                "total": int(a_mask.size),
                "both_foreground": int(both_fg.sum()),
                "both_background": bg_both,
                "only_ours": only_ours,
                "only_resources3d": only_r3d,
            },
        },
        "timing_ms": {
            "ours_render": round(t_ours * 1000.0, 2),
            "resources3d_render": round(t_r3d * 1000.0, 2),
            "total": round((time.perf_counter() - t_start) * 1000.0, 2),
        },
        "outputs": {k: os.path.relpath(v, ROOT) for k, v in vis.items()},
    }
    os.makedirs(os.path.dirname(os.path.abspath(json_path)), exist_ok=True)
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print(json.dumps({
        "status": report["status"],
        "headline_rate": headline,
        "threshold": THRESHOLD,
        "pass": report["results"]["pass"],
        "mask_pixel_agreement": mask_rate,
        "lineart_pixel_agreement": lineart_rate,
        "depth_max_abs_diff_normalized": max_abs_diff,
        "depth_max_abs_diff_meters": max_z_diff_m,
    }, ensure_ascii=False, indent=2))
    print("wrote", json_path)
    return report


def main(argv=None):
    ap = argparse.ArgumentParser(description="与 resources3D 的同相机同场景交叉渲染比对")
    ap.add_argument("--resources3d", default=DEFAULT_RESOURCES3D)
    ap.add_argument("--width", type=int, default=512)
    ap.add_argument("--height", type=int, default=512)
    ap.add_argument("--f-px", type=float, default=512.0)
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--json", default=None)
    args = ap.parse_args(argv)
    report = run_compare(args.resources3d, args.width, args.height, args.f_px,
                         args.out_dir, args.json)
    return 0 if report.get("status") == "ok" else 2


if __name__ == "__main__":
    raise SystemExit(main())
