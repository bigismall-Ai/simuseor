"""CPU 验证闭环：几何完整性、尺度、场景关系、运动数据、相机构图、特效连续性。

输出结构化反馈，供「生成 → 执行 → 验证 → 修正」循环使用。
"""
from __future__ import annotations

import json
import math
import os
import re

import numpy as np
import trimesh

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VAL = os.path.join(ROOT, "assets", "validation")


def wjson(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


# ------------------------------------------------------------------ 几何
def _parts(mesh):
    try:
        return mesh.split(only_watertight=False)
    except Exception:
        return [mesh]


def aabb_gap(a, b):
    gap = np.maximum(0.0, np.maximum(a[0] - b[1], b[0] - a[1]))
    return float(np.linalg.norm(gap))


def validate_geometry(name, mesh, expect, extra=None):
    checks = []
    parts = _parts(mesh)
    wt = [bool(p.is_watertight) for p in parts]
    vols = [float(abs(p.volume)) for p in parts]
    deg = int(sum(int(np.sum(p.area_faces < 1e-10)) for p in parts))
    lo, hi = mesh.bounds
    size = hi - lo
    metrics = {
        "components": len(parts),
        "watertight_ratio": round(sum(wt) / max(1, len(wt)), 3),
        "faces": int(len(mesh.faces)),
        "vertices": int(len(mesh.vertices)),
        "volume_m3": round(float(sum(vols)), 4),
        "bbox_min": [round(float(v), 4) for v in lo],
        "bbox_max": [round(float(v), 4) for v in hi],
        "size_m": {k: round(float(v), 4) for k, v in zip("xyz", size)},
    }

    def add(code, ok, msg, hint=""):
        checks.append({"code": code, "ok": bool(ok), "message": msg, "hint": hint})

    add("MESH_WATERTIGHT", all(wt) and len(parts) > 0,
        f"{sum(wt)}/{len(parts)} 个部件水密",
        "检查 loft 截面闭合/法线方向；布尔失败时退回部件合并")
    add("MESH_VOLUME", sum(vols) > 1e-4, f"总体积 {metrics['volume_m3']} m^3",
        "体积近零通常意味着面反转或截面退化")
    add("DEGENERATE_FACES", deg == 0, f"退化面 {deg} 个", "清理零面积三角形")

    for axis, rng in (expect or {}).items():
        if axis not in ("x", "y", "z"):
            continue
        v = float(size["xyz".index(axis)])
        ok = rng[0] <= v <= rng[1]
        add(f"SCALE_{axis.upper()}", ok, f"{axis} 尺寸 {v:.3f} m，期望 {rng[0]}–{rng[1]} m",
            f"按比例调整参数使 {axis} 落入区间")
    if expect and "max_parts" in expect:
        add("COMPONENT_LIMIT", len(parts) <= expect["max_parts"],
            f"部件数 {len(parts)}，上限 {expect['max_parts']}",
            "合并相邻部件或减少细节件")

    if extra and extra.get("check_floating"):
        gaps = []
        boxes = [p.bounds for p in parts]
        for i, b in enumerate(boxes):
            others = [aabb_gap(b, boxes[j]) for j in range(len(boxes)) if j != i]
            gaps.append(min(others) if others else 0.0)
        worst = float(max(gaps)) if gaps else 0.0
        metrics["max_part_gap_m"] = round(worst, 4)
        add("FLOATING_PART", worst <= 0.06,
            f"最大部件间隙 {worst:.3f} m（阈值 0.06）",
            "把肢体/头部关节偏移归零，或将部件重新贴合躯干")

    if extra and extra.get("ground"):
        add("GROUND_CONTACT", abs(float(lo[2])) <= 0.05,
            f"最低点 z={lo[2]:.4f} m", "沿 Z 平移使最低点贴地")

    passed = all(c["ok"] for c in checks)
    return {"asset": name, "pass": passed, "checks": checks, "metrics": metrics}


# ------------------------------------------------------------------ 场景
def _world_aabb(mesh, tf):
    m = mesh.copy()
    if tf is not None:
        m.apply_transform(np.asarray(tf).reshape(4, 4))
    return m.bounds, m


def validate_scene(out, cam_data, layout):
    checks = []
    metrics = {}

    def add(code, ok, msg, hint=""):
        checks.append({"code": code, "ok": bool(ok), "message": msg, "hint": hint})

    objs = {o["name"]: o for o in layout["objects"]}
    geoms = {name: mesh for name, mesh, tf in out["scene"]["items"]}
    tf_map = {name: tf for name, mesh, tf in out["scene"]["items"]}

    # 贴地
    worst = 0.0
    for name in ("hero", "car_a", "car_b", "building_a", "tree_a"):
        if name not in geoms:
            continue
        bb, _ = _world_aabb(geoms[name], tf_map[name])
        worst = max(worst, abs(float(bb[0][2])))
    metrics["max_ground_offset_m"] = round(worst, 4)
    add("SCENE_GROUND", worst <= 0.06, f"最大离地 {worst:.3f} m", "校正场景放置高度")

    # 服装贴合：仅当场景中存在服装外壳时检查（SOMA 主角时没有外壳）
    hero_bb, _ = _world_aabb(geoms["hero"], tf_map["hero"])
    if "hero_jacket" in geoms:
        jk_bb, _ = _world_aabb(geoms["hero_jacket"], tf_map["hero_jacket"])
        z_ov = max(0.0, min(hero_bb[1][2], jk_bb[1][2]) - max(hero_bb[0][2], jk_bb[0][2]))
        jk_h = max(jk_bb[1][2] - jk_bb[0][2], 1e-6)
        z_ratio = z_ov / jk_h
        c_hero = ((hero_bb[0] + hero_bb[1]) / 2)[:2]
        c_jk = ((jk_bb[0] + jk_bb[1]) / 2)[:2]
        c_off = float(np.linalg.norm(c_hero - c_jk))
        metrics["jacket_z_cover"] = round(z_ratio, 3)
        metrics["jacket_center_offset_m"] = round(c_off, 3)
        add("CLOTH_FIT", z_ratio > 0.85 and c_off < 0.05,
            f"外套 Z 覆盖 {z_ratio:.0%}，水平偏移 {c_off:.3f} m", "对齐根节点或缩小外壳偏移")

    # 人物与车辆穿插
    car_bb, _ = _world_aabb(geoms["car_a"], tf_map["car_a"])
    gap = aabb_gap(hero_bb, car_bb)
    metrics["hero_car_gap_m"] = round(gap, 3)
    add("NO_INTERPENETRATION", gap > 0.05, f"人物-车辆 AABB 间隙 {gap:.3f} m", "移动主体或车辆")

    # 人群间距
    centers = []
    for name, o in objs.items():
        if o["category"] != "crowd":
            continue
        bb, _ = _world_aabb(geoms[name], tf_map[name])
        centers.append(((bb[0] + bb[1]) / 2)[:2])
    mind = 9e9
    for i in range(len(centers)):
        for j in range(i + 1, len(centers)):
            mind = min(mind, float(np.linalg.norm(centers[i] - centers[j])))
    metrics["crowd_min_spacing_m"] = round(mind, 3) if centers else None
    add("CROWD_SPACING", mind >= 0.6, f"人群最小间距 {mind:.2f} m", "增大实例间距或降低密度")

    # 相机构图（首帧）
    s = cam_data["samples"][0]
    focal = s["focal_mm"]
    fov = math.degrees(2 * math.atan(cam_data["sensor_width_mm"] / (2 * focal)))
    from geomlib import Camera
    cam = Camera(tuple(s["eye"]), tuple(s["target"]), (0, 0, 1), fov, 960, 600)
    pts = np.array([[x, y, z] for x in (hero_bb[0][0], hero_bb[1][0])
                    for y in (hero_bb[0][1], hero_bb[1][1])
                    for z in (hero_bb[0][2], hero_bb[1][2])])
    px, depth = cam.project(pts)
    inside = ((px[:, 0] > 0) & (px[:, 0] < 960) & (px[:, 1] > 0) & (px[:, 1] < 600)).mean()
    box_w = (px[:, 0].max() - px[:, 0].min()) / 960
    box_h = (px[:, 1].max() - px[:, 1].min()) / 600
    cx = (px[:, 0].max() + px[:, 0].min()) / 2 / 960 - 0.5
    metrics.update({"camera_focal_mm": focal, "camera_fov_deg": round(fov, 2),
                    "subject_in_frame": round(float(inside), 3),
                    "subject_height_ratio": round(float(box_h), 3),
                    "subject_center_offset": round(float(abs(cx)), 3)})
    add("CAMERA_FRAMING", inside > 0.9 and 0.15 < box_h < 0.95 and abs(cx) < 0.25,
        f"主体 8 角点入画率 {inside:.0%}，高度占比 {box_h:.0%}，居中偏移 {abs(cx):.0%}",
        "调整相机 eye/target 或焦距")

    # 类别覆盖
    cats = {}
    for o in layout["objects"]:
        cats[o["category"]] = cats.get(o["category"], 0) + 1
    metrics["categories"] = cats
    add("SCENE_CATEGORIES", {"character", "building", "vehicle", "crowd"} <= set(cats),
        f"场景包含类别：{', '.join(sorted(cats))}", "补齐场景必需的类别")

    return {"asset": "scene_street", "pass": all(c["ok"] for c in checks),
            "checks": checks, "metrics": metrics}


# ------------------------------------------------------------------ BVH
def parse_bvh(path):
    text = open(path, "r", encoding="utf-8").read()
    head, motion = text.split("MOTION", 1)
    tokens = re.findall(r"[{}]|[^\s{}]+", head)

    nodes = []
    pos = tokens.index("ROOT")

    def expect(tok):
        nonlocal pos
        if tokens[pos] != tok:
            raise ValueError(f"BVH 语法错误：期望 {tok}，实际 {tokens[pos]}")
        pos += 1

    def parse_node(parent):
        nonlocal pos
        kw = tokens[pos]
        if kw not in ("ROOT", "JOINT"):
            raise ValueError(f"BVH 语法错误：{kw}")
        name = tokens[pos + 1]
        pos += 2
        expect("{")
        node = {"name": name, "parent": parent, "offset": [0.0, 0.0, 0.0], "channels": []}
        nodes.append(node)
        while tokens[pos] != "}":
            t = tokens[pos]
            if t in ("ROOT", "JOINT"):
                parse_node(name)
            elif t == "OFFSET":
                node["offset"] = [float(tokens[pos + 1]), float(tokens[pos + 2]), float(tokens[pos + 3])]
                pos += 4
            elif t == "CHANNELS":
                n = int(tokens[pos + 1])
                node["channels"] = tokens[pos + 2:pos + 2 + n]
                pos += 2 + n
            elif t == "End":
                pos += 1
                expect("Site")
                expect("{")
                expect("OFFSET")
                node["end"] = [float(tokens[pos]), float(tokens[pos + 1]), float(tokens[pos + 2])]
                pos += 3
                expect("}")
            else:
                raise ValueError(f"BVH 未知标记：{t}")
        expect("}")
        return node

    parse_node(None)

    lines = [l for l in motion.strip().splitlines() if l.strip()]
    nframes = int(lines[0].split(":")[1])
    frame_time = float(lines[1].split(":")[1])
    rows = [[float(v) for v in l.split()] for l in lines[2:]]
    return {"nodes": nodes, "frames": nframes, "frame_time": frame_time, "rows": rows}


def _euler_zxy(z, x, y):
    z, x, y = map(math.radians, (z, x, y))
    cz, sz = math.cos(z), math.sin(z)
    cx, sx = math.cos(x), math.sin(x)
    cy, sy = math.cos(y), math.sin(y)
    rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    return rz @ rx @ ry


def fk(bvh):
    nodes = bvh["nodes"]
    idx = {n["name"]: i for i, n in enumerate(nodes)}
    frames = []
    for row in bvh["rows"]:
        world = {}
        vals = {}
        p = 0
        for n in nodes:
            c = n["channels"]
            vals[n["name"]] = row[p:p + len(c)]
            p += len(c)
        for n in nodes:
            c = n["channels"]
            if c and c[0] == "Xposition":
                trans = np.array(vals[n["name"]][:3], float)
                ang = vals[n["name"]][3:]
            else:
                trans = np.zeros(3)
                ang = vals[n["name"]][:3] if c else []
            rot = _euler_zxy(*ang) if len(ang) == 3 else np.eye(3)
            off = np.array(n["offset"], float)
            parent = n["parent"]
            if parent is None:
                m = np.eye(4)
                m[:3, :3] = rot
                m[:3, 3] = off + trans
            else:
                pm = world[parent]
                m = pm.copy()
                lm = np.eye(4)
                lm[:3, :3] = rot
                lm[:3, 3] = off
                m = pm @ lm
                m[:3, 3] += trans
            world[n["name"]] = m
        frames.append(world)
    return frames, idx


def validate_motion(path):
    bvh = parse_bvh(path)
    frames, idx = fk(bvh)
    nodes = bvh["nodes"]
    checks = []

    def add(code, ok, msg, hint=""):
        checks.append({"code": code, "ok": bool(ok), "message": msg, "hint": hint})

    names = {n["name"] for n in nodes}
    add("BVH_JOINTS", len(nodes) >= 18, f"关节数 {len(nodes)}", "补全四肢关节")
    add("BVH_FRAMES", bvh["frames"] == len(bvh["rows"]) and bvh["frames"] >= 24,
        f"帧数 {bvh['frames']}，帧时长 {bvh['frame_time']:.4f}s", "检查 MOTION 段帧数与数据行一致")
    add("BVH_HIERARCHY", "Hips" in names and "Head" in names and "LeftToe" in names,
        "根/头/脚关节齐全", "补全层级")

    def pos_of(fr, name, end=False):
        m = fr[name]
        if end and "end" in [n for n in nodes if n["name"] == name][0]:
            e = [n for n in nodes if n["name"] == name][0]["end"]
            return m[:3, :3] @ np.array(e) + m[:3, 3]
        return m[:3, 3]

    toes = [pos_of(fr, "LeftToe") for fr in frames]
    toe_y = np.array([p[1] for p in toes])
    root_z = np.array([fr["Hips"][2, 3] for fr in frames])
    travel = float(root_z[-1] - root_z[0])
    min_y = float(toe_y.min())

    # 支撑相滑步（脚趾 y 低于阈值视为触地）
    stance = np.where(toe_y < 0.075)[0]
    slides = []
    for i in range(1, len(stance)):
        if stance[i] - stance[i - 1] == 1:
            a, b = toes[stance[i - 1]], toes[stance[i]]
            slides.append(float(math.hypot(b[0] - a[0], b[2] - a[2])))
    slide = float(np.mean(slides)) if slides else 0.0

    # 关节角速度上限（度/秒）
    max_deg = 0.0
    for i in range(1, len(bvh["rows"])):
        for k, n in enumerate(nodes):
            c = n["channels"]
            if not c:
                continue
            off = 3 if c[0] == "Xposition" else 0
            for j in range(off, len(c)):
                a = bvh["rows"][i - 1][sum(len(x["channels"]) for x in nodes[:k]) + j]
                b = bvh["rows"][i][sum(len(x["channels"]) for x in nodes[:k]) + j]
                d = abs(b - a)
                d = min(d, 360 - d)
                max_deg = max(max_deg, d / bvh["frame_time"])

    metrics = {"joints": len(nodes), "frames": bvh["frames"], "fps": round(1 / bvh["frame_time"], 3),
               "root_travel_m": round(travel, 3), "toe_min_y_m": round(min_y, 3),
               "foot_slide_mean_m_per_frame": round(slide, 4),
               "max_angular_speed_deg_s": round(max_deg, 1),
               "cycle_duration_s": round(bvh["frames"] * bvh["frame_time"], 3)}

    add("FOOT_GROUND", min_y > -0.06, f"脚趾最低点 y={min_y:.3f} m", "抬高根节点或减小膝弯")
    add("ROOT_TRAVEL", 0.8 <= travel <= 2.0, f"根位移 {travel:.2f} m / 周期", "调整步幅与前进速度")
    add("FOOT_SLIDE", slide < 0.02, f"支撑相平均滑步 {slide:.4f} m/帧", "用 IK 修正支撑腿或降低根速度")
    add("ANGULAR_LIMIT", max_deg < 900, f"最大角速度 {max_deg:.0f} °/s", "降低摆动幅度或提高帧率")

    return {"asset": "motion_walk_2s.bvh", "pass": all(c["ok"] for c in checks),
            "checks": checks, "metrics": metrics}


# ------------------------------------------------------------------ 非几何 JSON
def validate_camera(path):
    data = json.load(open(path, encoding="utf-8"))
    checks = []

    def add(code, ok, msg, hint=""):
        checks.append({"code": code, "ok": bool(ok), "message": msg, "hint": hint})

    samples = data["samples"]
    ts = [s["t"] for s in samples]
    eyes = np.array([s["eye"] for s in samples])
    steps = np.linalg.norm(np.diff(eyes, axis=0), axis=1)
    focal = [s["focal_mm"] for s in samples]
    add("CAM_MONOTONIC_T", all(b > a for a, b in zip(ts, ts[1:])), "时间单调递增", "排序关键帧")
    add("CAM_FOCAL", min(focal) >= 18 and max(focal) <= 200,
        f"焦距 {min(focal):.0f}–{max(focal):.0f} mm", "限制在常见镜头范围")
    add("CAM_PATH_SMOOTH", float(np.max(np.abs(np.diff(steps)))) < 0.08,
        f"最大加速度突变 {float(np.max(np.abs(np.diff(steps)))):.4f} m/帧²", "对路径做平滑/加密关键帧")
    add("CAM_FRUSTUM", all(s["eye"] != s["target"] for s in samples), "eye 与 target 不重合", "修正关键帧")
    metrics = {"frames": len(samples), "fps": data["fps"], "duration_s": data["duration_s"],
               "path_length_m": round(float(steps.sum()), 2),
               "focal_range_mm": [min(focal), max(focal)],
               "max_step_m": round(float(steps.max()), 4)}
    return {"asset": "camera_path.json", "pass": all(c["ok"] for c in checks),
            "checks": checks, "metrics": metrics}


def validate_fx(path):
    data = json.load(open(path, encoding="utf-8"))
    checks = []

    def add(code, ok, msg, hint=""):
        checks.append({"code": code, "ok": bool(ok), "message": msg, "hint": hint})

    series = data["volume_series"]
    ts = [s["t"] for s in series]
    radii = [s["radius"] for s in series]
    centers = np.array([s["center"] for s in series])
    gaps = np.linalg.norm(np.diff(centers, axis=0), axis=1)
    ok_cont = bool(np.all(gaps < 2.0 * (np.array(radii[:-1]) + np.array(radii[1:]))))
    add("FX_CONTINUITY", ok_cont, f"体积采样最大间距 {gaps.max():.3f} m", "加密采样或增大半径")
    add("FX_MONOTONIC", all(b >= a for a, b in zip(ts, ts[1:])), "时间单调递增", "排序采样")
    add("FX_RADIUS", min(radii) > 0 and all(b >= a for a, b in zip(radii, radii[1:])),
        f"半径 {min(radii):.2f}→{max(radii):.2f} m", "半径应为正且随时间扩张")
    add("FX_DEBRIS", len(data["debris"]) >= 12, f"碎片代理 {len(data['debris'])} 个", "补足碎片轨迹")
    add("FX_DOWNSTREAM_HINT", "downstream_hint" in data, "包含下游消费提示", "补充控制图转换说明")
    metrics = {"samples": len(series), "duration_s": max(ts), "max_radius_m": max(radii),
               "debris": len(data["debris"]), "total_track_length_m": round(float(gaps.sum()), 2)}
    return {"asset": "fx_proxy.json", "pass": all(c["ok"] for c in checks),
            "checks": checks, "metrics": metrics}


def validate_layout(path, expect_counts=None):
    data = json.load(open(path, encoding="utf-8"))
    checks = []

    def add(code, ok, msg, hint=""):
        checks.append({"code": code, "ok": bool(ok), "message": msg, "hint": hint})

    objs = data.get("objects") or [{"name": p["id"]} for p in data.get("people", [])]
    counts = {}
    for o in data.get("objects", []):
        counts[o["category"]] = counts.get(o["category"], 0) + 1
    add("LAYOUT_COUNT", len(objs) >= 8, f"布局对象 {len(objs)} 个", "补齐场景对象")
    add("LAYOUT_UNITS", data.get("units", "meter") in ("meters", "meter"), "单位为米", "统一单位")
    if expect_counts:
        ok = all(counts.get(k, 0) >= v for k, v in expect_counts.items())
        add("LAYOUT_CATEGORIES", ok, f"类别计数 {counts}", "补齐缺失类别")
    return {"asset": os.path.basename(path), "pass": all(c["ok"] for c in checks),
            "checks": checks, "metrics": {"objects": len(objs), "categories": counts}}


def validate_crowd(path):
    data = json.load(open(path, encoding="utf-8"))
    people = data["people"]
    pos = np.array([[p["pos"][0], p["pos"][1]] for p in people])
    mind = 9e9
    for i in range(len(pos)):
        for j in range(i + 1, len(pos)):
            mind = min(mind, float(np.linalg.norm(pos[i] - pos[j])))
    checks = [
        {"code": "CROWD_COUNT", "ok": len(people) >= 8, "message": f"代理实例 {len(people)} 个", "hint": "增加实例"},
        {"code": "CROWD_MIN_DIST", "ok": mind >= 0.6, "message": f"最小间距 {mind:.2f} m", "hint": "降低密度"},
        {"code": "CROWD_CLIP", "ok": all("clip" in p for p in people), "message": "每个实例绑定动画片段", "hint": "补充 clip 字段"},
    ]
    return {"asset": "crowd_layout.json", "pass": all(c["ok"] for c in checks),
            "checks": checks, "metrics": {"count": len(people), "min_spacing_m": round(mind, 3)}}


def validate_rig(path):
    data = json.load(open(path, encoding="utf-8"))
    joints = data["joints"]
    names = {j["name"] for j in joints}
    bad_parent = [j["name"] for j in joints if j["parent"] and j["parent"] not in names]
    checks = [
        {"code": "RIG_JOINTS", "ok": len(joints) >= 18, "message": f"关节 {len(joints)} 个", "hint": "补全关节"},
        {"code": "RIG_PARENT", "ok": not bad_parent, "message": f"父关节缺失 {bad_parent}", "hint": "修正层级"},
        {"code": "RIG_FINITE", "ok": all(all(math.isfinite(v) for v in j["rest"]) for j in joints),
         "message": "rest 坐标有限", "hint": "修正数值"},
    ]
    return {"asset": "character_rig.json", "pass": all(c["ok"] for c in checks),
            "checks": checks, "metrics": {"joints": len(joints)}}


# ------------------------------------------------------------------ 汇总
def summarize(results):
    items = list(results.values())
    failed = [r["asset"] for r in items if not r["pass"]]
    warns = [c["code"] for r in items for c in r["checks"] if not c["ok"]]
    return {"total": len(items), "passed": len(items) - len(failed), "failed": len(failed),
            "failed_assets": failed, "failed_checks": warns,
            "pass_rate": round((len(items) - len(failed)) / max(1, len(items)), 3)}
