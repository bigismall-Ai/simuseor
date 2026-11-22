"""R4 资产注册表：把 R4 新件挂进 manifest v2 的构建流程。

为什么不是直接改 harness/asset_manifest.py
-------------------------------------------
asset_manifest.py 是 R3 既有文件，R4 不改它（文件分工已定）。
它的资产名录（GEOMETRY_ASSETS / NONGEOMETRY_ASSETS）是写死的模块级常量，
新资产要进台账只有两条路：改那个文件，或者在构建时注入。
本模块走第二条：**构建时注入注册表，再调用官方的 build_manifest() /
write_manifest() / validate_manifest()**。台账仍然是构建器生成的，不是手写。

台账字段的来源
--------------
* id / fingerprint / bytes / files：由 asset_manifest 的构建器算（sha256 逐文件重算）。
* license / provenance：来自每个 R4 件的随图 sidecar（<name>.json）。
* validation：来自 R4 自己的校验读数（assets/validation/*.json），
  不是 exports.json 的兜底 —— 逐件能追到具体检查项。
* lod.level / attributes：按用途分级回填（hero/mid/low），不再一律 "base"。
* hierarchy：街区 -> 成员（来自场景实例表）。

纯标准库 + 既有模块；无外部依赖。
"""
from __future__ import annotations

import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GEO = os.path.join(ROOT, "assets", "geometry")
NGEO = os.path.join(ROOT, "assets", "nongeometry")
VAL = os.path.join(ROOT, "assets", "validation")

import r4_common as C  # noqa: E402

#: R4 几何件的 sidecar 目录 -> (资产 id 前缀, manifest category)
SIDECAR_DIRS = [
    ("props", "geometry/props", "prop"),
    ("vegetation", "geometry/vegetation", "tree"),
    ("soma_variants", "geometry/soma_variants", "character"),
]

#: R4 非几何契约（配方 / 实例表）-> manifest category
R4META_FILES = [
    ("r4_vehicle_dynamics.json", "vehicle"),
    ("prop_library_recipe.json", "recipe"),
    ("vegetation_recipes.json", "recipe"),
    ("vegetation_instances.json", "layout"),
    ("vehicle_car_recipe.json", "recipe"),
    ("vehicle_car_parts.json", "part_library"),
    ("character_variants_recipe.json", "recipe"),
    ("scene_blocks.json", "recipe"),
    ("scene_instances.json", "layout"),
    ("color_independence.json", "convention"),
]

#: 校验读数文件 -> (kind, 取 items 的键)
VALIDATION_REPORTS = [
    ("assets/validation/prop_library.json", "items"),
    ("assets/validation/vegetation_lod.json", "items"),
    ("assets/validation/vehicle_topology.json", "items"),
    ("assets/validation/character_variants.json", "items"),
    ("assets/validation/scene_mix.json", "scenes"),
]


def _sidecars():
    """扫描全部 R4 随图 sidecar。"""
    out = []
    for sub, _prefix, _cat in SIDECAR_DIRS:
        d = os.path.join(GEO, sub)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if not name.endswith(".json"):
                continue
            doc = C.read_json(os.path.join(d, name))
            if isinstance(doc, dict) and doc.get("kind") == "r4_asset":
                out.append((sub, doc))
    # 顶层 R4 件（载具四车身 / 三个街区）
    for name in sorted(os.listdir(GEO)):
        if not name.endswith(".json"):
            continue
        doc = C.read_json(os.path.join(GEO, name))
        if isinstance(doc, dict) and doc.get("kind") == "r4_asset":
            out.append(("", doc))
    return out


def geometry_assets():
    """注入构建器的几何资产名录：[(asset_id, [相对 GEO 的文件名], category)]。"""
    out = []
    for sub, doc in _sidecars():
        asset_id = doc.get("id", "")
        if not asset_id.startswith("geometry/"):
            continue
        rel = asset_id[len("geometry/"):]
        # 相对 assets/geometry 的路径（含子目录 props/ vegetation/ …）
        out.append((asset_id, [rel + ".glb"], doc.get("category", "prop")))
    return out


def nongeometry_assets():
    """注入构建器的非几何资产名录。"""
    out = []
    for fname, category in R4META_FILES:
        if not os.path.exists(os.path.join(C.R4META, fname)):
            continue
        # 文件名相对 assets/nongeometry（R4META 在其下的 r4/ 子目录）
        out.append(("nongeometry/r4/" + fname[:-5], ["r4/" + fname], category))
    if os.path.exists(os.path.join(NGEO, "r4_vehicle_dynamics.json")):
        out.append(("nongeometry/r4_vehicle_dynamics",
                    ["r4_vehicle_dynamics.json"], "vehicle"))
    return out


def aliases():
    """短名 -> asset_id（R4 新件也登记进来，镜头包可以直接用短名引用）。"""
    out = {}
    for _sub, doc in _sidecars():
        name = doc.get("name", "")
        if name and doc.get("id"):
            out[name] = doc["id"]
    return out


def _validation_rows():
    """把 R4 校验读数摊平成 {资产名: (report_path, report_kind, row)}。"""
    rows = {}
    for rel, key in VALIDATION_REPORTS:
        doc = C.read_json(os.path.join(ROOT, rel), {}) or {}
        for row in doc.get(key) or []:
            rows[row.get("asset")] = (rel, doc.get("kind", ""), row)
    return rows


def validation_for(asset_id):
    """给构建器一个 R4 资产的 validation 段（找不到就返回 None，交给官方兜底）。"""
    rows = _validation_rows()
    name = asset_id.split("/")[-1]
    hit = rows.get(name)
    if hit:
        rel, kind, row = hit
        checks = [{"code": c.get("code", "?"), "ok": bool(c.get("ok")),
                   "message": c.get("message", ""), "hint": c.get("hint", "")}
                  for c in row.get("checks") or []]
        metrics = dict(row.get("metrics") or {})
        metrics["faces"] = row.get("faces")
        metrics["usage_level"] = row.get("usage_level")
        return {"report_path": rel, "pass": bool(row.get("pass")), "checks": checks,
                "validated_at": "", "source_key": kind, "metrics": metrics}
    # R4 非几何契约：解析回读 + 引用完整性
    if asset_id.startswith("nongeometry/r4") or asset_id.startswith("nongeometry/r4_"):
        fname = asset_id.split("/")[-1]
        path = os.path.join(C.R4META, fname + ".json") if "r4/" in asset_id else \
            os.path.join(NGEO, fname + ".json")
        if not os.path.exists(path):
            return None
        doc = C.read_json(path, {}) or {}
        known = {d.get("id") for _s, d in _sidecars()}
        checks = [{"code": "JSON_PARSE_OK", "ok": isinstance(doc, dict),
                   "message": "配方/实例表可被独立解析回读",
                   "hint": "跑 harness/asset_manifest.py --validate 复核"}]
        refs = []
        for inst in doc.get("instances") or []:
            asset = inst.get("asset")
            if asset and asset.startswith("geometry/"):
                refs.append(asset)
        if refs:
            missing = sorted({r for r in refs if r not in known})
            checks.append({"code": "ASSET_REF_RESOLVES", "ok": not missing,
                           "message": "实例表引用的 %d 个 asset_id %s"
                                      % (len(set(refs)), "全部可解析" if not missing
                                         else "有缺失：" + ", ".join(missing)),
                           "hint": "引用完整性：实例表 -> 台账"})
        return {"report_path": C.rel(path),
                "pass": all(c["ok"] for c in checks), "checks": checks,
                "validated_at": "", "source_key": "r4_contract",
                "metrics": {"instances": len(doc.get("instances") or []),
                            "variants": len(doc.get("variants") or [])}}
    return None


def decorate(manifest):
    """构建器产出之后回填 R4 字段（LOD 档位 / 用途分级 / 来源 / 层级）。

    官方构建器对所有本地件一律写 lod.level="base"、attributes={}；
    R4 件有明确的用途分级与配方，必须回填，否则台账表达不了「按用途分级」。
    """
    by_id = {}
    for _sub, doc in _sidecars():
        by_id[doc.get("id")] = doc
    # 街区 -> 成员（来自场景实例表）
    scene_children = {}
    for fname in ("scene_instances.json",):
        doc = C.read_json(os.path.join(C.R4META, fname), {}) or {}
        for inst in doc.get("instances") or []:
            scene_children.setdefault(inst.get("scene"), set()).add(inst.get("asset"))
    for entry in manifest.get("assets") or []:
        doc = by_id.get(entry.get("id"))
        if not doc:
            continue
        level = doc.get("usage_level")
        faces = (doc.get("geometry") or {}).get("faces")
        entry["lod"] = {"level": level, "faces": faces, "source": "sidecar"}
        if faces is None:
            g = entry.get("geometry") or {}
            faces = g.get("faces")
            entry["lod"]["faces"] = faces
        attrs = dict(entry.get("attributes") or {})
        attrs.update({
            "usage_level": level,
            "budget_faces": doc.get("budget_faces"),
            "semantic_category": doc.get("semantic_category"),
            "recipe_id": (doc.get("recipe") or {}).get("recipe_id"),
            "variant": (doc.get("recipe") or {}).get("variant"),
            "nodes": len(doc.get("nodes") or []) or None,
            "origin": doc.get("origin"),
        })
        if doc.get("note"):
            attrs["note"] = doc["note"]
        entry["attributes"] = {k: v for k, v in attrs.items() if v is not None}
        entry["tags"] = sorted(set((entry.get("tags") or []) +
                                   [doc.get("category"), level] +
                                   ([doc["origin"]] if doc.get("origin") else [])))
        # 许可与来源按 sidecar 逐件回填（公共件是 CC0，程序化件是自制）
        lic = dict(entry.get("license") or {})
        side_lic = doc.get("license") or {}
        for k in ("spdx", "source_url", "license_url", "attribution_required", "credit"):
            if k in side_lic:
                lic[k] = side_lic[k]
        entry["license"] = lic
        prov = dict(entry.get("provenance") or {})
        prov.update({k: v for k, v in (doc.get("provenance") or {}).items()
                      if v is not None})
        entry["provenance"] = prov
        src = dict(entry.get("source") or {})
        # 生成器出处按件回填（公共件 = 取材器；程序化件 = 各自的生成器）
        prov_gen = (doc.get("provenance") or {}).get("generator")
        if prov_gen:
            src["generator"] = prov_gen
            src["cmd"] = "python %s" % prov_gen
        elif (doc.get("provenance") or {}).get("origin") == "public-download":
            src["generator"] = "harness/r4_fetch_props.py"
            src["cmd"] = "python harness/r4_fetch_props.py --build"
        src["params"] = dict(src.get("params") or {})
        src["params"].update({"usage_level": level,
                               "budget_faces": doc.get("budget_faces")})
        entry["source"] = src
        children = sorted(c for c in scene_children.get(entry.get("id"), set()) if c)
        if children:
            entry["hierarchy"] = {"parent_id": None, "children": children}
    return manifest
