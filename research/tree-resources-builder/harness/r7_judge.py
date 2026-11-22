# R7 判定器：机器判定「这份配方 + 这份几何」过不过。
#
# 判定权只在机器手里
# ------------------
# 模型自评不算通过（ROADMAP R7「明确不做」）。判定分四层：
#   ① 形状层：配方是不是合法的 r7-recipe/1（字段/类型/区间/命名/许可）
#   ② 关系层：参数之间的结构关系（轴距 vs 车长、冠幅 vs 树高…）
#   ③ 几何层：既有 harness/validate.py 的口径（水密/体积/退化面/尺度/
#      部件数/间隙/贴地）——不另立一套标准
#   ④ 结构层：同拓扑哈希、场景贴地与穿插、服装贴合、道具目标尺寸、确定性
#
# 几何层为什么跑两次 validate_geometry
# -----------------------------------
# R4 的口径是**逐节点**判（R4 校验器按 node 逐个调 validate_geometry），
# 装配体层面的间隙没人判。R7 判装配体，所以拆成两次：
#   * 资产级（全部部件合并）：尺度、水密、体积、退化面、面数预算、贴地；
#   * 装配级（核心部件子集）：部件间隙。
# 核心子集按类别声明：树的冠层、人的服装壳都是**有意**挂在主体外的代理件
# （棕榈叶本来就悬在树冠顶端，立领本来就比下巴高），放进间隙判据会永远判红，
# 所以它们各自有专门的检查：REL_TREE_CANOPY_BASE / CLOTH_FIT_*。
from __future__ import annotations

import hashlib
from typing import Any

import numpy as np

import r7_contract as K
from validate import validate_geometry

#: 各类别的部件数上限（R4 的 MAX_PARTS 口径，人物按装配体放宽到 40）
MAX_PARTS = {"prop": 16, "tree": 120, "vehicle": 32, "character": 40, "scene": None}

#: 装配级间隙检查用哪些部件（None = 全部部件）
CORE_PARTS = {
    "prop": None,
    "tree": ["trunk"],
    "vehicle": None,
    "character": ["body_*"],
    "scene": None,
}

#: 各类别的几何检查开关
GEOM_EXTRA = {
    "prop": {"check_floating": False, "ground": True},
    "tree": {"check_floating": True, "ground": True},
    "vehicle": {"check_floating": True, "ground": True},
    "character": {"check_floating": True, "ground": True},
    "scene": {"check_floating": False, "ground": False},
}


#: 尺度类失败的可执行 hint（validate.py 的通用 hint 只说「调参数」，
#: 模型不知道该动哪个参数 —— R7 把「动哪个」写进 hint，修复轮才有抓手）
SCALE_HINTS = {
    ("vehicle", "SCALE_X"): "车长不对：改 params.length（车身长由 length 决定）",
    ("vehicle", "SCALE_Y"): "车宽不对：整车宽 = 2×(track + 0.12)（车轮外缘），"
                            "收窄 track 或加宽 width",
    ("vehicle", "SCALE_Z"): "车高不对：改 roof 里最高的几个站位（max(roof)）",
    ("tree", "SCALE_X"): "冠幅不对：改 params.canopy_r（冠层半径）",
    ("tree", "SCALE_Y"): "冠幅不对：改 params.canopy_r（冠层半径）",
    ("tree", "SCALE_Z"): "树高不对：改 params.height（主干长度按 height×0.42 起算）",
    ("character", "SCALE_Z"): "身高不对：改 params.height",
}


def _check(checks, code, ok, message, hint=""):
    checks.append({"code": code, "ok": bool(ok), "message": message, "hint": hint})


def _num(v, default=0.0):
    try:
        return float(v)
    except Exception:
        return float(default)


def _core_mesh(parts: dict[str, Any], category: str):
    """装配级间隙检查用的核心部件合并体。"""
    import fnmatch

    pattern = CORE_PARTS.get(category)
    if pattern is None:
        sel = list(parts.values())
    else:
        sel = [m for k, m in parts.items() if any(fnmatch.fnmatch(k, p) for p in pattern)]
    sel = [m for m in sel if m is not None and hasattr(m, "faces")]
    if not sel:
        return None
    from geomlib import merge

    return merge(sel)


# ------------------------------------------------------------------ 关系层

def _check_relations(task, params, checks):
    cat = task["category"]
    if cat == "prop":
        src_max = task["source"].get("current_max_dim_m") or 0.0
        target = _num(params.get("target_max_dim_m"))
        scale = _num(params.get("scale_factor"))
        expect = (target / src_max) if src_max > 0 else 0.0
        ok = abs(scale - expect) <= max(0.02, abs(expect) * 0.02)
        _check(checks, "REL_PROP_SCALE", ok,
               "scale_factor=%.4f，target/source=%.4f（相对差 %.2f%%）"
               % (scale, expect, (abs(scale - expect) / max(1e-6, abs(expect)) * 100)),
               "scale_factor 必须等于 target_max_dim_m ÷ 源件当前最大边长")
    elif cat == "tree":
        h = _num(params.get("height"))
        cr = _num(params.get("canopy_r"))
        ch = _num(params.get("canopy_h"))
        tr = _num(params.get("trunk_r"))
        _check(checks, "REL_TREE_CANOPY_RATIO", cr <= 0.70 * h + 1e-9,
               "canopy_r=%.3f，上限 0.70×height=%.3f" % (cr, 0.70 * h),
               "冠层半径要收窄或树高要抬高")
        _check(checks, "REL_TREE_CANOPY_H", ch <= 0.65 * h + 1e-9,
               "canopy_h=%.3f，上限 0.65×height=%.3f" % (ch, 0.65 * h),
               "冠层厚度要压薄或树高要抬高")
        _check(checks, "REL_TREE_TRUNK", (0.02 * h - 1e-9) <= tr <= (0.10 * h + 1e-9),
               "trunk_r=%.3f，允许 0.02–0.10×height=[%.3f, %.3f]"
               % (tr, 0.02 * h, 0.10 * h),
               "主干半径要落在身高的 2%–10% 之间")
        lod = params.get("lod") or {}
        _check(checks, "REL_TREE_LOD",
               int(lod.get("segments", 0)) >= 4 and 1 <= int(lod.get("levels", 0)) <= 3,
               "lod.segments=%s（≥ 4），lod.levels=%s（1–3）"
               % (lod.get("segments"), lod.get("levels")),
               "截面段数至少 4，分枝层数 1–3")
    elif cat == "vehicle":
        L = _num(params.get("length"))
        W = _num(params.get("width"))
        roof = [_num(x) for x in (params.get("roof") or [])]
        cabin = [_num(x) for x in (params.get("cabin") or [])]
        wb = [_num(x) for x in (params.get("wheelbase") or [])]
        track = _num(params.get("track"))
        wheel_r = _num(params.get("wheel_r"))
        clearance = _num(params.get("clearance"))
        if wb:
            ok = all(abs(x) <= 0.40 * L + 1e-9 for x in wb)
            _check(checks, "REL_VEHICLE_WHEELBASE", ok,
                   "wheelbase=%s，上限 ±0.40×length=±%.3f"
                   % ([round(x, 3) for x in wb], 0.40 * L),
                   "轴距要缩短或车长要加长")
        if len(cabin) == 2:
            ok = 1.5 <= cabin[0] < cabin[1] <= 9.5
            _check(checks, "REL_VEHICLE_CABIN", ok,
                   "cabin=%s（要求 1.5 ≤ 前站位 < 后站位 ≤ 9.5）"
                   % ([round(x, 2) for x in cabin],),
                   "座舱要落在车身中部（站位 1.5–9.5）")
        if roof:
            ok = min(roof) >= clearance - 1e-9
            _check(checks, "REL_VEHICLE_ROOF", ok,
                   "min(roof)=%.3f，clearance=%.3f" % (min(roof), clearance),
                   "车顶最低点不能低于离地间隙，否则车身翻转")
        _check(checks, "REL_VEHICLE_TRACK",
               (0.60 * W - 1e-9) <= 2 * track <= (0.95 * W + 1e-9),
               "2×track=%.3f，允许 0.60–0.95×width=[%.3f, %.3f]"
               % (2 * track, 0.60 * W, 0.95 * W),
               "轮距要与车宽相称")
        whole_w = 2 * (track + 0.12)
        _check(checks, "REL_VEHICLE_WIDTH", whole_w <= 1.12 * W + 1e-9,
               "整车宽 2×(track+0.12)=%.3f，上限 1.12×width=%.3f"
               % (whole_w, 1.12 * W),
               "收窄 track（轮距）或加宽 width")
        _check(checks, "REL_VEHICLE_WHEEL",
               (0.055 * L - 1e-9) <= wheel_r <= (0.115 * L + 1e-9),
               "wheel_r=%.3f，允许 0.055–0.115×length=[%.3f, %.3f]"
               % (wheel_r, 0.055 * L, 0.115 * L),
               "车轮半径要与车长相称")
    elif cat == "scene":
        w = _num(params.get("width"))
        n = int(params.get("building_count") or 0)
        per_row = (n + 1) // 2
        _check(checks, "REL_SCENE_FIT", per_row * (w + 1.5) <= 64.0 + 1e-9,
               "每排 %d 栋 × (width+1.5)=%.1f ≤ 64" % (per_row, per_row * (w + 1.5)),
               "楼体数量或面宽要减小，否则排不进街区块")
        total = sum(int(params.get(k) or 0) for k in
                    ("tree_count", "prop_count", "vehicle_count", "char_count"))
        _check(checks, "REL_SCENE_COUNTS", total <= 40,
               "混排件数 %d（上限 40）" % total, "减少摆件数量")
        floors = int(params.get("floors") or 0)
        _check(checks, "REL_SCENE_FLOORS", 2 <= floors <= 20,
               "floors=%d（允许 2–20）" % floors, "层数要落在 2–20 之间")
    elif cat == "character":
        h = _num(params.get("height"))
        torso = _num(params.get("torso"), 1.0)
        shoulder = _num(params.get("shoulder"), 1.0)
        hip = _num(params.get("hip"), 1.0)
        limb = _num(params.get("limb"), 1.0)
        head = _num(params.get("head"), 1.0)
        _check(checks, "REL_CHAR_SCALE",
               abs(torso - 1) <= 0.20 and abs(shoulder - 1) <= 0.18
               and abs(hip - 1) <= 0.14 and abs(head - 1) <= 0.28,
               "torso=%.3f shoulder=%.3f hip=%.3f head=%.3f"
               % (torso, shoulder, hip, head),
               "体格系数偏离基准不能超过：躯干 0.16 / 肩 0.14 / 胯 0.12 / 头 0.24")
        _check(checks, "REL_CHAR_LIMB", 0.75 <= limb * h <= 2.60,
               "limb×height=%.3f（允许 0.75–2.60）" % (limb * h),
               "肢体粗细要与身长相称")


# ------------------------------------------------------------------ 结构层

def _body_topology_hash(mesh) -> str:
    """与 R4 车身拓扑哈希同口径（同样的前缀与面索引表）。"""
    faces = np.asarray(mesh.faces, dtype=np.int64)
    h = hashlib.sha256()
    h.update(b"body faces=%d verts=%d\n" % (faces.shape[0], len(mesh.vertices)))
    h.update(faces.tobytes())
    return h.hexdigest()


def _check_structure(task, params, built, checks):
    cat = task["category"]
    parts = built.get("parts") or {}
    metrics = built.get("metrics") or {}
    if cat == "prop":
        target = _num(params.get("target_max_dim_m"))
        size = np.asarray(metrics.get("bbox_max", [0, 0, 0])) - \
            np.asarray(metrics.get("bbox_min", [0, 0, 0]))
        measured = float(max(size)) if len(size) == 3 else 0.0
        ok = abs(measured - target) <= max(0.03, target * 0.03)
        _check(checks, "TARGET_DIM", ok,
               "实测最大边长 %.4f m，目标 %.4f m" % (measured, target),
               "缩放后最大边长要等于目标最大边长（±3%）")
    elif cat == "tree":
        canopy = parts.get("canopy")
        h = _num(params.get("height"))
        if canopy is not None:
            base = float(canopy.bounds[0][2])
            ok = base >= 0.18 * h - 1e-9
            _check(checks, "REL_TREE_CANOPY_BASE", ok,
                   "冠层底面 z=%.3f m（要求 ≥ 0.18×height=%.3f）" % (base, 0.18 * h),
                   "冠层不能压到树基：抬高树高或收小冠幅")
    elif cat == "vehicle":
        body = parts.get("body")
        expect = task.get("source", {}).get("body_topology_hash")
        if body is not None and expect:
            got = _body_topology_hash(body)
            _check(checks, "TOPOLOGY_HASH", got == expect,
                   "车身顶点拓扑哈希 %s（台账 %s）" % (got[:12], str(expect)[:12]),
                   "车身拓扑必须与台账一致（12 站位 × 24 截面：参数只改坐标不改拓扑）")
    elif cat == "scene":
        instances = built.get("instances") or []
        ground = [i for i in instances if i.get("layer") == "ground"]
        above = [i for i in instances if i.get("layer") == "above"]
        top_ok = all(abs(float(g["aabb"][1][2])) <= 1e-6 for g in ground)
        _check(checks, "SCENE_GROUND_ZERO", top_ok,
               "地面层 %d 块，顶面统一 z=0" % len(ground),
               "地面/道路/人行道顶面必须统一在 z=0")
        clash = []
        for i in range(len(above)):
            for j in range(i + 1, len(above)):
                a, b = above[i]["aabb"], above[j]["aabb"]
                ov = [min(a[1][k], b[1][k]) - max(a[0][k], b[0][k]) for k in range(3)]
                if ov[0] > 0.05 and ov[1] > 0.05 and ov[2] > 0.05:
                    clash.append("%s↔%s" % (above[i]["name"], above[j]["name"]))
        _check(checks, "SCENE_NO_INTERPENETRATION", not clash,
               "地上件 %d 个，穿插 %d 处" % (len(above), len(clash)),
               "混排件互相穿插：%s" % (", ".join(clash[:4]) or "无"))
        want = {
            "building_count": int(params.get("building_count") or 0),
            "tree_count": int(params.get("tree_count") or 0),
            "prop_count": int(params.get("prop_count") or 0),
            "vehicle_count": int(params.get("vehicle_count") or 0),
            "char_count": int(params.get("char_count") or 0),
        }
        placed = {
            "building_count": sum(1 for i in above if i["name"].startswith("building")),
            "tree_count": sum(1 for i in above if i["name"].startswith("tree")),
            "prop_count": sum(1 for i in above if i["name"].startswith("prop")),
            "vehicle_count": sum(1 for i in above if i["name"].startswith("vehicle")),
            "char_count": sum(1 for i in above if i["name"].startswith("char")),
        }
        missing = {k: (want[k], placed[k]) for k in want if placed[k] < want[k]}
        _check(checks, "SCENE_INSTANCE_COUNT", not missing,
               "要求 %s，实际 %s" % (want, placed),
               "摆件没摆上（候选位被挡）：%s" % (missing or "无"))
    elif cat == "character":
        torso = parts.get("body_torso")
        jacket = parts.get("jacket_body")
        if torso is not None and jacket is not None:
            # 口径与 R4 的 CLOTH_FIT 一致：Z 覆盖率（按服装壳高度）+ 中心水平偏移
            blo, bhi = torso.bounds
            jlo, jhi = jacket.bounds
            z_ov = max(0.0, min(bhi[2], jhi[2]) - max(blo[2], jlo[2]))
            j_h = max(jhi[2] - jlo[2], 1e-6)
            cover = z_ov / j_h
            c_body = (blo + bhi) / 2.0
            c_jkt = (jlo + jhi) / 2.0
            off = float(np.linalg.norm(c_body[:2] - c_jkt[:2]))
            _check(checks, "CLOTH_FIT", cover > 0.85 and off < 0.05,
                   "服装壳 Z 覆盖 %.0f%%，中心水平偏移 %.4f m" % (cover * 100, off),
                   "贴合服装壳：覆盖 >85% 且水平偏移 <0.05 m")


# ------------------------------------------------------------------ 几何层

def _expect_for(task, params) -> dict[str, Any]:
    cat = task["category"]
    if cat == "tree":
        h = _num(params.get("height"))
        cr = _num(params.get("canopy_r"))
        expect: dict[str, Any] = {"z": [h * 0.45, h * 1.25],
                                  "max_parts": MAX_PARTS["tree"]}
        if cr > 0:
            expect["x"] = [cr * 0.80, cr * 2.40]
            expect["y"] = [cr * 0.80, cr * 2.40]
        return expect
    if cat == "vehicle":
        L = _num(params.get("length"))
        W = _num(params.get("width"))
        roof = [_num(x) for x in (params.get("roof") or [])]
        top = max(roof) if roof else 1.4
        # 车宽上限 1.12 而不是 1.06：车轮外缘比 body 宽（整车宽 = 2×(track+0.12)），
        # 1.06 与 REL_VEHICLE_TRACK 的允许区间互相打架（合法 track 也会判红）
        return {"x": [L * 0.95, L * 1.06],
                "y": [W * 0.88, W * 1.12],
                "z": [top * 0.92, top * 1.18],
                "max_parts": MAX_PARTS["vehicle"]}
    if cat == "character":
        h = _num(params.get("height"))
        return {"z": [h * 0.90, h * 1.03], "max_parts": MAX_PARTS["character"]}
    if cat == "prop":
        return {"max_parts": MAX_PARTS["prop"]}
    return {}


def judge(task: dict[str, Any], recipe: dict[str, Any], built: dict[str, Any]) -> dict[str, Any]:
    """返回 {pass, checks, metrics}。built 是 r7_execute.execute 的结果。"""
    checks: list[dict[str, Any]] = []
    params = recipe.get("params") if isinstance(recipe, dict) else {}
    if not isinstance(params, dict):
        params = {}

    checks.extend(K.check_shape(recipe, task))
    _check_relations(task, params, checks)

    metrics: dict[str, Any] = {}
    if built.get("ok"):
        merged = built["merged"]
        cat = task["category"]
        expect = _expect_for(task, params)
        extra = dict(GEOM_EXTRA.get(cat, {}))
        name = (recipe.get("asset_name") if isinstance(recipe, dict) else None) or task["task_id"]

        # 资产级：尺度/水密/体积/退化面/部件数/贴地
        asset_res = validate_geometry(str(name), merged, expect,
                                       {"check_floating": False,
                                        "ground": bool(extra.get("ground"))})
        for c in asset_res["checks"]:
            if c["code"] == "FLOATING_PART":
                continue
            if not c["ok"]:
                # 把通用 hint 换成「该动哪个参数」的可执行 hint
                c = dict(c)
                c["hint"] = SCALE_HINTS.get((cat, c["code"]), c["hint"])
            checks.append(c)
        metrics = dict(asset_res["metrics"])
        metrics.update(built.get("metrics") or {})

        # 装配级：核心部件子集的间隙（冠层/服装壳另有专门判据）
        core = _core_mesh(built.get("parts") or {}, cat)
        if core is not None:
            core_res = validate_geometry(str(name) + "_core", core, {},
                                         {"check_floating": True, "ground": False})
            for c in core_res["checks"]:
                if c["code"] == "FLOATING_PART":
                    checks.append(c)
                if c["code"] == "components":
                    pass
            metrics["core_components"] = core_res["metrics"].get("components")
            metrics["core_max_part_gap_m"] = core_res["metrics"].get("max_part_gap_m")

        budget = task.get("budget_faces") or 0
        faces = int(metrics.get("faces") or 0)
        _check(checks, "FACE_BUDGET", faces <= budget,
               "总面数 %d，预算 %d（%s 档）" % (faces, budget, task["usage_level"]),
               "面数预算：low≤500 / mid≤5000 / hero≤50000")
        _check_structure(task, params, built, checks)
    else:
        _check(checks, "EXECUTE_ERROR", False,
               "配方无法执行：%s" % built.get("error", "未知错误"),
               "按提示修配方参数，让它能被确定性执行器接受")

    failed = [c for c in checks if not c["ok"]]
    return {
        "pass": not failed,
        "checks": checks,
        "metrics": metrics,
        "failed_codes": [c["code"] for c in failed],
    }
