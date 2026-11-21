"""shot_spec / vehicle_dynamics 的验收单元测试。

用途：
  把「车载镜头结构地基」的验收标准固化成可重复执行的断言：
  挂载相机的矩阵推导、静止载具的相机恒定、右转 90° 的朝向旋转，
  以及动力学信号在匀速段/减速段的正确性。

用法：
  python test_shot_spec.py        # 打印每条验收标准的实测数字
  pytest test_shot_spec.py        # 同样可被 pytest 收集

设计理由：
  1) 关键矩阵在测试里手工拼装，不用被测模块自己的函数，
     否则「实现和期望同源」会让测试永远通过。
  2) 每个测试把实测数字记进 _MEASURED（pytest 要求测试函数返回 None），
     汇报时可以直接引用真实数值。
  3) 只依赖 numpy + 标准库，与被测模块保持同一套依赖边界。
"""
from __future__ import annotations

import inspect
import json
import math
import os
import sys

import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import shot_spec  # noqa: E402
import vehicle_dynamics as vd  # noqa: E402

# 实测数字统一记在这里，由 main() 统一打印
_MEASURED = {}
_CURRENT = [""]


def _record(info: dict) -> None:
    _MEASURED[_CURRENT[0]] = info


# ------------------------------------------------------------------ 手工参考实现
def manual_matrix(pos, yaw_deg: float) -> np.ndarray:
    """手工拼 4x4 变换（列向量约定），刻意不复用被测模块的实现。"""
    a = math.radians(float(yaw_deg))
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0.0, float(pos[0])],
                     [s,  c, 0.0, float(pos[1])],
                     [0.0, 0.0, 1.0, float(pos[2])],
                     [0.0, 0.0, 0.0, 1.0]])


def mounted_spec(eye_local, target_local, track, asset="car_a", focal=35.0):
    """构造一个最小可用的 mounted 模式 spec。"""
    return {
        "kind": "shot_spec",
        "shot_id": "T",
        "fps": 24,
        "duration_s": float(track[-1]["t"]),
        "camera": {
            "mode": "mounted",
            "mount": {"asset": asset, "eye_local": list(eye_local),
                      "target_local": list(target_local), "up": [0, 0, 1]},
            "focal_mm": focal,
        },
        "actors": [{"asset": asset, "track": list(track)}],
        "conditions": ["depth", "normal", "seg"],
    }


def straight_track(duration_s=4.0, fps=24, speed=8.0):
    n = int(round(fps * duration_s))
    return [{"t": round(i / fps, 6), "pos": [speed * i / fps, 0.0, 0.0],
             "yaw_deg": 0.0} for i in range(n + 1)]


def right_turn_track(duration_s=4.0, fps=24, speed=8.0, turn_start=1.0, turn_deg=-90.0):
    """直线后接一段固定角速度的右转，转角由 yaw 精确给定。"""
    n = int(round(fps * duration_s))
    turn_end = min(turn_start + abs(turn_deg) / 45.0, duration_s)
    pts = []
    for i in range(n + 1):
        t = round(i / fps, 6)
        if t <= turn_start:
            pts.append({"t": t, "pos": [speed * t, 0.0, 0.0], "yaw_deg": 0.0})
            continue
        yaw = turn_deg if t >= turn_end else -45.0 * (t - turn_start)
        pts.append({"t": t, "pos": [speed * t, 0.0, 0.0], "yaw_deg": yaw})
    return pts


def signed_angle_deg(a, b) -> float:
    """两个水平方向向量之间的有符号夹角（绕 +Z，正为左转）。"""
    a = np.asarray(a, float)[:2]
    b = np.asarray(b, float)[:2]
    cross = a[0] * b[1] - a[1] * b[0]
    dot = float(a @ b)
    return math.degrees(math.atan2(cross, dot))


# ------------------------------------------------------------------ 验收 1
def test_mounted_matches_manual_matrix():
    """验收 1：mounted 模式的 world_eye 与手算 M(t) @ eye_local 误差 < 1e-9。"""
    track = [{"t": 0.0, "pos": [3.0, -4.0, 0.0], "yaw_deg": 0.0},
             {"t": 1.0, "pos": [7.0, 2.0, 0.0], "yaw_deg": -30.0},
             {"t": 2.0, "pos": [9.0, -1.0, 0.0], "yaw_deg": 45.0}]
    eye_local = [0.36, 0.0, 1.15]
    target_local = [8.0, 0.0, 1.05]
    spec = mounted_spec(eye_local, target_local, track)

    worst_eye = 0.0
    worst_target = 0.0
    worst_auto = 0.0
    for k in track:
        t = float(k["t"])
        m = manual_matrix(k["pos"], k["yaw_deg"])
        cam = shot_spec.resolve_camera(spec, t, {"car_a": m})
        expect_eye = m @ np.array([eye_local[0], eye_local[1], eye_local[2], 1.0])
        expect_target = m @ np.array([target_local[0], target_local[1], target_local[2], 1.0])
        worst_eye = max(worst_eye, float(np.max(np.abs(cam["eye"] - expect_eye[:3]))))
        worst_target = max(worst_target, float(np.max(np.abs(cam["target"] - expect_target[:3]))))
        # 内部从轨迹求出的变换也要与手算一致（插值路径）
        auto = shot_spec.actor_transforms_at(spec, t)["car_a"]
        worst_auto = max(worst_auto, float(np.max(np.abs(auto - m))))

    assert worst_eye < 1e-9, f"world_eye 误差 {worst_eye}"
    assert worst_target < 1e-9, f"world_target 误差 {worst_target}"
    assert worst_auto < 1e-9, f"轨迹插值出的 M(t) 误差 {worst_auto}"
    assert abs(shot_spec.resolve_camera(spec, 0.0, {"car_a": manual_matrix(track[0]["pos"], 0.0)})["focal_mm"] - 35.0) < 1e-12
    _record({
        "world_eye_max_err": worst_eye,
        "world_target_max_err": worst_target,
        "track_interp_matrix_max_err": worst_auto,
    })


# ------------------------------------------------------------------ 验收 2
def test_static_vehicle_camera_constant():
    """验收 2：载具静止（轨迹无位移）时，相机世界坐标逐帧恒定。"""
    track = [{"t": round(i / 24, 6), "pos": [5.0, -2.0, 0.0], "yaw_deg": 30.0}
             for i in range(25)]
    spec = mounted_spec([0.36, 0.0, 1.15], [8.0, 0.0, 1.05], track)
    eyes = []
    targets = []
    for i in range(25):
        cam = shot_spec.resolve_camera(spec, i / 24.0, shot_spec.actor_transforms_at(spec, i / 24.0))
        eyes.append(cam["eye"])
        targets.append(cam["target"])
    eyes = np.array(eyes)
    targets = np.array(targets)
    dev_eye = float(np.max(np.abs(eyes - eyes[0])))
    dev_target = float(np.max(np.abs(targets - targets[0])))
    assert dev_eye < 1e-12, f"静止时眼点漂移 {dev_eye}"
    assert dev_target < 1e-12, f"静止时注视点漂移 {dev_target}"
    _record({"eye_max_drift_m": dev_eye, "target_max_drift_m": dev_target,
             "frames": len(eyes)})


# ------------------------------------------------------------------ 验收 3
def test_right_turn_rotates_view_90deg():
    """验收 3：载具右转 90° 时，相机朝向向量也转过 90°，误差 < 1e-6。"""
    track = right_turn_track()
    # 水平挂载：eye 与 target 同高，朝向向量完全落在水平面内，旋转角可精确比较
    spec = mounted_spec([0.36, 0.0, 1.15], [8.36, 0.0, 1.15], track)
    t0 = 0.0
    t1 = float(track[-1]["t"])
    c0 = shot_spec.resolve_camera(spec, t0, shot_spec.actor_transforms_at(spec, t0))
    c1 = shot_spec.resolve_camera(spec, t1, shot_spec.actor_transforms_at(spec, t1))
    d0 = c0["target"] - c0["eye"]
    d1 = c1["target"] - c1["eye"]
    ang = signed_angle_deg(d0, d1)
    err = abs(abs(ang) - 90.0)
    assert err < 1e-6, f"朝向旋转角 {ang} 偏离 90° 达 {err}"
    assert ang < 0, "右转应为负角（绕 +Z 顺时针）"

    # 3D 全向量夹角（水平挂载时与水平投影角一致）
    cosang = float(np.dot(d0, d1) / (np.linalg.norm(d0) * np.linalg.norm(d1)))
    ang3d = abs(math.degrees(math.acos(max(-1.0, min(1.0, cosang)))))
    err3d = abs(ang3d - 90.0)
    assert err3d < 1e-6, f"3D 夹角 {ang3d} 偏离 90° 达 {err3d}"

    # 示例 spec（视线略微下倾）的水平投影同样精确转 90°
    demo = shot_spec.build_demo_spec()
    cd0 = shot_spec.resolve_camera(demo, 0.0, shot_spec.actor_transforms_at(demo, 0.0))
    cd1 = shot_spec.resolve_camera(demo, 5.0, shot_spec.actor_transforms_at(demo, 5.0))
    ang_demo = signed_angle_deg(cd1["target"] - cd1["eye"], cd0["target"] - cd0["eye"])
    err_demo = abs(abs(ang_demo) - 90.0)
    assert err_demo < 1e-6, f"示例 spec 朝向旋转 {ang_demo} 偏离 90° 达 {err_demo}"
    _record({"view_rotation_deg": ang, "abs_err_vs_90_deg": err,
             "view_rotation_3d_deg": ang3d, "demo_spec_rotation_deg": ang_demo})


# ------------------------------------------------------------------ 验收 4
def test_dynamics_constant_speed_segment():
    """验收 4：匀速直线段 speed 恒定、yaw_rate == 0、brake_light 全 false。"""
    traj = vd.build_demo_trajectory()
    dyn = vd.derive_dynamics(traj["track"])
    frames = dyn["frames"]
    fps = traj["fps"]
    cruise = vd.DEMO_SPEED_MPS
    straight = [f for f in frames if f["t"] <= vd.DEMO_TURN0_S - 1.0 / fps + 1e-12]
    assert straight, "没有落在匀速直线段内的帧"
    speeds = np.array([f["speed_mps"] for f in straight])
    yaw_rates = np.array([f["yaw_rate_degps"] for f in straight])
    spread = float(speeds.max() - speeds.min())
    max_dev = float(np.max(np.abs(speeds - cruise)))
    max_yaw = float(np.max(np.abs(yaw_rates)))
    brakes = sum(1 for f in straight if f["brake_light"])
    assert spread < 1e-6, f"匀速段速度波动 {spread}"
    assert max_dev < 1e-6, f"匀速段速度偏离 {cruise} m/s 达 {max_dev}"
    assert max_yaw == 0.0, f"匀速段横摆角速度 {max_yaw}"
    assert brakes == 0, f"匀速段出现 {brakes} 帧刹车灯"
    _record({"straight_frames": len(straight), "speed_spread_mps": spread,
             "speed_max_dev_mps": max_dev, "cruise_speed_mps": cruise,
             "max_abs_yaw_rate_degps": max_yaw, "brake_frames": brakes})


# ------------------------------------------------------------------ 验收 5
def test_dynamics_brake_light_in_decel():
    """验收 5：减速段 brake_light 至少有一帧为 true。"""
    traj = vd.build_demo_trajectory()
    dyn = vd.derive_dynamics(traj["track"])
    frames = dyn["frames"]
    decel = [f for f in frames if f["t"] >= vd.DEMO_TURN1_S]
    brake_frames = [f for f in decel if f["brake_light"]]
    accels = np.array([f["accel_mps2"] for f in decel])
    assert brake_frames, "减速段没有任何一帧点亮刹车灯"
    assert float(accels.min()) < vd.BRAKE_ACCEL_THRESHOLD, accels.min()
    # 末段必须真的停住（静止保持段速度严格为 0）
    stopped = [f for f in frames if f["t"] >= vd.DEMO_STOP_S]
    assert stopped and all(f["speed_mps"] == 0.0 for f in stopped), "静止段速度不为 0"
    assert frames[-1]["speed_mps"] == 0.0
    _record({"decel_frames": len(decel), "brake_frames": len(brake_frames),
             "min_accel_mps2": float(accels.min()),
             "final_speed_mps": frames[-1]["speed_mps"],
             "stopped_frames": len(stopped)})


# ------------------------------------------------------------------ 验收 6
def test_no_heavy_dependencies():
    """验收 6：链路里只有 numpy（无 scipy / torch）。"""
    forbidden = ("scipy", "torch", "sklearn", "pandas")
    for mod in (shot_spec, vd):
        src = inspect.getsource(mod)
        for name in forbidden:
            assert f"import {name}" not in src, f"{mod.__name__} 引入了 {name}"
    loaded = [m for m in forbidden if m in sys.modules]
    assert not loaded, f"运行时加载了重依赖：{loaded}"
    assert "numpy" in sys.modules
    _record({"heavy_modules_loaded": loaded, "numpy_version": np.__version__})


# ------------------------------------------------------------------ 附加
def test_public_api_contract():
    """公开接口签名必须一字不差（另一个子代理按此 import）。"""
    sig = inspect.signature(shot_spec.resolve_camera)
    assert list(sig.parameters) == ["spec", "t", "asset_transforms"], sig
    assert sig.parameters["spec"].default is inspect.Parameter.empty
    assert sig.parameters["t"].default is inspect.Parameter.empty
    assert sig.parameters["asset_transforms"].default is inspect.Parameter.empty
    out = shot_spec.resolve_camera(shot_spec.build_demo_spec(), 0.0, {})
    assert set(out) == {"eye", "target", "focal_mm"}, sorted(out)
    assert np.asarray(out["eye"]).shape == (3,)
    assert np.asarray(out["target"]).shape == (3,)
    assert isinstance(out["focal_mm"], float)
    _record({"signature": str(sig), "return_keys": sorted(out)})


def test_validate_spec():
    """validate_spec 必须能挑出问题，且对示例 spec 不报错。"""
    demo = shot_spec.build_demo_spec()
    assert shot_spec.validate_spec(demo) == []

    bad = json.loads(json.dumps(demo))
    bad["camera"]["mount"]["asset"] = "car_zzz"
    assert any("car_zzz" in p for p in shot_spec.validate_spec(bad))

    bad = json.loads(json.dumps(demo))
    bad["camera"]["mount"]["eye_local"] = [0.36, 0.0, 1.9]
    assert any("眼点高度" in p for p in shot_spec.validate_spec(bad))

    bad = json.loads(json.dumps(demo))
    bad["actors"][0]["track"] = bad["actors"][0]["track"][:10]
    assert any("未覆盖" in p for p in shot_spec.validate_spec(bad))

    bad = json.loads(json.dumps(demo))
    bad["conditions"] = ["depth", "albedo"]
    assert any("albedo" in p for p in shot_spec.validate_spec(bad))
    _record({"demo_problems": shot_spec.validate_spec(demo)})


def test_world_mode_reuses_existing_camera_path():
    """world 模式必须能原样吃下现有 camera_path.json 的绝对关键帧。"""
    path = os.path.join(shot_spec.ROOT, "assets", "nongeometry", "camera_path.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    keys = data["keys"]
    spec = {
        "kind": "shot_spec", "shot_id": "W01", "fps": data["fps"],
        "duration_s": data["duration_s"],
        "camera": {"mode": "world", "keys": keys},
        "actors": [], "conditions": ["depth", "normal", "seg"],
    }
    worst = 0.0
    for k in keys:
        cam = shot_spec.resolve_camera(spec, float(k["t"]), {})
        worst = max(worst, float(np.max(np.abs(cam["eye"] - np.asarray(k["eye"], float)))))
        worst = max(worst, float(np.max(np.abs(cam["target"] - np.asarray(k["target"], float)))))
        worst = max(worst, abs(float(cam["focal_mm"]) - float(k["focal_mm"])))
    assert worst < 1e-9, f"关键帧处与世界关键帧不一致 {worst}"
    # 关键帧之间应当插出中间姿态
    t_mid = 0.5 * (float(keys[0]["t"]) + float(keys[1]["t"]))
    cam = shot_spec.resolve_camera(spec, t_mid, {})
    assert bool(np.linalg.norm(cam["eye"] - cam["target"]) > 1e-6)
    assert shot_spec.validate_spec(spec) == []
    _record({"keys": len(keys), "max_key_mismatch": worst,
             "mid_sample_eye": [round(float(v), 4) for v in cam["eye"]]})


def test_demo_artifacts_written():
    """两个交付产物必须落在指定路径且内容自洽。"""
    ng = os.path.join(shot_spec.ROOT, "assets", "nongeometry", "vehicle_dynamics.json")
    vp = os.path.join(shot_spec.ROOT, "assets", "validation", "shot_spec.json")
    for path in (ng, vp):
        assert os.path.exists(path), f"缺少产物 {path}（先跑对应的 --demo CLI）"
    with open(ng, encoding="utf-8") as f:
        dyn = json.load(f)
    with open(vp, encoding="utf-8") as f:
        spec = json.load(f)
    assert dyn["kind"] == "vehicle_dynamics"
    assert spec["kind"] == "shot_spec"
    # 同一份轨迹：两边的轨迹点必须逐点相同
    assert len(dyn["track"]) == len(spec["actors"][0]["track"])
    assert dyn["track"] == spec["actors"][0]["track"], "两侧轨迹不一致"
    assert spec["validation"]["pass"] is True
    _record({"vehicle_dynamics_json": ng, "shot_spec_json": vp,
             "track_points": len(dyn["track"]),
             "camera_samples": len(spec["camera_samples"])})


# ------------------------------------------------------------------ runner
def main():
    tests = [
        ("验收1 mounted 矩阵一致性", test_mounted_matches_manual_matrix),
        ("验收2 静止载具相机恒定", test_static_vehicle_camera_constant),
        ("验收3 右转 90° 朝向旋转", test_right_turn_rotates_view_90deg),
        ("验收4 匀速段动力学", test_dynamics_constant_speed_segment),
        ("验收5 减速段刹车灯", test_dynamics_brake_light_in_decel),
        ("验收6 依赖纯 numpy", test_no_heavy_dependencies),
        ("附加 公开接口契约", test_public_api_contract),
        ("附加 validate_spec", test_validate_spec),
        ("附加 world 模式复用相机路径", test_world_mode_reuses_existing_camera_path),
        ("附加 交付产物落盘", test_demo_artifacts_written),
    ]
    failed = 0
    for name, fn in tests:
        _CURRENT[0] = name
        try:
            fn()
        except AssertionError as exc:
            failed += 1
            print(f"[FAIL] {name}: {exc}")
            continue
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"[ERROR] {name}: {type(exc).__name__}: {exc}")
            continue
        print(f"[PASS] {name}")
        for k, v in (_MEASURED.get(name) or {}).items():
            print(f"        {k} = {v}")
    print(f"\n{len(tests) - failed}/{len(tests)} 通过")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
