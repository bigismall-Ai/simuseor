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

v2（ROADMAP §2.5.1）
===================
  spec 带 schema_version=2 时，validate_spec 额外强制 11 个字段：
  resolution / up_axis / assets[] / camera.move / camera.near|far /
  conditions 对象形态 / timeline.events[] / validation / license[] / status / kind。
  没有 schema_version 的老 spec 仍按老规则校验——历史产物（camera_path 派生的
  W01 等）不会因为「补字段」被一次性判死，但也不会被当成 v2 用。
  资产引用一律用 assets/manifest.json 的 asset_id；conditions.channels 的闭集
  仍是 SUPPORTED_CONDITIONS 六通道（depth/normal/seg/mask/lineart/pose）。

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
    DEMO_STOP_S,
    DEMO_TURN0_S,
    DEMO_TURN1_S,
    build_demo_trajectory,
    sample_track,
    track_to_matrix,
)
# 条件通道闭集与 condition_contract.py 同源（R0 契约），不另抄一份。
from condition_contract import (  # noqa: E402
    CHANNELS as CONTRACT_CHANNELS,
    DEPTH_POLARITY,
    MASK_SEMANTICS,
    SEG_PALETTE_ID,
    UP_AXIS as CONTRACT_UP_AXIS,
)
# 自产件的默认许可口径与资产台账同源（asset_manifest.py 是唯一事实源）。
from asset_manifest import (  # noqa: E402
    SELF_CREDIT as ASSET_DEFAULT_CREDIT,
    SELF_SPDX as ASSET_DEFAULT_SPDX,
)

ROOT = os.path.dirname(_HERE)
VAL = os.path.join(ROOT, "assets", "validation")

# 受支持的渲染通道：条件渲染的输出位面，与 conditions 字段一一对应。
# R0 契约扩到六通道（depth/normal/seg/mask/lineart/pose）；闭集取自
# condition_contract.CHANNELS，契约改了这里自动跟着改。
SUPPORTED_CONDITIONS = CONTRACT_CHANNELS
# 车内眼点高度区间（米，相对车体原点即地面）
EYE_HEIGHT_RANGE = (0.9, 1.4)
CAMERA_MODES = ("world", "mounted")

# ------------------------------------------------------------------ v2 schema
# ROADMAP §2.5.1 的 shot spec 最小字段。v1 的 spec（没有 schema_version）继续按老
# 规则校验，保证既有产物（camera_path 派生的 W01 等）不被判红；schema_version >= 2
# 的 spec 才强制下面这些字段——这样「补字段」不会把历史 spec 一次性判死。
SHOT_SPEC_SCHEMA_VERSION = 2
SHOT_STATUSES = ("draft", "validated", "approved")
# 运镜类型与缓动闭集：与 harness/camera_moves.py 的 MOVE_TYPES / EASINGS 对齐
# （那边是运镜实现侧、本模块是描述侧，词表必须一致，改一处要改两处）。
CAMERA_MOVE_TYPES = ("dolly_in", "dolly_out", "pan", "tilt", "truck",
                     "follow", "orbit", "pedestal", "handheld")
CAMERA_MOVE_EASINGS = ("linear", "smoothstep", "smoothstep_in", "smoothstep_out")
# 渲染分辨率：与条件图 sidecar 同口径（R0 condition_pack 实测 512x512）。
DEFAULT_RESOLUTION = (512, 512)
# sidecar 的 f_px 是权威内参（契约 §1），focal_mm / sensor_width_mm 只作参考。
DEFAULT_F_PX = 512.0


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


# ------------------------------------------------------------------ v2 辅助
def _load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _scene_assets():
    """scene_layout.json 的 objects[] -> shot spec 的 assets[]（asset_id 引用）。

    单一事实源：objects[].source 就是 manifest 的 asset_id（v2 起不再是文件路径），
    这里只搬运，不另建映射表——映射表一多就会和台账说各话。
    """
    doc = _load_json(os.path.join(ROOT, "assets", "nongeometry", "scene_layout.json"), {}) or {}
    out = []
    for o in doc.get("objects") or []:
        asset_id = o.get("source")
        if not asset_id:
            continue
        out.append({
            "asset_id": asset_id,
            "role": o.get("category") or "prop",
            "instance": o.get("name"),
            "transform": list(o.get("transform") or []),
        })
    return out


def _manifest_license_map():
    """assets/manifest.json（v2）里 id -> license 段；没有台账就退回默认口径。"""
    doc = _load_json(os.path.join(ROOT, "assets", "manifest.json"), {}) or {}
    out = {}
    for a in doc.get("assets") or []:
        lic = a.get("license") or {}
        out[a.get("id")] = {
            "license": lic.get("spdx") or ASSET_DEFAULT_SPDX,
            "source_url": lic.get("source_url"),
            "attribution": lic.get("credit") or ASSET_DEFAULT_CREDIT,
        }
    return out


def _shot_licenses(asset_ids):
    """shot 的 license[]：逐资产带出许可，来源是 manifest（不是手抄）。"""
    lic_map = _manifest_license_map()
    out, seen = [], set()
    for aid in asset_ids:
        if aid in seen:
            continue
        seen.add(aid)
        info = lic_map.get(aid) or {}
        out.append({
            "asset_id": aid,
            "license": info.get("license", ASSET_DEFAULT_SPDX),
            "source_url": info.get("source_url"),
            "attribution": info.get("attribution", ASSET_DEFAULT_CREDIT),
        })
    return out


def _timeline_events(duration_s):
    """时间轴事件：FX 代理的起止 + 载具轨迹上的可观测节点。"""
    events = []
    fx = _load_json(os.path.join(ROOT, "assets", "nongeometry", "fx_proxy.json"), {}) or {}
    traj = fx.get("trajectory") or {}
    t0, t1 = traj.get("t_start"), traj.get("t_end")
    if isinstance(t0, (int, float)) and isinstance(t1, (int, float)):
        events.append({"t": round(float(t0), 3), "type": "fx_volume.start",
                       "target": "nongeometry/fx_proxy"})
        events.append({"t": round(float(t1), 3), "type": "fx_volume.end",
                       "target": "nongeometry/fx_proxy"})
    events.append({"t": round(float(DEMO_TURN0_S), 3), "type": "vehicle.turn_begin",
                   "target": "car_a"})
    events.append({"t": round(float(DEMO_TURN1_S), 3), "type": "brake_light.on",
                   "target": "car_a"})
    events.append({"t": round(float(DEMO_STOP_S), 3), "type": "vehicle.stop",
                   "target": "car_a"})
    events = [e for e in events if -1e-9 <= e["t"] <= float(duration_s) + 1e-9]
    events.sort(key=lambda e: e["t"])
    return events


def _scene_depth_range(spec):
    """沿相机前向轴求场景深度包络（米），给 camera.near/far 与 conditions.depth。

    口径：scene_layout 的实例包围盒（局部盒经实例变换到世界）沿前向轴投影的包络，
    是**包围盒包络**而不是像素级前景实测，所以比条件图实测的 depth_range 略宽。
    它的作用是给 near/far 一个有据可查、可复算的初值；真正渲染时以 sidecar 为准。
    """
    layout = _load_json(os.path.join(ROOT, "assets", "nongeometry", "scene_layout.json"), {}) or {}
    chunks = []
    for o in layout.get("objects") or []:
        bb = o.get("bbox_m")
        tr = o.get("transform")
        if not (isinstance(bb, (list, tuple)) and len(bb) == 6):
            continue
        lo = np.asarray(bb[:3], float)
        hi = np.asarray(bb[3:], float)
        pts = np.array([[x, y, z] for x in (lo[0], hi[0])
                        for y in (lo[1], hi[1]) for z in (lo[2], hi[2])])
        if isinstance(tr, (list, tuple)) and len(tr) == 16:
            m = _as_matrix(tr)
            # 列向量约定 p_world = M @ p_local -> 行向量写法是 p_row @ M.T
            pts = (np.hstack([pts, np.ones((len(pts), 1))]) @ m.T)[:, :3]
        chunks.append(pts)
    if not chunks:
        return 0.05, 100.0
    world = np.vstack(chunks)
    fps = float(spec.get("fps", 24))
    duration = float(spec.get("duration_s", 0.0))
    n = max(2, int(round(fps * duration)))
    spans = []
    for i in range(n):
        t = i / fps
        cam = resolve_camera(spec, t, actor_transforms_at(spec, t))
        eye = np.asarray(cam["eye"], float)
        fwd = np.asarray(cam["target"], float) - eye
        norm = float(np.linalg.norm(fwd))
        if norm < 1e-9:
            continue
        d = (world - eye) @ (fwd / norm)
        pos = d[d > 1e-3]
        if pos.size:
            spans.append((float(pos.min()), float(pos.max())))
    if not spans:
        return 0.05, 100.0
    near = max(min(s[0] for s in spans), 0.05)
    far = max(s[1] for s in spans)
    if far <= near:
        far = near * 100.0
    return round(near, 6), round(far, 6)


def _v2_field_status(spec):
    """§2.5.1 的 11 个字段逐条判定 -> {code: (ok, message, hint)}。

    校验器（validate_spec）与报告（_schema_checks）共用这一份判定，
    免得「判红的地方」和「报出来的地方」两套口径。
    """
    cam = spec.get("camera") or {}
    res = spec.get("resolution")
    res_ok = (isinstance(res, (list, tuple)) and len(res) == 2
              and all(isinstance(v, int) and v > 0 for v in res))
    move = cam.get("move")
    move_ok = (isinstance(move, dict)
               and move.get("type") in CAMERA_MOVE_TYPES
               and move.get("easing") in CAMERA_MOVE_EASINGS)
    near, far = cam.get("near"), cam.get("far")
    clip_ok = (isinstance(near, (int, float)) and isinstance(far, (int, float))
               and 0 < near < far)
    assets = spec.get("assets")
    assets_ok = bool(assets) and all(
        isinstance(a, dict) and a.get("asset_id") and a.get("role")
        and isinstance(a.get("transform"), (list, tuple)) and len(a["transform"]) == 16
        for a in assets)
    conds = spec.get("conditions")
    if isinstance(conds, dict):
        ch = conds.get("channels")
        conds_ok = (isinstance(ch, (list, tuple)) and bool(ch)
                    and all(c in SUPPORTED_CONDITIONS for c in ch)
                    and isinstance(conds.get("depth"), dict)
                    and bool(conds.get("depth", {}).get("encoding"))
                    and bool(conds.get("mask_semantics"))
                    and bool(conds.get("palette_version")))
    else:
        conds_ok = False
    tl = spec.get("timeline")
    tl_ok = (isinstance(tl, dict) and isinstance(tl.get("events"), (list, tuple))
             and all(isinstance(e, dict) and e.get("type") and e.get("target")
                     and isinstance(e.get("t"), (int, float)) for e in tl["events"]))
    val = spec.get("validation")
    val_ok = (isinstance(val, dict) and bool(val.get("report_path"))
              and "pass" in val and isinstance(val.get("checks"), (list, tuple)))
    lic = spec.get("license")
    lic_ok = bool(lic) and all(isinstance(l, dict) and l.get("asset_id")
                                and l.get("license") for l in lic)
    return {
        "SHOT_KIND": (spec.get("kind") == "shot_spec",
                      "kind=%r" % spec.get("kind"), "固定为 shot_spec"),
        "SHOT_RESOLUTION": (res_ok, "resolution=%s" % (res,),
                            "[w, h]：条件图 sidecar 要引用同一分辨率"),
        "SHOT_UP_AXIS": (spec.get("up_axis") == CONTRACT_UP_AXIS,
                         "up_axis=%r" % spec.get("up_axis"), "本项目固定 Z-up"),
        "SHOT_ASSETS": (assets_ok, "assets[] 引用 %d 个 asset_id" % len(assets or []),
                        "asset_id 必须在 assets/manifest.json 里存在"),
        "SHOT_CAMERA_MOVE": (move_ok, "camera.move=%s" % (move,),
                             "{type, easing, handheld?}；type 取 CAMERA_MOVE_TYPES"),
        "SHOT_CAMERA_CLIP": (clip_ok, "camera.near=%s camera.far=%s" % (near, far),
                             "近远裁剪面（米），与 conditions.depth 同值"),
        "SHOT_CONDITIONS": (conds_ok, "conditions 形态=%s"
                            % ("object" if isinstance(conds, dict) else type(conds).__name__),
                            "v2 用对象形态 {channels[], depth{...}, mask_semantics, palette_version}"),
        "SHOT_TIMELINE": (tl_ok, "timeline.events[] %d 条"
                          % len((tl or {}).get("events") or []) if isinstance(tl, dict) else 0,
                          "FX 才有时间轴归属"),
        "SHOT_VALIDATION": (val_ok, "validation.report_path=%r"
                            % (val.get("report_path") if isinstance(val, dict) else None),
                            "shot 必须回链验证报告"),
        "SHOT_LICENSE": (lic_ok, "license[] 带出 %d 个资产的许可" % len(lic or []),
                         "shot 必须带出资产许可，否则交付不可用"),
        "SHOT_STATUS": (spec.get("status") in SHOT_STATUSES,
                        "status=%r" % spec.get("status"), "draft|validated|approved"),
    }


def _schema_checks(spec, problems):
    """把 §2.5.1 的 11 个字段列成 {code, ok, message, hint} 检查表。

    结构与仓库既有报告（validation_report.json / exports.json）一致。
    """
    checks = []
    for code, (ok, message, hint) in _v2_field_status(spec).items():
        checks.append({"code": code, "ok": bool(ok), "message": message, "hint": hint})
    checks.append({"code": "SHOT_VALIDATE_SPEC", "ok": not problems,
                   "message": "validate_spec 报出 %d 个问题" % len(problems),
                   "hint": "问题清单见 problems 字段"})
    return checks


def _validate_v2(spec, problems):
    """§2.5.1 的 11 个字段校验（只对 schema_version >= 2 的 spec 生效）。"""
    duration = float(spec.get("duration_s") or 0.0)
    status = _v2_field_status(spec)
    for code in ("SHOT_KIND", "SHOT_RESOLUTION", "SHOT_UP_AXIS", "SHOT_ASSETS",
                 "SHOT_CAMERA_MOVE", "SHOT_CAMERA_CLIP", "SHOT_CONDITIONS",
                 "SHOT_TIMELINE", "SHOT_VALIDATION", "SHOT_LICENSE", "SHOT_STATUS"):
        ok, message, hint = status[code]
        if not ok:
            problems.append(f"{code}: {message}（{hint}）")

    # 逐条细说：让报错直接指向字段，而不是只说「这一组不合格」
    cam = spec.get("camera") or {}
    move = cam.get("move")
    if isinstance(move, dict):
        if move.get("type") not in CAMERA_MOVE_TYPES:
            problems.append(f"camera.move.type 必须是 {CAMERA_MOVE_TYPES} 之一"
                            f"（当前 {move.get('type')!r}）")
        if move.get("easing") not in CAMERA_MOVE_EASINGS:
            problems.append(f"camera.move.easing 必须是 {CAMERA_MOVE_EASINGS} 之一"
                            f"（当前 {move.get('easing')!r}）")
        if move.get("handheld") is not None and not isinstance(move.get("handheld"), dict):
            problems.append("camera.move.handheld 必须是 dict 或省略")
    near, far = cam.get("near"), cam.get("far")
    for name, value in (("camera.near", near), ("camera.far", far)):
        if not isinstance(value, (int, float)) or value <= 0:
            problems.append(f"{name} 必须是正数（当前 {value!r}）")
    if isinstance(near, (int, float)) and isinstance(far, (int, float)) and near >= far:
        problems.append(f"camera.near({near}) 必须小于 camera.far({far})")

    conds = spec.get("conditions")
    if isinstance(conds, dict):
        channels = conds.get("channels")
        if not (isinstance(channels, (list, tuple)) and channels):
            problems.append("conditions.channels 必须是非空列表")
        else:
            for c in channels:
                if c not in SUPPORTED_CONDITIONS:
                    problems.append(f"不支持的条件通道 '{c}'（支持 {SUPPORTED_CONDITIONS}）")
        depth = conds.get("depth")
        if not isinstance(depth, dict):
            problems.append("conditions.depth 必须是 {near, far, encoding}")
        else:
            for name in ("near", "far"):
                value = depth.get(name)
                if not isinstance(value, (int, float)) or value <= 0:
                    problems.append(f"conditions.depth.{name} 必须是正数（当前 {value!r}）")
            if not depth.get("encoding"):
                problems.append("conditions.depth.encoding 缺失")
        if not conds.get("mask_semantics"):
            problems.append("conditions.mask_semantics 缺失")
        if not conds.get("palette_version"):
            problems.append("conditions.palette_version 缺失")

    tl = spec.get("timeline")
    if isinstance(tl, dict):
        for e in tl.get("events") or []:
            if not isinstance(e, dict):
                problems.append("timeline.events 的元素必须是 dict")
                continue
            if not isinstance(e.get("t"), (int, float)):
                problems.append("timeline 事件缺少数值 t")
            elif duration and not (-1e-9 <= float(e["t"]) <= duration + 1e-9):
                problems.append(f"timeline 事件 t={e['t']} 超出 [0, {duration}]")
            if not e.get("type"):
                problems.append("timeline 事件缺少 type")
            if not e.get("target"):
                problems.append("timeline 事件缺少 target")

    assets = spec.get("assets")
    if isinstance(assets, (list, tuple)):
        for a in assets:
            if not isinstance(a, dict):
                problems.append("assets 的元素必须是 dict")
                continue
            if not a.get("asset_id"):
                problems.append("assets 条目缺少 asset_id（引用 manifest 的唯一句柄）")
            if not a.get("role"):
                problems.append(f"assets 条目 {a.get('asset_id')!r} 缺少 role")
            tr = a.get("transform")
            if not (isinstance(tr, (list, tuple)) and len(tr) == 16):
                problems.append(f"assets 条目 {a.get('asset_id')!r} 的 transform "
                                f"必须是 16 元行主序矩阵")

    lic = spec.get("license")
    if isinstance(lic, (list, tuple)):
        for l in lic:
            if not isinstance(l, dict):
                problems.append("license 的元素必须是 dict")
                continue
            if not l.get("asset_id"):
                problems.append("license 条目缺少 asset_id")
            if not l.get("license"):
                problems.append(f"license 条目 {l.get('asset_id')!r} 缺少 license")


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
    if isinstance(conds, dict):
        pass                      # v2 对象形态：逐字段校验交给 _validate_v2
    elif not isinstance(conds, (list, tuple)):
        problems.append("conditions 必须是列表或 {channels[], depth{...}} 对象")
    else:
        for c in conds:
            if c not in SUPPORTED_CONDITIONS:
                problems.append(f"不支持的条件通道 '{c}'（支持 {SUPPORTED_CONDITIONS}）")

    if int(spec.get("schema_version", 1) or 1) >= SHOT_SPEC_SCHEMA_VERSION:
        _validate_v2(spec, problems)
    return problems


# ------------------------------------------------------------------ 示例 spec
def build_demo_spec() -> dict:
    """造一个可运行的示例镜头：车载相机跟着 car_a 走完「直线 -> 右转 -> 刹车停车」。

    轨迹直接取自 vehicle_dynamics.build_demo_trajectory()，
    因此 shot_spec 与 vehicle_dynamics 共享同一条真相，不会各说各话。
    """
    traj = build_demo_trajectory()
    assets = _scene_assets()
    asset_ids = [a["asset_id"] for a in assets]
    spec = {
        "kind": "shot_spec",
        "schema_version": SHOT_SPEC_SCHEMA_VERSION,
        "shot_id": "S03",
        "status": "draft",
        "fps": traj["fps"],
        "duration_s": traj["duration_s"],
        "resolution": list(DEFAULT_RESOLUTION),
        "up_axis": CONTRACT_UP_AXIS,
        "assets": assets,
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
            "move": {"type": "follow", "easing": "smoothstep"},
            "focal_mm": 35.0,
            "sensor_width_mm": 36.0,
            "f_px": DEFAULT_F_PX,
            "near": 0.0,      # 下面按场景包络回填
            "far": 0.0,
        },
        "actors": [
            {"asset": "car_a", "track": traj["track"]},
        ],
        "conditions": {
            "channels": list(SUPPORTED_CONDITIONS),
            "depth": {"near": 0.0, "far": 0.0, "encoding": DEPTH_POLARITY},
            "mask_semantics": dict(MASK_SEMANTICS),
            "palette_version": SEG_PALETTE_ID,
        },
        "timeline": {"events": _timeline_events(float(traj["duration_s"]))},
        "validation": {
            "report_path": "assets/validation/shot_spec_report.json",
            "pass": False,
            "checks": [],
        },
        "license": _shot_licenses(asset_ids),
        "notes": "车载镜头：相机位姿由 car_a 的刚体变换 M(t) 推出；"
                 "轨迹覆盖 [0, 8.0] s，含直线、右转 90 度、减速停车、静止保持四段",
    }
    near, far = _scene_depth_range(spec)
    spec["camera"]["near"] = near
    spec["camera"]["far"] = far
    spec["camera"]["depth_range_source"] = {
        "method": "scene_layout 实例包围盒沿相机前向轴的包络（逐帧求 min/max）",
        "clamp_near_m": 0.05,
        "note": "相机在 car_a 包围盒内部，最近几何由 clamp 下限给出；"
                "渲染时以 sidecar 的 near/far 为准",
    }
    spec["conditions"]["depth"]["near"] = near
    spec["conditions"]["depth"]["far"] = far
    return spec


# ------------------------------------------------------------------ CLI
def main(argv=None):
    ap = argparse.ArgumentParser(description="镜头描述（shot spec）工具")
    ap.add_argument("--demo", action="store_true", help="写出示例 spec 到 assets/validation/shot_spec.json")
    ap.add_argument("--out", default=os.path.join(VAL, "shot_spec.json"))
    args = ap.parse_args(argv)

    spec = build_demo_spec()
    problems = validate_spec(spec)
    samples = sample_shot(spec)
    report_path = "assets/validation/shot_spec_report.json"
    doc = dict(spec)
    doc["camera_samples"] = samples
    doc["status"] = "validated" if not problems else "draft"
    checks = _schema_checks(doc, problems)
    doc["validation"] = {"report_path": report_path, "pass": not problems,
                         "checks": checks, "problems": problems,
                         "frames": len(samples)}
    doc["downstream_hint"] = ("resolve_camera(spec, t, actor_transforms_at(spec, t)) "
                              "直接得到世界坐标镜头；camera_samples 是预烘焙的逐帧结果")

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)

    report = {"kind": "shot_spec_validation", "cpu_only": True,
              "shot_id": spec.get("shot_id"),
              "schema_version": spec.get("schema_version"),
              "pass": not problems, "problems": problems, "checks": checks,
              "frames": len(samples)}
    report_abs = os.path.join(ROOT, report_path)
    os.makedirs(os.path.dirname(report_abs), exist_ok=True)
    with open(report_abs, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(json.dumps({k: v for k, v in spec.items() if k != "actors"}, ensure_ascii=False, indent=2))
    print("actors:", [(a["asset"], len(a["track"])) for a in spec["actors"]])
    print("validation problems:", problems)
    print("first sample:", json.dumps(samples[0], ensure_ascii=False))
    print("last  sample:", json.dumps(samples[-1], ensure_ascii=False))
    print("written", args.out)
    return 0 if not problems else 1


if __name__ == "__main__":
    raise SystemExit(main())
