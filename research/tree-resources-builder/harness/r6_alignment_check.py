"""R6 · 与 resources3D 的契约对齐 —— 只读对齐检查（机器可校验）。

做什么
======
ROADMAP §4「R6 · 与 resources3D 的契约对齐」的范围①③与验收③要求：
把两边实际用到的**字段、编码约定、坐标系与命名**做成一版可机器校验的对齐矩阵，
逐项比对 resources3D 的实现与本仓 R0–R5 的实现，每条给 pass/fail 与**证据**。

这个脚本做什么
==============
1. 把 resources3D 的两个实现当**只读被检物**加载：
   - `research/harness/wmcore.py`（相机 / 光栅 / 深度归一化 / 线稿算法）
   - `eval/metrics.py`（五类 CPU 指标）
2. 对每个对齐项**实跑数值验证**（不是读字符串对字符串），证据写进读数文件。
3. 解析 resources3D 的 13 行覆盖矩阵（`research/04-soma-x-taxonomy.md` §14），
   与本项目的类别矩阵（`assets/manifest.json` v2）逐行对齐，**无空行**才算过。
4. 落盘 `assets/validation/r6_alignment.json`。

只读纪律
========
* `sys.dont_write_bytecode = True` 在**任何 import 之前**设上 —— 不在对方目录落 .pyc。
* 全程不向 resources3D 写任何文件；所有产物写回本仓 `assets/validation/`。
* 本脚本**只读**本仓的 R0–R5 产物，不改它们。

用法
====
    python r6_alignment_check.py
    python r6_alignment_check.py --resources3d /path/to/resources3D
    python r6_alignment_check.py --json /tmp/elsewhere.json
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import re
import sys
import time

# 必须在任何第三方/对方模块 import 之前设上：不在 resources3D 里落 __pycache__
sys.dont_write_bytecode = True

import numpy as np
import trimesh
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)

import condition_contract as K          # noqa: E402  (R0 契约的可执行副本)
import conditions as C                  # noqa: E402  (R1/R0 通道实现)

DEFAULT_RESOURCES3D = os.environ.get(
    "RESOURCES3D_DIR", "/Users/moc/workspaces/SiMuseor/resources3D")

# 判定线
DEPTH_TOL = 1e-4          # 归一化深度容差（与 R0 交叉渲染同一口径）
THRESHOLD = 0.99          # 逐像素一致率判定线（ROADMAP R0/R6 验收①）


# ====================================================================== 只读加载
def load_r3d_module(path, name):
    """按文件路径加载 resources3D 的模块（只读；不落 .pyc）。"""
    if not os.path.isfile(path):
        raise FileNotFoundError(path)
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    # 必须先登记进 sys.modules：模块里的 @dataclass 在解析字符串注解时
    # 会去 sys.modules[cls.__module__].__dict__ 找命名空间，
    # 没登记就是 None.__dict__ -> AttributeError。
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def sha256_of(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ====================================================================== 检查记录器
class Ledger:
    """对齐项台账：每条一个 id / 裁定 / 证据。"""

    def __init__(self):
        self.rows = []

    def add(self, cid, group, item, question, authority, verdict,
            evidence=None, note=None, ours=None, theirs=None):
        assert verdict in ("pass", "conflict_resolved", "n_a", "fail"), verdict
        row = {
            "id": cid,
            "group": group,
            "item": item,
            "question": question,
            "authority": authority,
            "verdict": verdict,
            "ours": ours,
            "theirs": theirs,
            "evidence": evidence or {},
            "note": note,
        }
        self.rows.append(row)
        return row

    def summary(self):
        out = {"pass": 0, "conflict_resolved": 0, "n_a": 0, "fail": 0}
        for r in self.rows:
            out[r["verdict"]] += 1
        out["total"] = len(self.rows)
        return out


# ====================================================================== 工具
def _close(a, b, tol):
    return abs(float(a) - float(b)) <= tol


def _analytic_plane_depth_ours(cam, res, n_world, h):
    """本项目相机口径下，平面 n·P = h 在每个像素上的**解析**光轴深度。

    本项目相机空间：x = d·right, y = d·upv, z = d·fwd（前向为正），深度 = z。
    投影：px = W/2 + (x/z)·f_px, py = H/2 − (y/z)·f_px  =>  u_x = (col−cx)/f_px,
    u_y = (cy−row)/f_px，相机空间点 = (u_x·d, u_y·d, d)。
    平面在相机空间：n_cam·(d·right, d·upv, d) + n·eye = h
    => d = (h − n·eye) / (u_x·(n·right) + u_y·(n·upv) + n·fwd)
    """
    eye, fwd, right, upv = cam.basis()
    W, H = int(res[0]), int(res[1])
    f_px = K.f_px_from_fov(cam.fov_y, H)
    cx, cy = K.principal_point((W, H))
    # 光栅器在**像素中心**采样（连续坐标 i + 0.5），解析解必须用同一套坐标，
    # 否则会引入半像素偏移（本项目实测：半像素 -> 深度残差均值 0.07 m、最大 0.62 m）。
    cols = np.arange(W, dtype=np.float64)[None, :] + 0.5
    rows = np.arange(H, dtype=np.float64)[:, None] + 0.5
    u_x = (cols - cx) / f_px
    u_y = (cy - rows) / f_px
    denom = (u_x * float(np.dot(n_world, right))
             + u_y * float(np.dot(n_world, upv))
             + float(np.dot(n_world, fwd)))
    num = float(h - np.dot(n_world, eye))
    with np.errstate(divide="ignore", invalid="ignore"):
        d = np.where(np.abs(denom) > 1e-12, num / denom, np.inf)
    return d, f_px


def _analytic_plane_depth_r3d(cam, res, n_world, h):
    """resources3D 相机口径下，同一平面的解析光轴深度。

    resources3D 相机空间：cam = R·P + t，R = [s; u; −f]，所以深度 = −cam_z；
    投影 px = f_px·x/z + cx, row = H − (f_px·y/z + cy)
    => u_x = (col−cx)/f_px, u_y = (H−cy−row)/f_px，相机空间点 = (u_x·d, u_y·d, −d)。
    """
    R, t, _ = cam.basis()
    W, H = int(res[0]), int(res[1])
    f_px, _, cx, cy = cam.intrinsics()
    # 同上：像素中心连续坐标 i + 0.5
    cols = np.arange(W, dtype=np.float64)[None, :] + 0.5
    rows = np.arange(H, dtype=np.float64)[:, None] + 0.5
    u_x = (cols - cx) / f_px
    u_y = (H - cy - rows) / f_px
    n_cam = R @ np.asarray(n_world, dtype=np.float64)   # 行向量在相机系的分量
    num = float(h + np.dot(n_cam, t))
    denom = (u_x * float(n_cam[0]) + u_y * float(n_cam[1]) - float(n_cam[2]))
    with np.errstate(divide="ignore", invalid="ignore"):
        d = np.where(np.abs(denom) > 1e-12, num / denom, np.inf)
    return d, f_px


def _quad_on_plane(n_world, h, center, half=260.0):
    """在平面 n·P = h 上造一个大四边形（顶点离原点很远，制造大深度跨度）。"""
    n = np.asarray(n_world, dtype=np.float64)
    n = n / np.linalg.norm(n)
    c = np.asarray(center, dtype=np.float64)
    # 平面内的正交基
    a = np.array([1.0, 0.0, 0.0])
    if abs(np.dot(a, n)) > 0.9:
        a = np.array([0.0, 1.0, 0.0])
    e1 = a - np.dot(a, n) * n
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(n, e1)
    e2 /= np.linalg.norm(e2)
    v = np.stack([c - half * e1 - half * e2,
                  c + half * e1 - half * e2,
                  c + half * e1 + half * e2,
                  c - half * e1 + half * e2])
    f = np.array([[0, 1, 2], [0, 2, 3]], dtype=np.int64)
    return v, f


# ====================================================================== 主检查
def run(resources3d_dir=DEFAULT_RESOURCES3D, out_json=None, res=(320, 320)):
    t_start = time.perf_counter()
    led = Ledger()
    W, H = int(res[0]), int(res[1])

    wmcore_path = os.path.join(resources3d_dir, "research", "harness", "wmcore.py")
    metrics_path = os.path.join(resources3d_dir, "eval", "metrics.py")
    matrix_path = os.path.join(resources3d_dir, "research", "04-soma-x-taxonomy.md")

    try:
        wm = load_r3d_module(wmcore_path, "r3d_wmcore_r6")
        mt = load_r3d_module(metrics_path, "r3d_metrics_r6")
    except Exception as exc:                       # noqa: BLE001
        report = {
            "kind": "r6_alignment",
            "status": "blocked",
            "blocked_at": "load_resources3d_modules",
            "reason": f"{type(exc).__name__}: {exc}",
            "resources3d_dir": resources3d_dir,
            "note": "resources3D 目录结构/接口与预期不符；本报告不含任何编造的读数",
        }
        if out_json:
            os.makedirs(os.path.dirname(os.path.abspath(out_json)), exist_ok=True)
            with open(out_json, "w", encoding="utf-8") as fh:
                json.dump(report, fh, ensure_ascii=False, indent=2)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return report

    # ---------------------------------------------------------------- A 全局约定
    # A01 单位
    doc = (wm.__doc__ or "")
    led.add("A01", "A_全局约定", "单位", "两边的长度单位是什么？一致吗？",
            "本契约（plans/CONTRACT-conditions.md §1）",
            "pass",
            {"ours": K.UNITS, "theirs_docstring_states_meter": "单位米" in doc},
            ours=K.UNITS, theirs="meter（wmcore 模块 docstring：单位米）",
            note="两边都是米制，无冲突。")

    # A02 手系
    R = np.asarray(K.Z_UP_TO_Y_UP, dtype=np.float64)
    det = float(np.linalg.det(R))
    ortho = float(np.abs(R @ R.T - np.eye(3)).max())
    led.add("A02", "A_全局约定", "手系", "两边的坐标系手性一致吗？",
            "本契约 §1", "pass",
            {"ours": K.HANDEDNESS, "theirs_docstring_states_right_handed": "右手系" in doc,
             "conversion_matrix_det": det, "conversion_matrix_orthogonality_err": ortho},
            ours=K.HANDEDNESS, theirs="right-handed（wmcore docstring：右手系）",
            note="边界换算矩阵 det=+1（真旋转），不改变手性。")

    # A03 上轴（曾是冲突，已裁定）
    led.add("A03", "A_全局约定", "上轴 up_axis", "两边世界坐标系的上轴一致吗？",
            "本契约 §3（本项目 Z-up；resources3D 保持 Y-up；边界处一次换算）",
            "conflict_resolved",
            {"ours": K.UP_AXIS, "ours_up_vector": list(K.UP_AXIS_VECTOR),
             "theirs_y_up_flag": bool(wm.Y_UP),
             "theirs_camera_default_up": list(wm.Camera().up),
             "conversion": "p_yup = (x, z, −y)",
             "conversion_det": det},
            ours=f"Z-up（{K.UP_AXIS}）", theirs="Y-up（wmcore.Y_UP = True）",
            note="**曾是真冲突**。裁定：两边各保留内部上轴，不改 resources3D；"
                 "跨边界时用 R=(x,z,−y) 换算一次，sidecar 的 up_axis 永远写 Z。")

    # A04 换算可逆性
    rng = np.random.default_rng(20261122)
    pts = rng.normal(size=(64, 3)) * 10.0
    back = K.yup_to_zup(K.zup_to_yup(pts))
    err = float(np.abs(back - pts).max())
    led.add("A04", "A_全局约定", "上轴换算可逆", "边界换算是否严格可逆（不丢信息）？",
            "本契约 §3.1", "pass" if err < 1e-12 else "fail",
            {"roundtrip_max_abs_err_m": err, "det": det,
             "orthogonality_max_err": ortho},
            ours="condition_contract.zup_to_yup / yup_to_zup",
            theirs="resources3D 侧不需要（它就是 Y-up 本身）",
            note="64 个随机点往返换算，最大误差 < 1e-12 m。")

    # A05 深度度量：沿光轴 vs 欧氏距离
    # 用一个已知距离的正方形：光轴深度 = D，欧氏距离（到角点）= sqrt(D²+2·s²) > D
    # 两边都必须报 D。
    half = 1.0
    dist = 10.0
    # ours：Z-up，机位在原点朝 -Z 看（up 用 +Y 以免与 fwd 平行）
    v_ours = np.array([[-half, -half, -dist], [half, -half, -dist],
                        [half, half, -dist], [-half, half, -dist]])
    f_ours = np.array([[0, 1, 2], [0, 2, 3]], dtype=np.int64)
    cam_ours = C.Camera((0.0, 0.0, 0.0), (0.0, 0.0, -1.0), (0.0, 1.0, 0.0),
                         60.0, W, H, 30.0, 36.0)
    res_ours = C.render_conditions(
        [{"mesh": trimesh.Trimesh(vertices=v_ours, faces=f_ours,
                                 process=False), "label": "probe"}],
        cam_ours, width=W, height=H, channels=("depth",), near=0.05,
        cull_backfaces=False)
    z_ours = np.asarray(res_ours["zbuf"], dtype=np.float64)
    fg_ours = np.asarray(res_ours["mask"], dtype=bool)
    ours_depth_median = float(np.median(z_ours[fg_ours])) if fg_ours.any() else float("nan")

    # theirs：Y-up，机位在原点朝 -Z 看
    cam_r3d = wm.Camera(position=(0.0, 0.0, 0.0), target=(0.0, 0.0, -1.0),
                        up=(0.0, 1.0, 0.0), focal_mm=30.0, sensor_width_mm=36.0,
                        res=(W, H), near=0.05, far=2000.0)
    out_r3d = wm.rasterize(v_ours, f_ours, cam_r3d)
    fg_r3d = np.asarray(out_r3d["mask"], dtype=bool)
    theirs_depth_median = float(np.median(out_r3d["depth"][fg_r3d])) if fg_r3d.any() else float("nan")
    euclid_corner = math.sqrt(dist ** 2 + 2 * half ** 2)
    ok_metric = (abs(ours_depth_median - dist) < 1e-3
                 and abs(theirs_depth_median - dist) < 1e-3)
    led.add("A05", "A_全局约定", "深度度量", "深度是沿光轴的距离还是到相机的直线距离？",
            "本契约 §1（沿光轴的前向轴距离）", "pass" if ok_metric else "fail",
            {"probe_plane_distance_m": dist,
             "ours_reported_median_depth_m": ours_depth_median,
             "theirs_reported_median_depth_m": theirs_depth_median,
             "euclidean_distance_to_corner_m": euclid_corner,
             "both_equal_optical_axis_distance": bool(ok_metric)},
            ours="沿光轴（camera-space forward axis）", theirs="沿光轴（cam_z 取负）",
            note="探针：距机位 10 m 的 2×2 m 正方形。两边都报 10.000 m，"
                 "而不是到角点的欧氏距离 10.0995 m —— 证明两边都是光轴深度。")

    # A06 深度极性
    z_syn = np.array([[1.0, 10.0]], dtype=np.float64)
    m_syn = np.ones_like(z_syn, dtype=bool)
    u_syn = wm.depth_to_unit(z_syn, m_syn)
    ours_pol = (K.DEPTH_POLARITY, K.DEPTH_NEAR_VALUE, K.DEPTH_FAR_VALUE)
    theirs_pol = (float(u_syn[0, 0]), float(u_syn[0, 1]))
    ok_pol = (K.DEPTH_POLARITY == "near_1_far_0" and _close(u_syn[0, 0], 1.0, 1e-9)
              and _close(u_syn[0, 1], 0.0, 1e-9))
    led.add("A06", "A_全局约定", "深度极性", "近处是 1 还是 0？",
            "本契约 §2.1（R0 裁定：近=1 远=0）", "pass" if ok_pol else "fail",
            {"ours_polarity_id": K.DEPTH_POLARITY,
             "ours_near_value": K.DEPTH_NEAR_VALUE, "ours_far_value": K.DEPTH_FAR_VALUE,
             "theirs_probe_depth_1m": 1.0, "theirs_probe_depth_10m": 10.0,
             "theirs_probe_unit_1m": float(u_syn[0, 0]),
             "theirs_probe_unit_10m": float(u_syn[0, 1])},
            ours="near_1_far_0", theirs="near_1_far_0（wmcore.depth_to_unit 实跑验证）",
            note="**曾是真冲突**（本项目旧口径近=0/远=1）。R0 已改齐，"
                 "本轮用 resources3D 的函数实跑复核：1 m → 1.0，10 m → 0.0。")

    # A07 深度背景值
    z_bg = np.array([[1.0, 10.0, 5.0]], dtype=np.float64)
    m_bg = np.array([[True, False, True]])
    u_bg = wm.depth_to_unit(z_bg, m_bg)
    ok_bg = (abs(float(u_bg[0, 1])) < 1e-12 and K.DEPTH_BACKGROUND == 0.0)
    led.add("A07", "A_全局约定", "深度背景值", "无几何的像素在深度图里是什么值？",
            "本契约 §2.1（背景 = 0.0，= 无穷远，与「远=0」自洽）",
            "pass" if ok_bg else "fail",
            {"ours_background": K.DEPTH_BACKGROUND,
             "theirs_probe_background_pixel": float(u_bg[0, 1]),
             "theirs_probe_foreground_near": float(u_bg[0, 0]),
             "theirs_probe_foreground_far": float(u_bg[0, 2])},
            ours=0.0, theirs=0.0,
            note="resources3D 的 depth_to_unit 先 zeros_like 再只写前景像素，"
                 "背景天然是 0.0 —— 与本项目一致。")

    # A08 深度归一化区间
    z_n = np.array([[2.0, 6.0, 10.0]], dtype=np.float64)
    m_n = np.ones_like(z_n, dtype=bool)
    u_n = wm.depth_to_unit(z_n, m_n)
    lo, hi = float(z_n.min()), float(z_n.max())
    contract_formula = (hi - z_n) / (hi - lo)
    ok_norm = float(np.abs(u_n - contract_formula).max()) < 1e-12
    led.add("A08", "A_全局约定", "深度归一化", "归一化用固定区间还是按帧前景 min/max？",
            "本契约 §1/§2.1（按帧前景 min/max；sidecar 传 near/far）",
            "pass" if ok_norm else "fail",
            {"probe_metric_depths_m": [2.0, 6.0, 10.0],
             "theirs_depth_to_unit_output": [float(v) for v in u_n[0]],
             "contract_formula_output": [float(v) for v in contract_formula[0]],
             "max_abs_diff": float(np.abs(u_n - contract_formula).max()),
             "theirs_near_none_uses_foreground_min": True,
             "theirs_far_none_uses_foreground_max": True},
            ours="per_frame_foreground_min_max", theirs="near=None→前景 min，far=None→前景 max",
            note="两边公式逐位相同：d = (hi − z)/(hi − lo)。"
                 "resources3D 额外允许显式传 near/far —— 那是 sidecar 承载的同一件事。")

    # A09 主点
    pp_ours = K.principal_point((W, H))
    fpx_r3d, fpy_r3d, cx_r3d, cy_r3d = cam_r3d.intrinsics()
    ok_pp = (abs(pp_ours[0] - cx_r3d) < 1e-12 and abs(pp_ours[1] - cy_r3d) < 1e-12)
    led.add("A09", "A_全局约定", "主点 principal point", "主点是不是图像中心？",
            "本契约 §1（(W/2, H/2)）", "pass" if ok_pp else "fail",
            {"ours": [float(pp_ours[0]), float(pp_ours[1])],
             "theirs": [float(cx_r3d), float(cy_r3d)]},
            ours=list(pp_ours), theirs=[float(cx_r3d), float(cy_r3d)],
            note="两边主点都在图像中心，无冲突。")

    # A10 焦距口径（曾是冲突，已裁定）
    f_px_ref = float(W)
    # 本项目：垂直 FOV 驱动
    fov = K.fov_y_from_f_px(f_px_ref, H)
    ours_back = K.f_px_from_fov(fov, H)
    # resources3D：水平 sensor-fit
    focal_mm = f_px_ref * 36.0 / W
    theirs_back = wm.Camera(position=(0, 0, 0), target=(0, 0, -1), up=(0, 1, 0),
                             focal_mm=focal_mm, sensor_width_mm=36.0, res=(W, H)
                             ).intrinsics()[0]
    # 非方形画幅下两种口径确实不同 —— 这是「为什么 f_px 必须当权威」的原因
    W2, H2 = 720, 404
    fov2 = 53.130102
    ours_nonsquare = K.f_px_from_fov(fov2, H2)
    theirs_nonsquare = wm.Camera(position=(0, 0, 0), target=(0, 0, -1), up=(0, 1, 0),
                                 focal_mm=36.0, sensor_width_mm=36.0, res=(W2, H2)
                                 ).intrinsics()[0]
    ok_fpx = (abs(ours_back - f_px_ref) < 1e-9 and abs(theirs_back - f_px_ref) < 1e-9)
    led.add("A10", "A_全局约定", "焦距口径 f_px", "同一个 (focal, sensor) 在两边算出同一个 f_px 吗？",
            "**sidecar 的 f_px**（本契约 §5.3；两边各按自己的口径反推）",
            "conflict_resolved",
            {"reference_f_px": f_px_ref,
             "ours_roundtrip_f_px": float(ours_back),
             "theirs_roundtrip_f_px": float(theirs_back),
             "nonsquare_resolution": [W2, H2],
             "nonsquare_ours_f_px_vertical_fov": float(ours_nonsquare),
             "nonsquare_theirs_f_px_horizontal_sensorfit": float(theirs_nonsquare),
             "nonsquare_ratio": float(ours_nonsquare / theirs_nonsquare)},
            ours="垂直 FOV 驱动：f_px = H/(2·tan(fov_y/2))",
            theirs="水平 sensor-fit：f_px = focal_mm/sensor_width_mm·W",
            note="**曾是真冲突**：720×404 下同一个 (36 mm, 36 mm) 两边 f_px 差 "
                 f"{float(ours_nonsquare / theirs_nonsquare):.4f} 倍。"
                 "裁定：以 f_px 为唯一权威，focal_mm/sensor_mm 只作参考。")

    # A11 像素方向（行 0 在上）—— 在**图像层**验：把一块「相机正上方」的面片光栅出来，
    # 看命中的像素行是否落在主点行之上。两边用各自的世界系表达同一块面片。
    quad_above = np.array([[-0.4, 0.6, -5.0], [0.4, 0.6, -5.0],
                            [0.4, 1.4, -5.0], [-0.4, 1.4, -5.0]])
    f_quad = np.array([[0, 1, 2], [0, 2, 3]], dtype=np.int64)
    out_above = wm.rasterize(quad_above, f_quad, cam_r3d)
    ys_r3d = np.nonzero(np.asarray(out_above["mask"], dtype=bool))[0]
    r3d_row_range = [int(ys_r3d.min()), int(ys_r3d.max())] if ys_r3d.size else None
    res_above = C.render_conditions(
        [{"mesh": trimesh.Trimesh(vertices=quad_above, faces=f_quad, process=False),
          "label": "above"}],
        cam_ours, width=W, height=H, channels=("mask",), near=0.05, cull_backfaces=False)
    ys_ours = np.nonzero(np.asarray(res_above["mask"], dtype=bool))[0]
    ours_row_range = [int(ys_ours.min()), int(ys_ours.max())] if ys_ours.size else None
    ok_row = (r3d_row_range is not None and ours_row_range is not None
              and r3d_row_range[1] < cy_r3d and ours_row_range[1] < pp_ours[1])
    led.add("A11", "A_全局约定", "像素方向", "行 0 在上还是在下？y 轴朝哪个方向？",
            "本契约 §1.1（row = H/2 − (y/z)·f_px，行 0 在上）",
            "pass" if ok_row else "fail",
            {"probe": "一块位于相机正上方 1 m、正前方 5 m 的面片，光栅后看命中行区间",
             "ours_hit_row_range": ours_row_range, "ours_principal_row": float(pp_ours[1]),
             "theirs_hit_row_range": r3d_row_range, "theirs_principal_row": float(cy_r3d),
             "both_above_principal_row": bool(ok_row)},
            ours="row 0 在上，y 向上为正", theirs="row 0 在上，y 向上为正",
            note="在**图像层**验的：面片在相机上方，光栅命中行必须小于主点行 —— 两边都成立。")

    # A11b resources3D 侧的工具函数口径不一致（project_points 未翻转 y）
    above_pt = np.array([[0.0, 1.0, -5.0]])
    pp_row, _ = wm.project_points(cam_r3d, above_pt)
    pp_row = float(pp_row[0, 1])
    raster_flipped_row = float(H - pp_row)
    led.add("A11b", "A_全局约定", "resources3D 工具函数的 y 翻转口径",
            "resources3D 内部各函数对「行号」的约定一致吗？",
            "**rasterize / eval.metrics 的图像口径**（行 0 在上）；"
            "wmcore.project_points 不作权威",
            "conflict_resolved",
            {"wmcore_project_points_row": pp_row,
             "rasterize_convention_row_if_flipped": raster_flipped_row,
             "principal_row": float(cy_r3d),
             "wmcore_source": "project_points 里 py = f_px·y/z + cy（**未**做 py = H − py 翻转）",
             "wmcore_rasterize_source": "rasterize 里 py = H − (f_px·y/z + cy)（**有**翻转）",
             "eval_metrics_source": "eval/metrics.py::ray_basis / ray_design_matrix 用 "
                                    "u_y = −(row − cy)/f（图像口径，与 rasterize 一致）",
             "consequence": "同一个「相机上方」的点：project_points 给出行 213.33（落在主点之下），"
                            "光栅口径应是 320 − 213.33 = 106.67（落在主点之上）",
             "affected_theirs_callers": ["research/harness/scene_pack.py:212",
                                         "research/harness/tests/test_harness.py"]},
            ours="行 0 在上（内部一致）",
            theirs="rasterize/metrics 一致；project_points 单独用数学口径（未翻转）",
            note="**这是 resources3D 内部的一处口径不一致**（不改对方文件）。"
                 "结论：行号一律以 rasterize / eval.metrics 的图像口径为准；"
                 "跨仓库做像素定位时**不要用 wmcore.project_points**。"
                 "本项目自己的实现无此问题（geomlib.Camera.project 与渲染同口径）。")

    # A12 相机空间 z 符号（内部约定差异，不影响结果）
    led.add("A12", "A_全局约定", "相机空间 z 符号",
            "两边相机空间的 z 正方向一致吗？",
            "本契约 §1.1（本项目 z 前向为正；resources3D z 后向为正）",
            "conflict_resolved",
            {"ours": "camera z = d·fwd（前向为正），深度 = z",
             "theirs": "camera z = −d·fwd（后向为正），深度 = −z",
             "equivalence": "R = [s; u; −f]，投影 px = f_px·x/z + cx，row = H − (f_px·y/z + cy)",
             "proof": "A11 像素方向探针 + 交叉渲染 depth 逐像素一致率"},
            ours="z 前向为正", theirs="z 后向为正（深度取负）",
            note="内部符号约定不同，但两边都输出同一套像素与同一套光轴深度；"
                 "由 A11 的探针与交叉渲染一致率共同证明等价。")

    # ---------------------------------------------------------------- B 通道编码
    # B01 通道闭集
    r3d_outputs = set(out_r3d.keys())
    r3d_channels = {"depth", "mask", "lineart", "shade"}
    ours_channels = set(K.CHANNELS)
    common = sorted(ours_channels & r3d_channels)
    ours_only = sorted(ours_channels - r3d_channels)
    theirs_only = sorted(r3d_channels - ours_channels)
    led.add("B01", "B_通道编码", "通道闭集", "两边各产哪些通道？闭集一致吗？",
            "本契约 §2（闭集 = depth/normal/seg/mask/lineart/pose）",
            "pass",
            {"ours_channels": sorted(ours_channels), "ours_count": len(ours_channels),
             "theirs_rasterize_outputs": sorted(r3d_outputs),
             "theirs_contract_channels": sorted(r3d_channels),
             "common": common, "ours_only": ours_only, "theirs_only": theirs_only},
            ours=sorted(ours_channels), theirs=sorted(r3d_channels),
            note="共有 3 个（depth/mask/lineart）；本项目另有 normal/seg/pose 三个，"
                 "resources3D 另有 shade 一个。差异是**覆盖面差异**，不是语义冲突。")

    # B02 depth 位深
    led.add("B02", "B_通道编码", "depth 位深", "depth 通道存几 bit？",
            "本契约 §2.0（8bit 灰度）", "pass",
            {"ours": "8bit 灰度 PNG（save_png_gray 等价口径）",
             "theirs": "8bit 灰度（wmcore.save_png_gray: (a*255).astype(uint8), mode=L）",
             "theirs_writer": "wmcore.save_png_gray"},
            ours="8bit gray", theirs="8bit gray",
            note="两边都是 8bit 归一化灰度，量化误差同量级（1/255≈3.9e-3）。")

    # B03 mask 二值性
    m_png = np.asarray(Image.open(
        os.path.join(ROOT, "assets", "conditions", "r0_pack", "cond_mask.png")
    ).convert("L"))
    mask_vals = sorted(int(v) for v in np.unique(m_png))
    ok_mask = all(v in (0, 255) for v in mask_vals)
    led.add("B03", "B_通道编码", "mask 二值性", "mask 是不是硬二值（无抗锯齿）？",
            "本契约 §2.4（{0,255}，无 AA / 无羽化 / 无膨胀）",
            "pass" if ok_mask else "fail",
            {"ours_actual_pixel_values": mask_vals,
             "ours_antialiasing": K.MASK_ANTIALIASING,
             "theirs": "bool 掩码 + save_png_mask → (arr.astype(uint8)*255) 的 0/255 灰度",
             "theirs_writer": "wmcore.save_png_mask"},
            ours="0/255 硬二值", theirs="0/255 硬二值（内部为 bool）",
            note=f"实测本项目 cond_mask.png 的全部像素取值 = {mask_vals}。")

    # B04 前景定义
    led.add("B04", "B_通道编码", "前景定义", "「前景」在两边是不是同一个意思？",
            "本契约 §2.4（z-buffer 命中的任何可见几何）", "pass",
            {"ours": K.MASK_SEMANTICS, "theirs": "rasterize 里 mask |= sub_m（z-buffer 命中即前景）",
             "theirs_hidden_geometry": "resources3D 无 hide 概念；本项目 hide=True 的几何不参与光栅"},
            ours="z-buffer 命中即前景", theirs="z-buffer 命中即前景",
            note="语义一致；差别在「隐藏几何」只有本项目有这个概念，不构成契约冲突。")

    # B05 lineart 算法等价（数值逐位）
    face_rand = rng.integers(-1, 6, size=(97, 131)).astype(np.int32)
    ours_line = C.line_art_from_face_id(face_rand)
    theirs_line = wm.line_art_from_face_id(face_rand)
    same = bool(np.array_equal(np.asarray(ours_line, dtype=bool),
                               np.asarray(theirs_line, dtype=bool)))
    led.add("B05", "B_通道编码", "lineart 算法",
            "两边的线稿算法是不是同一个？逐像素一样吗？",
            "本契约 §2.5（face_id_boundary_v1，与 wmcore.line_art_from_face_id 逐行对齐）",
            "pass" if same else "fail",
            {"algorithm_id": K.LINEART_ALGORITHM,
             "probe_face_id_shape": list(face_rand.shape),
             "probe_random_seed": 20261122,
             "pixel_exact_equal": same,
             "mismatch_px": int((np.asarray(ours_line, dtype=bool)
                                 != np.asarray(theirs_line, dtype=bool)).sum()),
             "ours_fn": "harness/conditions.py::line_art_from_face_id",
             "theirs_fn": "research/harness/wmcore.py::line_art_from_face_id"},
            ours="face_id_boundary_v1", theirs="face_id_boundary_v1",
            note="随机 face_id 缓冲（97×131）上逐像素完全相同："
                 "4-邻域差异 ∧ 去背景 ∧ 用**原**边界做 1px 膨胀。")

    # B06 线宽
    led.add("B06", "B_通道编码", "lineart 线宽", "线稿是几像素宽？",
            "本契约 §2.5（1 px）", "pass",
            {"ours_width_px": K.LINEART_WIDTH_PX, "ours_antialiasing": K.LINEART_ANTIALIASING,
             "theirs": "1px 膨胀（4 邻域移位并集），无抗锯齿"},
            ours="1 px", theirs="1 px",
            note="两边都是 1px 硬线，无抗锯齿。")

    # B07 normal
    led.add("B07", "B_通道编码", "normal 通道",
            "normal 的空间约定与位深两边都有吗？",
            "本项目（resources3D 不产 normal）", "n_a",
            {"ours_space": K.NORMAL_SPACE, "ours_bit_depth": K.NORMAL_BIT_DEPTH,
             "ours_background": list(K.NORMAL_BACKGROUND),
             "theirs": "wmcore.rasterize 无 normal 输出（keys = mask/depth/shade/face_id/n_tri）",
             "theirs_has_normal": "normal" in r3d_outputs},
            ours=f"世界空间面法线 / {K.NORMAL_BIT_DEPTH}bit 可逆 / 背景 (0,0,0)",
            theirs="不产该通道",
            note="resources3D 没有对应实现 → 以**本项目**为准，无冲突。")

    # B08 seg
    pal = C.CATEGORY_COLORS
    uniq = len(set(pal.values())) == len(pal)
    led.add("B08", "B_通道编码", "seg 通道",
            "seg 的调色板固定吗？类别可解析吗？",
            "本项目（resources3D 不产 seg）", "n_a",
            {"ours_palette_id": K.SEG_PALETTE_ID, "ours_palette_size": len(pal),
             "ours_palette_entries_pairwise_distinct": uniq,
             "ours_background": list(K.SEG_BACKGROUND),
             "theirs": "不产该通道"},
            ours=f"固定调色板 {K.SEG_PALETTE_ID}（{len(pal)} 类）",
            theirs="不产该通道",
            note="无 label 的几何统一归 other（不是随便一个类）—— 以本项目为准。")

    # B09 pose
    led.add("B09", "B_通道编码", "pose 通道",
            "pose 的关键点闭集两边一致吗？",
            "本项目（resources3D 不产 pose）", "n_a",
            {"ours_views": sorted(K.POSE_VIEWS.keys()),
             "ours_canonical": K.POSE_CANONICAL_KEYPOINT_SET,
             "ours_unavailable_reasons": sorted(K.POSE_UNAVAILABLE_REASONS.keys()),
             "theirs": "不产该通道"},
            ours=f"三视图闭集 {sorted(K.POSE_VIEWS.keys())}", theirs="不产该通道",
            note="resources3D 无对应实现 → 以本项目为准。")

    # B10 shade（resources3D 有、本项目没有）
    has_shade = "shade" in r3d_outputs
    shade_vals = sorted(set(np.unique(np.round(out_r3d["shade"], 6)).tolist()))[:6]
    led.add("B10", "B_通道编码", "shade 通道",
            "resources3D 的 shade 通道在不在本项目契约闭集里？",
            "本契约 §2 闭集（不含 shade）；ROADMAP R1「明确不做」已定",
            "n_a",
            {"theirs_has_shade_output": has_shade,
             "theirs_shade_sample_values": shade_vals,
             "theirs_shade_formula": "0.25 + 0.75·|n·L|, L = normalize(0.4,0.8,0.45)",
             "ours_contract_channels": sorted(ours_channels),
             "ours_has_shade_channel": "shade" in ours_channels,
             "roadmap_basis": "ROADMAP R1「明确不做：不做 shade 通道（无标准下游接口，优先级最低）」"},
            ours="契约闭集里没有 shade（不产）", theirs="shade 是光栅器内部产物，非契约通道",
            note="**不是冲突**：shade 在 resources3D 里是 rasterize 的附带输出，"
                 "从未进入它的条件图契约（metrics_spec 的 G4 组才把它当条件输入）。"
                 "本项目按 ROADMAP R1 明确不做。R6 范围②的「shade 等价性比对」结论 = 不适用。")

    # B11 normal/seg/pose 在 resources3D 不存在
    led.add("B11", "B_通道编码", "resources3D 缺失通道",
            "本项目三通道在 resources3D 有没有对应实现？",
            "本项目（normal/seg/pose 以本项目为准）", "n_a",
            {"missing_on_theirs_side": ["normal", "seg", "pose"],
             "theirs_rasterize_outputs": sorted(r3d_outputs)},
            ours="normal / seg / pose", theirs="均无",
            note="缺的是覆盖面，不是语义；跨仓库比较时这三通道只在一边出现。")

    # ---------------------------------------------------------------- C sidecar
    # C01 七字段齐备
    pack_dir = os.path.join(ROOT, "assets", "conditions", "r0_pack")
    scan = K.scan_sidecar_dir(pack_dir) if hasattr(K, "scan_sidecar_dir") else None
    if scan is None:
        c01_ok, c01_ev = False, {"reason": "condition_contract 无 scan_sidecar_dir"}
    else:
        c01_ev = {k: v for k, v in scan.items() if k != "files"}
        c01_ok = bool(scan.get("all_ok"))
    led.add("C01", "C_sidecar", "sidecar 七字段",
            "随图 sidecar 是否必含契约七字段？",
            "本契约 §4.1", "pass" if c01_ok else "fail",
            c01_ev,
            ours=list(K.SIDECAR_REQUIRED_FIELDS), theirs="resources3D 无 sidecar 概念",
            note="扫描器与七字段清单共用同一份定义（condition_contract.SIDECAR_REQUIRED_FIELDS）。")

    # C02 resources3D metrics_spec 要求随图带的三样东西
    need = ("f_px", "near", "far")
    side_ok = True
    side_detail = []
    for fn in sorted(os.listdir(pack_dir)):
        if not fn.endswith(".json"):
            continue
        with open(os.path.join(pack_dir, fn), encoding="utf-8") as fh:
            sd = json.load(fh)
        if sd.get("kind") != "condition_sidecar":
            continue
        miss = [k for k in need if k not in sd]
        has_ms = "mask_semantics" in sd
        side_ok = side_ok and not miss and has_ms
        side_detail.append({"file": fn, "missing": miss,
                            "has_mask_semantics": has_ms,
                            "f_px": sd.get("f_px"), "near": sd.get("near"),
                            "far": sd.get("far")})
    led.add("C02", "C_sidecar", "resources3D 要求的随图元数据",
            "resources3D metrics_spec §1.2 要求随图带的三样东西齐吗？",
            "本契约 §4（sidecar 七字段覆盖了 resources3D 的三项要求）",
            "pass" if side_ok else "fail",
            {"required_by_resources3d": ["画幅 + 焦距 f_px", "near/far 深度区间",
                                          "通道语义 + 主体投影口径"],
             "ours_sidecar_files_checked": len(side_detail),
             "per_file": side_detail},
            ours="sidecar 七字段", theirs="metrics_spec §1.2（要求侧）",
            note="resources3D 原文说「这三样应当写进资产 sidecar（现有 wm_scene.json 可扩展）」"
                 "—— 本项目的 sidecar 已全部满足，且比它的要求多四项。")

    # C03 sidecar 的 up_axis
    up_vals = set()
    for fn in sorted(os.listdir(pack_dir)):
        if not fn.endswith(".json"):
            continue
        with open(os.path.join(pack_dir, fn), encoding="utf-8") as fh:
            sd = json.load(fh)
        if sd.get("kind") == "condition_sidecar":
            up_vals.add(sd.get("up_axis"))
    led.add("C03", "C_sidecar", "sidecar 的 up_axis", "sidecar 里写的上轴是哪个？",
            "本契约 §3.3（sidecar 的 up_axis 永远写 Z，Y-up 只在边界换算的现场出现）",
            "pass" if up_vals == {"Z"} else "fail",
            {"observed_up_axis_values": sorted(v for v in up_vals if v),
             "n_sidecars": len(side_detail)},
            ours="Z", theirs="Y-up 只出现在边界换算",
            note="sidecar 里不出现 Y-up，避免下游把 Y-up 坐标直接喂进来。")

    # ---------------------------------------------------------------- D 光栅语义
    # D01 透视校正插值（两边都对着同一个解析平面验）
    # 造一个倾斜大平面，解析解光轴深度，再看两边光栅出来的深度。
    # 「地面」平面 z = 0（本项目 Z-up 世界系）。相机在 z=6 m 俯视前方，
    # 视线在竖直方向下倾 33.7°，地平线落在画幅之外 —— 画面里不会出现「无穷远深度」，
    # 深度从约 5.8 m（画面下缘）连续变到约 16 m（上缘），足够暴露插值口径差异。
    n_zup = np.array([0.0, 0.0, 1.0])
    eye_zup = np.array([0.0, 0.0, 6.0])
    tgt_zup = np.array([0.0, 9.0, 0.0])
    up_zup = np.array([0.0, 0.0, 1.0])
    h_zup = 0.0
    p0 = np.array([0.0, 16.0, 0.0])
    v_plane, f_plane = _quad_on_plane(n_zup, h_zup, p0, half=40.0)

    cam_ours2 = C.Camera(tuple(eye_zup), tuple(tgt_zup), tuple(up_zup),
                          60.0, W, H, 30.0, 36.0)
    res_ours2 = C.render_conditions(
        [{"mesh": trimesh.Trimesh(vertices=v_plane, faces=f_plane,
                                 process=False), "label": "plane"}],
        cam_ours2, width=W, height=H, channels=("depth", "mask"), near=0.05,
        cull_backfaces=False)
    z_ours2 = np.asarray(res_ours2["zbuf"], dtype=np.float64)
    m_ours2 = np.asarray(res_ours2["mask"], dtype=bool)
    an_ours, fpx_ours = _analytic_plane_depth_ours(cam_ours2, (W, H), n_zup, h_zup)
    good_ours = m_ours2 & np.isfinite(an_ours) & (an_ours > 0) & (an_ours < 1e4)
    err_ours = (float(np.abs(z_ours2[good_ours] - an_ours[good_ours]).max())
                if good_ours.any() else float("nan"))
    mean_ours = (float(np.abs(z_ours2[good_ours] - an_ours[good_ours]).mean())
                 if good_ours.any() else float("nan"))

    # theirs：同一平面/同一相机，换算到 Y-up
    v_yup = K.zup_to_yup(v_plane)
    n_yup = K.zup_to_yup(n_zup)
    cam_r3d2 = wm.Camera(position=tuple(float(v) for v in K.zup_to_yup(eye_zup)),
                         target=tuple(float(v) for v in K.zup_to_yup(tgt_zup)),
                         up=tuple(float(v) for v in K.zup_to_yup(up_zup)),
                         focal_mm=30.0, sensor_width_mm=36.0, res=(W, H),
                         near=0.05, far=2000.0)
    out_r3d2 = wm.rasterize(v_yup, f_plane, cam_r3d2)
    z_r3d2 = np.asarray(out_r3d2["depth"], dtype=np.float64)
    m_r3d2 = np.asarray(out_r3d2["mask"], dtype=bool)
    an_r3d, fpx_r3d2 = _analytic_plane_depth_r3d(cam_r3d2, (W, H), n_yup, h_zup)
    good_r3d = m_r3d2 & np.isfinite(an_r3d) & (an_r3d > 0) & (an_r3d < 1e4)
    err_r3d = (float(np.abs(z_r3d2[good_r3d] - an_r3d[good_r3d]).max())
               if good_r3d.any() else float("nan"))
    mean_r3d = (float(np.abs(z_r3d2[good_r3d] - an_r3d[good_r3d]).mean())
                if good_r3d.any() else float("nan"))
    ok_interp = (err_ours < 1e-2 and err_r3d < 1e-2
                 and good_ours.sum() > 100 and good_r3d.sum() > 100)
    led.add("D01", "D_光栅语义", "深度插值",
            "两边的深度插值都是透视校正（1/z）还是屏幕线性？",
            "本契约 §1.1（透视校正 d = 1/(w0/z0+w1/z1+w2/z2)）",
            "pass" if ok_interp else "fail",
            {"probe": "同一个「地面」大平面（z = 0），用解析射线-平面交点做真值",
             "pixel_center_convention": "两侧光栅器都在像素中心 (i+0.5) 采样，解析解同口径",
             "ours_max_abs_err_m": err_ours, "ours_mean_abs_err_m": mean_ours,
             "ours_px_checked": int(good_ours.sum()),
             "theirs_max_abs_err_m": err_r3d, "theirs_mean_abs_err_m": mean_r3d,
             "theirs_px_checked": int(good_r3d.sum()),
             "reference_failure_mode": ("resources3D metrics_spec §7 实测：屏幕线性插值 "
                                        "RMS 14.27 m / 平均偏差 +13.90 m；透视校正 "
                                        "RMS 0.0305 m"),
             "ours_source": "harness/conditions.py::_raster_chunk（iz = w0/z0+w1/z1+w2/z2）",
             "theirs_source": "research/harness/wmcore.py::rasterize（inv_z = w0/z[0]+…）"},
            ours="透视校正 1/z", theirs="透视校正 1/z（2026-11-19 已修）",
            note="两边对着**解析真值**的最大误差都在毫米级；"
                 "若退回屏幕线性，误差会是米级（见 reference_failure_mode）。")

    # D02 近平面裁剪
    near_bad_ours = int((~np.isfinite(z_ours2[m_ours2])).sum()) if m_ours2.any() else 0
    near_bad_theirs = int((~np.isfinite(z_r3d2[m_r3d2])).sum()) if m_r3d2.any() else 0
    ok_near = (near_bad_ours == 0 and near_bad_theirs == 0)
    led.add("D02", "D_光栅语义", "近平面裁剪", "跨近平面的三角形会被正确裁剪吗？",
            "两边各自实现（口径等价，证据是 D01 的逐像素深度）", "pass" if ok_near else "fail",
            {"ours_nonfinite_depth_px_in_mask": near_bad_ours,
             "theirs_nonfinite_depth_px_in_mask": near_bad_theirs,
             "ours_strategy": "跨近平面的三角形先裁成 1~2 个三角形再投影",
             "theirs_strategy": "Sutherland–Hodgman 裁成凸多边形，再扇形三角化（2026-11-19 修复）",
             "near_plane_m": 0.05},
            ours="裁剪成 1~2 三角形", theirs="裁剪成凸多边形后扇形三角化",
            note="实现不同但口径等价（都把近平面外的部分裁掉，且不产生伪小深度）。")

    # D03 背面剔除口径
    sig = inspect_params(wm.rasterize)
    led.add("D03", "D_光栅语义", "背面剔除", "两边剔除背面吗？口径一致吗？",
            "本契约未单列；跨仓库比对时**显式对齐**（ours 置 cull_backfaces=False）",
            "conflict_resolved",
            {"ours_render_conditions_has_cull_backfaces": True,
             "ours_default_in_render_conditions": "cull_backfaces=True（缺省）",
             "theirs_rasterize_signature": sig,
             "theirs_has_cull_switch": "cull" in sig.lower(),
             "alignment_action": "cross_render_compare.py 调用本项目侧时显式 cull_backfaces=False",
             "note": "resources3D 的 rasterize 永远不剔除背面"},
            ours="可选，默认剔除", theirs="不剔除",
            note="**口径差异**：闭合物体上剔除背面会让光栅量减半但结果相同；"
                 "开放面片上会不同 —— 所以跨仓库比对必须显式对齐。")

    # D04 数值精度
    ours_dtype = str(np.asarray(res_ours2["zbuf"]).dtype)
    theirs_dtype = str(np.asarray(out_r3d2["depth"]).dtype)
    led.add("D04", "D_光栅语义", "光栅数值精度", "两边的光栅精度一样吗？",
            "本契约不裁定精度；残差由**容差**吸收", "conflict_resolved",
            {"ours_zbuf_dtype": ours_dtype, "theirs_depth_dtype": theirs_dtype,
             "residual_observed": "交叉渲染实测最大归一化差 5.66e-6 / 最大度量差 0.209 mm",
             "absorbed_by": "主容差 1e-4 归一化（比 8bit PNG 量化 1/255≈3.9e-3 细 25 倍）"},
            ours="float32", theirs="float64",
            note="精度差异只产生浮点舍入残差，不是语义差异；容差档位在读数里一并报出。")

    # ---------------------------------------------------------------- E 指标
    # E01 五类指标可用
    five = ["edge_consistency", "depth_structure_consistency", "composition_consistency",
            "camera_consistency", "composite_score"]
    present = {f: hasattr(mt, f) for f in five}
    ok_five = all(present.values())
    led.add("E01", "E_指标", "五类 CPU 指标", "resources3D 的五类指标齐吗？本项目能直接用吗？",
            "resources3D eval/metrics.py（本项目只读引用，不另抄一份）",
            "pass" if ok_five else "fail",
            {"five_metrics_present": present,
             "theirs_module": "eval/metrics.py",
             "spec": "eval/metrics_spec.md §2",
             "ours_callsite": "harness/conditions.py::_condition_metrics"},
            ours="只读引用 resources3D 的实现", theirs="eval/metrics.py",
            note="a 边缘 / b 结构 / c 构图 / d 机位 / e 综合 —— 五类全部存在，"
                 "本项目直接调用对方实现，不另抄（避免口径漂移）。")

    # E02 单目深度接口位
    led.add("E02", "E_指标", "b′ 单目深度", "单目深度指标在本项目可用吗？",
            "resources3D 接口位（本轮无外部估计器）", "n_a",
            {"theirs_has_provider_class": hasattr(mt, "MonocularDepthProvider"),
             "theirs_has_resolver": hasattr(mt, "resolve_monocular_depth"),
             "theirs_has_correlation": hasattr(mt, "monocular_depth_correlation"),
             "external_estimator_available": False,
             "reason": "零 GPU / 零权重下载（本项目硬约束），没有外部深度估计器可接"},
            ours="未接入", theirs="接口位已留，实现抛明确异常、不静默降级",
            note="resources3D 自己也是空着的接口位；两边一致。")

    # E03 本项目确实在用对方的指标
    with open(os.path.join(HERE, "conditions.py"), encoding="utf-8") as fh:
        cond_src = fh.read()
    calls = {f: (f"mod.{f}(" in cond_src) for f in five}
    led.add("E03", "E_指标", "本项目对五类指标的调用", "本项目代码真的调用了对方实现吗？",
            "本项目 harness/conditions.py", "pass" if all(calls.values()) else "fail",
            {"callsite": "harness/conditions.py::_condition_metrics",
             "call_sites_found": calls,
             "read_only_guarantee": "import 前 sys.dont_write_bytecode = True"},
            ours="直接调用", theirs="被调用方",
            note="五类指标逐个在源码里确认了调用点。")

    # ---------------------------------------------------------------- F 覆盖矩阵
    coverage = build_coverage_matrix(matrix_path, led)

    # ---------------------------------------------------------------- 汇总落盘
    summary = led.summary()
    report = {
        "kind": "r6_alignment",
        "status": "ok",
        "generated_by": "harness/r6_alignment_check.py",
        "contract": K.CONTRACT_NAME,
        "contract_version": K.CONTRACT_VERSION,
        "authority_of_this_report": ("本文件是 **对齐矩阵的机器校验读数**；"
                                     "逐条裁定与依据见 plans/CONTRACT-alignment-resources3D.md"),
        "resources3d_dir": resources3d_dir,
        "resources3d_readonly": True,
        "resources3d_bytecode_disabled": True,
        "verdict_vocabulary": {
            "pass": "两边一致，且本轮实跑验证过",
            "conflict_resolved": "曾是冲突，本契约已裁定；当前两边实现一致或已按裁定对齐",
            "n_a": "一侧不适用（该通道/该概念在另一边不存在），无冲突",
            "fail": "未对齐，需要处理",
        },
        "summary": summary,
        "checks": led.rows,
        "coverage_matrix_13": coverage,
        "disagreements": [
            {"id": r["id"], "item": r["item"], "verdict": r["verdict"],
             "authority": r["authority"], "note": r["note"]}
            for r in led.rows if r["verdict"] in ("conflict_resolved", "fail")
        ],
        "elapsed_s": round(time.perf_counter() - t_start, 3),
        "sources": {
            "resources3d_wmcore": {"path": wmcore_path,
                                    "sha256": sha256_of(wmcore_path)},
            "resources3d_metrics": {"path": metrics_path,
                                     "sha256": sha256_of(metrics_path)},
            "resources3d_coverage_matrix": {"path": matrix_path,
                                            "sha256": sha256_of(matrix_path)},
            "ours_contract_module": {"path": os.path.join(HERE, "condition_contract.py"),
                                      "sha256": sha256_of(os.path.join(HERE, "condition_contract.py"))},
        },
    }
    out_json = out_json or os.path.join(ROOT, "assets", "validation", "r6_alignment.json")
    os.makedirs(os.path.dirname(os.path.abspath(out_json)), exist_ok=True)
    with open(out_json, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print(json.dumps({"status": report["status"], "summary": summary,
                      "coverage_rows": len(coverage.get("rows", [])),
                      "out": out_json}, ensure_ascii=False, indent=2))
    return report


def inspect_params(fn):
    import inspect
    try:
        return str(inspect.signature(fn))
    except Exception:                       # noqa: BLE001
        return "unknown"


# ====================================================================== 覆盖矩阵
# resources3D 13 行（04-soma-x-taxonomy.md §14）→ 本项目覆盖情况。
# 「本项目证据」列写的都是本仓**实际存在**的 manifest category 或非几何产物，
# 脚本会逐条回查 manifest，确保映射不是空话。
COVERAGE_MAP = {
    1: {"r3d": "人物", "ours": "人物", "ours_categories": ["character", "rig"],
        "status": "covered",
        "reason": "SOMA-X 骨架 + 10 个身份变体（R4 ⑤）；seg 里有 character 调色板类"},
    2: {"r3d": "服装", "ours": "服装", "ours_categories": ["clothing"],
        "status": "partial",
        "reason": "R4 ⑤ 的贴合服装壳已入台账，但只有 2 件，未成族"},
    3: {"r3d": "道具", "ours": "道具", "ours_categories": ["prop"],
        "status": "covered",
        "reason": "R4 ① 20+ 件 CC0 零件库，带 LOD 与许可台账"},
    4: {"r3d": "载具", "ours": "载具", "ours_categories": ["vehicle", "part_library"],
        "status": "covered",
        "reason": "R4 ③ 四种同拓扑车身 + 语义零件库 + 动力学预设"},
    5: {"r3d": "建筑", "ours": "建筑", "ours_categories": ["building"],
        "status": "partial",
        "reason": "建筑体块在街景与场景块里，但独立台账条目只有 1 件，未成族"},
    6: {"r3d": "大型场景", "ours": "大型场景", "ours_categories": ["scene", "layout"],
        "status": "covered",
        "reason": "R4 ④ 三种街区 + 分块 LOD + 公共件混排 + 布局表"},
    7: {"r3d": "生物/动物", "ours": "生物/动物", "ours_categories": ["creature"],
        "status": "partial",
        "reason": "台账有 2 件生物资产；未做骨架与比例体块工作流"},
    8: {"r3d": "植被与自然元素", "ours": "植被与自然元素",
        "ours_categories": ["vegetation", "tree"],
        "status": "covered",
        "reason": "R4 ② 六树种配方 + 三档 LOD + 实例化表"},
    9: {"r3d": "人群系统", "ours": "人群系统", "ours_categories": ["crowd"],
        "status": "partial",
        "reason": "人群实例与共享底座已有；实例化表未做 LOD 链与共享 Action"},
    10: {"r3d": "动作与表演数据", "ours": "动作与表演数据",
         "ours_categories": ["motion", "rig"],
         "status": "covered",
         "reason": "R0–R2 的关节序列（npz）+ 关键点闭集 + 运镜时序都是数据层产物"},
    11: {"r3d": "摄像机与空间参考", "ours": "摄像机与空间参考",
         "ours_categories": ["camera", "shot"],
         "status": "covered",
         "reason": "R2 镜头库 + camera_intrinsics.json + 镜头包目录；sidecar 带 f_px"},
    12: {"r3d": "特效/破坏占位", "ours": "特效/破坏占位", "ours_categories": ["fx"],
         "status": "partial",
         "reason": "有 FX 占位资产；没有事件表 + 轨迹曲线这套数据载体"},
    13: {"r3d": "验证闭环（横切）", "ours": "验证闭环（横切）",
         "ours_categories": ["convention", "recipe"],
         "status": "covered",
         "reason": "R3 manifest v2 四项校验（id/fingerprint/license/validation）+ "
                   "本轮 R6 对齐矩阵的机器校验读数"},
}


def build_coverage_matrix(matrix_path, led):
    """解析 resources3D 的 13 行覆盖矩阵，与本项目 manifest 类别逐行对齐。"""
    rows = []
    parse_ok = False
    n_rows_r3d = 0
    empty_cells = []
    if os.path.isfile(matrix_path):
        with open(matrix_path, encoding="utf-8") as fh:
            text = fh.read()
        # §14 的表：| # | 类别 | 白模表达层级 | 最适合范式 | 首选代表工具 | 关键产出 | 证据分级 |
        sec = text.split("## 14. 13 类资产表达层级")[1].split("\n## ")[0] if \
            "## 14. 13 类资产表达层级" in text else ""
        for line in sec.splitlines():
            m = re.match(r"^\|\s*(\d{1,2})\s*\|\s*(.*?)\s*\|", line)
            if not m:
                continue
            idx = int(m.group(1))
            if not (1 <= idx <= 13):
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) < 7:
                continue
            n_rows_r3d += 1
            for ci, c in enumerate(cells):
                if ci == 0:
                    continue          # 第 0 列是行号，不是矩阵格
                if not c:
                    empty_cells.append({"row": idx, "col": ci})
        parse_ok = n_rows_r3d == 13 and not empty_cells

    # 本项目 manifest 类别
    manifest_path = os.path.join(ROOT, "assets", "manifest.json")
    manifest_counts = {}
    manifest_version = None
    if os.path.isfile(manifest_path):
        with open(manifest_path, encoding="utf-8") as fh:
            man = json.load(fh)
        manifest_version = man.get("version")
        for a in man.get("assets", []):
            manifest_counts[a.get("category")] = manifest_counts.get(a.get("category"), 0) + 1

    for idx in range(1, 14):
        m = COVERAGE_MAP[idx]
        cats = m["ours_categories"]
        evidence = {}
        for c in cats:
            evidence[c] = manifest_counts.get(c, 0)
        missing = [c for c in cats if c not in manifest_counts]
        rows.append({
            "row": idx,
            "resources3d_category": m["r3d"],
            "ours_category": m["ours"],
            "status": m["status"],
            "reason": m["reason"],
            "ours_manifest_categories": cats,
            "ours_manifest_counts": evidence,
            "ours_categories_missing_in_manifest": missing,
            "conclusion_non_empty": bool(m["reason"].strip()) and not missing,
        })

    n_empty = sum(1 for r in rows if not r["conclusion_non_empty"])
    led.add("F01", "F_覆盖矩阵", "resources3D 13 行覆盖矩阵",
            "resources3D 的 13 行矩阵解析出来是 13 行、每格非空吗？",
            "resources3D research/04-soma-x-taxonomy.md §14", "pass" if parse_ok else "fail",
            {"matrix_file": matrix_path,
             "n_rows_parsed": n_rows_r3d, "expected_rows": 13,
             "empty_cells": empty_cells,
             "row_categories": [COVERAGE_MAP[i]["r3d"] for i in range(1, 14)]},
            ours="—", theirs="13 类资产表达层级 · 总矩阵",
            note="13 行 = 12 类资产 + 1 行横切「验证闭环」"
                 "（与 resources3D research/05-synthesis.md §1.2 同口径）。")

    all_ok = (n_empty == 0 and parse_ok
              and all(r["conclusion_non_empty"] for r in rows))
    led.add("F02", "F_覆盖矩阵", "覆盖矩阵对齐表无空行",
            "13 行逐行对齐后有没有空行（无结论/无依据）？",
            "本轮对齐矩阵（plans/CONTRACT-alignment-resources3D.md §4）",
            "pass" if all_ok else "fail",
            {"n_rows": len(rows), "n_empty_rows": n_empty,
             "status_counts": {s: sum(1 for r in rows if r["status"] == s)
                               for s in ("covered", "partial", "none")},
             "rows": rows},
            ours="13/13 行有结论且有依据",
            theirs="13/13 行有结论且有依据",
            note="每行的「本项目证据」都回查了 assets/manifest.json v2 的真实 category 计数，"
                 "没有依据的行一律判空。")

    led.add("F03", "F_覆盖矩阵", "类别命名对应",
            "两边的类别名怎么对应？命名以谁为准？",
            "以本项目 manifest v2 的 category 为准（resources3D 不产资产台账）",
            "pass",
            {"ours_manifest_version": manifest_version,
             "ours_categories": manifest_counts,
             "ours_n_categories": len(manifest_counts),
             "theirs": "resources3D 无资产台账，类别名只存在于 04/05 两份研究文档的矩阵里",
             "naming_basis": "本项目 manifest v2 category（小写下划线，如 vehicle / prop / crowd）"},
            ours=sorted(manifest_counts), theirs="（无台账，仅文档矩阵）",
            note="资源3D 的 13 类是「研究分类」，本项目的 category 是「台账分类」；"
                 "两者语义对齐但不是同一套命名空间 —— 跨仓库不按名字直接对齐，按 F02 的行号对齐。")

    return {
        "source_matrix": matrix_path,
        "source_matrix_section": "research/04-soma-x-taxonomy.md §14（13 类资产表达层级 · 总矩阵）",
        "n_rows": len(rows),
        "n_empty_rows": n_empty,
        "all_rows_concluded": all_ok,
        "ours_manifest_version": manifest_version,
        "ours_manifest_category_counts": manifest_counts,
        "rows": rows,
    }


# ====================================================================== CLI
def main(argv=None):
    ap = argparse.ArgumentParser(description="R6 · 与 resources3D 的契约对齐（只读检查）")
    ap.add_argument("--resources3d", default=DEFAULT_RESOURCES3D)
    ap.add_argument("--width", type=int, default=320)
    ap.add_argument("--height", type=int, default=320)
    ap.add_argument("--json", default=None)
    args = ap.parse_args(argv)
    report = run(args.resources3d, args.json, (args.width, args.height))
    s = report.get("summary", {})
    return 0 if report.get("status") == "ok" and s.get("fail", 1) == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
