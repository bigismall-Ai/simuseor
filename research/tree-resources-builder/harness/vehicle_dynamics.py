"""载具时序信号推导：从轨迹（位置 + 航向）确定性推出每帧的驾驶动态量。

用途：
  为「车载镜头」提供可复现的时序信号——车速、加速度、横摆角速度、轮转角、
  刹车灯、转向灯以及悬挂姿态（俯仰/侧倾）。这些量全部由几何轨迹唯一决定，
  不需要额外的动画数据，因此渲染器、验证器、报告页都能从同一份轨迹得到
  逐位一致的结果。

用法：
  python vehicle_dynamics.py --demo          # 造示例轨迹并写出 assets/nongeometry/vehicle_dynamics.json
  from vehicle_dynamics import build_demo_trajectory, derive_dynamics, sample_track

设计理由：
  1) 只依赖 numpy + 标准库，链路里不出现随机源：同一轨迹必然得到相同输出，
     便于回归对比与跨进程校验（验收标准 6）。
  2) speed / accel / yaw_rate 全部是轨迹的有限差分，不做额外的美化平滑，
     保证「位移 ↔ 速度 ↔ 加速度」三者严格自洽，可以直接反算校验。
  3) 悬挂姿态单独走一阶低通（时间常数固定 0.25 s），把加速度序列里的
     有限差分毛刺压成小角度；低通系数按每步 dt 精确离散，与帧率无关。
  4) 轨迹约定与本项目白模一致：米制、+Z 向上、航向 yaw 为绕 +Z 的角度，
     载具局部 +X 为车头方向；yaw 增大即左转，减小即右转。
"""
from __future__ import annotations

import argparse
import json
import math
import os

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NGEO = os.path.join(ROOT, "assets", "nongeometry")

# ------------------------------------------------------------------ 参数
WHEEL_RADIUS_M = 0.32          # 车轮半径，直接决定轮转角
BRAKE_ACCEL_THRESHOLD = -2.0   # 低于该加速度视为踩刹车（m/s^2）
TURN_SIGNAL_YAW_RATE = 8.0     # 超过该横摆角速度视为需要打转向灯（deg/s）
TURN_SIGNAL_HZ = 1.2           # 转向灯闪烁频率
SUSPENSION_TAU_S = 0.25        # 悬挂一阶低通时间常数
PITCH_GAIN = 1.0               # 纵向加速度 -> 俯仰角（deg / (m/s^2)），正值表示抬头
ROLL_GAIN = 0.45               # 横向加速度 -> 侧倾角（deg / (m/s^2)），正值表示右侧下沉

# 轨迹位置保留的小数位：位置量化误差会被 1/dt 放大成速度噪声，
# 6 位小数会让 8 m/s 的匀速段出现 1.4e-4 m/s 的假抖动，9 位可压到 1e-8 量级。
TRACK_DECIMALS = 9
SIGNAL_DECIMALS = 6

# 示例轨迹的分段时间点（秒）与巡航速度，供 CLI / 测试共享，避免各处各写一份
DEMO_SPEED_MPS = 6.5
DEMO_TURN0_S = 3.0
DEMO_TURN1_S = 5.0
DEMO_STOP_S = 7.5
DEMO_DURATION_S = 8.0

# ------------------------------------------------------------------ 轨迹工具
def wrap180(deg: float) -> float:
    """把角度折到 (-180, 180]，用于跨 ±180° 的最短弧插值。"""
    return (float(deg) + 180.0) % 360.0 - 180.0


def _track_arrays(track):
    """把轨迹统一成 (时间, 位置, 航向) 三组数组，并按时间升序排列。"""
    items = sorted(track, key=lambda k: float(k["t"]))
    ts = np.array([float(k["t"]) for k in items], float)
    pos = np.array([[float(c) for c in k["pos"]] for k in items], float)
    yaw = np.array([float(k.get("yaw_deg", 0.0)) for k in items], float)
    return ts, pos, yaw


def sample_track(track, t: float):
    """在时刻 t 采样轨迹，返回 (位置(3,), 航向角(deg))。

    位置线性插值、航向按最短弧插值：航向插值若不折角，轨迹从 179° 穿到 -179°
    时相机会绕远路转 358°，与真实车辆行为不符。
    """
    ts, pos, yaw = _track_arrays(track)
    if len(ts) == 0:
        raise ValueError("空轨迹")
    if t <= ts[0]:
        return pos[0].copy(), float(yaw[0])
    if t >= ts[-1]:
        return pos[-1].copy(), float(yaw[-1])
    i = int(np.searchsorted(ts, t, side="right"))
    i = max(1, min(i, len(ts) - 1))
    t0, t1 = ts[i - 1], ts[i]
    u = 0.0 if t1 <= t0 else float((t - t0) / (t1 - t0))
    p = pos[i - 1] + (pos[i] - pos[i - 1]) * u
    dy = wrap180(yaw[i] - yaw[i - 1])
    return p, float(yaw[i - 1] + dy * u)


def track_to_matrix(pos, yaw_deg: float) -> np.ndarray:
    """(位置, 航向) -> 4x4 刚体变换。

    行列约定与 scene_layout.json 一致：行主序展开、平移在最后一列，
    作用方式是 p_world = M @ p_local（列向量约定）。
    """
    m = np.eye(4)
    a = math.radians(float(yaw_deg))
    c, s = math.cos(a), math.sin(a)
    m[0, 0], m[0, 1] = c, -s
    m[1, 0], m[1, 1] = s, c
    m[0, 3], m[1, 3], m[2, 3] = float(pos[0]), float(pos[1]), float(pos[2])
    return m


# ------------------------------------------------------------------ 动态量
def _lowpass(x: np.ndarray, dts: np.ndarray, tau: float) -> np.ndarray:
    """一阶低通 y' = (x - y) / tau 的精确离散。

    逐帧用 dt/tau 做指数逼近而不是固定系数，换帧率时物理含义保持不变；
    初值取 x[0]，避免镜头挂载瞬间出现假的起步俯冲。
    """
    y = np.zeros_like(x)
    if len(x) == 0:
        return y
    y[0] = x[0]
    for i in range(1, len(x)):
        a = dts[i - 1] / tau
        y[i] = y[i - 1] + a * (x[i] - y[i - 1])
    return y


def derive_dynamics(track, wheel_radius_m: float = WHEEL_RADIUS_M,
                     brake_accel_threshold: float = BRAKE_ACCEL_THRESHOLD,
                     turn_signal_yaw_rate: float = TURN_SIGNAL_YAW_RATE,
                     turn_signal_hz: float = TURN_SIGNAL_HZ,
                     suspension_tau_s: float = SUSPENSION_TAU_S) -> dict:
    """把轨迹推导成逐帧动态信号。

    返回 {"frames": [...], "track": [...], "params": {...}}，frames 与输入轨迹
    逐点一一对应（同一时间序列），因此可以直接按下标对齐使用。
    """
    ts, pos, yaw = _track_arrays(track)
    n = len(ts)
    if n < 2:
        raise ValueError("轨迹至少需要 2 个采样点")
    dts = np.diff(ts)

    # 速度：相邻帧位移 / dt；末帧沿用最后一段（区间平均速度的定义使末帧无后继）
    seg = np.linalg.norm(np.diff(pos, axis=0), axis=1)
    speed = np.concatenate([seg / dts, [seg[-1] / dts[-1]]])
    vel = np.diff(pos, axis=0) / dts[:, None]
    vel = np.vstack([vel, vel[-1:]])

    # 标量加速度：speed 的差分（正值=加速，负值=减速）
    accel = np.zeros(n)
    accel[1:] = np.diff(speed) / dts

    # 横摆角速度：航向差分 / dt
    dyaw = np.array([wrap180(yaw[i + 1] - yaw[i]) for i in range(n - 1)])
    yaw_rate = np.concatenate([dyaw / dts, [dyaw[-1] / dts[-1]]])

    # 轮转角：累计弧长 / 轮半径
    arc = np.concatenate([[0.0], np.cumsum(seg)])
    wheel_angle = np.degrees(arc / float(wheel_radius_m))

    # 世界加速度向量：与标量加速度不同，匀速转弯时它不为零（纯横向）
    avec = np.zeros((n, 3))
    avec[1:] = np.diff(vel, axis=0) / dts[:, None]

    # 分解到车身坐标系：+X 车头，+Y 左侧
    rad = np.radians(yaw)
    fwd = np.column_stack([np.cos(rad), np.sin(rad), np.zeros(n)])
    left = np.column_stack([-np.sin(rad), np.cos(rad), np.zeros(n)])
    a_long = np.einsum("ij,ij->i", avec, fwd)
    a_lat = np.einsum("ij,ij->i", avec, left)

    # 悬挂姿态：加速度 -> 小角度，再过一阶低通
    pitch = _lowpass(PITCH_GAIN * a_long, dts, float(suspension_tau_s))
    roll = _lowpass(ROLL_GAIN * a_lat, dts, float(suspension_tau_s))

    brake = accel < float(brake_accel_threshold)
    # 转向灯：只在真的需要转向时按固定频率闪，相位用时间本身决定（可复现）
    blink = np.sin(2.0 * math.pi * float(turn_signal_hz) * ts) > 0.0
    turn = (np.abs(yaw_rate) > float(turn_signal_yaw_rate)) & blink

    frames = []
    for i in range(n):
        frames.append({
            "t": round(float(ts[i]), SIGNAL_DECIMALS),
            "speed_mps": round(float(speed[i]), SIGNAL_DECIMALS),
            "accel_mps2": round(float(accel[i]), SIGNAL_DECIMALS),
            "yaw_rate_degps": round(float(yaw_rate[i]), SIGNAL_DECIMALS),
            "wheel_angle_deg": round(float(wheel_angle[i]), SIGNAL_DECIMALS),
            "brake_light": bool(brake[i]),
            "turn_signal": bool(turn[i]),
            "pitch_deg": round(float(pitch[i]), SIGNAL_DECIMALS),
            "roll_deg": round(float(roll[i]), SIGNAL_DECIMALS),
        })
    return {
        "frames": frames,
        "track": [{"t": round(float(ts[i]), TRACK_DECIMALS),
                   "pos": [round(float(c), TRACK_DECIMALS) for c in pos[i]],
                   "yaw_deg": round(float(yaw[i]), TRACK_DECIMALS)} for i in range(n)],
        "params": {
            "wheel_radius_m": float(wheel_radius_m),
            "brake_accel_threshold_mps2": float(brake_accel_threshold),
            "turn_signal_yaw_rate_degps": float(turn_signal_yaw_rate),
            "turn_signal_hz": float(turn_signal_hz),
            "suspension_tau_s": float(suspension_tau_s),
            "pitch_gain_deg_per_mps2": PITCH_GAIN,
            "roll_gain_deg_per_mps2": ROLL_GAIN,
        },
    }


# ------------------------------------------------------------------ 示例轨迹
def build_demo_trajectory(fps: int = 24, duration_s: float = DEMO_DURATION_S,
                          start_pos=(0.0, 0.0, 0.0), start_yaw_deg: float = 0.0,
                          speed_mps: float = DEMO_SPEED_MPS, turn_deg: float = -90.0,
                          t_turn0: float = DEMO_TURN0_S, t_turn1: float = DEMO_TURN1_S,
                          t_stop: float = DEMO_STOP_S) -> dict:
    """造一条「沿街直线 -> 右转 -> 减速停车」的示例轨迹。

    四段：直行（恒速）-> 右转 90 度（恒速恒横摆角速度）-> 匀减速到 0 -> 静止保持。
    段与段之间速度连续，因此差分出来的加速度只在减速段明显为负，
    刹车灯只在真正需要刹车时才亮——这正是信号应当具备的可信度。
    末尾留一段静止，是为了让「停住」这件事在逐帧数据里是可见的
    （速度严格为 0），而不是「恰好在最后一帧才到 0」。
    """
    fps = int(fps)
    n = int(round(fps * float(duration_s)))
    ts = np.arange(n + 1, dtype=float) / fps      # 含终点，轨迹覆盖 [0, duration_s]

    p0 = np.array([float(c) for c in start_pos], float)
    psi0 = math.radians(float(start_yaw_deg))
    t_turn0 = min(float(t_turn0), float(duration_s))
    t_turn1 = min(float(t_turn1), float(duration_s))
    t_turn1 = max(t_turn1, t_turn0 + 1e-3)
    t_stop = min(float(t_stop), float(duration_s))
    t_stop = max(t_stop, t_turn1 + 1e-3)
    decel_time = max(t_stop - t_turn1, 1e-6)
    accel_decel = -speed_mps / decel_time        # 匀减速到 0

    omega = math.radians(float(turn_deg)) / (t_turn1 - t_turn0)  # 负值=右转
    psi1 = psi0 + omega * (t_turn1 - t_turn0)

    # 位置一律在世界坐标系里积分：dp/dt = v * (cos yaw, sin yaw)。
    # 若改在车身系积分再旋转，航向为非零时会二次旋转，轨迹与航向自相矛盾。
    dir0 = np.array([math.cos(psi0), math.sin(psi0)])
    dir1 = np.array([math.cos(psi1), math.sin(psi1)])
    p_turn0 = p0[:2] + dir0 * (speed_mps * t_turn0)
    p_turn1 = p_turn0 + (speed_mps / omega) * np.array([math.sin(psi1) - math.sin(psi0),
                                                         -(math.cos(psi1) - math.cos(psi0))])
    s_stop = speed_mps * decel_time + 0.5 * accel_decel * decel_time ** 2
    p_stop = p_turn1 + dir1 * s_stop

    pts = []
    for t in ts:
        if t <= t_turn0:
            world = p0[:2] + dir0 * (speed_mps * t)
            yaw = psi0
        elif t <= t_turn1:
            tau = t - t_turn0
            # 车身以恒定横摆角速度行驶：位置是航向的积分，闭式解保证速度严格连续
            yaw = psi0 + omega * tau
            world = p_turn0 + (speed_mps / omega) * np.array(
                [math.sin(yaw) - math.sin(psi0), -(math.cos(yaw) - math.cos(psi0))])
        elif t <= t_stop:
            tau = t - t_turn1
            s = speed_mps * tau + 0.5 * accel_decel * tau * tau
            world = p_turn1 + dir1 * s
            yaw = psi1
        else:
            world = p_stop
            yaw = psi1
        pts.append({"t": round(float(t), TRACK_DECIMALS),
                    "pos": [round(float(world[0]), TRACK_DECIMALS),
                            round(float(world[1]), TRACK_DECIMALS),
                            round(float(p0[2]), TRACK_DECIMALS)],
                    "yaw_deg": round(math.degrees(yaw) % 360.0, TRACK_DECIMALS)})
    return {"fps": fps, "duration_s": float(duration_s), "track": pts}


# ------------------------------------------------------------------ CLI
def main(argv=None):
    ap = argparse.ArgumentParser(description="载具时序信号推导")
    ap.add_argument("--demo", action="store_true", help="生成示例轨迹并写出 JSON")
    ap.add_argument("--out", default=os.path.join(NGEO, "vehicle_dynamics.json"))
    args = ap.parse_args(argv)

    traj = build_demo_trajectory()
    dyn = derive_dynamics(traj["track"])
    doc = {
        "kind": "vehicle_dynamics",
        "asset": "car_a",
        "fps": traj["fps"],
        "duration_s": traj["duration_s"],
        "wheel_radius_m": WHEEL_RADIUS_M,
        "params": dyn["params"],
        "segments": [
            {"name": "straight", "t_range": [0.0, DEMO_TURN0_S], "note": "恒速直线"},
            {"name": "right_turn", "t_range": [DEMO_TURN0_S, DEMO_TURN1_S],
             "note": "右转 90 度，恒定横摆角速度"},
            {"name": "brake_to_stop", "t_range": [DEMO_TURN1_S, DEMO_STOP_S],
             "note": "匀减速至停车"},
            {"name": "stopped", "t_range": [DEMO_STOP_S, traj["duration_s"]],
             "note": "静止保持"},
        ],
        "track": dyn["track"],
        "frames": dyn["frames"],
        "summary": _summarize(dyn["frames"]),
        "downstream_hint": "车载镜头的速度/刹车灯/转向灯/俯仰侧倾信号源；"
                           "与 shot_spec.json 的 actors 轨迹同源，可直接对齐帧号",
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
    print(json.dumps(doc["summary"], ensure_ascii=False, indent=2))
    print("written", args.out)
    return 0


def _summarize(frames):
    speed = np.array([f["speed_mps"] for f in frames])
    accel = np.array([f["accel_mps2"] for f in frames])
    yaw_rate = np.array([f["yaw_rate_degps"] for f in frames])
    return {
        "frames": len(frames),
        "max_speed_mps": round(float(speed.max()), 4),
        "min_speed_mps": round(float(speed.min()), 4),
        "min_accel_mps2": round(float(accel.min()), 4),
        "max_abs_yaw_rate_degps": round(float(np.abs(yaw_rate).max()), 4),
        "brake_frames": int(sum(1 for f in frames if f["brake_light"])),
        "turn_signal_frames": int(sum(1 for f in frames if f["turn_signal"])),
        "max_abs_pitch_deg": round(float(np.abs([f["pitch_deg"] for f in frames]).max()), 4),
        "max_abs_roll_deg": round(float(np.abs([f["roll_deg"] for f in frames]).max()), 4),
        # 累计弧长可由轮转角反推：角度 = 弧长 / 轮半径
        "total_arc_m": round(math.radians(float(frames[-1]["wheel_angle_deg"])) * WHEEL_RADIUS_M, 4),
    }


if __name__ == "__main__":
    raise SystemExit(main())
