"""镜头描述（shot spec）统一格式：把「世界绝对关键帧相机」与「挂在载具刚体上的车载镜头」
统一到同一份 JSON 里。

用途：
  现有 camera_path.json 只有纯世界坐标的 87 个采样点，scene_layout.json 里的
  car_a / car_b 只有静态 4x4 变换——两者无法表达「车在动、镜头跟着车动」的车内视角。
  本模块引入统一的镜头描述格式：相机可以挂在某个载具的刚体变换上，
  载具由 pos + yaw 的时间序列驱动，镜头位姿由 M(t) 推导。

用法：
  from shot_spec import resolve_camera, validate_spec, actor_transforms_at

  transforms = actor_transforms_at(spec, t)      # {asset: 4x4}
  cam = resolve_camera(spec, t, transforms)        # {"eye": (3,), "target": (3,), "focal_mm": float}
  problems = validate_spec(spec)                  # [] 表示规范

  python shot_spec.py --demo     # 写出 assets/validation/shot_spec.json

设计理由：
  1) 公开接口 resolve_camera(spec, t, asset_transforms) 的返回值全部是世界坐标，
     下游渲染器不需要知道镜头是「世界相机」还是「车载相机」，也不需要自己懂挂载规则。
  2) 变换约定与 scene_layout.json 完全一致：行主序展开、平移在最后一列、
     列向量约定 p_world = M @ p_local，因此同一份 asset_transforms 可以直接
     喂给 trimesh / USD / glTF 节点，不做二次转换。
  3) 载具航向 yaw=0 表示载具局部 +X（车头）指向世界 +X，yaw 增大为左转。
     这与 vehicle_dynamics.py 的轨迹约定完全一致，两边可以共用一条轨迹。
  4) 轨迹求值只做位置线性插值 + 航向最短弧插值，不引入样条：车内镜头要求
     与载具刚体严格贴合，平滑反而会让镜头与车身脱节。
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

import numpy as np

# harness 目录内的兄弟模块（vehicle_dynamics）按脚本方式导入，
# 这里补一次 sys.path 以支持被别的模块 import 的用法。
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from vehicle_dynamics import (  # noqa: E402
    build_demo_trajectory,
    sample_track,
    track_to_matrix,
)

ROOT = os.path.dirname(_HERE)
VAL = os.path.join(ROOT, "assets", "validation")

# 受支持的渲染通道：条件渲染的输出位面，与 conditions 字段一一对应
SUPPORTED_CONDITIONS = ("depth", "normal", "seg")
# 车内眼点高度区间（米，相对车体原点即地面）
EYE_HEIGHT_RANGE = (0.9, 1.4)
CAMERA_MODES = ("world", "mounted")


# ------------------------------------------------------------------ 轨迹求值
def _as_matrix(m) -> np.ndarray:
    """把 4x4 变换统一成 np.ndarray，兼容列表/JSON 形式。"""
    return np.asarray(m, float).reshape(4, 4)


def _smoothstep(u: float) -> float:
    """与 render_shot.cam_at 一致的缓动：镜头关键帧之间不留折角。"""
    u = min(1.0, max(0.0, u))
    return u * u * (3.0 - 2.0 * u)


def _lerp3(a, b, u):
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    return a + (b - a) * u


def actor_transforms_at(spec: dict, t: float) -> dict:
    """求出 t 时刻所有 actor 的 4x4 世界变换。

    返回 {asset_name: 4x4 np.ndarray}；同名 asset 以最后一条为准。
    """
    out = {}
    for actor in spec.get("actors") or []:
        name = actor.get("asset")
        track = actor.get("track") or []
        if not name or not track:
            continue
        pos, yaw = sample_track(track, float(t))
        out[name] = track_to_matrix(pos, yaw)
    return out


def _mount_matrix(spec: dict, asset: str, asset_transforms: dict, t: float) -> np.ndarray:
    """取挂载载具在 t 时刻的刚体变换。

    优先用调用方传入的 asset_transforms（渲染器通常已经算好了）；
    传不到时回退到 spec 内 actor 的轨迹，保证 resolve_camera 单独自洽可用。
    """
    if asset_transforms and asset_transforms.get(asset) is not None:
        return _as_matrix(asset_transforms[asset])
    for actor in spec.get("actors") or []:
        if actor.get("asset") == asset:
            pos, yaw = sample_track(actor.get("track") or [], float(t))
            return track_to_matrix(pos, yaw)
    raise KeyError(f"挂载载具 '{asset}' 在 t={t} 没有可用的变换："
                   f"asset_transforms 未提供且 spec.actors 里也没有它的轨迹")


def _world_camera(cam: dict, t: float) -> dict:
    """世界模式：在绝对关键帧之间插值出世界坐标的 eye / target / focal。"""
    keys = cam.get("keys")
    if keys:
        keys = sorted(keys, key=lambda k: float(k["t"]))
        ts = [float(k["t"]) for k in keys]
        if t <= ts[0]:
            k = keys[0]
            return {"eye": np.asarray(k["eye"], float),
                    "target": np.asarray(k["target"], float),
                    "focal_mm": float(k.get("focal_mm", cam.get("focal_mm", 50.0)))}
        if t >= ts[-1]:
            k = keys[-1]
            return {"eye": np.asarray(k["eye"], float),
                    "target": np.asarray(k["target"], float),
                    "focal_mm": float(k.get("focal_mm", cam.get("focal_mm", 50.0)))}
        i = int(np.searchsorted(ts, t, side="right"))
        i = max(1, min(i, len(keys) - 1))
        k0, k1 = keys[i - 1], keys[i]
        u = _smoothstep((t - float(k0["t"])) / (float(k1["t"]) - float(k0["t"])))
        f0 = float(k0.get("focal_mm", cam.get("focal_mm", 50.0)))
        f1 = float(k1.get("focal_mm", cam.get("focal_mm", 50.0)))
        return {"eye": _lerp3(k0["eye"], k1["eye"], u),
                "target": _lerp3(k0["target"], k1["target"], u),
                "focal_mm": f0 + (f1 - f0) * u}
    if "eye" in cam and "target" in cam:
        return {"eye": np.asarray(cam["eye"], float),
                "target": np.asarray(cam["target"], float),
                "focal_mm": float(cam.get("focal_mm", 50.0))}
    raise ValueError("world 模式相机需要 keys 或 eye/target")


def resolve_camera(spec: dict, t: float, asset_transforms: dict) -> dict:
    """返回 {"eye": (3,), "target": (3,), "focal_mm": float}，全部是世界坐标。

    asset_transforms: {asset_name: 4x4 np.ndarray}
    mounted 模式：world_eye = M(t) @ eye_local，world_target = M(t) @ target_local

    world 模式：直接沿用 spec 内绝对关键帧的插值结果。
    返回值中 eye / target 是长度 3 的 numpy 数组，focal_mm 是 float。
    """
    cam = spec.get("camera") or {}
    mode = cam.get("mode", "world")
    t = float(t)

    if mode == "mounted":
        mount = cam.get("mount") or {}
        asset = mount.get("asset")
        if not asset:
            raise ValueError("mounted 模式缺少 camera.mount.asset")
        eye_local = np.asarray(mount.get("eye_local"), float)
        target_local = np.asarray(mount.get("target_local"), float)
        if eye_local.shape != (3,) or target_local.shape != (3,):
            raise ValueError("camera.mount.eye_local / target_local 必须是 3 维向量")
        m = _mount_matrix(spec, asset, asset_transforms or {}, t)
        eye = (m @ np.array([eye_local[0], eye_local[1], eye_local[2], 1.0]))[:3]
        target = (m @ np.array([target_local[0], target_local[1], target_local[2], 1.0]))[:3]
        focal = float(mount.get("focal_mm", cam.get("focal_mm", 50.0)))
        return {"eye": eye, "target": target, "focal_mm": focal}

    if mode != "world":
        raise ValueError(f"未知 camera.mode：{mode}（支持 {CAMERA_MODES}）")
    return _world_camera(cam, t)


def sample_shot(spec: dict):
    """把整条镜头逐帧采样成渲染器可直接消费的记录。

    每条记录含帧号、时间、世界 eye/target、焦距，以及该时刻所有 actor 的变换。
    """
    fps = float(spec.get("fps", 24))
    duration = float(spec.get("duration_s", 0.0))
    n = int(round(fps * duration))
    out = []
    for i in range(n):
        t = i / fps
        transforms = actor_transforms_at(spec, t)
        cam = resolve_camera(spec, t, transforms)
        out.append({
            "frame": i,
            "t": round(t, 6),
            "eye": [round(float(v), 6) for v in cam["eye"]],
            "target": [round(float(v), 6) for v in cam["target"]],
            "focal_mm": round(float(cam["focal_mm"]), 6),
            "actor_transforms": {k: [round(float(c), 6) for c in v.reshape(-1)]
                                 for k, v in transforms.items()},
        })
    return out


# ------------------------------------------------------------------ 校验
def validate_spec(spec: dict, asset_names=None) -> list:
    """检查镜头描述是否自洽，返回问题描述列表（空列表 = 合法）。"""
    problems = []
    if not isinstance(spec, dict):
        return ["spec 必须是 dict"]

    if spec.get("kind") != "shot_spec":
        problems.append(f"kind 必须是 'shot_spec'（当前 {spec.get('kind')!r}）")

    fps = spec.get("fps")
    if not isinstance(fps, (int, float)) or fps <= 0:
        problems.append(f"fps 必须是正数（当前 {fps!r}）")
    duration = spec.get("duration_s")
    if not isinstance(duration, (int, float)) or duration <= 0:
        problems.append(f"duration_s 必须是正数（当前 {duration!r}）")
        duration = 0.0

    cam = spec.get("camera")
    if not isinstance(cam, dict):
        problems.append("缺少 camera 段")
        return problems

    mode = cam.get("mode", "world")
    if mode not in CAMERA_MODES:
        problems.append(f"camera.mode 必须是 {CAMERA_MODES} 之一（当前 {mode!r}）")

    actors = spec.get("actors") or []
    actor_assets = [a.get("asset") for a in actors if isinstance(a, dict)]

    if mode == "mounted":
        mount = cam.get("mount")
        if not isinstance(mount, dict):
            problems.append("mounted 模式缺少 camera.mount")
        else:
            asset = mount.get("asset")
            if not asset:
                problems.append("camera.mount.asset 不能为空")
            elif asset not in actor_assets:
                problems.append(f"camera.mount.asset '{asset}' 不在 actors 里，"
                                f"挂载点没有轨迹就无法求 M(t)")
            elif asset_names is not None and asset not in set(asset_names):
                problems.append(f"camera.mount.asset '{asset}' 不在场景物件列表里")
            eye_local = mount.get("eye_local")
            if not (isinstance(eye_local, (list, tuple)) and len(eye_local) == 3):
                problems.append("camera.mount.eye_local 必须是 3 维向量")
            else:
                h = float(eye_local[2])
                lo, hi = EYE_HEIGHT_RANGE
                if not (lo <= h <= hi):
                    problems.append(f"眼点高度 {h:.3f} m 超出 {lo}~{hi} m 的车内合理区间")
            target_local = mount.get("target_local")
            if not (isinstance(target_local, (list, tuple)) and len(target_local) == 3):
                problems.append("camera.mount.target_local 必须是 3 维向量")
            elif isinstance(eye_local, (list, tuple)) and len(eye_local) == 3:
                d = math.dist([float(c) for c in eye_local], [float(c) for c in target_local])
                if d < 1e-6:
                    problems.append("camera.mount 的 eye_local 与 target_local 重合")
        focal = cam.get("focal_mm")
        if not isinstance(focal, (int, float)) or focal <= 0:
            problems.append(f"camera.focal_mm 必须是正数（当前 {focal!r}）")
    else:
        keys = cam.get("keys")
        if keys:
            ts = [float(k["t"]) for k in keys]
            if any(b <= a for a, b in zip(ts, ts[1:])):
                problems.append("camera.keys 的时间必须严格递增")
            for k in keys:
                if not (isinstance(k.get("eye"), (list, tuple)) and len(k["eye"]) == 3):
                    problems.append("camera.keys 缺少三维 eye")
                    break
                if not (isinstance(k.get("target"), (list, tuple)) and len(k["target"]) == 3):
                    problems.append("camera.keys 缺少三维 target")
                    break
                if math.dist(k["eye"], k["target"]) < 1e-6:
                    problems.append("camera.keys 中 eye 与 target 重合")
                    break
        elif not ("eye" in cam and "target" in cam):
            problems.append("world 模式相机需要 keys 或 eye/target")
        focal = cam.get("focal_mm")
        if focal is not None and (not isinstance(focal, (int, float)) or focal <= 0):
            problems.append(f"camera.focal_mm 必须是正数（当前 {focal!r}）")

    for actor in actors:
        if not isinstance(actor, dict):
            problems.append("actors 的元素必须是 dict")
            continue
        name = actor.get("asset")
        if not name:
            problems.append("actor 缺少 asset 字段")
            continue
        if asset_names is not None and name not in set(asset_names):
            problems.append(f"actor '{name}' 不在场景物件列表里")
        track = actor.get("track")
        if not track:
            problems.append(f"actor '{name}' 缺少轨迹")
            continue
        ts = []
        for k in track:
            if not isinstance(k, dict) or "t" not in k or "pos" not in k:
                problems.append(f"actor '{name}' 的轨迹点需要 t 与 pos 字段")
                continue
            if not (isinstance(k["pos"], (list, tuple)) and len(k["pos"]) == 3):
                problems.append(f"actor '{name}' 的轨迹点 pos 必须是 3 维向量")
                continue
            ts.append(float(k["t"]))
        if len(ts) < 2:
            problems.append(f"actor '{name}' 的轨迹至少需要 2 个采样点")
            continue
        if any(b <= a for a, b in zip(ts, ts[1:])):
            problems.append(f"actor '{name}' 的轨迹时间必须严格递增")
        if ts[0] > 1e-9 or ts[-1] < duration - 1e-9:
            problems.append(f"actor '{name}' 的轨迹时间 [{ts[0]:.3f}, {ts[-1]:.3f}] "
                            f"未覆盖 [0, {duration:.3f}]")

    conds = spec.get("conditions", [])
    if not isinstance(conds, (list, tuple)):
        problems.append("conditions 必须是列表")
    else:
        for c in conds:
            if c not in SUPPORTED_CONDITIONS:
                problems.append(f"不支持的条件通道 '{c}'（支持 {SUPPORTED_CONDITIONS}）")
    return problems


# ------------------------------------------------------------------ 示例 spec
def build_demo_spec() -> dict:
    """造一个可运行的示例镜头：车载相机跟着 car_a 走完「直线 -> 右转 -> 刹车停车」。

    轨迹直接取自 vehicle_dynamics.build_demo_trajectory()，
    因此 shot_spec 与 vehicle_dynamics 共享同一条真相，不会各说各话。
    """
    traj = build_demo_trajectory()
    return {
        "kind": "shot_spec",
        "shot_id": "S03",
        "fps": traj["fps"],
        "duration_s": traj["duration_s"],
        "sensor_width_mm": 36.0,
        "camera": {
            "mode": "mounted",
            "mount": {
                "asset": "car_a",
                # 车内中央前排，视线高度 1.15 m；局部 +X 是车头方向
                "eye_local": [0.36, 0.0, 1.15],
                "target_local": [8.0, 0.0, 1.05],
                "up": [0.0, 0.0, 1.0],
            },
            "focal_mm": 35.0,
        },
        "actors": [
            {"asset": "car_a", "track": traj["track"]},
        ],
        "conditions": ["depth", "normal", "seg"],
        "notes": "车载镜头：相机位姿由 car_a 的刚体变换 M(t) 推出；"
                 "轨迹覆盖 [0, 8.0] s，含直线、右转 90 度、减速停车、静止保持四段",
    }


# ------------------------------------------------------------------ CLI
def main(argv=None):
    ap = argparse.ArgumentParser(description="镜头描述（shot spec）工具")
    ap.add_argument("--demo", action="store_true", help="写出示例 spec 到 assets/validation/shot_spec.json")
    ap.add_argument("--out", default=os.path.join(VAL, "shot_spec.json"))
    args = ap.parse_args(argv)

    spec = build_demo_spec()
    problems = validate_spec(spec)
    samples = sample_shot(spec)
    doc = dict(spec)
    doc["camera_samples"] = samples
    doc["validation"] = {"problems": problems, "pass": not problems,
                         "frames": len(samples)}
    doc["downstream_hint"] = ("resolve_camera(spec, t, actor_transforms_at(spec, t)) "
                              "直接得到世界坐标镜头；camera_samples 是预烘焙的逐帧结果")

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)

    print(json.dumps({k: v for k, v in spec.items() if k != "actors"}, ensure_ascii=False, indent=2))
    print("actors:", [(a["asset"], len(a["track"])) for a in spec["actors"]])
    print("validation problems:", problems)
    print("first sample:", json.dumps(samples[0], ensure_ascii=False))
    print("last  sample:", json.dumps(samples[-1], ensure_ascii=False))
    print("written", args.out)
    return 0 if not problems else 1


if __name__ == "__main__":
    raise SystemExit(main())
