"""R2 · 运镜体系化 —— 9 类镜头生成器 + 构图/运动校验量 + 镜头库目录。

这是 ROADMAP-IMAGE-VIDEO.md §4「R2 · 运镜体系化（镜头类型库 + 镜头包）」的代码侧落点：
把「一次推镜」变成「9 类镜头 × 可校验 × 可批量」。

交付范围
========
* 9 类镜头参数化：推 / 拉 / 摇 / 俯仰 / 移 / 跟 / 环绕 / 升降 / 手持
  （dolly_in / dolly_out / pan / tilt / truck / follow / orbit / pedestal / handheld）。
* 统一参数化表达（ROADMAP §2.4.1）：
  move = {type, frame, duration_s, fps, easing,
          start:{eye,target,focal_mm}, end:{eye,target,focal_mm},
          params:{...}, mount?:{...}, handheld?:{...}}
* 构图/运动校验量（ROADMAP §2.4.4 的通用 8 条 + 每类专有量），全部可自动判定。
* move_catalog()：9 类样例的机器可读目录（参数 + 阈值）。

口径（全部继承 R0 契约，不另立一套）
======================================
* 上轴 **Z-up**（世界 +Z 朝上），右手系，米制。
* 投影按 CONTRACT-conditions.md §1.1：
      fwd = normalize(target - eye); right = normalize(cross(fwd, up)); upv = cross(right, fwd)
      相机空间 x = d·right, y = d·upv, z = d·fwd（z 向前为正）
      px = W/2 + (x/z)·f_px ; py = H/2 - (y/z)·f_px
* f_px 是权威内参：f_px = H / (2·tan(fov_y/2))，fov_y = 2·atan(sensor_mm/2 / focal_mm)。
* Y-up ↔ Z-up 只用契约里的那一处：condition_contract.Z_UP_TO_Y_UP（p_yup = (x, z, −y)）。
* USD 相机（−Z 朝前、+Y 向上）的欧拉约定与既有 harness/export_usd.py 的
  `_look_at_rot` 一致：rotateXYZ = Rz(rz)·Ry(ry)·Rx(rx)，由 R_usd 列向量 [right, upv, −fwd] 反解。
* 手持噪声是**受限频带**的正弦叠加（不是白噪声），主频必须落在 0.5–3 Hz。

硬约束
======
禁 3D 生成式模型 / 全 CPU / 不下载模型权重 / 不引入 Blender 运行时 /
不做下游图视频模型 A/B 验证。本模块只做几何与数值，不渲染、不训练、不推理。

作者备注
========
本模块**不使用** SOMA 关节索引（pose_store.ANK_L=70 / render_shot.ANK_L=70 在 77 关节
公共表里实际指向趾根，名字表比数组差一位）。主体几何一律走英雄网格包围盒；
pose 通道由 R1 的 `_JointSource.from_soma77` 按关节**名**解析，不由本模块经手。
"""
from __future__ import annotations

import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import condition_contract as K  # noqa: E402  —— 唯一的上轴换算处

# ---------------------------------------------------------------- 全局常量
MOVE_TYPES = ("dolly_in", "dolly_out", "pan", "tilt", "truck",
              "follow", "orbit", "pedestal", "handheld")

MOVE_LABELS_ZH = {
    "dolly_in": "推镜",
    "dolly_out": "拉镜",
    "pan": "摇镜",
    "tilt": "俯仰镜",
    "truck": "移镜",
    "follow": "跟镜",
    "orbit": "环绕镜",
    "pedestal": "升降镜",
    "handheld": "手持镜",
}

EASINGS = ("linear", "smoothstep", "smoothstep_in", "smoothstep_out")

SENSOR_WIDTH_MM = 36.0          # 与 camera_path.json / render_shot 同口径
WORLD_UP = (0.0, 0.0, 1.0)      # Z-up（契约 §1）

# 手持噪声：三个正弦分量，频率刻意取在 24fps×5s 窗口的 FFT 整频点
# （120 帧 × 24fps → 频率栅格 0.2 Hz；0.8/1.6/2.4 Hz 正好落在 bin 4/8/12）。
HANDHELD_FREQS_HZ = (0.8, 1.6, 2.4)
HANDHELD_AMPS_M = (0.010, 0.016, 0.008)

# 通用阈值（每类可在 limits 里覆盖）
DEFAULT_LIMITS = {
    "subject_in_frame_ratio": 0.95,
    "subject_corner_inside_mean": 0.70,
    "centering_offset_max": 0.35,
    "offscreen_ratio_mean": 0.15,
    "frustum_subject_ratio_mean": 0.90,
    "subject_height_ratio_band": (0.10, 0.85),
    "speed_curve_peak_accel_mps2": 0.50,
    "focal_rate_mm_per_s": 30.0,
    "pan_yaw_rate": 30.0,
    "pan_no_wrap": 20.0,
    "tilt_pitch_rate": 30.0,
    "tilt_no_wrap": 20.0,
    "truck_speed_cv": 0.05,
    "truck_vertical_drift": 1e-6,
    "truck_lateral_drift_m": 0.30,
    "follow_distance_band": 0.05,
    "follow_offset_band": 0.02,
    "orbit_radius_band": 0.02,
    "orbit_angular_cv": 1.0,
    "orbit_height_band": 0.03,
    "pedestal_end_speed": 0.25,
    "pedestal_min_height_ratio": 0.12,
    "handheld_amplitude_m": 0.045,
    "handheld_rms_m": 0.030,
    "handheld_band": (0.5, 3.0),
}


# ---------------------------------------------------------------- 缓动
def ease(u: float, kind: str) -> float:
    """缓动曲线。

    ROADMAP §2.4.1 的实现规则：恒速推轨用 linear，缓动只用于「有起停」的镜头，
    且缓动作用在**位移量**上（不是每帧增量角度上）。
    """
    u = float(min(max(u, 0.0), 1.0))
    if kind == "linear":
        return u
    if kind == "smoothstep":
        return u * u * (3.0 - 2.0 * u)
    if kind == "smoothstep_in":
        return u * u
    if kind == "smoothstep_out":
        return 1.0 - (1.0 - u) ** 2
    raise ValueError(f"未知缓动 {kind!r}，可选 {EASINGS}")


# ---------------------------------------------------------------- 相机数学
def normalize(v):
    v = np.asarray(v, float)
    n = float(np.linalg.norm(v))
    if n < 1e-12:
        raise ValueError("不能归一化零向量")
    return v / n


def camera_basis(eye, target, up=WORLD_UP):
    """契约 §1.1 的基向量：返回 (eye, fwd, right, upv)。"""
    eye = np.asarray(eye, float)
    fwd = normalize(np.asarray(target, float) - eye)
    right = normalize(np.cross(fwd, np.asarray(up, float)))
    upv = np.cross(right, fwd)
    return eye, fwd, right, upv


def f_px_from_focal(focal_mm: float, height: int,
                    sensor_mm: float = SENSOR_WIDTH_MM) -> float:
    """由焦距毫米数推出焦距像素值（契约口径：方形像素、垂直 FOV 驱动）。

    f_px = H / (2 tan(fov_y/2))，fov_y = 2 atan(sensor/2 / focal)  ⇒  f_px = H·focal/sensor
    """
    return float(height) * float(focal_mm) / float(sensor_mm)


def fov_y_from_f_px(f_px: float, height: int) -> float:
    return math.degrees(2.0 * math.atan(float(height) / (2.0 * float(f_px))))


def project_points(points, eye, target, f_px, width, height, up=WORLD_UP):
    """世界点 → 像素 + 相机空间深度（契约 §1.1 公式，逐项对齐 geomlib.Camera.project）。

    返回 (px[N,2], depth[N])。depth 是**沿光轴**的米数（z 向前为正）。
    """
    pts = np.atleast_2d(np.asarray(points, float))
    eye, fwd, right, upv = camera_basis(eye, target, up)
    d = pts - eye
    x = d @ right
    y = d @ upv
    z = d @ fwd
    zsafe = np.where(np.abs(z) < 1e-6, 1e-6, z)
    px = width / 2.0 + (x / zsafe) * float(f_px)
    py = height / 2.0 - (y / zsafe) * float(f_px)
    return np.stack([px, py], axis=-1), z


def look_at_rot_xyz(eye, target):
    """USD 相机（看 −Z、+Y 向上）的 rotateXYZ 欧拉角（度）。

    矩阵约定与既有 harness/export_usd.py::_look_at_rot 完全一致：
        R_usd 的列向量 = [right, upv, −fwd]（世界→相机）
        rotateXYZ 复合为 Rz(rz)·Ry(ry)·Rx(rx)
    """
    eye = np.asarray(eye, float)
    f = normalize(np.asarray(target, float) - eye)
    z = -f
    x = normalize(np.cross(WORLD_UP, z))
    y = np.cross(z, x)
    m = np.stack([x, y, z], axis=1)           # 列 = 相机轴在世界系里的方向
    sy = -m[2, 0]
    ry = math.asin(max(-1.0, min(1.0, sy)))
    rx = math.atan2(m[2, 1], m[2, 2])
    rz = math.atan2(m[1, 0], m[0, 0])
    return (math.degrees(rx), math.degrees(ry), math.degrees(rz))


def usd_camera_pose(eye, target):
    """USD 相机位姿：translate（世界坐标，米）+ rotateXYZ（度）。"""
    e = np.asarray(eye, float)
    rx, ry, rz = look_at_rot_xyz(eye, target)
    return {"translate": [float(e[0]), float(e[1]), float(e[2])],
            "rotate_xyz_deg": [rx, ry, rz]}


def gltf_node_transform(eye, target):
    """glTF 节点变换（Y-up 世界系，四元数 xyzw）。

    换算只走契约里的那一处：p_yup = (x, z, −y)（K.Z_UP_TO_Y_UP）。
    相机局部轴仍是 glTF 规范：+X 右、+Y 上、镜头朝 −Z。
    """
    e = np.asarray(eye, float)
    tgt = np.asarray(target, float)
    fwd = normalize(tgt - e)
    right = normalize(np.cross(fwd, WORLD_UP))
    upv = np.cross(right, fwd)
    r_c2w = np.stack([right, upv, -fwd], axis=1)      # 相机→世界（Z-up）
    m = K.Z_UP_TO_Y_UP
    r_gltf = m @ r_c2w @ m.T                          # 转到 glTF 的 Y-up 世界
    t_gltf = m @ e
    q = mat_to_quat(r_gltf)
    return {"translation": [float(t_gltf[0]), float(t_gltf[1]), float(t_gltf[2])],
            "rotation_xyzw": [float(v) for v in q]}


def mat_to_quat(m):
    """3x3 旋转矩阵 → 四元数 (x, y, z, w)（glTF 顺序）。"""
    tr = float(m[0, 0] + m[1, 1] + m[2, 2])
    if tr > 0.0:
        s = math.sqrt(tr + 1.0) * 2.0
        w = 0.25 * s
        x = (m[2, 1] - m[1, 2]) / s
        y = (m[0, 2] - m[2, 0]) / s
        z = (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2.0
        w = (m[2, 1] - m[1, 2]) / s
        x = 0.25 * s
        y = (m[0, 1] + m[1, 0]) / s
        z = (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2.0
        w = (m[0, 2] - m[2, 0]) / s
        x = (m[0, 1] + m[1, 0]) / s
        y = 0.25 * s
        z = (m[1, 2] + m[2, 1]) / s
    else:
        s = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2.0
        w = (m[1, 0] - m[0, 1]) / s
        x = (m[0, 2] + m[2, 0]) / s
        y = (m[1, 2] + m[2, 1]) / s
        z = 0.25 * s
    n = math.sqrt(x * x + y * y + z * z + w * w)
    return (x / n, y / n, z / n, w / n)


def quat_to_mat(q):
    """四元数 (x,y,z,w) → 3x3 旋转矩阵。"""
    x, y, z, w = [float(v) for v in q]
    n = math.sqrt(x * x + y * y + z * z + w * w)
    if n < 1e-12:
        return np.eye(3)
    x, y, z, w = x / n, y / n, z / n, w / n
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ], dtype=np.float64)


def yaw_pitch_to_dir(yaw_deg, pitch_deg):
    """偏航/俯仰角 → 单位方向向量（yaw 绕世界 +Z，pitch 抬升）。"""
    y = math.radians(float(yaw_deg))
    p = math.radians(float(pitch_deg))
    cp = math.cos(p)
    return np.array([cp * math.cos(y), cp * math.sin(y), math.sin(p)], dtype=np.float64)


def bearing_deg(eye, point):
    """从 eye 指向 point 的水平偏航角（度，atan2 口径）。"""
    d = np.asarray(point, float) - np.asarray(eye, float)
    return math.degrees(math.atan2(d[1], d[0]))


# ---------------------------------------------------------------- 主体轨迹
def make_subject_track(root_y, offset=(0.0, -1.6, 0.0), chest_z=0.9):
    """由 SOMA 序列的 root_y 造出主体的逐帧轨迹。

    root_y 是英雄根节点沿 +Y 的位移（SOMA 公共关节表不含 Root，位移单列在 npz 里）。
    offset 与 conditions.SHOT_HERO_OFFSET 同值，保证与 R1 的条件图同一坐标系。
    """
    root_y = np.asarray(root_y, float).reshape(-1)
    n = root_y.shape[0]
    pos = np.zeros((n, 3), dtype=np.float64)
    pos[:, 1] = float(offset[1]) + root_y
    chest = pos.copy()
    chest[:, 2] = float(chest_z)
    return {"pos": pos, "chest": chest, "n": n,
            "yaw": np.zeros(n), "offset": list(offset), "chest_z": float(chest_z)}


# ---------------------------------------------------------------- 计划构建
def build_move(spec: dict) -> dict:
    """把镜头参数化表达归一化成一份**可落盘**的镜头计划。

    spec 字段（ROADMAP §2.4.1 的统一表达）：
        type        9 类之一
        frame       "subject"（eye/target 是相对主体的偏移）或 "world"（世界坐标）
        duration_s  时长（秒）
        fps         帧率
        easing      linear / smoothstep / smoothstep_in / smoothstep_out
        start       {eye:[3], target:[3], focal_mm:float}
        end         {eye:[3], target:[3], focal_mm:float}
        params      类型专有参数
        mount       follow 专用（挂载在主体刚体上）
        handheld    handheld 专用（受限频带噪声）
    """
    if "type" not in spec:
        raise ValueError("镜头 spec 缺 type")
    mtype = spec["type"]
    if mtype not in MOVE_TYPES:
        raise ValueError(f"未知镜头类型 {mtype!r}，可选 {MOVE_TYPES}")
    fps = float(spec.get("fps", 24.0))
    duration_s = float(spec.get("duration_s", 5.0))
    easing = spec.get("easing", "linear")
    if easing not in EASINGS:
        raise ValueError(f"未知缓动 {easing!r}，可选 {EASINGS}")
    start = spec.get("start") or {}
    end = spec.get("end") or {}
    f_start = float(start.get("focal_mm", 40.0))
    plan = {
        "kind": "camera_move_plan",
        "type": mtype,
        "label_zh": MOVE_LABELS_ZH[mtype],
        "frame": spec.get("frame", "subject"),
        "duration_s": duration_s,
        "fps": fps,
        "n_frames": int(round(duration_s * fps)),
        "easing": easing,
        "up": list(WORLD_UP),
        "sensor_width_mm": float(spec.get("sensor_width_mm", SENSOR_WIDTH_MM)),
        "focal_mm": {"start": f_start,
                     "end": float(end.get("focal_mm", f_start))},
        "start": {
            "eye": [float(v) for v in start.get("eye", (0.0, 0.0, 0.0))],
            "target": [float(v) for v in start.get("target", (0.0, 0.0, 0.0))],
        },
        "end": {
            "eye": [float(v) for v in end.get("eye", start.get("eye", (0.0, 0.0, 0.0)))],
            "target": [float(v) for v in end.get("target", start.get("target", (0.0, 0.0, 0.0)))],
        },
        "params": dict(spec.get("params") or {}),
        "mount": dict(spec["mount"]) if spec.get("mount") else None,
        "handheld": dict(spec["handheld"]) if spec.get("handheld") else None,
        "source_spec": dict(spec),
    }
    if mtype == "handheld" and plan["handheld"] is None:
        plan["handheld"] = {"freqs_hz": list(HANDHELD_FREQS_HZ),
                            "amps_m": list(HANDHELD_AMPS_M),
                            "phases_rad": [0.0, 1.7, 3.4],
                            "rot_amp_deg": 0.35}
    return plan


# ---------------------------------------------------------------- 采样
def sample_move(plan: dict, subject: dict) -> list:
    """采样逐帧镜头：返回 [{"i","t","eye","target","focal_mm"}...]。

    约定：
    * frame == "subject"：eye = 主体根位置 + 偏移（推/拉/跟/环绕/手持）
    * frame == "world"   ：eye 是世界坐标（摇/俯仰/移/升降，机身固定或匀速平移）
    """
    mtype = plan["type"]
    n = int(plan["n_frames"])
    fps = float(plan["fps"])
    easing = plan["easing"]
    p = plan["params"]
    f0 = plan["focal_mm"]["start"]
    f1 = plan["focal_mm"]["end"]
    subj_pos = np.asarray(subject["pos"], float)
    subj_chest = np.asarray(subject["chest"], float)
    subj_yaw = np.asarray(subject.get("yaw", np.zeros(n)), float)

    def _u(i):
        return 0.0 if n <= 1 else i / float(n - 1)

    def _e(i):
        return ease(_u(i), easing)

    def _focal(i):
        return f0 + (f1 - f0) * _u(i)

    frames = []
    if mtype in ("dolly_in", "dolly_out"):
        axis = normalize(np.asarray(plan["start"]["eye"], float))
        d0 = float(np.linalg.norm(np.asarray(plan["start"]["eye"], float)))
        d1 = float(np.linalg.norm(np.asarray(plan["end"]["eye"], float)))
        for i in range(n):
            dist = d0 + (d1 - d0) * _e(i)
            eye = subj_pos[i] + axis * dist
            frames.append(_frame(i, fps, eye, subj_chest[i], _focal(i)))
    elif mtype == "pan":
        eye0 = np.asarray(plan["start"]["eye"], float)
        y0 = float(p["yaw_start_deg"])
        y1 = float(p["yaw_end_deg"])
        pitch = float(p.get("pitch_deg", 0.0))
        for i in range(n):
            yaw = y0 + (y1 - y0) * _u(i)          # 匀速摇：线性角速度
            tgt = eye0 + yaw_pitch_to_dir(yaw, pitch) * 10.0
            frames.append(_frame(i, fps, eye0, tgt, _focal(i)))
    elif mtype == "tilt":
        eye0 = np.asarray(plan["start"]["eye"], float)
        yaw = float(p.get("yaw_deg", 0.0))
        p0 = float(p["pitch_start_deg"])
        p1 = float(p["pitch_end_deg"])
        for i in range(n):
            pitch = p0 + (p1 - p0) * _u(i)        # 匀速俯仰：线性角速度
            tgt = eye0 + yaw_pitch_to_dir(yaw, pitch) * 10.0
            frames.append(_frame(i, fps, eye0, tgt, _focal(i)))
    elif mtype == "truck":
        eye0 = np.asarray(plan["start"]["eye"], float)
        vel = np.asarray(p["velocity_mps"], float)
        for i in range(n):
            eye = eye0 + vel * (i / fps)           # 机身匀速平移
            frames.append(_frame(i, fps, eye, subj_chest[i], _focal(i)))
    elif mtype == "follow":
        mount = plan["mount"] or {}
        eye_l = np.asarray(mount.get("eye_local", plan["start"]["eye"]), float)
        tgt_l = np.asarray(mount.get("target_local", plan["start"]["target"]), float)
        for i in range(n):
            rot = yaw_matrix(subj_yaw[i])
            eye = subj_pos[i] + rot @ eye_l
            tgt = subj_pos[i] + rot @ tgt_l
            frames.append(_frame(i, fps, eye, tgt, _focal(i)))
    elif mtype == "orbit":
        radius = float(p["radius_m"])
        height = float(p.get("height_m", 1.5))
        a0 = float(p["angle_start_deg"])
        a1 = float(p["angle_end_deg"])
        for i in range(n):
            a = math.radians(a0 + (a1 - a0) * _u(i))   # 匀角速度
            eye = subj_pos[i] + np.array([radius * math.cos(a),
                                          radius * math.sin(a), height])
            frames.append(_frame(i, fps, eye, subj_chest[i], _focal(i)))
    elif mtype == "pedestal":
        eye0 = np.asarray(plan["start"]["eye"], float)
        z0 = float(p["z_start_m"])
        z1 = float(p["z_end_m"])
        for i in range(n):
            z = z0 + (z1 - z0) * _e(i)            # 升降走缓动
            eye = np.array([eye0[0], eye0[1], z])
            frames.append(_frame(i, fps, eye, subj_chest[i], _focal(i)))
    elif mtype == "handheld":
        hh = plan["handheld"]
        axis = normalize(np.asarray(plan["start"]["eye"], float))
        d0 = float(np.linalg.norm(np.asarray(plan["start"]["eye"], float)))
        d1 = float(np.linalg.norm(np.asarray(plan["end"]["eye"], float)))
        freqs = [float(v) for v in hh.get("freqs_hz", HANDHELD_FREQS_HZ)]
        amps = [float(v) for v in hh.get("amps_m", HANDHELD_AMPS_M)]
        phases = [float(v) for v in hh.get("phases_rad", (0.0, 1.7, 3.4))]
        rot_amp = float(hh.get("rot_amp_deg", 0.0))
        for i in range(n):
            t = i / fps
            dist = d0 + (d1 - d0) * _u(i)        # 基础轨道：线性缓推
            base_eye = subj_pos[i] + axis * dist
            base_tgt = subj_chest[i]
            _, fwd, right, upv = camera_basis(base_eye, base_tgt)
            off = 0.0
            for k in range(len(freqs)):
                ph = phases[k % len(phases)]
                off += amps[k % len(amps)] * math.sin(2.0 * math.pi * freqs[k] * t + ph)
            eye = base_eye + right * off
            # 视角微抖：同一频带的小角度摆动
            d = normalize(base_tgt - base_eye)
            yaw = math.degrees(math.atan2(d[1], d[0])) + rot_amp * math.sin(
                2.0 * math.pi * freqs[0] * t + phases[0] + 1.1)
            pitch = math.degrees(math.asin(max(-1.0, min(1.0, d[2])))) + rot_amp * math.sin(
                2.0 * math.pi * freqs[1] * t + phases[1] + 2.3)
            tgt = eye + yaw_pitch_to_dir(yaw, pitch) * 10.0
            frames.append(_frame(i, fps, eye, tgt, _focal(i)))
    else:  # pragma: no cover - build_move 已挡住
        raise ValueError(f"未实现的镜头类型 {mtype!r}")
    return frames


def yaw_matrix(deg):
    a = math.radians(float(deg))
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]], dtype=np.float64)


def _frame(i, fps, eye, target, focal_mm):
    return {
        "i": int(i),
        "t": round(float(i) / float(fps), 6),
        "eye": [float(v) for v in np.asarray(eye, float)],
        "target": [float(v) for v in np.asarray(target, float)],
        "focal_mm": float(focal_mm),
    }


# ---------------------------------------------------------------- 校验量
def evaluate_move(plan, frames, subject, width, height, limits=None):
    """算一个镜头的构图/运动校验量。

    subject : {"pos":(N,3), "chest":(N,3), "bbox":(N,2,3)}
    limits  : 阈值覆盖（见 DEFAULT_LIMITS）。

    返回 {"checks":[...], "metrics":{...}}；每条 check = {id, name_zh, value, limit, pass, detail}。
    """
    lim = dict(DEFAULT_LIMITS)
    if limits:
        lim.update(limits)
    n = len(frames)
    eye = np.array([f["eye"] for f in frames], float)
    tgt = np.array([f["target"] for f in frames], float)
    focal = np.array([f["focal_mm"] for f in frames], float)
    sensor = float(plan["sensor_width_mm"])
    bbox = np.asarray(subject["bbox"], float)
    subj_pos = np.asarray(subject["pos"], float)
    chest = np.asarray(subject["chest"], float)

    f_px = np.array([f_px_from_focal(focal[i], height, sensor) for i in range(n)])

    inside_ratio = np.zeros(n)
    center_off = np.zeros(n)
    offscreen = np.zeros(n)
    hratio = np.zeros(n)
    frustum_ratio = np.zeros(n)
    dist = np.zeros(n)
    screen_x = np.zeros(n)
    for i in range(n):
        corners = bbox_corners(bbox[i])
        px, z = project_points(corners, eye[i], tgt[i], f_px[i], width, height)
        ok = (px[:, 0] >= 0) & (px[:, 0] <= width) & (px[:, 1] >= 0) & (px[:, 1] <= height) & (z > 0)
        inside_ratio[i] = ok.mean()
        cx = (px[:, 0].min() + px[:, 0].max()) / 2.0
        cy = (px[:, 1].min() + px[:, 1].max()) / 2.0
        center_off[i] = max(abs(cx - width / 2.0) / (width / 2.0),
                            abs(cy - height / 2.0) / (height / 2.0))
        bw = max(px[:, 0].max() - px[:, 0].min(), 1e-6)
        bh = max(px[:, 1].max() - px[:, 1].min(), 1e-6)
        ox = max(0.0, -px[:, 0].min()) + max(0.0, px[:, 0].max() - width)
        oy = max(0.0, -px[:, 1].min()) + max(0.0, px[:, 1].max() - height)
        offscreen[i] = min(1.0, (ox * bh + oy * bw) / (bw * bh))
        hratio[i] = bh / float(height)
        frustum_ratio[i] = ok.mean()
        dist[i] = float(np.linalg.norm(eye[i] - chest[i]))
        screen_x[i] = cx

    # 速度曲线按**镜头自身相对主体的运动**算（主体步态是素材属性，不是运镜属性）：
    # frame=subject 的镜头剥掉主体位移，frame=world 的镜头直接看世界轨迹。
    ref = subj_pos if plan.get("frame") == "subject" else np.zeros_like(eye)
    rel_eye = eye - ref
    vel = np.diff(rel_eye, axis=0) * plan["fps"]
    dv = np.diff(vel, axis=0) * plan["fps"] if n > 2 else np.zeros((1, 3))
    speed = np.linalg.norm(vel, axis=1) if n > 1 else np.zeros(1)
    dfocal = np.abs(np.diff(focal)) * plan["fps"] if n > 1 else np.zeros(1)

    metrics = {
        "subject_in_frame_ratio": float(np.mean(inside_ratio > 0.0)),
        "subject_corner_inside_mean": float(inside_ratio.mean()),
        "centering_offset_max": float(center_off.max()),
        "centering_offset_mean": float(center_off.mean()),
        "offscreen_ratio_mean": float(offscreen.mean()),
        "frustum_subject_ratio_mean": float(frustum_ratio.mean()),
        "subject_height_ratio_mean": float(hratio.mean()),
        "subject_height_ratio_min": float(hratio.min()),
        "subject_height_ratio_max": float(hratio.max()),
        "speed_mean_mps": float(speed.mean()),
        "speed_mean_world_mps": float(np.linalg.norm(
            np.diff(eye, axis=0) * plan["fps"], axis=1).mean()) if n > 1 else 0.0,
        "speed_peak_accel_mps2": float(np.linalg.norm(dv, axis=1).max()) if len(dv) else 0.0,
        "focal_rate_mm_per_s": float(dfocal.max()) if len(dfocal) else 0.0,
        "distance_to_subject_start_m": float(dist[0]),
        "distance_to_subject_end_m": float(dist[-1]),
        "distance_to_subject_mean_m": float(dist.mean()),
        "distance_to_subject_span_m": float(dist.max() - dist.min()),
    }

    checks = []

    def _add(cid, name, value, op, limit, detail=""):
        ok = (value >= limit) if op == ">=" else (value <= limit) if op == "<=" else True
        checks.append({"id": cid, "name_zh": name, "value": round(float(value), 6),
                       "limit": limit, "op": op, "pass": bool(ok), "detail": detail})

    def _add_in(cid, name, value, lo, hi, detail=""):
        checks.append({"id": cid, "name_zh": name, "value": round(float(value), 6),
                       "limit": [lo, hi], "op": "in", "pass": bool(lo <= value <= hi),
                       "detail": detail})

    def _add_trend(cid, name, series, want_up, min_trend, detail="",
                   max_violation_frac=0.05, tol=0.003):
        """单调趋势判定。

        严格逐帧单调对**主体步态**这类素材抖动不成立（英雄根节点每帧有步态起伏），
        所以判定口径是「整体趋势显著 + 非单调帧占比 ≤ 5%」，而不是数学上的严格单调。
        """
        tr = monotonic_trend(series, want_up=want_up, tol=tol)
        ok = bool((tr["trend"] >= min_trend if want_up else tr["trend"] <= -min_trend)
                  and tr["violation_frac"] <= max_violation_frac)
        checks.append({"id": cid, "name_zh": name,
                       "value": round(float(tr["trend"]), 6),
                       "limit": {"min_trend": min_trend,
                                 "max_violation_frac": max_violation_frac},
                       "op": "trend", "pass": ok,
                       "detail": (detail + " | " if detail else "") +
                                 "trend=%.4f 非单调帧占比=%.3f" % (tr["trend"], tr["violation_frac"])})

    # ---- 通用项（ROADMAP §2.4.4 验证清单）
    _add("subject_in_frame_ratio", "主体在画幅内的帧占比",
         metrics["subject_in_frame_ratio"], ">=", lim["subject_in_frame_ratio"])
    _add("subject_corner_inside_mean", "主体包围盒角点在画幅内比例（均值）",
         metrics["subject_corner_inside_mean"], ">=", lim["subject_corner_inside_mean"])
    _add("centering_offset", "构图居中偏移（归一化最大）",
         metrics["centering_offset_max"], "<=", lim["centering_offset_max"])
    _add("offscreen_ratio", "离屏比例（均值）",
         metrics["offscreen_ratio_mean"], "<=", lim["offscreen_ratio_mean"])
    _add("frustum_subject_ratio", "视锥内主体比例",
         metrics["frustum_subject_ratio_mean"], ">=", lim["frustum_subject_ratio_mean"])
    _add_in("subject_height_ratio_band", "主体高度占比（均值）",
             metrics["subject_height_ratio_mean"],
             lim["subject_height_ratio_band"][0], lim["subject_height_ratio_band"][1])
    _add("speed_curve_peak_accel", "速度曲线连续性（峰值加速度上限 m/s^2）",
         metrics["speed_peak_accel_mps2"], "<=", lim["speed_curve_peak_accel_mps2"])
    _add("focal_rate", "焦距变化率（mm/s）",
         metrics["focal_rate_mm_per_s"], "<=", lim["focal_rate_mm_per_s"])

    # ---- 每类专有量
    mtype = plan["type"]
    if mtype == "dolly_in":
        _add_trend("dolly_distance_monotonic", "机位到主体距离单调下降",
                   dist, want_up=False, min_trend=0.60,
                   detail="distance 首=%.3f 末=%.3f" % (dist[0], dist[-1]))
        _add_trend("dolly_height_ratio_up", "主体高度占比单调上升",
                   hratio, want_up=True, min_trend=0.12,
                   detail="height_ratio 首=%.3f 末=%.3f" % (hratio[0], hratio[-1]))
    elif mtype == "dolly_out":
        _add_trend("dolly_distance_monotonic", "机位到主体距离单调上升",
                   dist, want_up=True, min_trend=0.60,
                   detail="distance 首=%.3f 末=%.3f" % (dist[0], dist[-1]))
        _add_trend("dolly_height_ratio_down", "主体高度占比单调下降",
                   hratio, want_up=False, min_trend=0.12,
                   detail="height_ratio 首=%.3f 末=%.3f" % (hratio[0], hratio[-1]))
    elif mtype == "pan":
        yaw = camera_yaw_series(eye, tgt)
        dyaw = np.diff(np.unwrap(np.radians(yaw)))
        rate = float(np.abs(dyaw).max() * plan["fps"]) if len(dyaw) else 0.0
        _add("pan_yaw_rate", "摇镜角速度（度/s）", rate, "<=", lim["pan_yaw_rate"])
        _add("pan_no_angle_wrap", "摇镜逐帧角度跳变（度）",
             float(np.max(np.abs(np.diff(yaw))) if n > 1 else 0.0), "<=", lim["pan_no_wrap"])
        _add("pan_yaw_monotonic", "摇镜偏航角单调",
             float(_is_monotonic(np.unwrap(np.radians(yaw)))), ">=", 1.0,
             "yaw %.1f° → %.1f°" % (yaw[0], yaw[-1]))
    elif mtype == "tilt":
        pitch = camera_pitch_series(eye, tgt)
        dpitch = np.diff(np.unwrap(np.radians(pitch)))
        rate = float(np.abs(dpitch).max() * plan["fps"]) if len(dpitch) else 0.0
        _add("tilt_pitch_rate", "俯仰角速度（度/s）", rate, "<=", lim["tilt_pitch_rate"])
        _add("tilt_no_angle_wrap", "俯仰逐帧角度跳变（度）",
             float(np.max(np.abs(np.diff(pitch))) if n > 1 else 0.0), "<=", lim["tilt_no_wrap"])
        _add("tilt_pitch_monotonic", "俯仰角单调",
             float(_is_monotonic(np.unwrap(np.radians(pitch)))), ">=", 1.0,
             "pitch %.1f° → %.1f°" % (pitch[0], pitch[-1]))
    elif mtype == "truck":
        cv = float(speed.std() / (speed.mean() + 1e-9)) if speed.mean() > 1e-9 else 0.0
        _add("truck_world_speed_constant", "机身线速度恒定（速度变异系数）",
             cv, "<=", lim["truck_speed_cv"],
             "speed mean=%.3f m/s" % speed.mean())
        _add("truck_horizontal_only", "机身垂直漂移（m）",
             float(np.abs(eye[:, 2] - eye[0, 2]).max()), "<=", lim["truck_vertical_drift"])
        lat = eye[:, 0] - subj_pos[:, 0]
        _add("truck_lateral_offset", "机身相对主体的横向位移（m）",
             float(abs(lat[-1] - lat[0])), ">=", lim["truck_lateral_drift_m"],
             "横向偏移 %.3f → %.3f m" % (lat[0], lat[-1]))
    elif mtype == "follow":
        _add("follow_distance_constant", "与被摄体距离恒定（带宽 m）",
             metrics["distance_to_subject_span_m"], "<=", lim["follow_distance_band"],
             "distance %.3f → %.3f" % (dist[0], dist[-1]))
        offset = eye - subj_pos
        _add("follow_offset_constant", "主体局部系下机位偏移恒定（带宽 m）",
             float(np.abs(offset - offset[0]).max()), "<=", lim["follow_offset_band"],
             "offset %s" % np.round(offset[0], 3).tolist())
        tdist = np.linalg.norm(tgt - subj_pos, axis=1)
        _add("follow_camera_locked_to_subject", "相机朝向锁定主体（目标距离带宽 m）",
             float(np.abs(tdist - tdist[0]).max()), "<=", lim["follow_distance_band"],
             "target 距离 %.3f m" % tdist[0])
    elif mtype == "orbit":
        rel = eye - subj_pos
        rad = np.linalg.norm(rel[:, :2], axis=1)
        _add("orbit_radius_constant", "环绕半径恒定（带宽 m）",
             float(rad.max() - rad.min()), "<=", lim["orbit_radius_band"],
             "radius %.3f–%.3f" % (rad.min(), rad.max()))
        ang = np.unwrap(np.arctan2(rel[:, 1], rel[:, 0]))
        dang = np.diff(ang)
        _add("orbit_angular_rate_constant", "环绕角速度恒定（度/s 变异）",
             float(np.abs(dang).std() * plan["fps"] * 180.0 / math.pi),
             "<=", lim["orbit_angular_cv"],
             "rate %.2f deg/s" % (float(np.mean(dang) * plan["fps"] * 180.0 / math.pi)))
        _add("orbit_subject_height_constant", "主体高度占比恒定（带宽）",
             float(hratio.max() - hratio.min()), "<=", lim["orbit_height_band"],
             "height_ratio %.3f–%.3f" % (hratio.min(), hratio.max()))
    elif mtype == "pedestal":
        z = eye[:, 2]
        _add("pedestal_z_monotonic", "机位高度单调变化",
             float(_is_monotonic(z)), ">=", 1.0,
             "z %.2f → %.2f m" % (z[0], z[-1]))
        vz = np.abs(np.diff(z)) * plan["fps"]
        _add("pedestal_vertical_speed", "垂直速度起止收敛（首末速度上限 m/s）",
             float(max(vz[0], vz[-1])), "<=", lim["pedestal_end_speed"],
             "v 首=%.3f 末=%.3f m/s" % (vz[0], vz[-1]))
        _add("pedestal_subject_not_cropped", "主体未被裁切（高度占比最小值）",
             float(hratio.min()), ">=", lim["pedestal_min_height_ratio"])
    elif mtype == "handheld":
        residual = handheld_residual(plan, frames, subject)
        dom, freqs, spectrum = fft_dominant(residual, plan["fps"])
        _add_in("handheld_noise_band", "手持噪声主频落在 0.5–3 Hz",
                float(dom), lim["handheld_band"][0], lim["handheld_band"][1],
                "FFT 主频 %.2f Hz（频率栅格 %.2f Hz）" % (dom, float(freqs[1] - freqs[0])))
        _add("handheld_amplitude", "手持位移幅度（m）",
             float(np.abs(residual).max()), "<=", lim["handheld_amplitude_m"])
        _add("handheld_residual_rms", "手持残差 RMS（m）",
             float(np.sqrt((residual ** 2).sum(axis=1).mean())), "<=", lim["handheld_rms_m"])

    return {"checks": checks, "metrics": metrics,
            "n_pass": sum(1 for c in checks if c["pass"]),
            "n_total": len(checks),
            "all_pass": all(c["pass"] for c in checks)}


# ---------------------------------------------------------------- 辅助
def bbox_corners(bb):
    bb = np.asarray(bb, float)
    lo, hi = bb[0], bb[1]
    return np.array([[x, y, z] for x in (lo[0], hi[0])
                     for y in (lo[1], hi[1]) for z in (lo[2], hi[2])], float)


def camera_yaw_series(eye, tgt):
    d = np.asarray(tgt, float) - np.asarray(eye, float)
    return np.degrees(np.arctan2(d[:, 1], d[:, 0]))


def camera_pitch_series(eye, tgt):
    d = np.asarray(tgt, float) - np.asarray(eye, float)
    n = np.linalg.norm(d, axis=1)
    return np.degrees(np.arcsin(np.clip(d[:, 2] / np.maximum(n, 1e-9), -1.0, 1.0)))


def monotonic_trend(series, want_up=True, tol=0.003):
    """单调趋势读数：{"trend", "violations", "violation_frac", "pass"}。

    trend = 末值 − 首值；violations = 与期望方向相反且幅度超过 tol 的帧数。
    """
    s = np.asarray(series, float)
    if s.size < 2:
        return {"trend": 0.0, "violations": 0, "violation_frac": 0.0, "pass": False}
    d = np.diff(s)
    trend = float(s[-1] - s[0])
    viol = int(np.sum(d < -tol)) if want_up else int(np.sum(d > tol))
    return {"trend": trend, "violations": viol,
            "violation_frac": float(viol) / float(len(d))}


def _is_monotonic(a):
    a = np.asarray(a, float)
    d = np.diff(a)
    return bool(np.all(d >= -1e-9) or np.all(d <= 1e-9))


def handheld_residual(plan, frames, subject):
    """手持残差 = 实际 eye 减去解析基础轨道（去掉慢推，只留抖动）。

    基础轨道是「沿固定轴的线性缓推」，解析可算，因此残差里只剩受限频带噪声。
    视轴方向的分量再单独扣掉（那是推镜本身，不是抖动）。
    """
    eye = np.array([f["eye"] for f in frames], float)
    tgt = np.array([f["target"] for f in frames], float)
    subj_pos = np.asarray(subject["pos"], float)
    n = len(frames)
    axis = normalize(np.asarray(plan["start"]["eye"], float))
    d0 = float(np.linalg.norm(np.asarray(plan["start"]["eye"], float)))
    d1 = float(np.linalg.norm(np.asarray(plan["end"]["eye"], float)))
    base = np.array([subj_pos[i] + axis * (d0 + (d1 - d0) * (i / float(n - 1)))
                     for i in range(n)], float)
    res = eye - base
    for i in range(n):
        fwd = normalize(tgt[i] - eye[i])
        res[i] = res[i] - (res[i] @ fwd) * fwd
    return res


def fft_dominant(residual, fps):
    """残差的 FFT 主频（Hz）+ 频率栅格 + 频谱幅值。

    返回 (dominant_hz, freqs, spectrum)。用 Hann 窗抑制泄漏。
    """
    x = np.asarray(residual, float)
    n = x.shape[0]
    win = np.hanning(n) if n > 1 else np.ones(1)
    best_hz, best_amp, best_spec, best_freqs = 0.0, -1.0, None, None
    for c in range(x.shape[1]):
        sig = (x[:, c] - x[:, c].mean()) * win
        spec = np.abs(np.fft.rfft(sig))
        freqs = np.fft.rfftfreq(n, d=1.0 / float(fps))
        k = int(np.argmax(spec))
        if spec[k] > best_amp:
            best_amp = float(spec[k])
            best_hz = float(freqs[k])
            best_spec = spec
            best_freqs = freqs
    return best_hz, best_freqs, best_spec



# ---------------------------------------------------------------- 镜头库目录
def move_catalog():
    """9 类镜头的样例参数化 + 每类阈值（这就是「镜头库」的机器可读形态）。

    参数化表达沿用 ROADMAP §2.4.1 的统一形式；其中 pan / tilt 的偏航角用
    「相对主体方位角」表达（bearing_offset），由 resolve_move_spec() 落成绝对角，
    这样样例不依赖具体场景坐标，也能落到具体机位。

    limits 是每类镜头的阈值覆盖；通用项见 DEFAULT_LIMITS。
    """
    cat = [
        {
            "type": "dolly_in", "shot_id": "shot_dolly_in",
            "title_zh": "推镜 · 主体迎面走来，机位沿视线恒速推近",
            "spec": {
                "type": "dolly_in", "frame": "subject",
                "duration_s": 5.0, "fps": 24, "easing": "linear",
                "start": {"eye": [3.26, 4.07, 2.04], "focal_mm": 42.0},
                "end": {"eye": [2.27, 2.84, 1.42], "focal_mm": 45.0},
                "params": {"note": "沿 start.eye 方向恒速推近：首距 5.60 m → 末距 3.90 m"},
            },
            "limits": {},
        },
        {
            "type": "dolly_out", "shot_id": "shot_dolly_out",
            "title_zh": "拉镜 · 主体迎面走来，机位恒速后退拉远",
            "spec": {
                "type": "dolly_out", "frame": "subject",
                "duration_s": 5.0, "fps": 24, "easing": "linear",
                "start": {"eye": [2.27, 2.84, 1.42], "focal_mm": 35.0},
                "end": {"eye": [3.52, 4.66, 2.33], "focal_mm": 38.0},
                "params": {"note": "沿 start.eye 方向恒速拉远：首距 3.90 m → 末距 6.40 m"},
            },
            "limits": {},
        },
        {
            "type": "pan", "shot_id": "shot_pan",
            "title_zh": "摇镜 · 机身固定，匀速横摇扫过街道",
            "spec": {
                "type": "pan", "frame": "world",
                "duration_s": 5.0, "fps": 24, "easing": "linear",
                "start": {"eye": [2.60, 1.60, 1.55], "focal_mm": 42.0},
                "end": {"eye": [2.60, 1.60, 1.55], "focal_mm": 42.0},
                "params": {"bearing_offset_start_deg": -20.0,
                           "bearing_offset_end_deg": 20.0,
                           "pitch_mode": "subject_chest"},
            },
            "limits": {"centering_offset_max": 0.62, "offscreen_ratio_mean": 0.22,
                       "subject_corner_inside_mean": 0.80},
        },
        {
            "type": "tilt", "shot_id": "shot_tilt",
            "title_zh": "俯仰镜 · 机身固定，匀速俯仰由地面扫到主体",
            "spec": {
                "type": "tilt", "frame": "world",
                "duration_s": 5.0, "fps": 24, "easing": "linear",
                "start": {"eye": [2.90, 1.00, 1.15], "focal_mm": 40.0},
                "end": {"eye": [2.90, 1.00, 1.15], "focal_mm": 40.0},
                "params": {"yaw_mode": "subject_chest",
                           "pitch_start_deg": -5.0, "pitch_end_deg": 7.0},
            },
            "limits": {"centering_offset_max": 0.50, "offscreen_ratio_mean": 0.20,
                       "subject_corner_inside_mean": 0.72},
        },
        {
            "type": "truck", "shot_id": "shot_truck",
            "title_zh": "移镜 · 机身匀速横移，云台跟住主体",
            "spec": {
                "type": "truck", "frame": "world",
                "duration_s": 5.0, "fps": 24, "easing": "linear",
                "start": {"eye": [3.40, -0.60, 1.55], "focal_mm": 40.0},
                "end": {"eye": [1.90, -0.60, 1.55], "focal_mm": 40.0},
                "params": {"velocity_mps": [-0.30, 0.0, 0.0]},
            },
            "limits": {},
        },
        {
            "type": "follow", "shot_id": "shot_follow",
            "title_zh": "跟镜 · 云台挂在主体刚体上，机身与主体同速",
            "spec": {
                "type": "follow", "frame": "subject",
                "duration_s": 5.0, "fps": 24, "easing": "linear",
                "start": {"eye": [1.50, 2.60, 1.75], "focal_mm": 35.0},
                "end": {"eye": [1.50, 2.60, 1.75], "focal_mm": 35.0},
                "mount": {"asset": "hero", "eye_local": [1.50, 2.60, 1.75],
                          "target_local": [0.0, 0.0, 1.00], "up": "Z"},
                "params": {"note": "机位挂在主体刚体的局部偏移上"},
            },
            "limits": {},
        },
        {
            "type": "orbit", "shot_id": "shot_orbit",
            "title_zh": "环绕镜 · 匀角速度绕主体转圈，半径恒定",
            "spec": {
                "type": "orbit", "frame": "subject",
                "duration_s": 5.0, "fps": 24, "easing": "linear",
                "start": {"eye": [4.20, 0.00, 1.50], "focal_mm": 40.0},
                "end": {"eye": [4.20, 0.00, 1.50], "focal_mm": 40.0},
                "params": {"radius_m": 4.20, "height_m": 1.50,
                           "angle_start_deg": 120.0, "angle_end_deg": 190.0},
            },
            "limits": {},
        },
        {
            "type": "pedestal", "shot_id": "shot_pedestal",
            "title_zh": "升降镜 · 机身水平位置不动，沿世界 Z 轴缓升",
            "spec": {
                "type": "pedestal", "frame": "world",
                "duration_s": 5.0, "fps": 24, "easing": "smoothstep",
                "start": {"eye": [3.00, -0.20, 1.05], "focal_mm": 38.0},
                "end": {"eye": [3.00, -0.20, 2.55], "focal_mm": 38.0},
                "params": {"z_start_m": 1.05, "z_end_m": 2.55},
            },
            "limits": {},
        },
        {
            "type": "handheld", "shot_id": "shot_handheld",
            "title_zh": "手持镜 · 基础缓推 + 受限频带（0.8/1.6/2.4 Hz）抖动",
            "spec": {
                "type": "handheld", "frame": "subject",
                "duration_s": 5.0, "fps": 24, "easing": "linear",
                "start": {"eye": [2.60, 3.40, 1.50], "focal_mm": 42.0},
                "end": {"eye": [2.06, 2.70, 1.19], "focal_mm": 42.0},
                "params": {"note": "基础轨道：沿 start.eye 方向线性缓推"},
                "handheld": {"freqs_hz": [0.8, 1.6, 2.4],
                             "amps_m": [0.010, 0.016, 0.008],
                             "phases_rad": [0.0, 1.7, 3.4],
                             "rot_amp_deg": 0.35},
            },
            "limits": {"speed_curve_peak_accel_mps2": 4.00},
        },
    ]
    for entry in cat:
        entry.setdefault("limits", {})
    return cat


def resolve_move_spec(spec, subject):
    """把「相对主体方位角」的参数落成绝对角（pan / tilt 需要场景上下文）。

    返回 (resolved_spec, note)。resolved_spec 的 params 里是绝对值，
    落盘的 shot_spec.json 用它，保证样例可复现。
    """
    spec = json.loads(json.dumps(spec))
    params = spec.setdefault("params", {})
    note = ""
    if spec["type"] == "pan":
        eye = np.asarray(spec["start"]["eye"], float)
        chest = np.asarray(subject["chest"], float)
        b0 = bearing_deg(eye, chest[0])
        b1 = bearing_deg(eye, chest[-1])
        params["yaw_start_deg"] = b0 + float(params.get("bearing_offset_start_deg", -20.0))
        params["yaw_end_deg"] = b1 + float(params.get("bearing_offset_end_deg", 20.0))
        if params.get("pitch_mode") == "subject_chest":
            d = chest[0] - eye
            params["pitch_deg"] = math.degrees(math.asin(d[2] / float(np.linalg.norm(d))))
        note = ("yaw 由主体方位角解出：起始 %.3f° → 结束 %.3f°，pitch %.3f°"
                % (params["yaw_start_deg"], params["yaw_end_deg"], params["pitch_deg"]))
    elif spec["type"] == "tilt":
        eye = np.asarray(spec["start"]["eye"], float)
        chest = np.asarray(subject["chest"], float)
        if params.get("yaw_mode") == "subject_chest":
            params["yaw_deg"] = bearing_deg(eye, chest[0])
        note = "yaw 由主体方位角解出：%.3f°" % params["yaw_deg"]
    return spec, note



def handheld_residual_from_track(frames, subject):
    """从**落盘的逐帧 eye** 反推手持残差（不依赖镜头计划里的解析参数）。

    做法：把 eye − subject.pos 投影到其主方向（噪声零均值，主方向即基础轨道方向），
    再用最小二乘拟合「线性推轨」的起点与终点，最后相减得到只剩受限频带噪声的残差。
    """
    eye = np.array([f["eye"] for f in frames], float)
    tgt = np.array([f["target"] for f in frames], float)
    subj_pos = np.asarray(subject["pos"], float)
    n = len(frames)
    rel = eye - subj_pos
    axis = normalize(rel.mean(axis=0))
    u = np.linspace(0.0, 1.0, n)
    proj = rel @ axis
    A = np.stack([np.ones(n), u], axis=1)
    coef, *_ = np.linalg.lstsq(A, proj, rcond=None)
    d0, slope = float(coef[0]), float(coef[1])
    base = subj_pos + axis * (d0 + slope * u)[:, None]
    res = eye - base
    for i in range(n):
        fwd = normalize(tgt[i] - eye[i])
        res[i] = res[i] - (res[i] @ fwd) * fwd
    return res

