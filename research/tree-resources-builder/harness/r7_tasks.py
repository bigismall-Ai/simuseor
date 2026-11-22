# R7 任务库：从 R4 的真实台账派生任务批次（只读引用，不改 R4 产物）。
#
# 任务是什么
# ----------
# 一个任务 = 「一份规格要求 + 一个待产的资产类别」。云端 LLM 的活是把规格
# 翻译成 JSON 配方；本机负责执行、判定、给 hint。三类事实来源：
#   * 真实台账：assets/nongeometry/r4/*.json（R4 五类资产配方）
#   * 真实资产：assets/geometry/props/*.glb（道具源件，用于缩放执行）
#   * 实例规则：下面 INSTANCE_BANDS（把台账中心值变成带区间的规格）
#
# 为什么要有实例（instance）
# --------------------------
# 台账里一个家族只有一组中心值，样本量不够统计。实例规则把中心值按固定
# 档位缩放成「带区间的规格」，同一家族可派生多个任务；样本量与分档都在
# build_tasks() 里算清楚，落盘可查。
from __future__ import annotations

import json
import os
from typing import Any

import r4_common as C
import r4_generate_assets as GA

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
R4META = os.path.join(ROOT, "assets", "nongeometry", "r4")
GEO = os.path.join(ROOT, "assets", "geometry")

#: 数值字段的实例档位（相对台账中心值的倍率区间）
INSTANCE_BANDS = [
    ("base", 0.98, 1.02),
    ("up", 1.05, 1.14),
    ("down", 0.87, 0.95),
    ("wide", 0.93, 1.08),
    ("alt", 0.90, 1.12),
]

#: LOD 子字段的取值区间（面数是否达标由 FACE_BUDGET 兜底）
LOD_RANGES = {
    "segments": {"range": [4, 8]},
    "levels": {"range": [1, 3]},
    "canopy_blobs": {"range": [1, 7]},
    "canopy_subdiv": {"range": [1, 2]},
    "branch_ratio": {"range": [0.30, 0.45]},
}

CATEGORY_CN = {
    "prop": "道具",
    "tree": "植被",
    "vehicle": "载具",
    "scene": "场景",
    "character": "人物",
}


def _r4(name: str) -> Any:
    return C.read_json(os.path.join(R4META, name))


def _band(spec: dict[str, Any], name: str, value: Any,
          lo: float, hi: float, digits: int = 3) -> None:
    """把台账中心值换算成区间并写进 spec（spec[name] = {"range": [lo, hi]}）。"""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return
    spec[name] = {"range": [round(value * lo, digits), round(value * hi, digits)],
                  "center": value}


def _fixed(spec: dict[str, Any], name: str, value: Any) -> None:
    """固定值字段：模型必须原样回写。"""
    spec[name] = {"fixed": value, "enum": [value]}


def _scaled(value: float, lo: float, hi: float, digits: int = 3) -> list[float]:
    return [round(value * lo, digits), round(value * hi, digits)]


def _scaled_range(values, lo: float, hi: float, digits: int = 3) -> list[float]:
    """数组按倍率缩放后的取值区间（负值方向相反，逐元素算再取并集）。"""
    lo_all, hi_all = [], []
    for v in values:
        a, b = v * lo, v * hi
        lo_all.append(min(a, b))
        hi_all.append(max(a, b))
    return [round(min(lo_all), digits), round(max(hi_all), digits)]


def _round_to(v: float, step: float = 0.01) -> float:
    return round(round(v / step) * step, 4)


def _example(task: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    """给模型的骨架示例（各字段都在自己区间内）。"""
    return {
        "kind": "r7_recipe",
        "schema": "r7-recipe/1",
        "task_id": task["task_id"],
        "asset_name": task["asset_name_hint"],
        "usage_level": task["usage_level"],
        "category": task["category"],
        "params": params,
        "license": {
            "spdx": "LicenseRef-Proprietary",
            "credit": "程序化生成（harness/r7_execute.py，纯 CPU，无生成式模型）",
            "source_url": "",
            "attribution_required": True,
        },
        "notes": "",
    }


def _scale_params(params: dict[str, Any], lo: float, hi: float) -> dict[str, Any]:
    """按实例档位缩放参数中心值（数组逐元素缩放，整数项保持原值）。"""
    out: dict[str, Any] = {}
    for k, v in params.items():
        if isinstance(v, bool):
            out[k] = v
        elif isinstance(v, int):
            out[k] = v
        elif isinstance(v, float):
            out[k] = _round_to(v * (lo + hi) / 2.0)
        elif isinstance(v, list):
            out[k] = [_round_to(x * (lo + hi) / 2.0) if isinstance(x, (int, float))
                      else x for x in v]
        elif isinstance(v, dict):
            out[k] = dict(v)
        else:
            out[k] = v
    return out


# ------------------------------------------------------------------ 道具

def _prop_tasks() -> list[dict[str, Any]]:
    import trimesh

    doc = _r4("prop_library_recipe.json")
    out = []
    for i, v in enumerate(doc.get("variants", [])):
        asset = v["variant"]
        src = os.path.join(GEO, "props", asset + ".glb")
        if not os.path.exists(src):
            continue
        mesh = trimesh.load(src, force="mesh", process=False)
        size = mesh.bounds[1] - mesh.bounds[0]
        cur = float(max(size))
        tier = v.get("usage_level") or v.get("tier") or "low"
        kind, lo, hi = INSTANCE_BANDS[0]
        task_id = "r7-prop-%s-i%02d" % (asset, 0)
        spec = {}
        _band(spec, "target_max_dim_m", cur, lo, hi)
        params = {"scale_factor": _round_to(cur and 1.0),
                  "target_max_dim_m": _round_to(cur)}
        baseline = {"scale_factor": 1.0, "target_max_dim_m": _round_to(cur)}
        spec["scale_factor"] = {"range": [_round_to(cur * lo / cur), _round_to(cur * hi / cur)]}
        spec["scale_factor"] = {"range": [lo, hi]}
        task = {
            "task_id": task_id,
            "category": "prop",
            "category_cn": CATEGORY_CN["prop"],
            "family": asset,
            "instance": 0,
            "instance_kind": kind,
            "usage_level": tier,
            "budget_faces": C.budget_for(tier),
            "asset_name_hint": "%s_r7" % asset,
            "naming": {"pattern": r"^(prop|tree|tree_canopy|vehicle|building|hero|jacket|scene)_[a-z0-9]+(_[a-z0-9]+)*$",
                       "semantic": C.resolve_semantic("%s_r7" % asset)},
            "fields": spec,
            "relations": [
                {"code": "REL_PROP_SCALE",
                 "text": "scale_factor 必须等于 target_max_dim_m ÷ 源件当前最大边长 %.4f m（相对误差 ≤ 2%%）"
                         % cur},
            ],
            "source": {"r4_file": "assets/nongeometry/r4/prop_library_recipe.json",
                       "entry": asset,
                       "prop_glb": os.path.relpath(src, ROOT),
                       "current_max_dim_m": round(cur, 4),
                       "faces": int(len(mesh.faces)),
                       "license": v.get("source")},
            "reference_params": params,
        }
        task["example_recipe"] = _example(task, params)
        out.append(task)
    return out


# ------------------------------------------------------------------ 植被

def _tree_tasks() -> list[dict[str, Any]]:
    doc = _r4("vegetation_recipes.json")
    out = []
    bands = list(INSTANCE_BANDS)
    idx = 0
    for sp in doc.get("species", []):
        for vi, variant in enumerate(sp.get("variants", [])):
            kind, lo, hi = bands[idx % len(bands)]
            idx += 1
            tier = variant.get("usage_level") or "mid"
            params = variant.get("params") or {}
            lod = dict(variant.get("lod") or {})
            spec: dict[str, Any] = {}
            for key in ("height", "trunk_r", "canopy_r", "canopy_h"):
                _band(spec, key, params.get(key), lo, hi)
            _fixed(spec, "shape", params.get("shape"))
            for key in ("branches", "levels", "seed"):
                _fixed(spec, key, params.get(key))
            spec["lod"] = {"subfields": LOD_RANGES}
            base_params = {k: v for k, v in params.items()
                          if k not in ("name", "note")}
            center = _scale_params(base_params, lo, hi)
            center["lod"] = dict(lod)
            baseline = dict(base_params)
            baseline["lod"] = dict(lod)
            task_id = "r7-tree-%s-%s-i%02d" % (sp["species"], variant["variant"],
                                               vi)
            task = {
                "task_id": task_id,
                "category": "tree",
                "category_cn": CATEGORY_CN["tree"],
                "family": sp["species"],
                "instance": vi,
                "instance_kind": kind,
                "usage_level": tier,
                "budget_faces": C.budget_for(tier),
                "asset_name_hint": "tree_%s_%s_r7" % (sp["species"], variant["variant"]),
                "naming": {"pattern": r"^(prop|tree|tree_canopy|vehicle|building|hero|jacket|scene)_[a-z0-9]+(_[a-z0-9]+)*$",
                           "semantic": "tree"},
                "fields": spec,
                "relations": [
                    {"code": "REL_TREE_CANOPY_RATIO",
                     "text": "canopy_r ≤ 0.70 × height"},
                    {"code": "REL_TREE_CANOPY_H", "text": "canopy_h ≤ 0.65 × height"},
                    {"code": "REL_TREE_TRUNK",
                     "text": "0.02 × height ≤ trunk_r ≤ 0.10 × height"},
                    {"code": "REL_TREE_LOD",
                     "text": "lod.segments ≥ 4；lod 各子字段都要在给定区间内"},
                    {"code": "REL_TREE_CANOPY_BASE",
                     "text": "冠层底面不得低于 0.18 × height（冠层不能压到树基）"},
                ],
                "source": {"r4_file": "assets/nongeometry/r4/vegetation_recipes.json",
                           "entry": "%s/%s" % (sp["species"], variant["variant"])},
                "reference_params": center,
                "baseline_params": baseline,
            }
            task["example_recipe"] = _example(task, baseline)
            out.append(task)
    # 每树种再补一个「改规格」实例（换档 + 换 seed），把样本量补到 24
    for sp in doc.get("species", []):
        base = sp.get("variants", [])
        if not base:
            continue
        variant = base[min(1, len(base) - 1)]
        kind, lo, hi = INSTANCE_BANDS[4]
        tier = "hero" if len(out) % 3 == 0 else ("low" if len(out) % 3 == 1 else "mid")
        params = dict(variant.get("params") or {})
        # 改规格实例的 LOD 必须与用途档位对齐：面数预算按档位执法，
        # LOD 与档位不一致的配方谁也修不通过（不可解任务）。
        lod = dict(GA.LODS[tier])
        params["seed"] = int(params.get("seed", 11)) + 7
        spec: dict[str, Any] = {}
        for key in ("height", "trunk_r", "canopy_r", "canopy_h"):
            _band(spec, key, params.get(key), lo, hi)
        _fixed(spec, "shape", params.get("shape"))
        for key in ("branches", "levels"):
            _fixed(spec, key, params.get(key))
        _fixed(spec, "seed", params.get("seed"))
        spec["lod"] = {"subfields": LOD_RANGES}
        base_params = {k: v for k, v in params.items()
                       if k not in ("name", "note")}
        center = _scale_params(base_params, lo, hi)
        center["lod"] = dict(lod)
        task_id = "r7-tree-%s-retune-i%02d" % (sp["species"], len(out))
        task = {
            "task_id": task_id,
            "category": "tree",
            "category_cn": CATEGORY_CN["tree"],
            "family": sp["species"],
            "instance": 90 + len(out),
            "instance_kind": kind + "-retune",
            "usage_level": tier,
            "budget_faces": C.budget_for(tier),
            "asset_name_hint": "tree_%s_r7" % sp["species"],
            "naming": {"pattern": r"^(prop|tree|tree_canopy|vehicle|building|hero|jacket|scene)_[a-z0-9]+(_[a-z0-9]+)*$",
                       "semantic": "tree"},
            "fields": spec,
            "relations": [
                {"code": "REL_TREE_CANOPY_RATIO", "text": "canopy_r ≤ 0.70 × height"},
                {"code": "REL_TREE_CANOPY_H", "text": "canopy_h ≤ 0.65 × height"},
                {"code": "REL_TREE_TRUNK",
                 "text": "0.02 × height ≤ trunk_r ≤ 0.10 × height"},
                {"code": "REL_TREE_LOD",
                 "text": "lod.segments ≥ 4；lod 各子字段都要在给定区间内"},
                {"code": "REL_TREE_CANOPY_BASE",
                 "text": "冠层底面不得低于 0.18 × height（冠层不能压到树基）"},
            ],
            "source": {"r4_file": "assets/nongeometry/r4/vegetation_recipes.json",
                       "entry": "%s/retune" % sp["species"]},
            "reference_params": center,
        }
        task["example_recipe"] = _example(task, baseline)
        out.append(task)
    return out


# ------------------------------------------------------------------ 载具

def _vehicle_tasks() -> list[dict[str, Any]]:
    doc = _r4("vehicle_car_recipe.json")
    out = []
    kinds = INSTANCE_BANDS[:5]
    for v in doc.get("variants", []):
        params = v.get("params") or {}
        for i, (kind, lo, hi) in enumerate(kinds):
            spec: dict[str, Any] = {}
            for key in ("length", "width", "clearance", "cabin_h", "wheel_r", "track"):
                _band(spec, key, params.get(key), lo, hi)
            roof = list(params.get("roof") or [])
            spec["roof"] = {"range": [_round_to(min(roof) * lo), _round_to(max(roof) * hi)],
                             "length": len(roof)}
            spec["cabin"] = {"ranges": [[1.5, 5.0], [6.0, 9.5]]}
            wb = list(params.get("wheelbase") or [1.3, -1.3])
            spec["wheelbase"] = {"range": _scaled_range(wb, lo, hi)}
            vparams = {k: v for k, v in params.items()
                       if k not in ("name", "note")}
            center = _scale_params(vparams, lo, hi)
            baseline = dict(vparams)
            # cabin 是站位号（0–11 的位置），不是长度，不能随比例缩放
            center["cabin"] = list(params.get("cabin") or [3.0, 8.0])
            baseline["cabin"] = list(params.get("cabin") or [3.0, 8.0])
            task_id = "r7-vehicle-%s-i%02d" % (params.get("name", "car"), i)
            task = {
                "task_id": task_id,
                "category": "vehicle",
                "category_cn": CATEGORY_CN["vehicle"],
                "family": params.get("name", "car"),
                "instance": i,
                "instance_kind": kind,
                "usage_level": v.get("usage_level", "hero"),
                "budget_faces": C.budget_for(v.get("usage_level", "hero")),
                "asset_name_hint": "vehicle_car_%s_r7" % params.get("name", "car"),
                "naming": {"pattern": r"^(prop|tree|tree_canopy|vehicle|building|hero|jacket|scene)_[a-z0-9]+(_[a-z0-9]+)*$",
                           "semantic": "vehicle"},
                "fields": spec,
                "relations": [
                    {"code": "REL_VEHICLE_WHEELBASE",
                     "text": "|wheelbase[0]| ≤ 0.40 × length 且 |wheelbase[1]| ≤ 0.40 × length"},
                    {"code": "REL_VEHICLE_CABIN",
                     "text": "1.5 ≤ cabin[0] < cabin[1] ≤ 9.5（站位号，0–11）"},
                    {"code": "REL_VEHICLE_ROOF",
                     "text": "min(roof) ≥ clearance（车顶最低点不得低于离地间隙）"},
                    {"code": "REL_VEHICLE_TRACK",
                     "text": "0.60 × width ≤ 2 × track ≤ 0.95 × width"},
                    {"code": "REL_VEHICLE_WIDTH",
                     "text": "整车宽 = 2 × (track + 0.12)（含车轮外缘），"
                             "须 ≤ 1.12 × width"},
                    {"code": "REL_VEHICLE_WHEEL",
                     "text": "0.055 × length ≤ wheel_r ≤ 0.115 × length"},
                ],
                "source": {"r4_file": "assets/nongeometry/r4/vehicle_car_recipe.json",
                           "entry": params.get("name", "car"),
                           "body_topology_hash": v.get("body_topology_hash")},
                "reference_params": center,
                "baseline_params": baseline,
            }
            task["example_recipe"] = _example(task, baseline)
            out.append(task)
    return out


# ------------------------------------------------------------------ 场景

def _scene_tasks() -> list[dict[str, Any]]:
    doc = _r4("scene_blocks.json")
    out = []
    kinds = INSTANCE_BANDS
    for b in doc.get("blocks", []):
        params = b.get("params") or {}
        floors_lo, floors_hi = params.get("floors", [4, 6])
        w_lo, w_hi = params.get("width", [8.0, 10.0])
        depth = float(params.get("depth", 8.0))
        for i in range(7):
            kind, lo, hi = kinds[i % len(kinds)]
            spec: dict[str, Any] = {
                "floors": {"range": [int(floors_lo), int(floors_hi)]},
                "width": {"range": [_round_to(w_lo * lo), _round_to(w_hi * hi)]},
                "depth": {"range": [_round_to(depth * lo), _round_to(depth * hi)]},
                "building_count": {"fixed": 6},
                "tree_count": {"fixed": 4},
                "prop_count": {"fixed": 6},
                "vehicle_count": {"fixed": 2},
                "char_count": {"fixed": 2},
                "seed": {"fixed": int(params.get("seed", 13)) + i},
            }
            center = {
                "floors": int((floors_lo + floors_hi) / 2),
                "width": _round_to((w_lo + w_hi) / 2),
                "depth": _round_to(depth * (lo + hi) / 2),
                "building_count": 6,
                "tree_count": 4,
                "prop_count": 6,
                "vehicle_count": 2,
                "char_count": 2,
                "seed": int(params.get("seed", 13)) + i,
            }
            baseline = {
                "floors": int((floors_lo + floors_hi) / 2),
                "width": _round_to((w_lo + w_hi) / 2),
                "depth": _round_to(depth),
                "building_count": 6,
                "tree_count": 4,
                "prop_count": 6,
                "vehicle_count": 2,
                "char_count": 2,
                "seed": int(params.get("seed", 13)),
            }
            task_id = "r7-scene-%s-i%02d" % (b["variant"], i)
            task = {
                "task_id": task_id,
                "category": "scene",
                "category_cn": CATEGORY_CN["scene"],
                "family": b["variant"],
                "instance": i,
                "instance_kind": kind,
                "usage_level": "mid",
                "budget_faces": 150000,
                "asset_name_hint": "scene_block_%s_r7" % b["variant"],
                "naming": {"pattern": r"^(prop|tree|tree_canopy|vehicle|building|hero|jacket|scene)_[a-z0-9]+(_[a-z0-9]+)*$",
                           "semantic": C.resolve_semantic("scene_block_%s_r7" % b["variant"])},
                "fields": spec,
                "relations": [
                    {"code": "REL_SCENE_FIT",
                     "text": "每排楼体数（building_count 的一半向上取整）× (width + 1.5) ≤ 64（街区块长）"},
                    {"code": "REL_SCENE_COUNTS",
                     "text": "tree_count + prop_count + vehicle_count + char_count ≤ 40"},
                    {"code": "REL_SCENE_FLOORS", "text": "2 ≤ floors ≤ 20"},
                ],
                "source": {"r4_file": "assets/nongeometry/r4/scene_blocks.json",
                           "entry": b["variant"]},
                "reference_params": center,
            }
            task["example_recipe"] = _example(task, baseline)
            out.append(task)
    return out


# ------------------------------------------------------------------ 人物

def _character_tasks() -> list[dict[str, Any]]:
    doc = _r4("character_variants_recipe.json")
    out = []
    for v in doc.get("variants", []):
        params = v.get("params") or {}
        tier = v.get("usage_level", "hero")
        for i, (kind, lo, hi) in enumerate(INSTANCE_BANDS[:2]):
            spec: dict[str, Any] = {}
            _band(spec, "height", params.get("height"), lo, hi)
            # 体格系数是形状量不是长度：只给 ±4% 窄带，不能跟身高同比例放大
            for key in ("torso", "shoulder", "hip", "limb", "head"):
                _band(spec, key, params.get(key), 0.96, 1.04)
            spec["variant"] = {"enum": [params.get("variant", "base")]}
            cparams = {k: v for k, v in params.items()
                       if k not in ("name", "note")}
            center = _scale_params(cparams, lo, hi)
            baseline = dict(cparams)
            for key in ("torso", "shoulder", "hip", "limb", "head"):
                center[key] = params.get(key)
                baseline[key] = params.get(key)
            task_id = "r7-character-%s-%s-i%02d" % (params.get("name", "hero"),
                                                     params.get("variant", "base"), i)
            task = {
                "task_id": task_id,
                "category": "character",
                "category_cn": CATEGORY_CN["character"],
                "family": "%s_%s" % (params.get("name", "hero"), params.get("variant", "base")),
                "instance": i,
                "instance_kind": kind,
                "usage_level": tier,
                "budget_faces": C.budget_for(tier),
                "asset_name_hint": "hero_%s_%s_r7" % (params.get("name", "hero"),
                                                      params.get("variant", "base")),
                "naming": {"pattern": r"^(prop|tree|tree_canopy|vehicle|building|hero|jacket|scene)_[a-z0-9]+(_[a-z0-9]+)*$",
                           "semantic": "character"},
                "fields": spec,
                "relations": [
                    {"code": "REL_CHAR_SCALE",
                     "text": "|torso-1| ≤ 0.16，|shoulder-1| ≤ 0.14，|hip-1| ≤ 0.12，|head-1| ≤ 0.24"},
                    {"code": "REL_CHAR_LIMB",
                     "text": "1.15 ≤ limb × height ≤ 2.05（肢体粗细与身高的相对关系）"},
                ],
                "source": {"r4_file": "assets/nongeometry/r4/character_variants_recipe.json",
                           "entry": "%s_%s" % (params.get("name"), params.get("variant"))},
                "reference_params": center,
            }
            task["example_recipe"] = _example(task, baseline)
            out.append(task)
    return out


# ------------------------------------------------------------------ 汇总

def build_tasks() -> list[dict[str, Any]]:
    tasks: list[dict[str, Any]] = []
    tasks.extend(_prop_tasks())
    tasks.extend(_tree_tasks())
    tasks.extend(_vehicle_tasks())
    tasks.extend(_scene_tasks())
    tasks.extend(_character_tasks())
    for t in tasks:
        t["example_recipe"]["asset_name"] = t["asset_name_hint"]
        t["example_recipe"]["task_id"] = t["task_id"]
    return tasks


def bucket_stats(tasks: list[dict[str, Any]]) -> dict[str, Any]:
    by_cat: dict[str, int] = {}
    by_tier: dict[str, int] = {}
    for t in tasks:
        by_cat[t["category"]] = by_cat.get(t["category"], 0) + 1
        by_tier[t["usage_level"]] = by_tier.get(t["usage_level"], 0) + 1
    return {
        "total": len(tasks),
        "by_category": dict(sorted(by_cat.items())),
        "by_tier": dict(sorted(by_tier.items())),
        "min_bucket": min(list(by_cat.values()) + list(by_tier.values())),
    }


if __name__ == "__main__":
    ts = build_tasks()
    print(json.dumps(bucket_stats(ts), ensure_ascii=False, indent=2))
    print(json.dumps(ts[0], ensure_ascii=False, indent=2)[:1500])
