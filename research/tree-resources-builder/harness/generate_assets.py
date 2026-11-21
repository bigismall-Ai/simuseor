"""确定性生成白模参考资产：几何 + 非几何（动作/相机/特效/布局）。

设计原则：
1. 每个资产由可读参数（配方）驱动，参数可被 LLM 直接改写；
2. 全部在 CPU 上执行，无随机数以外的外部输入（随机均固定种子）；
3. 几何与非几何资产使用同一套米制坐标系（+X 右 / +Y 前 / +Z 上），便于汇合。
"""
from __future__ import annotations

import json
import math
import os

import numpy as np
import trimesh
from PIL import Image, ImageDraw

from geomlib import (Camera, box, camera_fit, cylinder, ellipse_ring, export_glb,
                     export_obj, export_stl, loft, merge, R_axis, S, scene_glb,
                     segment, sphere, T, union)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO = os.path.join(ROOT, "assets", "geometry")
NGEO = os.path.join(ROOT, "assets", "nongeometry")
PREV = os.path.join(ROOT, "assets", "previews")


def wjson(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


# ------------------------------------------------------------------ 人物
HUMAN_JOINTS = [
    ("Root", None, (0.0, 0.0, 0.0)),
    ("Hips", "Root", (0.0, 0.0, 0.98)),
    ("Spine", "Hips", (0.0, 0.0, 0.13)),
    ("Chest", "Spine", (0.0, 0.0, 0.18)),
    ("Neck", "Chest", (0.0, 0.0, 0.18)),
    ("Head", "Neck", (0.0, 0.0, 0.15)),
    ("L_Shoulder", "Chest", (0.19, 0.0, 0.14)),
    ("L_Elbow", "L_Shoulder", (0.23, 0.01, -0.27)),
    ("L_Wrist", "L_Elbow", (0.16, 0.03, -0.25)),
    ("L_Hand", "L_Wrist", (0.03, 0.03, -0.09)),
    ("R_Shoulder", "Chest", (-0.19, 0.0, 0.14)),
    ("R_Elbow", "R_Shoulder", (-0.23, 0.01, -0.27)),
    ("R_Wrist", "R_Elbow", (-0.16, 0.03, -0.25)),
    ("R_Hand", "R_Wrist", (-0.03, 0.03, -0.09)),
    ("L_Hip", "Hips", (0.10, 0.0, -0.05)),
    ("L_Knee", "L_Hip", (0.01, 0.01, -0.43)),
    ("L_Ankle", "L_Knee", (0.0, 0.01, -0.42)),
    ("L_Toe", "L_Ankle", (0.0, 0.14, -0.04)),
    ("R_Hip", "Hips", (-0.10, 0.0, -0.05)),
    ("R_Knee", "R_Hip", (-0.01, 0.01, -0.43)),
    ("R_Ankle", "R_Knee", (0.0, 0.01, -0.42)),
    ("R_Toe", "R_Ankle", (0.0, 0.14, -0.04)),
]


def joint_world_positions():
    acc = {}
    out = {}
    for name, parent, off in HUMAN_JOINTS:
        base = np.zeros(3) if parent is None else acc[parent]
        pos = base + np.asarray(off, float)
        acc[name] = pos
        out[name] = pos
    return out


def human_proxy(height=1.75, arm_offset=0.0, lod="mid", yaw=0.0, gait=0.0):
    """体型化人偶白模。arm_offset>0 会制造「手臂脱离躯干」的缺陷用于验证演练。"""
    s = height / 1.75
    j = {k: v * s for k, v in joint_world_positions().items()}
    sec = {"mid": 16, "low": 10, "xlow": 8}[lod]
    sub = {"mid": 2, "low": 1, "xlow": 1}[lod]
    parts = {}

    torso_rings = []
    for z, rx, ry in ((0.93, 0.150, 0.100), (1.03, 0.142, 0.096),
                      (1.16, 0.165, 0.104), (1.32, 0.200, 0.112), (1.43, 0.180, 0.100)):
        torso_rings.append(ellipse_ring(rx * s, ry * s, z * s, sec, 2.6))
    parts["torso"] = loft(torso_rings)
    parts["pelvis"] = sphere(0.14 * s, center=(0, 0, 0.94 * s), subdiv=sub,
                             scale=(1.10, 0.80, 0.72))
    parts["neck"] = segment((0, 0, 1.40 * s), (0, 0, 1.52 * s), 0.050 * s, 0.046 * s, sec)
    parts["head"] = sphere(0.105 * s, center=(0, 0.005 * s, 1.625 * s), subdiv=sub,
                           scale=(0.92, 1.0, 1.10))
    for side, sx in (("L", 1.0), ("R", -1.0)):
        sh = j[f"{side}_Shoulder"]
        el = j[f"{side}_Elbow"]
        wr = j[f"{side}_Wrist"]
        hp = j[f"{side}_Hip"]
        kn = j[f"{side}_Knee"]
        an = j[f"{side}_Ankle"]
        lift = 1.0 if side == "L" else -1.0
        sh = sh + np.array([sx * arm_offset, 0, 0])
        el = el + np.array([sx * arm_offset, 0, 0])
        wr = wr + np.array([sx * arm_offset, 0, 0])
        # 步态：绕 X 轴摆腿/摆臂（gait 单位：度）
        swing = gait * lift
        parts[f"shoulder_{side}"] = sphere(0.075 * s, center=sh, subdiv=sub)
        parts[f"upperarm_{side}"] = segment(sh, el, 0.058 * s, 0.048 * s, sec)
        parts[f"elbow_{side}"] = sphere(0.047 * s, center=el, subdiv=sub)
        parts[f"forearm_{side}"] = segment(el, wr, 0.047 * s, 0.037 * s, sec)
        parts[f"hand_{side}"] = box((0.055 * s, 0.075 * s, 0.095 * s),
                                    center=(wr[0], wr[1], wr[2] - 0.05 * s))
        parts[f"thigh_{side}"] = segment(hp, kn, 0.085 * s, 0.061 * s, sec)
        parts[f"knee_{side}"] = sphere(0.060 * s, center=kn, subdiv=sub)
        parts[f"shin_{side}"] = segment(kn, an, 0.058 * s, 0.041 * s, sec)
        parts[f"foot_{side}"] = box((0.092 * s, 0.235 * s, 0.075 * s),
                                    center=(an[0], an[1] + 0.065 * s, 0.038 * s))

    if abs(gait) > 1e-6:
        for side, sx in (("L", 1.0), ("R", -1.0)):
            sw = math.radians(gait * sx)
            pivot = j[f"{side}_Hip"]
            for k in (f"thigh_{side}", f"knee_{side}", f"shin_{side}", f"foot_{side}"):
                parts[k] = _rotate_about_x(parts[k], pivot, sw)
    mesh = merge(parts.values())
    if abs(yaw) > 1e-6:
        mesh = _rotate_about_z(mesh, np.zeros(3), math.radians(yaw))
    return mesh, {"parts": parts, "joints": {k: v.tolist() for k, v in j.items()},
                  "height": height, "arm_offset": arm_offset}


def _rotate_about_x(mesh, pivot, ang):
    c, s_ = math.cos(ang), math.sin(ang)
    m = np.eye(4)
    m[1, 1], m[1, 2], m[2, 1], m[2, 2] = c, -s_, s_, c
    p = T(-pivot[0], -pivot[1], -pivot[2])
    return place_safe(mesh, T(*pivot) @ m @ p)


def _rotate_about_z(mesh, pivot, ang):
    m = R_axis("z", math.degrees(ang))
    p = T(-pivot[0], -pivot[1], -pivot[2])
    return place_safe(mesh, T(*pivot) @ m @ p)


def place_safe(mesh, m):
    out = mesh.copy()
    out.apply_transform(m)
    return out


def jacket(height=1.75, yaw=0.0):
    """服装白模：在人体底座外做偏移壳（外套）。"""
    s = height / 1.75
    rings = []
    for z, rx, ry in ((0.98, 0.185, 0.135), (1.10, 0.180, 0.130),
                      (1.24, 0.205, 0.140), (1.36, 0.235, 0.145), (1.45, 0.210, 0.130)):
        rings.append(ellipse_ring(rx * s, ry * s, z * s, 20, 2.6))
    body = loft(rings)
    j = {k: v * s for k, v in joint_world_positions().items()}
    parts = [body]
    for side in ("L", "R"):
        sh, el, wr = j[f"{side}_Shoulder"], j[f"{side}_Elbow"], j[f"{side}_Wrist"]
        parts.append(segment(sh + np.array([0, 0, 0.01]), el, 0.090 * s, 0.077 * s, 16))
        parts.append(segment(el, wr, 0.074 * s, 0.060 * s, 16))
    parts.append(segment((0, 0, 1.42 * s), (0, 0, 1.52 * s), 0.075 * s, 0.070 * s, 16))
    mesh = merge(parts)
    if abs(yaw) > 1e-6:
        mesh = _rotate_about_z(mesh, np.zeros(3), math.radians(yaw))
    return mesh


# ------------------------------------------------------------------ 道具
def prop_crate(size=0.62):
    """机械箱体：布尔并集（manifold 引擎，CPU）。"""
    h = size / 2
    parts = [box((size, size, size), center=(0, 0, h))]
    for x in (-h, h):
        for y in (-h, h):
            parts.append(box((0.06, 0.06, size + 0.02), center=(x, y, h)))
    for z in (0.10, size - 0.10):
        parts.append(box((size + 0.03, size + 0.03, 0.035), center=(0, 0, z)))
    for y in (-h - 0.02, h + 0.02):
        parts.append(box((0.34, 0.045, 0.05), center=(0, y, size - 0.10)))
    handle = box((0.22, 0.03, 0.035), center=(0, 0, size + 0.06))
    legs = [box((0.05, 0.05, 0.06), center=(x, y, size + 0.03)) for x in (-0.09, 0.09) for y in (-0.05, 0.05)]
    mesh = union(parts + [handle] + legs)
    return mesh, {"params": {"size": size}}


# ------------------------------------------------------------------ 载具
def _diff(mesh, cutters):
    try:
        return trimesh.boolean.difference([mesh, *cutters], engine="manifold")
    except Exception:
        return mesh


# 车门缝位置（同时作为车身 loft 的站位）。
# 为什么门缝必须当站位：门板要从车身自己的网格上切出来，边界正好落在门缝站位上，
# 这样门既不会穿模也不会错位（面板与车身共用同一套顶点，只是沿法线平移）。
CAR_DOOR_SEAMS = (-1.02, -0.08, 0.86)

# 门板相对车身的法向偏移（米）：
#   外偏移 10 mm → 门在剪影/深度图里独立可见，参考图里才学得出「门」；
#   内偏移 2 mm → 门板内表面不与车身共面（避免 z-fighting），也绝不穿进车身。
CAR_DOOR_OUT = 0.010
CAR_DOOR_IN = 0.002

# 门板覆盖的环向行号（28 点截面环的索引）：
#   左侧 [27,0,1,2,3,4]、右侧镜像 [15,14,13,12,11,10]，
#   从门槛上方一直到腰线，覆盖车身最平的那一段侧板。
CAR_DOOR_ROWS_LEFT = (27, 0, 1, 2, 3, 4)
CAR_DOOR_ROWS_RIGHT = (15, 14, 13, 12, 11, 10)


def _car_rings(xs_, ws_, hs_, zc_):
    """车身截面环：超椭圆（n=4）截面，28 点一圈。"""
    rings = []
    for x, w, hh, z in zip(xs_, ws_, hs_, zc_):
        t = np.linspace(0, 2 * np.pi, 28, endpoint=False)
        cy, sy = np.cos(t), np.sin(t)
        yy = w * np.sign(cy) * np.abs(cy) ** 0.5
        zz = (hh / 2) * np.sign(sy) * np.abs(sy) ** 0.5 + z
        rings.append(np.column_stack([np.full_like(t, x), yy, zz]))
    return rings


def _panel_from_grid(rings, zcs, i0, i1, js, out_off, in_off):
    """从车身 loft 网格上切出一块面板，沿法线加厚成有厚度的闭合板。

    为什么直接用车身顶点：面板与车身共用同一套网格点，沿法线的偏移量恒定，
    所以面板永远在车身外侧（不穿模），边界又正好落在门缝站位上（不错位）。
    """
    ni, nj = i1 - i0 + 1, len(js)
    P = np.array([[rings[i][j] for j in js] for i in range(i0, i1 + 1)], dtype=float)
    # 网格差分求顶点法线，再按「背离车轴」定向
    di = np.gradient(P, axis=0)
    dj = np.gradient(P, axis=1)
    N = np.cross(dj, di)
    # 「背离车轴」的向量：同一站位上车轴在 (0, 0, zc)，
    # 所以 rel = (0, y, z - zc)，用它把法线统一翻到朝外的一侧。
    rel = P.copy()
    rel[:, :, 0] = 0.0
    rel[:, :, 2] -= np.asarray(zcs[i0:i1 + 1], float)[:, None]
    flip = np.sum(N * rel, axis=-1) < 0
    N[flip] *= -1.0
    N /= np.maximum(np.linalg.norm(N, axis=-1, keepdims=True), 1e-12)

    outer = P + N * out_off
    inner = P + N * in_off
    verts = np.vstack([outer.reshape(-1, 3), inner.reshape(-1, 3)])
    off = ni * nj

    def idx(i, k):
        return i * nj + k

    def quad(a, b, c, d):
        return [[a, b, c], [a, c, d]]

    faces = []
    for i in range(ni - 1):
        for k in range(nj - 1):
            a, b = idx(i, k), idx(i + 1, k)
            c, d = idx(i + 1, k + 1), idx(i, k + 1)
            faces += quad(a, b, c, d)                      # 外表面
            faces += quad(a + off, d + off, c + off, b + off)  # 内表面（反向缠绕）
    # 四周侧壁，让门板成为闭合实体（水密，且在剪影里有厚度）。
    # 侧壁的绕向必须与外/内表面相反地走同一条边，否则整块面板的缠绕会自相矛盾，
    # 体积符号失去意义、法线翻转 → 渲染出来是一块黑面。
    loop = []
    loop += [(i, 0) for i in range(ni)]
    loop += [(ni - 1, k) for k in range(1, nj)]
    loop += [(i, nj - 1) for i in range(ni - 2, -1, -1)]
    loop += [(0, k) for k in range(nj - 2, 0, -1)]
    for t in range(len(loop)):
        a = idx(*loop[t])
        b = idx(*loop[(t + 1) % len(loop)])
        faces += quad(b, a, a + off, b + off)

    mesh = trimesh.Trimesh(vertices=verts, faces=np.array(faces, dtype=np.int64), process=False)
    if mesh.volume < 0:  # 左右两侧的网格绕向相反，用体积符号统一
        mesh.invert()
    # 面板必须水密且缠绕一致，否则渲染时是一块黑面（法线翻向）——直接报错，别静默出图
    if not (mesh.is_watertight and mesh.is_winding_consistent):
        raise RuntimeError("门面板网格不水密或缠绕不一致，请检查侧壁绕向")
    return mesh


def vehicle_car_parts(length=4.30, width=1.80, height=1.42):
    """程序化轿车 → 独立部件 mesh 字典（name → Trimesh）。

    为什么要拆件：治图/视频生成里的「车门漂移」不是精度不够，而是参考图里
    根本没有「门」这个可学结构——模型只看到「一整块车皮」，门就长在任意位置。
    这里把门（左右各两扇）、四个轮、后视镜、前后灯全部做成独立 mesh，
    导出的 GLB 是多 geometry 的 Scene，下游可以单独取用/替换门。
    """
    base_x = np.array([-2.15, -1.90, -1.25, -0.60, 0.0, 0.60, 1.25, 1.90, 2.15]) * (length / 4.3)
    base_w = np.array([0.30, 0.66, 0.84, 0.88, 0.88, 0.85, 0.76, 0.58, 0.40]) * (width / 1.8)
    base_h = np.array([0.26, 0.40, 0.50, 0.54, 0.55, 0.53, 0.48, 0.38, 0.24])
    base_z = np.array([0.55, 0.60, 0.62, 0.63, 0.64, 0.63, 0.60, 0.55, 0.48])
    seams = np.array(CAR_DOOR_SEAMS, dtype=float) * (length / 4.3)

    # 站位 = 原始站位 + 门缝站位。门缝必须是站位，门板才能与车身严格对齐。
    stations = np.unique(np.concatenate([base_x, seams]))
    ws = np.interp(stations, base_x, base_w)
    hs = np.interp(stations, base_x, base_h)
    zs = np.interp(stations, base_x, base_z)
    rings = _car_rings(stations, ws, hs, zs)

    body = loft(rings)
    # 抽壳：内腔缩短并收缩，保证四周留壁
    body = _diff(body, [loft(_car_rings(stations[1:-1] * 0.92, ws[1:-1] * 0.74,
                                       hs[1:-1] * 0.70, zs[1:-1] + 0.05))])

    # 座舱
    cx = np.array([-0.95, -0.55, 0.15, 0.75, 0.98]) * (length / 4.3)
    cw = np.array([0.62, 0.74, 0.74, 0.66, 0.50]) * (width / 1.8)
    cz0 = np.array([0.86, 0.92, 0.94, 0.90, 0.84])
    ch = np.array([0.16, 0.46, 0.50, 0.42, 0.18])

    def cabin_rings(cx_, cw_, cz0_, ch_):
        rings = []
        for x, w, z0, hh in zip(cx_, cw_, cz0_, ch_):
            t = np.linspace(0, 2 * np.pi, 24, endpoint=False)
            cy, sy = np.cos(t), np.sin(t)
            yy = w * np.sign(cy) * np.abs(cy) ** 0.72
            zz = (hh / 2) * np.sign(sy) * np.abs(sy) ** 0.72 + z0 + hh / 2
            rings.append(np.column_stack([np.full_like(t, x), yy, zz]))
        return rings

    cabin = loft(cabin_rings(cx, cw, cz0, ch))
    cabin = _diff(cabin, [loft(cabin_rings(cx, cw * 0.86, cz0 + 0.05, ch * 0.72))])
    windows = [
        box((0.50, 1.75, 0.25), center=(0.30, 0, 1.16)),   # 前侧窗（贯穿左右）
        box((0.42, 1.75, 0.24), center=(-0.46, 0, 1.15)),  # 后侧窗
        box((0.26, 1.20, 0.26), center=(0.94, 0, 1.17)),   # 前风挡
        box((0.22, 1.10, 0.24), center=(-0.92, 0, 1.15)),  # 后窗
    ]
    cabin = _diff(cabin, windows)

    # 车门分缝（在壳体上开浅槽，槽位与门板边界对齐）
    grooves = [box((0.010, 1.80, 0.42), center=(float(s), 0, 0.68)) for s in seams]
    grooves.append(box((float(seams[2] - seams[0]), 1.80, 0.014),
                        center=(float((seams[0] + seams[2]) * 0.5), 0, 0.484)))  # 门槛线
    body = _diff(body, grooves)

    # 门板：从车身网格切出，独立成件
    def station_index(x):
        return int(np.argmin(np.abs(stations - x)))

    i_front = station_index(seams[0])
    i_mid = station_index(seams[1])
    i_rear = station_index(seams[2])

    parts = {"body": body, "cabin": cabin}
    for side, rows in (("left", CAR_DOOR_ROWS_LEFT), ("right", CAR_DOOR_ROWS_RIGHT)):
        parts[f"door_front_{side}"] = _panel_from_grid(rings, zs, i_front, i_mid, rows,
                                                       CAR_DOOR_OUT, CAR_DOOR_IN)
        parts[f"door_rear_{side}"] = _panel_from_grid(rings, zs, i_mid, i_rear, rows,
                                                      CAR_DOOR_OUT, CAR_DOOR_IN)

    # 轮（四个，各自独立）
    for sx, axle in ((1.36, "front"), (-1.36, "rear")):
        for sy, side in ((0.80, "left"), (-0.80, "right")):
            w = cylinder(0.335, 0.22, sections=20)
            parts[f"wheel_{axle}_{side}"] = place_safe(w, T(sx, sy, 0.335) @ R_axis("x", 90))

    # 后视镜：贴在座舱侧面（原来浮在空中的位置已修正，避免「悬空零件」）
    for sy, side in ((0.60, "left"), (-0.60, "right")):
        parts[f"mirror_{side}"] = box((0.08, 0.10, 0.05), center=(0.78, sy, 0.95))

    # 前灯 / 尾灯：前后各两个，独立 mesh
    for sy, side in ((0.45, "left"), (-0.45, "right")):
        parts[f"headlight_{side}"] = box((0.04, 0.22, 0.10), center=(2.10, sy, 0.62))
    for sy, side in ((0.16, "left"), (-0.16, "right")):
        parts[f"taillight_{side}"] = box((0.04, 0.16, 0.10), center=(-2.15, sy, 0.60))

    # 内饰代理：座椅 / 仪表台 / 方向盘（透过窗洞可见，证明不是实心）
    for sy, side in ((0.33, "left"), (-0.33, "right")):
        parts[f"seat_{side}"] = box((0.42, 0.42, 0.46), center=(-0.18, sy, 0.80))
    parts["dashboard"] = box((0.22, 1.18, 0.16), center=(0.58, 0, 0.84))
    sw = cylinder(0.15, 0.03, sections=18)
    parts["steering_wheel"] = place_safe(sw, T(0.40, -0.33, 0.95) @ R_axis("y", 72))

    # 门把手撤掉了：门现在是独立部件，凸出来的面板旁边再挂一个悬空把手
    # 只会更像「碎片」；而且 4 个把手会吃掉部件数预算（validate 的 max_parts）。
    return parts


def vehicle_car_meta(parts, length=4.30, width=1.80, height=1.42):
    """程序化轿车的元数据（部件名、面数、门缝位置等）。"""
    faces = int(sum(len(m.faces) for m in parts.values()))
    return {
        "dimensions_m": [length, width, height + 0.06],
        "parts": len(parts),
        "faces": faces,
        "features": ["hollow_shell", "windows", "door_seams", "independent_doors",
                     "independent_wheels", "independent_lights"],
        "parted": any(k.startswith("door_") for k in parts),
        "part_names": list(parts.keys()),
        "door_seams_m": [round(float(s), 4) for s in CAR_DOOR_SEAMS],
        "door_panel_offset_m": {"outward": CAR_DOOR_OUT, "inward": CAR_DOOR_IN},
        "axes": {"front": "+X", "left": "+Y", "right": "-Y", "up": "+Z"},
    }


def vehicle_car(length=4.30, width=1.80, height=1.42, parted=True):
    """轿车白模：超椭圆截面 loft + 空腔壳体 + 门窗切口 + 轮胎 + **独立车门**。

    parted=True  → 车门是独立 mesh（治门漂移的关键：参考图里必须有可学的门结构）。
    parted=False → 同一台车但不生成门板（用于「拆件前/后」的深度对比基线）。
    """
    parts = vehicle_car_parts(length, width, height)
    if not parted:
        parts = {k: v for k, v in parts.items() if not k.startswith("door_")}
    mesh = merge(list(parts.values()))
    return mesh, vehicle_car_meta(parts, length, width, height)


def vehicle_boat(length=6.4, beam=2.0, depth=1.1):
    """船体白模：V 型截面 loft + 甲板 + 上层建筑。"""
    ys = np.linspace(-length / 2, length / 2, 9)
    half = np.array([0.30, 0.62, 0.82, 0.94, 1.00, 0.97, 0.86, 0.62, 0.26]) * (beam / 2)
    dep = np.array([0.55, 0.80, 0.96, 1.00, 1.00, 0.99, 0.92, 0.78, 0.50]) * depth
    rings = []
    for y, w, d in zip(ys, half, dep):
        t = np.linspace(0, 2 * np.pi, 26, endpoint=False)
        cy, sy = np.cos(t), np.sin(t)
        xx = w * np.sign(cy) * np.abs(cy) ** 0.62
        # 下半部收成 V 型
        zz = np.where(sy < 0, -d - 0.0, 0.0) * 0
        zz = np.where(sy < 0, -d * np.abs(sy) ** 0.55, d * 0.28 * sy)
        rings.append(np.column_stack([xx, np.full_like(t, y), zz + d * 0.72]))
    hull = loft(rings)
    deck = box((beam * 0.82, length * 0.86, 0.10), center=(0, 0.1, depth * 0.86))
    cabin = box((beam * 0.52, length * 0.26, 0.95), center=(0, -0.6, depth * 0.86 + 0.5))
    bridge = box((beam * 0.38, length * 0.16, 0.45), center=(0, -0.7, depth * 0.86 + 1.2))
    mesh = merge([hull, deck, cabin, bridge])
    return mesh, {"dimensions_m": [beam, length, depth + 1.45], "parts": 4}


# ------------------------------------------------------------------ 建筑
def building(footprint=(12.0, 9.0), floors=8, floor_h=3.2):
    w, d = footprint
    total = floors * floor_h
    parts = [box((w, d, total), center=(0, 0, total / 2))]
    for i in range(1, floors):
        parts.append(box((w + 0.28, d + 0.28, 0.22), center=(0, 0, i * floor_h)))
    parts.append(box((w + 0.40, d + 0.40, 0.30), center=(0, 0, total + 0.10)))
    for x in (-w / 2, 0.0, w / 2):
        for y in (-d / 2, d / 2):
            parts.append(box((0.16, 0.16, total), center=(x, y, total / 2)))
    for y in (-d / 2, 0.0, d / 2):
        for x in (-w / 2, w / 2):
            parts.append(box((0.16, 0.16, total), center=(x, y, total / 2)))
    mesh = merge(parts)
    return mesh, {"floors": floors, "floor_h": floor_h, "height_m": total + 0.25}


# ------------------------------------------------------------------ 生物
def creature_quadruped(scale=1.0):
    """四足动物代理（鹿型）：体块 + 四肢 + 头颈 + 尾，明确为代理表达。"""
    s = scale
    parts = []
    body_rings = []
    for y, rx, rz in ((-0.85, 0.20, 0.24), (-0.55, 0.30, 0.34), (0.0, 0.32, 0.36),
                      (0.55, 0.30, 0.33), (0.85, 0.22, 0.26)):
        t = np.linspace(0, 2 * np.pi, 18, endpoint=False)
        body_rings.append(np.column_stack([
            rx * s * np.sign(np.cos(t)) * np.abs(np.cos(t)) ** (2 / 2.3),
            np.full_like(t, y * s),
            1.05 * s + rz * s * np.sign(np.sin(t)) * np.abs(np.sin(t)) ** (2 / 2.3),
        ]))
    parts.append(loft(body_rings))
    parts.append(segment((0, 0.85 * s, 1.10 * s), (0, 1.15 * s, 1.30 * s), 0.14 * s, 0.11 * s, 14))
    parts.append(sphere(0.17 * s, center=(0, 1.28 * s, 1.36 * s), subdiv=2, scale=(0.9, 1.25, 0.95)))
    parts.append(segment((0, 1.36 * s, 1.33 * s), (0, 1.52 * s, 1.26 * s), 0.085 * s, 0.06 * s, 12))
    for sx in (-1, 1):
        parts.append(segment((0.10 * s * sx, 1.26 * s, 1.48 * s), (0.16 * s * sx, 1.30 * s, 1.62 * s),
                             0.03 * s, 0.01 * s, 8))
    for sx in (-1, 1):
        for yy in (-0.62, 0.58):
            hip = np.array([0.19 * s * sx, yy * s, 1.02 * s])
            knee = np.array([0.20 * s * sx, (yy + 0.06) * s, 0.58 * s])
            ankle = np.array([0.20 * s * sx, (yy - 0.02) * s, 0.12 * s])
            parts.append(segment(hip, knee, 0.075 * s, 0.055 * s, 12))
            parts.append(segment(knee, ankle, 0.052 * s, 0.035 * s, 12))
            parts.append(box((0.10 * s, 0.15 * s, 0.14 * s),
                             center=(ankle[0], ankle[1] + 0.03 * s, 0.07 * s)))
    parts.append(segment((0, -0.86 * s, 1.16 * s), (0, -1.06 * s, 1.02 * s), 0.055 * s, 0.025 * s, 10))
    mesh = merge(parts)
    return mesh, {"proxy_level": "silhouette_quadruped", "parts": len(parts)}


# ------------------------------------------------------------------ 植被
def tree(seed=7, levels=4, branches=3, height=4.6):
    """L-system 风格递归分枝 + 冠层代理。"""
    rng = np.random.default_rng(seed)
    parts = []
    tips = []

    def grow(p, direction, length, radius, depth):
        if depth > levels or radius < 0.012:
            tips.append(p)
            return
        d = direction / (np.linalg.norm(direction) + 1e-9)
        # 轻微向光性 + 随机扰动
        d = d + np.array([0, 0, 0.22]) + rng.normal(0, 0.20, 3)
        d /= np.linalg.norm(d)
        q = p + d * length
        parts.append(segment(p, q, radius, radius * 0.68, 8))
        n = branches if depth < levels else max(2, branches - 1)
        for i in range(n):
            ang = 2 * np.pi * i / n + rng.uniform(-0.5, 0.5)
            axis = np.array([math.cos(ang), math.sin(ang), 0.0])
            nd = d * 0.55 + axis * 0.75 + np.array([0, 0, 0.25])
            grow(q, nd, length * 0.68, radius * 0.62, depth + 1)

    grow(np.zeros(3), np.array([0, 0, 1.0]), height * 0.45, 0.19 * height / 4.6, 0)
    trunk = merge(parts)
    canopy_parts = []
    for i, t in enumerate(tips[:: max(1, len(tips) // 9)][:9]):
        r = 0.55 * height / 4.6 * (0.8 + 0.4 * ((i % 3) / 2))
        canopy_parts.append(sphere(r, center=t, subdiv=1, scale=(1.0, 1.0, 0.78)))
    canopy = merge(canopy_parts) if canopy_parts else sphere(0.5, center=(0, 0, height))
    return trunk, canopy, {"seed": seed, "levels": levels, "branches": branches,
                           "tips": len(tips), "trunk_parts": len(parts)}


# ------------------------------------------------------------------ 特效
def _fx_tube(pts, radii, sections=16):
    """沿轨迹放样出体积包络（比球串更干净，仍为代理）。"""
    rings = []
    up = np.array([0.0, 0.0, 1.0])
    for i, (p, r) in enumerate(zip(pts, radii)):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, len(pts) - 1)]
        t = b - a
        t /= np.linalg.norm(t) + 1e-9
        right = np.cross(t, up)
        if np.linalg.norm(right) < 1e-6:
            right = np.array([1.0, 0.0, 0.0])
        right /= np.linalg.norm(right)
        upv = np.cross(right, t)
        ang = np.linspace(0, 2 * np.pi, sections, endpoint=False)
        rings.append(p + np.outer(np.cos(ang), right) * r + np.outer(np.sin(ang), upv) * r)
    return loft(rings, cap=True)


def fx_proxy():
    """烟尘/爆炸体积代理：贝塞尔轨迹 + 半径序列 + 碎片轨迹（纯数据 + 可视化网格）。"""
    ctrl = np.array([[0.0, 0.0, 0.35], [0.5, 0.9, 1.4], [1.8, 1.6, 2.6], [3.2, 2.2, 3.6]])
    ts = np.linspace(0, 1, 26)
    pts = _bezier(ctrl, ts)
    radii = 0.16 + 1.35 * ts ** 1.6
    density = 1.0 / (1.0 + 4.0 * ts)
    spheres = [sphere(float(r), center=tuple(p), subdiv=1) for p, r in zip(pts, radii)]
    volume_mesh = _fx_tube(pts, radii)
    debris = []
    rng = np.random.default_rng(3)
    for i in range(24):
        dirv = rng.normal(0, 1, 3)
        dirv[2] = abs(dirv[2]) + 0.5
        dirv /= np.linalg.norm(dirv)
        start = np.array([0, 0, 0.30])
        end = start + dirv * (0.8 + rng.uniform(0, 1.6))
        debris.append({"id": f"debris_{i:02d}", "t0": 0.0, "t1": 0.6 + rng.uniform(0, 0.4),
                       "p0": start.tolist(), "p1": end.tolist(),
                       "size": float(rng.uniform(0.03, 0.10))})
    data = {
        "kind": "fx_volume_proxy",
        "trajectory": {"control_points": ctrl.tolist(), "samples": [p.tolist() for p in pts],
                       "t_start": 0.0, "t_end": 1.8},
        "volume_series": [{"t": float(t * 1.8), "center": p.tolist(), "radius": float(r),
                           "density": float(d)} for t, p, r, d in zip(ts, pts, radii, density)],
        "debris": debris,
        "downstream_hint": "转成深度/法线/遮罩序列作为视频生成的控制图；体积本身控制力弱",
    }
    return volume_mesh, data


def _bezier(ctrl, ts):
    out = []
    for t in ts:
        p = (1 - t) ** 3 * ctrl[0] + 3 * (1 - t) ** 2 * t * ctrl[1] + \
            3 * (1 - t) * t ** 2 * ctrl[2] + t ** 3 * ctrl[3]
        out.append(p)
    return np.array(out)


# ------------------------------------------------------------------ 相机
def camera_path():
    keys = [
        {"t": 0.0, "eye": [7.4, -8.8, 3.9], "target": [0.0, 1.0, 1.35], "focal_mm": 45},
        {"t": 1.2, "eye": [4.6, -7.2, 2.6], "target": [0.0, 0.6, 1.25], "focal_mm": 50},
        {"t": 2.4, "eye": [2.2, -6.0, 1.9], "target": [0.0, 0.3, 1.20], "focal_mm": 50},
        {"t": 3.6, "eye": [0.4, -5.2, 1.62], "target": [0.0, 0.2, 1.18], "focal_mm": 55},
    ]
    fps, duration = 24, 3.6
    frames = int(round(fps * duration)) + 1
    samples = []
    for i in range(frames):
        t = duration * i / (frames - 1)
        seg = min(int(t / 1.2), 2)
        u = (t - seg * 1.2) / 1.2
        u = u * u * (3 - 2 * u)  # smoothstep
        a, b = keys[seg], keys[seg + 1]
        eye = np.array(a["eye"]) * (1 - u) + np.array(b["eye"]) * u
        tgt = np.array(a["target"]) * (1 - u) + np.array(b["target"]) * u
        focal = a["focal_mm"] * (1 - u) + b["focal_mm"] * u
        samples.append({"frame": i, "t": round(t, 4), "eye": eye.round(4).tolist(),
                        "target": tgt.round(4).tolist(), "focal_mm": round(focal, 2)})
    return {
        "kind": "camera_path",
        "fps": fps,
        "duration_s": duration,
        "sensor_width_mm": 36.0,
        "near": 0.1,
        "far": 200.0,
        "keys": keys,
        "samples": samples,
        "downstream_hint": "UsdGeomCamera / glTF camera 直接消费；同时作为构图自动校验输入",
    }


# ------------------------------------------------------------------ 动作 BVH
BVH_TREE = [
    ("Hips", None, (0.0, 0.98, 0.0), 6),
    ("Spine", "Hips", (0.0, 0.14, 0.0), 3),
    ("Chest", "Spine", (0.0, 0.18, 0.0), 3),
    ("Neck", "Chest", (0.0, 0.18, 0.0), 3),
    ("Head", "Neck", (0.0, 0.14, 0.0), 3),
    ("LeftShoulder", "Chest", (0.19, 0.02, 0.0), 3),
    ("LeftElbow", "LeftShoulder", (0.22, -0.26, 0.02), 3),
    ("LeftWrist", "LeftElbow", (0.16, -0.24, 0.03), 3),
    ("LeftHand", "LeftWrist", (0.0, -0.10, 0.0), 3),
    ("RightShoulder", "Chest", (-0.19, 0.02, 0.0), 3),
    ("RightElbow", "RightShoulder", (-0.22, -0.26, 0.02), 3),
    ("RightWrist", "RightElbow", (-0.16, -0.24, 0.03), 3),
    ("RightHand", "RightWrist", (0.0, -0.10, 0.0), 3),
    ("LeftHip", "Hips", (0.10, -0.03, 0.0), 3),
    ("LeftKnee", "LeftHip", (0.01, -0.45, 0.0), 3),
    ("LeftAnkle", "LeftKnee", (0.01, -0.44, 0.01), 3),
    ("LeftToe", "LeftAnkle", (0.0, -0.04, 0.15), 3),
    ("RightHip", "Hips", (-0.10, -0.03, 0.0), 3),
    ("RightKnee", "RightHip", (-0.01, -0.45, 0.0), 3),
    ("RightAnkle", "RightKnee", (-0.01, -0.44, 0.01), 3),
    ("RightToe", "RightAnkle", (0.0, -0.04, 0.15), 3),
]


def motion_walk(frames=48, fps=24, stride_speed=0.65):
    """程序化走路：关节角由正弦相位驱动，根节点匀速前进（Y-up, 前向 +Z）。"""
    rows = []
    step = stride_speed * 2.0 / (frames - 1)  # 一个周期两步，总位移 = 2 × 步幅
    for i in range(frames):
        ph = 2 * math.pi * i / (frames - 1)
        bob = 0.012 * math.cos(2 * ph)
        root = [0.0, 0.98 + bob, step * i]
        # 通道顺序为 Z,X,Y；前向摆动使用 X 分量
        rot = {"Hips": [3.5 * math.sin(ph), 0.0, 0.0],
               "Spine": [2.0 * math.sin(ph), 0.0, 0.0],
               "Chest": [-1.5 * math.sin(ph), 0.0, 0.0],
               "Neck": [0.0, 0.0, 0.0],
               "Head": [0.0, 0.0, 0.0]}
        for side, sign in (("Left", 1.0), ("Right", -1.0)):
            rot[f"{side}Hip"] = [0.0, 24.0 * sign * math.sin(ph), 0.0]
            knee = 34.0 * max(0.0, math.sin(ph + (0.0 if sign > 0 else math.pi) + 0.6))
            rot[f"{side}Knee"] = [0.0, knee, 0.0]
            rot[f"{side}Ankle"] = [0.0, -9.0 * sign * math.sin(ph), 0.0]
            rot[f"{side}Toe"] = [0.0, 0.0, 0.0]
            rot[f"{side}Shoulder"] = [0.0, -21.0 * sign * math.sin(ph), 0.0]
            rot[f"{side}Elbow"] = [0.0, 12.0 + 9.0 * max(0.0, sign * math.sin(ph)), 0.0]
            rot[f"{side}Wrist"] = [0.0, 0.0, 0.0]
            rot[f"{side}Hand"] = [0.0, 0.0, 0.0]
        rows.append({"root": root, "rot": rot})
    return rows, {"frames": frames, "fps": fps}


def write_bvh(path, frames, fps):
    rows, meta = motion_walk(frames, fps)
    names = [t[0] for t in BVH_TREE]
    children = {n: [] for n in names}
    for name, parent, off, ch in BVH_TREE:
        if parent:
            children[parent].append(name)

    def emit(name, depth, lines):
        parent = [t[1] for t in BVH_TREE if t[0] == name][0]
        off = [t[2] for t in BVH_TREE if t[0] == name][0]
        ch = [t[3] for t in BVH_TREE if t[0] == name][0]
        kw = "ROOT" if parent is None else "JOINT"
        lines.append("  " * depth + f"{kw} {name}")
        lines.append("  " * depth + "{")
        lines.append("  " * (depth + 1) + f"OFFSET {off[0]:.4f} {off[1]:.4f} {off[2]:.4f}")
        if ch == 6:
            lines.append("  " * (depth + 1) + "CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation")
        else:
            lines.append("  " * (depth + 1) + "CHANNELS 3 Zrotation Xrotation Yrotation")
        kids = children[name]
        if kids:
            for k in kids:
                emit(k, depth + 1, lines)
        else:
            lines.append("  " * (depth + 1) + "End Site")
            lines.append("  " * (depth + 1) + "{")
            lines.append("  " * (depth + 2) + f"OFFSET 0.0000 0.0800 0.0000")
            lines.append("  " * (depth + 1) + "}")
        lines.append("  " * depth + "}")

    lines = ["HIERARCHY"]
    emit("Hips", 0, lines)
    lines.append("MOTION")
    lines.append(f"Frames: {len(rows)}")
    lines.append(f"Frame Time: {1.0 / fps:.7f}")
    for r in rows:
        vals = [f"{r['root'][0]:.2f}", f"{r['root'][1]:.4f}", f"{r['root'][2]:.4f}"]
        for name, parent, off, ch in BVH_TREE:
            ang = r["rot"][name]
            if ch == 6:
                vals += [f"{ang[0]:.4f}", f"{ang[1]:.4f}", f"{ang[2]:.4f}"]
            else:
                vals += [f"{ang[0]:.4f}", f"{ang[1]:.4f}", f"{ang[2]:.4f}"]
        lines.append(" ".join(vals))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return rows, meta


# ------------------------------------------------------------------ 场景装配
def _ground_mesh(size=30.0, n=24):
    xs = np.linspace(-size, size, n + 1)
    verts = np.array([[x, y, 0.0] for y in xs for x in xs])
    faces = []
    for iy in range(n):
        for ix in range(n):
            a = iy * (n + 1) + ix
            faces.append([a, a + 1, a + n + 2])
            faces.append([a, a + n + 2, a + n + 1])
    return trimesh.Trimesh(vertices=verts, faces=np.array(faces), process=False)


def street_scene():
    """街景装配。若已有 SOMA/ANNY 成人白模，则直接用它作为主角（同一米制、Z-up）。"""
    hero_glb = os.path.join(GEO, "soma_anny_adult.glb")
    if os.path.exists(hero_glb):
        hero = trimesh.load(hero_glb, force="mesh")
        hero_source = "assets/geometry/soma_anny_adult.glb"
        jacket_mesh = None
    else:
        hero, rig = human_proxy(1.75, yaw=8)
        hero_source = "procedural_mannequin"
        jacket_mesh = jacket(1.75, yaw=8)
    building_a, meta_a = building((12, 9), 8, 3.2)
    building_b, meta_b = building((10, 8), 6, 3.2)
    car, car_meta = vehicle_car()
    tree_trunk, tree_canopy, tree_meta = tree(seed=11, height=4.8)
    crowd_meshes = []
    for i in range(10):
        gx = -5.0 + (i % 5) * 1.25
        gy = 4.4 + (i // 5) * 1.15
        m, _ = human_proxy(1.58 + 0.06 * (i % 4), lod="low", yaw=180, gait=8 * math.sin(i))
        crowd_meshes.append((f"crowd_{i:02d}", m, T(gx, gy, 0)))

    items = [
        ("ground", _ground_mesh(30.0, 24), None),
        ("road", box((44, 7.0, 0.04), center=(0, 0, 0.02)), None),
        ("sidewalk_s", box((44, 2.0, 0.12), center=(0, -5.0, 0.06)), None),
        ("building_a", building_a, T(-9.5, 13.0, 0)),
        ("building_b", building_b, T(6.0, 15.0, 0)),
        ("car_a", car, T(-5.6, -1.4, 0.04) @ R_axis("z", 90)),
        ("car_b", car, T(9.0, 1.3, 0.04) @ R_axis("z", -90)),
        ("tree_a", tree_trunk, T(-8.5, 6.3, 0)),
        ("tree_b", tree_trunk, T(13.0, 6.3, 0)),
        ("tree_canopy_a", tree_canopy, T(-8.5, 6.3, 0)),
        ("tree_canopy_b", tree_canopy, T(13.0, 6.3, 0)),
        ("hero", hero, T(0, -1.6, 0)),
    ] + ([("hero_jacket", jacket_mesh, T(0, -1.6, 0))] if jacket_mesh is not None else []) + crowd_meshes
    layout = {
        "kind": "scene_layout",
        "units": "meters",
        "up_axis": "Z",
        "hero_source": hero_source,
        "objects": [
            {"name": "hero", "category": "character", "transform": _tf(T(0, -1.6, 0)),
             "bbox_m": _bbox(hero), "source": hero_source},
            *([{"name": "hero_jacket", "category": "clothing", "transform": _tf(T(0, -1.6, 0)),
                "bbox_m": _bbox(jacket_mesh)}] if jacket_mesh is not None else []),
            {"name": "building_a", "category": "building", "transform": _tf(T(-9.5, 13.0, 0)),
             "bbox_m": _bbox(building_a)},
            {"name": "building_b", "category": "building", "transform": _tf(T(6.0, 15.0, 0)),
             "bbox_m": _bbox(building_b)},
            {"name": "car_a", "category": "vehicle", "transform": _tf(T(-5.6, -1.4, 0.04) @ R_axis("z", 90)),
             "bbox_m": _bbox(car)},
            {"name": "car_b", "category": "vehicle", "transform": _tf(T(9.0, 1.3, 0) @ R_axis("z", -90)),
             "bbox_m": _bbox(car)},
            {"name": "tree_a", "category": "vegetation", "transform": _tf(T(-8.5, 6.3, 0)),
             "bbox_m": _bbox(tree_trunk)},
            {"name": "tree_b", "category": "vegetation", "transform": _tf(T(13.0, 6.3, 0)),
             "bbox_m": _bbox(tree_trunk)},
        ] + [{"name": name, "category": "crowd", "transform": _tf(tf), "bbox_m": _bbox(m)}
             for name, m, tf in crowd_meshes],
        "camera_ref": "camera_path.json",
        "fx_ref": "fx_proxy.json",
    }
    return items, layout


def _tf(m):
    return [round(float(v), 4) for v in np.asarray(m).reshape(-1)]


def _bbox(mesh):
    lo, hi = mesh.bounds
    return [round(float(v), 4) for v in np.r_[lo, hi]]


# ------------------------------------------------------------------ 主生成流程
def generate_all(bad_character=False):
    os.makedirs(GEO, exist_ok=True)
    os.makedirs(NGEO, exist_ok=True)
    out = {}

    # 1 人物
    hero, rig = human_proxy(2.45 if bad_character else 1.75,
                            arm_offset=0.16 if bad_character else 0.0)
    export_glb(hero, os.path.join(GEO, "character_hero.glb"))
    export_obj(hero, os.path.join(GEO, "character_hero.obj"))
    export_stl(hero, os.path.join(GEO, "character_hero.stl"))
    wjson(os.path.join(NGEO, "character_rig.json"),
          {"kind": "rig", "joints": [{"name": n, "parent": p, "rest": [round(v, 4) for v in rig["joints"][n]]}
                                     for n, p, _ in HUMAN_JOINTS]})
    out["character"] = {"mesh": hero, "parts": rig["parts"], "height": rig["height"],
                        "path": "assets/geometry/character_hero.glb",
                        "expect": {"z": [1.60, 1.86], "max_parts": 40}}

    # 2 服装
    jk = jacket(1.75)
    export_glb(jk, os.path.join(GEO, "clothing_jacket.glb"))
    out["clothing"] = {"mesh": jk, "path": "assets/geometry/clothing_jacket.glb",
                       "expect": {"z": [0.42, 0.68], "max_parts": 8}}

    # 3 道具
    crate, crate_meta = prop_crate()
    export_glb(crate, os.path.join(GEO, "prop_crate.glb"))
    export_stl(crate, os.path.join(GEO, "prop_crate.stl"))
    out["prop"] = {"mesh": crate, "path": "assets/geometry/prop_crate.glb", "meta": crate_meta,
                   "expect": {"z": [0.55, 0.90], "max_parts": 2}}

    # 4 载具（汽车按部件导出多 geometry Scene：门/轮/灯可单独取用）
    car_parts = vehicle_car_parts()
    car = merge(list(car_parts.values()))
    car_meta = vehicle_car_meta(car_parts)
    scene_glb([(name, mesh, np.eye(4)) for name, mesh in car_parts.items()],
              os.path.join(GEO, "vehicle_car.glb"))
    # OBJ 仍是合并网格（保持既有消费方不变）；分件结构以 GLB 为准
    export_obj(car, os.path.join(GEO, "vehicle_car.obj"))
    boat, boat_meta = vehicle_boat()
    export_glb(boat, os.path.join(GEO, "vehicle_boat.glb"))
    out["vehicle_car"] = {"mesh": car, "path": "assets/geometry/vehicle_car.glb", "meta": car_meta,
                          "parts": car_parts, "part_names": list(car_parts.keys()),
                          "expect": {"x": [3.8, 4.8], "z": [1.20, 1.65], "max_parts": 24}}
    out["vehicle_boat"] = {"mesh": boat, "path": "assets/geometry/vehicle_boat.glb", "meta": boat_meta,
                           "expect": {"y": [5.5, 7.2], "z": [1.2, 3.4], "max_parts": 8}}

    # 5 建筑
    bld, bld_meta = building((12, 9), 8, 3.2)
    export_glb(bld, os.path.join(GEO, "building_office.glb"))
    export_obj(bld, os.path.join(GEO, "building_office.obj"))
    out["building"] = {"mesh": bld, "path": "assets/geometry/building_office.glb", "meta": bld_meta,
                       "expect": {"z": [24.0, 27.5], "max_parts": 40}}

    # 6 生物
    deer, deer_meta = creature_quadruped()
    export_glb(deer, os.path.join(GEO, "creature_quadruped.glb"))
    export_stl(deer, os.path.join(GEO, "creature_quadruped.stl"))
    out["creature"] = {"mesh": deer, "path": "assets/geometry/creature_quadruped.glb", "meta": deer_meta,
                       "expect": {"y": [1.8, 2.8], "z": [1.2, 1.8], "max_parts": 24}}

    # 7 植被
    trunk, canopy, tree_meta = tree(seed=11, height=4.8)
    export_glb(merge([trunk, canopy]), os.path.join(GEO, "vegetation_tree.glb"))
    export_obj(trunk, os.path.join(GEO, "vegetation_tree_trunk.obj"))
    wjson(os.path.join(NGEO, "vegetation_params.json"), {"kind": "vegetation_params", **tree_meta})
    out["vegetation"] = {"mesh": trunk, "canopy": canopy, "path": "assets/geometry/vegetation_tree.glb",
                         "meta": tree_meta, "expect": {"z": [4.0, 6.8], "max_parts": 200}}

    # 8 人群
    crowd_items = []
    crowd_people = []
    for i in range(12):
        gx = -4.2 + (i % 4) * 1.25
        gy = 3.2 + (i // 4) * 1.15
        m, _ = human_proxy(1.56 + 0.07 * (i % 5), lod="low", yaw=20 * i, gait=7 * math.sin(i))
        crowd_items.append((f"person_{i:02d}", m, T(gx, gy, 0)))
        crowd_people.append({"id": f"person_{i:02d}", "height": round(1.56 + 0.07 * (i % 5), 3),
                             "pos": [round(gx, 3), round(gy, 3)], "yaw_deg": 20 * i,
                             "clip": "walk_cycle_2s"})
    scene_glb(crowd_items, os.path.join(GEO, "crowd_block.glb"))
    wjson(os.path.join(NGEO, "crowd_layout.json"),
          {"kind": "crowd_layout", "count": len(crowd_items), "unit": "meter",
           "clip": "motion_walk_2s.bvh", "people": crowd_people,
           "downstream_hint": "USD PointInstancer / glTF 实例化；远景点用 xlow LOD"})
    out["crowd"] = {"items": crowd_items, "path": "assets/geometry/crowd_block.glb",
                    "expect": {"count": 12}}

    # 9 特效
    fx_mesh, fx_data = fx_proxy()
    export_obj(fx_mesh, os.path.join(GEO, "fx_volume_proxy.obj"))
    wjson(os.path.join(NGEO, "fx_proxy.json"), fx_data)
    out["fx"] = {"mesh": fx_mesh, "data": fx_data, "path": "assets/geometry/fx_volume_proxy.obj",
                 "expect": {"max_radius": 2.0}}

    # 10 动作
    rows, motion_meta = write_bvh(os.path.join(NGEO, "motion_walk_2s.bvh"), 48, 24)
    wjson(os.path.join(NGEO, "motion_walk_meta.json"),
          {"kind": "motion_meta", **motion_meta, "source": "procedural_keyframe_bake",
           "retarget": "SOMA-X 77 关节 / SMAL 四足需独立重定向"})
    out["motion"] = {"path": "assets/nongeometry/motion_walk_2s.bvh", "meta": motion_meta}

    # 11 相机
    cam_data = camera_path()
    wjson(os.path.join(NGEO, "camera_path.json"), cam_data)
    out["camera"] = {"data": cam_data, "path": "assets/nongeometry/camera_path.json"}

    # 12 场景
    items, layout = street_scene()
    scene_glb(items, os.path.join(GEO, "scene_street.glb"))
    wjson(os.path.join(NGEO, "scene_layout.json"), layout)
    out["scene"] = {"items": items, "layout": layout, "path": "assets/geometry/scene_street.glb"}

    return out
