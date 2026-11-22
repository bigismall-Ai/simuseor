"""资产台账（asset manifest v2）与校验器：把「资产」变成可引用、可版本化、可追溯的一等实体。

ROADMAP §2.5.2 的字段表是本模块的唯一权威来源：
    id / path / bytes / category / kind / license / provenance / attributes /
    fingerprint / version / source / geometry / hierarchy / lod / validation / tags

两条硬规则（来自 R3 验收方式）
==========================
  1) 每个资产条目必须有 id + fingerprint + license + validation 四项，缺一即红；
  2) 引用完整性：shot spec 与 scene_layout 里引用的每个 asset_id 都必须在 manifest 中存在。

设计取舍
========
* 只依赖标准库（json / hashlib / os / re / argparse），不进 .venv 的依赖闭包，
  任何解释器都能跑；也因此 shot_spec.py 可以安全地 import 本模块取许可常量
  （单向依赖：asset_manifest 读 shot spec 的 JSON 文件，但不 import shot_spec，无环）。
* files[] 是 v1 的冻结快照，原样保留以兼容旧读法；assets[] 才是 v2 的权威视图，
  校验器只对 assets[] 判红。
* 指纹分两层：文件级（每个文件的 sha256）与资产级（对排序后的 path:sha256 再哈希）。
  公共件来自仓库外的源包、无法就地重算，标 fingerprint.source="public_assets.json"，
  只校验台账一致性，不假装重算过。
* attribution_required 由 spdx 派生，不手填布尔位（§2.5.2 明写）。
* 不改写 v1 的 files[]，所以 count / total_bytes 与 files[] 始终自洽。

用法
====
    python asset_manifest.py --build      # 合成 assets/manifest.json（v2）
    python asset_manifest.py --validate   # 校验并写 assets/validation/manifest_report.json
    python asset_manifest.py --check      # 只校验不落盘（CI 用，退出码非 0 即红）

    from asset_manifest import validate_manifest
    report = validate_manifest()          # 不传参则读 assets/manifest.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VAL = os.path.join(ROOT, "assets", "validation")
GEO = os.path.join(ROOT, "assets", "geometry")
NGEO = os.path.join(ROOT, "assets", "nongeometry")
PUB_NORM = os.path.join(ROOT, "assets", "public_normalized")

MANIFEST_PATH = os.path.join(ROOT, "assets", "manifest.json")
REPORT_PATH = os.path.join(VAL, "manifest_report.json")
SCENE_LAYOUT_PATH = os.path.join(NGEO, "scene_layout.json")
SHOT_SPEC_PATH = os.path.join(VAL, "shot_spec.json")

MANIFEST_VERSION = 2

# 每个资产条目必填的四要素（缺一即红）
ASSET_REQUIRED_FIELDS = ("id", "fingerprint", "license", "validation")

# ------------------------------------------------------------------ 许可
# 自产程序化件的许可尚未由用户拍板：这里用 SPDX 的自定义引用 LicenseRef-Proprietary
# 占位（SPDX 许可表达式允许 LicenseRef-<id> 形式），等用户定下来改成正式 SPDX ID 即可；
# 校验器只认「SPDX 形态 + 派生规则」，不认具体某张许可证。
SELF_SPDX = "LicenseRef-Proprietary"
SELF_CREDIT = "程序化生成（harness/generate_assets.py，纯 CPU，无生成式模型）"

# 公共件台账里的许可写法 -> SPDX ID。优先按 license_url 判，其次按名字判。
SPDX_BY_LICENSE_URL = {
    "https://creativecommons.org/publicdomain/zero/1.0/": "CC0-1.0",
    "https://creativecommons.org/licenses/by/4.0": "CC-BY-4.0",
    "https://creativecommons.org/licenses/by/3.0": "CC-BY-3.0",
    "https://polyhaven.com/license": "CC0-1.0",
}
SPDX_BY_NAME = {
    "CC0 1.0": "CC0-1.0",
    "CC0-1.0": "CC0-1.0",
    "CC-BY 4.0": "CC-BY-4.0",
    "CC-BY 3.0": "CC-BY-3.0",
    "CC-BY": "CC-BY-3.0",
}

# 不要求署名的 SPDX（其余一律要求署名：未声明许可的也要署名，保守取向）
NO_ATTRIBUTION_SPDX = ("CC0-1.0", "Unlicense", "CC-PDDC", "0BSD", "PDDL-1.0")


def normalize_spdx(raw, url=None):
    """把台账里的许可写法归一到 SPDX ID；认不出来就原样保留（校验器会判红）。

    URL 归一化会去掉尾斜杠（creativecommons 的两种写法都得认），
    因此查表时键也要同样去掉尾斜杠，否则 CC0 链接匹配不上。
    """
    if not raw:
        return ""
    url = (url or "").strip().rstrip("/")
    for key, spdx in SPDX_BY_LICENSE_URL.items():
        if key.rstrip("/") == url:
            return spdx
    return SPDX_BY_NAME.get(str(raw).strip(), str(raw).strip())


def attribution_required_for(spdx):
    """attribution_required 由 spdx 派生（§2.5.2：不手填布尔位）。

    只有明确的公共领域类许可才不要求署名；CC-BY / MIT / LicenseRef-* 等一律要求署名。
    """
    if not spdx:
        return True
    return spdx not in NO_ATTRIBUTION_SPDX


def is_spdx_shape(spdx):
    """SPDX 标识形态：正式 ID 形如 CC0-1.0 / MIT，或自定义引用 LicenseRef-xxx。"""
    s = spdx or ""
    if not re.match(r"^[A-Za-z0-9.-]+$", s):
        return False
    return "-" in s or s.isupper()


# ------------------------------------------------------------------ 工具
def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _rel(path):
    return os.path.relpath(path, ROOT).replace(os.sep, "/")


def _now():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def asset_fingerprint(files):
    """两层指纹：文件级 sha256 + 资产级合成哈希。

    资产级 = 对排序后的 "path:sha256" 逐行再哈希（内容寻址，与目录顺序无关的稳定值）。
    """
    files = {k: v for k, v in (files or {}).items() if v}
    if not files:
        return {"sha256": "", "algorithm": "sha256", "files": {}, "source": "absent"}
    joined = "\n".join("%s:%s" % (p, files[p]) for p in sorted(files))
    asset_hash = hashlib.sha256(joined.encode("utf-8")).hexdigest()
    return {"sha256": asset_hash, "algorithm": "sha256", "files": files, "source": "computed"}


# ------------------------------------------------------------------ 资产名录
# 程序化几何件：逻辑资产 id -> (类别, 该资产的全部格式文件, 语义类别)
GEOMETRY_ASSETS = [
    ("geometry/character_hero", ["character_hero.glb", "character_hero.obj", "character_hero.stl"], "character"),
    ("geometry/clothing_jacket", ["clothing_jacket.glb"], "clothing"),
    ("geometry/prop_crate", ["prop_crate.glb", "prop_crate.stl"], "prop"),
    ("geometry/vehicle_car", ["vehicle_car.glb", "vehicle_car.obj"], "vehicle"),
    ("geometry/vehicle_boat", ["vehicle_boat.glb"], "vehicle"),
    ("geometry/building_office", ["building_office.glb", "building_office.obj"], "building"),
    ("geometry/creature_quadruped", ["creature_quadruped.glb", "creature_quadruped.stl"], "creature"),
    ("geometry/crowd_block", ["crowd_block.glb"], "crowd"),
    ("geometry/vegetation_tree", ["vegetation_tree.glb"], "vegetation"),
    ("geometry/vegetation_tree_trunk", ["vegetation_tree_trunk.obj"], "vegetation"),
    ("geometry/fx_volume_proxy", ["fx_volume_proxy.obj"], "fx"),
    ("geometry/scene_street", ["scene_street.glb", "scene_street.usda"], "scene"),
    ("geometry/soma_anny_adult", ["soma_anny_adult.glb"], "character"),
    ("geometry/soma_anny_low", ["soma_anny_low.glb"], "character"),
    ("geometry/soma_mhr_low", ["soma_mhr_low.glb"], "character"),
    ("geometry/soma_native_low", ["soma_native_low.glb"], "character"),
]

NONGEOMETRY_ASSETS = [
    ("nongeometry/camera_path", ["camera_path.json"], "camera"),
    ("nongeometry/character_rig", ["character_rig.json"], "rig"),
    ("nongeometry/crowd_layout", ["crowd_layout.json"], "crowd"),
    ("nongeometry/fx_proxy", ["fx_proxy.json"], "fx"),
    ("nongeometry/motion_walk_2s", ["motion_walk_2s.bvh", "motion_walk_meta.json"], "motion"),
    ("nongeometry/scene_layout", ["scene_layout.json"], "layout"),
    ("nongeometry/vegetation_params", ["vegetation_params.json"], "vegetation"),
    ("nongeometry/shot001_hero", ["shot001_hero.npz", "shot001_meta.json"], "shot"),
    ("nongeometry/soma_anny_adult_joints",
     ["soma_anny_adult_joints.json", "soma_anny_adult_joints.npy"], "character"),
    ("nongeometry/soma_joints_low",
     ["soma_joints_low.json", "soma_joints_low.npy", "soma_anny_joints_low.npy"], "character"),
]

# 资产 -> validation_report.json 的 results 键（决定它拿哪份既有校验报告）
VALIDATION_SOURCE = {
    "geometry/character_hero": "character",
    "geometry/clothing_jacket": "clothing",
    "geometry/prop_crate": "prop",
    "geometry/vehicle_car": "vehicle_car",
    "geometry/vehicle_boat": "vehicle_boat",
    "geometry/building_office": "building",
    "geometry/creature_quadruped": "creature",
    "geometry/vegetation_tree": "vegetation",
    "geometry/scene_street": "scene",
    "geometry/soma_anny_adult": "character_soma_anny",
    "nongeometry/camera_path": "camera",
    "nongeometry/motion_walk_2s": "motion",
    "nongeometry/fx_proxy": "fx",
    "nongeometry/crowd_layout": "crowd",
    "nongeometry/scene_layout": "layout",
    "nongeometry/character_rig": "rig",
}

# 资产 -> pipeline_data.json 的 assets 键（程序化件的生成元信息）
PIPELINE_SOURCE = {
    "geometry/character_hero": "character",
    "geometry/clothing_jacket": "clothing",
    "geometry/prop_crate": "prop",
    "geometry/vehicle_car": "vehicle_car",
    "geometry/vehicle_boat": "vehicle_boat",
    "geometry/building_office": "building",
    "geometry/creature_quadruped": "creature",
    "geometry/vegetation_tree": "vegetation",
    "geometry/crowd_block": "crowd",
    "geometry/fx_volume_proxy": "fx",
    "geometry/scene_street": "scene",
    "nongeometry/motion_walk_2s": "motion",
    "nongeometry/camera_path": "camera",
}

# 场景 -> 成员（hierarchy 用；来自 scene_layout 的真实实例）
SCENE_PARENTS = {
    "geometry/scene_street": [
        "geometry/soma_anny_adult", "geometry/building_office", "geometry/vehicle_car",
        "geometry/vegetation_tree", "geometry/crowd_block",
    ],
}

# LOD 档位：base = 当前只有单一档、未分阶梯（R4 补 hero/mid/low）
LOD_LEVELS = ("hero", "mid", "low", "base")

# 公共件：public_assets.json 的 9 件源包（名字 -> 台账里的归一化产物名）
PUBLIC_ALIASES = {"Kenney car-kit": "ambulance"}

# 短名别名 -> 台账 asset_id。
# 镜头包（shots/*/shot_spec.json）里存的是「scene_street」这种短名，不是台账 id；
# 与其让引用完整性判红（然后被绕过），不如把别名显式登记在台账里：
# 引用解析只有两条路——直接命中 asset_id，或经 aliases 命中。
ASSET_ALIASES = {
    "scene_street": "geometry/scene_street",
    "character_hero": "geometry/character_hero",
    "shot001_hero_sequence": "nongeometry/shot001_hero",
}

# 自产件的生成器与工具版本（与 plans/ENV.md §1 记录的主环境一致）
SELF_SOURCE = {
    "generator": "harness/generate_assets.py",
    "cmd": "python harness/run_pipeline.py",
    "tool_version": {"Python": "3.13.14", "numpy": "2.5.4", "trimesh": "5.2.1"},
}
SELF_PROVENANCE = {
    "origin": "procedural",
    "statement": "由本仓库 harness 程序化生成（纯 CPU），非扫描、非 AI 生成",
    "source_url": None,
    "is_ai": 0,
}
SELF_LICENSE = {
    "spdx": SELF_SPDX,
    "source_url": None,
    "license_url": None,
    "attribution_required": True,
    "credit": SELF_CREDIT,
}


# ------------------------------------------------------------------ 合成 v2
def _validation_block(asset_id, validation_report, exports):
    """给资产找一份真实存在的校验证据，拼成 §2.5.2 的 validation 字段。"""
    key = VALIDATION_SOURCE.get(asset_id)
    if key:
        result = (validation_report or {}).get("results", {}).get(key)
        if result:
            checks = [{
                "code": c.get("code", "?"), "ok": bool(c.get("ok")),
                "message": c.get("message", ""), "hint": c.get("hint", ""),
            } for c in result.get("checks", [])]
            return {
                "report_path": "assets/validation/validation_report.json",
                "pass": bool(result.get("pass")),
                "checks": checks,
                "validated_at": (validation_report or {}).get("generated_at", ""),
                "source_key": key,
                "metrics": result.get("metrics", {}),
            }
    # 没有上游几何校验报告的资产（SOMA 低模、关节数据等）-> 用 exports.json 的回读记录
    files = [f for f in (exports or {}).get("files", []) if f.get("ok")]
    if files:
        return {
            "report_path": "assets/validation/exports.json",
            "pass": True,
            "checks": [{
                "code": "EXPORT_RELOAD_OK", "ok": True,
                "message": "%d 个导出件可被独立解析回读" % len(files),
                "hint": "跑 harness/verify_exports.py 复核",
            }],
            "validated_at": "",
            "source_key": "exports",
            "metrics": {"reloaded_files": len(files)},
        }
    return {"report_path": "", "pass": False, "checks": [], "validated_at": "",
            "source_key": "", "metrics": {}}


def _geometry_block(asset_id, exports, validation_report):
    """几何统计：优先 exports.json 的回读数（faces/vertices/bbox），其次 validation metrics。"""
    stem = asset_id.split("/")[-1]
    picked = None
    for f in (exports or {}).get("files", []) or []:
        if os.path.splitext(os.path.basename(f.get("file", "")))[0] == stem:
            picked = f
            break
    key = VALIDATION_SOURCE.get(asset_id, "")
    metrics = ((validation_report or {}).get("results", {}).get(key) or {}).get("metrics", {})
    block = {"verts": None, "faces": None, "watertight": None, "bbox_m": None,
             "up_axis": "Z", "units": "meters"}
    if picked:
        block["faces"] = picked.get("faces")
        block["verts"] = picked.get("vertices")
        block["bbox_m"] = picked.get("bbox_m")
        if "watertight" in picked:
            block["watertight"] = picked["watertight"]
    if block["faces"] is None and metrics.get("faces") is not None:
        block["faces"] = metrics.get("faces")
        block["verts"] = metrics.get("vertices")
    if block["watertight"] is None and metrics.get("watertight_ratio") is not None:
        block["watertight"] = metrics["watertight_ratio"] >= 1.0
    if block["bbox_m"] is None and metrics.get("bbox_min"):
        block["bbox_m"] = list(metrics["bbox_min"]) + list(metrics["bbox_max"])
    return block


def _build_local_assets():
    """程序化件 + 非几何件 -> assets[] 条目。"""
    validation_report = _read_json(os.path.join(VAL, "validation_report.json"), {}) or {}
    exports = _read_json(os.path.join(VAL, "exports.json"), {}) or {}
    pipeline = _read_json(os.path.join(ROOT, "assets", "pipeline_data.json"), {}) or {}
    pipeline_assets = pipeline.get("assets", {}) or {}

    entries = []

    def collect(directory, filenames):
        files = {}
        total = 0
        for name in filenames:
            p = os.path.join(directory, name)
            if not os.path.exists(p):
                continue
            files[_rel(p)] = sha256_of(p)
            total += os.path.getsize(p)
        return files, total

    for asset_id, filenames, category in GEOMETRY_ASSETS:
        files, total = collect(GEO, filenames)
        if not files:
            continue
        primary = sorted(files)[0]
        validation = _validation_block(asset_id, validation_report, exports)
        meta = (pipeline_assets.get(PIPELINE_SOURCE.get(asset_id, ""), {}) or {}).get("meta") or {}
        geometry = _geometry_block(asset_id, exports, validation_report)
        entries.append({
            "id": asset_id,
            "path": primary,
            "bytes": total,
            "category": category,
            "kind": "geometry",
            "license": dict(SELF_LICENSE),
            "provenance": dict(SELF_PROVENANCE),
            "attributes": dict(meta),
            "fingerprint": asset_fingerprint(files),
            "version": "1.0.0",
            "source": dict(SELF_SOURCE, params=dict(meta)),
            "geometry": geometry,
            "hierarchy": {"parent_id": None, "children": []},
            "lod": {"level": "base", "faces": geometry.get("faces"), "source": "exports.json"},
            "validation": validation,
            "tags": [category],
        })

    for asset_id, filenames, category in NONGEOMETRY_ASSETS:
        files, total = collect(NGEO, filenames)
        if not files:
            continue
        primary = sorted(files)[0]
        validation = _validation_block(asset_id, validation_report, exports)
        entries.append({
            "id": asset_id,
            "path": primary,
            "bytes": total,
            "category": category,
            "kind": "nongeometry",
            "license": dict(SELF_LICENSE),
            "provenance": dict(SELF_PROVENANCE),
            "attributes": {},
            "fingerprint": asset_fingerprint(files),
            "version": "1.0.0",
            "source": dict(SELF_SOURCE, params={}),
            "geometry": None,
            "hierarchy": {"parent_id": None, "children": []},
            "lod": {"level": "base", "faces": None, "source": "n/a"},
            "validation": validation,
            "tags": [category],
        })

    # hierarchy：场景 -> 成员（真实来自 scene_layout 的实例集合）
    by_id = {e["id"]: e for e in entries}
    for parent, children in SCENE_PARENTS.items():
        if parent in by_id:
            by_id[parent]["hierarchy"]["children"] = [c for c in children if c in by_id]
    return entries


def _build_public_assets():
    """公共件：public_assets.json 的 9 件源包，许可逐件入台账。

    源包在仓库之外（var/public-assets），无法就地重算 sha256，
    因此 fingerprint.source="public_assets.json"，只做台账一致性校验。
    """
    public_assets = _read_json(os.path.join(VAL, "public_assets.json"), {}) or {}
    public_decimated = _read_json(os.path.join(VAL, "public_decimated.json"), {}) or {}
    entries = []
    for rec in public_assets.get("assets") or []:
        name = rec.get("name", "")
        asset_id = "public/" + name
        spdx = normalize_spdx(rec.get("license"), rec.get("license_url"))
        normalized_name = PUBLIC_ALIASES.get(name, name)
        local_glb = os.path.join(PUB_NORM, normalized_name + ".glb")
        local_files = {}
        if os.path.exists(local_glb):
            local_files[_rel(local_glb)] = sha256_of(local_glb)
        decimated = None
        for d in public_decimated.get("assets") or []:
            if d.get("name") == normalized_name:
                decimated = d
                break
        if local_files:
            fingerprint = asset_fingerprint(local_files)
        else:
            fingerprint = {"sha256": rec.get("sha256", ""), "algorithm": "sha256",
                           "files": {}, "source": "public_assets.json"}
        checks = [{
            "code": "PUBLIC_LEDGER_PRESENT", "ok": True,
            "message": "台账记录齐全（源包 %d 字节，sha256 已录）" % rec.get("bytes", 0),
            "hint": "下载与许可核对走 harness/fetch_public_assets.py",
        }]
        if decimated:
            checks.append({
                "code": "PUBLIC_DECIMATED", "ok": decimated.get("status") == "ok",
                "message": "减面到 %s 面（目标 %s）" % (
                    (decimated.get("faces") or {}).get("decimated"),
                    decimated.get("target_faces")),
                "hint": "减面读数见 assets/validation/public_decimated.json",
            })
        lod = {"level": "base", "faces": None, "source": "n/a"}
        if decimated:
            lod = {"level": "low", "faces": (decimated.get("faces") or {}).get("decimated"),
                   "target_faces": decimated.get("target_faces"),
                   "source": "public_decimated.json"}
        entries.append({
            "id": asset_id,
            "path": (sorted(local_files)[0] if local_files
                     else (rec.get("files") or [""])[0]),
            "bytes": rec.get("bytes", 0),
            "category": rec.get("category", "prop"),
            "kind": "reference",
            "license": {
                "spdx": spdx,
                "source_url": rec.get("page"),
                "license_url": rec.get("license_url"),
                "attribution_required": attribution_required_for(spdx),
                "credit": (rec.get("credit") or (decimated or {}).get("credit")
                           or rec.get("source") or ""),
            },
            "provenance": {
                "origin": "public-download",
                "statement": "下载自 %s（%s）" % (rec.get("source", "?"), rec.get("page", "?")),
                "source_url": rec.get("page"),
                "is_ai": 0,
            },
            "attributes": dict(rec.get("stats") or {}),
            "fingerprint": fingerprint,
            "version": "1.0.0",
            "source": {
                "generator": "harness/fetch_public_assets.py",
                "cmd": "python harness/fetch_public_assets.py",
                "params": {"category": rec.get("category"), "source": rec.get("source")},
                "tool_version": {"Python": "3.13.14", "trimesh": "5.2.1"},
            },
            "geometry": None,
            "hierarchy": {"parent_id": None, "children": []},
            "lod": lod,
            "validation": {
                "report_path": "assets/validation/public_assets.json",
                "pass": True,
                "checks": checks,
                "validated_at": public_assets.get("summary", {}).get("generated_at", ""),
                "source_key": "public_assets",
                "metrics": dict(rec.get("stats") or {}),
            },
            "tags": [rec.get("category", "prop"), "public"],
        })
    return entries


def build_manifest():
    """合成 manifest v2：保留 v1 的 files[] 快照，新增 assets[] 权威视图。"""
    v1 = _read_json(MANIFEST_PATH, {}) or {}
    files = v1.get("files")
    if not files:
        files = []
        for dirpath, _, names in os.walk(os.path.join(ROOT, "assets")):
            for n in sorted(names):
                p = os.path.join(dirpath, n)
                files.append({"path": _rel(p), "bytes": os.path.getsize(p)})
        files.sort(key=lambda f: f["path"])

    assets = _build_local_assets() + _build_public_assets()
    known = {a["id"] for a in assets}
    aliases = {k: v for k, v in ASSET_ALIASES.items() if v in known}
    return {
        "kind": "manifest",
        "version": MANIFEST_VERSION,
        "root": v1.get("root", "research/tree-resources-builder"),
        "cpu_only": True,
        "count": len(files),
        "total_bytes": sum(int(f.get("bytes", 0)) for f in files),
        "files": files,
        "elapsed_s": v1.get("elapsed_s", 0.0),
        "generated_at": _now(),
        "assets": assets,
        "asset_count": len(assets),
        "aliases": aliases,
        "notes": (
            "v2：files[] 是 v1 冻结快照（原样保留以兼容旧读法），assets[] 是权威资产视图。"
            "每个 assets[] 条目必须有 id + fingerprint + license + validation 四项，缺一即红；"
            "校验器见 harness/asset_manifest.py，报告见 assets/validation/manifest_report.json。"
            "aliases[] 是短名到 asset_id 的显式映射（镜头包里的历史短名靠它解析）。"
        ),
    }


def write_manifest(manifest=None):
    manifest = manifest or build_manifest()
    os.makedirs(os.path.dirname(MANIFEST_PATH), exist_ok=True)
    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    return manifest


# ------------------------------------------------------------------ 引用完整性
def _shot_spec_files():
    """收集 shot spec 文件：assets/validation/shot_spec.json + shots/**/shot_spec.json。"""
    out = []
    if os.path.exists(SHOT_SPEC_PATH):
        out.append(SHOT_SPEC_PATH)
    shots_dir = os.path.join(ROOT, "shots")
    if os.path.isdir(shots_dir):
        for dirpath, _, names in os.walk(shots_dir):
            for n in sorted(names):
                if n == "shot_spec.json":
                    out.append(os.path.join(dirpath, n))
    return out


def _referenced_asset_ids():
    """扫描 shot spec 与 scene_layout，取出所有被引用的 asset_id。"""
    refs = {"shot_specs": {}, "scene_layout": []}
    for path in _shot_spec_files():
        doc = _read_json(path)
        if not isinstance(doc, dict):
            continue
        ids = []
        for a in doc.get("assets") or []:
            if isinstance(a, dict) and a.get("asset_id"):
                ids.append(a["asset_id"])
        for lic in doc.get("license") or []:
            if isinstance(lic, dict) and lic.get("asset_id"):
                ids.append(lic["asset_id"])
        refs["shot_specs"][_rel(path)] = sorted(set(ids))
    layout = _read_json(SCENE_LAYOUT_PATH)
    if isinstance(layout, dict):
        ids = []
        for o in layout.get("objects") or []:
            if isinstance(o, dict) and o.get("source"):
                ids.append(o["source"])
        for inst in (layout.get("instances") or {}).values():
            ids.extend(inst)
        refs["scene_layout"] = sorted(set(ids))
    return refs


# ------------------------------------------------------------------ 校验器
def validate_manifest(manifest=None, root=ROOT):
    """校验 manifest v2：四要素 + 指纹重算 + 许可派生 + 引用完整性。

    返回报告 dict：{kind, cpu_only, generated_at, summary, results, cross_checks}。
    每个资产一条 results[id]，内含 checks[]（code/ok/message/hint）。
    """
    manifest = manifest if manifest is not None else (_read_json(MANIFEST_PATH) or {})
    results = {}
    cross = []

    def check(codes, code, ok, message, hint=""):
        codes.append({"code": code, "ok": bool(ok), "message": message, "hint": hint})

    # ---- 顶层
    top = []
    check(top, "MANIFEST_VERSION", manifest.get("version") == MANIFEST_VERSION,
          "manifest.version = %r（期望 %d）" % (manifest.get("version"), MANIFEST_VERSION),
          "用 python harness/asset_manifest.py --build 重新合成")
    files = manifest.get("files")
    check(top, "MANIFEST_FILES_SNAPSHOT", isinstance(files, list),
          "files[] 快照保留：%d 条（v1 兼容层）" % (len(files) if isinstance(files, list) else 0),
          "files[] 必须保留，旧读法依赖它")
    if isinstance(files, list):
        bad = [f for f in files
               if not isinstance(f, dict) or "path" not in f or "bytes" not in f]
        check(top, "MANIFEST_FILES_SHAPE", not bad,
              "files[] 条目结构完整（path+bytes），异常 %d 条" % len(bad),
              "每条必须是 {path, bytes}")
        total = sum(int(f.get("bytes", 0)) for f in files if isinstance(f, dict))
        check(top, "MANIFEST_FILES_TOTAL", total == manifest.get("total_bytes"),
              "total_bytes=%s 与 files[] 求和 %d 一致" % (manifest.get("total_bytes"), total),
              "count/total_bytes 必须与 files[] 自洽")
    assets = manifest.get("assets")
    check(top, "MANIFEST_ASSETS_PRESENT", isinstance(assets, list) and bool(assets),
          "assets[] 权威视图：%d 条" % (len(assets) if isinstance(assets, list) else 0),
          "assets[] 是 v2 的资产清单")
    cross.append({"scope": "manifest", "pass": all(c["ok"] for c in top), "checks": top})

    if not isinstance(assets, list) or not assets:
        return {
            "kind": "manifest_validation", "cpu_only": True, "generated_at": _now(),
            "manifest_path": "assets/manifest.json",
            "manifest_version": manifest.get("version"),
            "summary": {"total": 0, "passed": 0, "failed": 0, "pass_rate": 0.0,
                        "failed_assets": [], "failed_checks": []},
            "results": {}, "cross_checks": cross, "cross_pass": False, "pass": False,
        }

    # ---- 逐资产
    seen_ids = {}
    for entry in assets:
        asset_id = entry.get("id") or "<no-id>"
        codes = []
        check(codes, "ASSET_ID_PRESENT", bool(entry.get("id")),
              "资产条目有 id：%r" % asset_id, "id 是 shot 引用的唯一句柄")
        if entry.get("id"):
            seen_ids[entry["id"]] = seen_ids.get(entry["id"], 0) + 1

        # 四要素：缺一即红
        missing = [f for f in ASSET_REQUIRED_FIELDS if not entry.get(f)]
        check(codes, "ASSET_REQUIRED_FIELDS", not missing,
              ("四要素齐全（%s）" % "/".join(ASSET_REQUIRED_FIELDS)) if not missing
              else "缺要素：%s" % missing,
              "id + fingerprint + license + validation，缺一即红")

        # 指纹：文件级重算 + 资产级复算
        fp = entry.get("fingerprint") or {}
        fp_files = fp.get("files") or {}
        if fp.get("source") == "computed":
            recomputed = {}
            missing_files = []
            for rel_path, recorded in fp_files.items():
                abs_path = os.path.join(root, rel_path)
                if not os.path.exists(abs_path):
                    missing_files.append(rel_path)
                    continue
                recomputed[rel_path] = sha256_of(abs_path)
            check(codes, "ASSET_FINGERPRINT_FILES",
                  not missing_files and all(recomputed.get(p) == fp_files.get(p)
                                            for p in fp_files),
                  ("文件级指纹逐个重算一致（%d 个文件）" % len(fp_files)) if not missing_files
                  else "文件缺失：%s" % missing_files,
                  "指纹是内容寻址，文件改了指纹必须跟着变")
            expect = asset_fingerprint(recomputed).get("sha256")
            check(codes, "ASSET_FINGERPRINT_ASSET", expect == fp.get("sha256"),
                  "资产级指纹与文件级一致（%s...）" % str(fp.get("sha256"))[:16],
                  "资产级 = 对排序后的 path:sha256 再哈希")
        else:
            check(codes, "ASSET_FINGERPRINT_SOURCE",
                  bool(fp.get("sha256")) and fp.get("source") == "public_assets.json",
                  ("外部件指纹取自台账（%s），源包不在仓库内不重算" % fp.get("source"))
                  if fp.get("source") else "指纹缺失：既没有可重算的文件级指纹，也没有台账指纹",
                  "外部件只校验台账一致性")

        # 许可：SPDX 形态 + attribution_required 必须与派生值一致
        lic = entry.get("license") or {}
        spdx = lic.get("spdx")
        check(codes, "ASSET_LICENSE_SPDX", bool(spdx) and is_spdx_shape(spdx),
              "许可 SPDX 标识：%r" % spdx, "spdx 用 SPDX ID 作唯一值域")
        check(codes, "ASSET_LICENSE_ATTRIBUTION",
              lic.get("attribution_required") == attribution_required_for(spdx),
              "attribution_required=%s（由 %s 派生）" % (lic.get("attribution_required"), spdx),
              "署名要求由许可派生，不手填布尔位")
        if attribution_required_for(spdx):
            check(codes, "ASSET_LICENSE_CREDIT", bool(lic.get("credit")),
                  "需署名的件带署名文本", "attribution_required=true 就必须有 credit")

        # 验证状态
        val = entry.get("validation") or {}
        check(codes, "ASSET_VALIDATION_PRESENT",
              bool(val.get("report_path")) and isinstance(val.get("checks"), list),
              "验证回链：%s（%d 条检查）" % (val.get("report_path") or "<无>",
                                            len(val.get("checks") or [])),
              "validation 段必须指回真实存在的报告")
        if val.get("report_path"):
            check(codes, "ASSET_VALIDATION_REPORT_EXISTS",
                  os.path.exists(os.path.join(root, val["report_path"])),
                  "报告文件存在：%s" % val["report_path"], "报告路径必须真的在仓库里")
        check(codes, "ASSET_VALIDATION_PASS", val.get("pass") is True,
              "验证结论 pass=%s" % val.get("pass"), "未通过的资产不得进台账")

        # 层级 / LOD / 类别
        hier = entry.get("hierarchy") or {}
        check(codes, "ASSET_HIERARCHY_SHAPE",
              "parent_id" in hier and isinstance(hier.get("children"), list),
              "层级字段完整（parent_id=%r，children=%d）"
              % (hier.get("parent_id"), len(hier.get("children") or [])),
              "hierarchy 支撑「模型 -> 部件」与「场景 -> 实例」")
        lod = entry.get("lod") or {}
        check(codes, "ASSET_LOD_LEVEL", lod.get("level") in LOD_LEVELS,
              "LOD 档位 %r（%s 面）" % (lod.get("level"), lod.get("faces")),
              "LOD 档位取值：%s" % (LOD_LEVELS,))
        check(codes, "ASSET_CATEGORY_KIND",
              bool(entry.get("category"))
              and entry.get("kind") in ("geometry", "nongeometry", "reference"),
              "类别 %r / 类型 %r" % (entry.get("category"), entry.get("kind")),
              "kind 取 geometry|nongeometry|reference")

        results[asset_id] = {
            "asset": asset_id,
            "pass": all(c["ok"] for c in codes),
            "checks": codes,
            "metrics": {
                "path": entry.get("path"), "bytes": entry.get("bytes"),
                "files": len(fp_files), "category": entry.get("category"),
                "kind": entry.get("kind"),
            },
        }

    # ---- 跨资产
    # 跨资产检查单独成一个 scope（cross 只装 scope 字典，checks 挂在 scope 里）
    xc = []
    dup = sorted(k for k, v in seen_ids.items() if v > 1)
    check(xc, "ASSET_ID_UNIQUE", not dup,
          ("asset_id 全局唯一（%d 个）" % len(seen_ids)) if not dup
          else "重复 id：%s" % dup,
          "重复 id 会让引用指向不明")
    known = set(seen_ids)
    hier_bad = []
    for entry in assets:
        for child in ((entry.get("hierarchy") or {}).get("children") or []):
            if child not in known:
                hier_bad.append("%s -> %s" % (entry.get("id"), child))
        parent = (entry.get("hierarchy") or {}).get("parent_id")
        if parent and parent not in known:
            hier_bad.append("%s 的 parent_id %s" % (entry.get("id"), parent))
    check(xc, "ASSET_HIERARCHY_RESOLVES", not hier_bad,
          "层级引用全部可解析" if not hier_bad else "悬空层级引用：%s" % hier_bad,
          "hierarchy 的 parent_id / children 必须是台账里存在的 id")

    # ---- 引用完整性（shot spec / scene_layout -> manifest）
    refs = _referenced_asset_ids()
    alias_map = manifest.get("aliases") or {}

    def _resolve(ref_id):
        """引用解析：直接命中 asset_id -> 'direct'；经 aliases 命中 -> 'alias'；否则 None。"""
        if ref_id in known:
            return "direct"
        target = alias_map.get(ref_id)
        if target and target in known:
            return "alias"
        return None

    for path, ids in refs["shot_specs"].items():
        missing = [i for i in ids if _resolve(i) is None]
        via_alias = [i for i in ids if _resolve(i) == "alias"]
        check(xc, "SHOT_ASSET_REFERENCE", not missing,
              "%s 引用的 %d 个 asset_id 全部解析到 manifest 条目"
              "（直接命中 %d，经别名 %d）"
              % (path, len(ids), len(ids) - len(via_alias) - len(missing), len(via_alias)),
              ("缺失：%s" % missing) if missing else "引用完整性：shot -> manifest")
    scene_ids = refs["scene_layout"]
    missing_scene = [i for i in scene_ids if _resolve(i) is None]
    check(xc, "SCENE_LAYOUT_REFERENCE", not missing_scene,
          "scene_layout 的 %d 个 asset_id 全部解析到 manifest 条目" % len(scene_ids),
          ("缺失：%s" % missing_scene) if missing_scene else "引用完整性：scene_layout -> manifest")
    check(xc, "SCENE_LAYOUT_REFERENCED", bool(scene_ids),
          "scene_layout 实际引用了 %d 个 asset_id" % len(scene_ids),
          "objects[].source 必须是 asset_id 引用")
    cross.append({"scope": "cross", "pass": all(c["ok"] for c in xc), "checks": xc})

    failed_assets = [k for k, v in results.items() if not v["pass"]]
    failed_checks = []
    for scope in cross:
        for c in scope["checks"]:
            if not c["ok"]:
                failed_checks.append("%s:%s" % (scope["scope"], c["code"]))
    for k, v in results.items():
        for c in v["checks"]:
            if not c["ok"]:
                failed_checks.append("%s:%s" % (k, c["code"]))
    total = len(results)
    passed = total - len(failed_assets)
    summary = {
        "total": total,
        "passed": passed,
        "failed": len(failed_assets),
        "failed_assets": failed_assets,
        "failed_checks": failed_checks,
        "pass_rate": round(passed / total, 6) if total else 0.0,
    }
    cross_pass = all(c["ok"] for scope in cross for c in scope["checks"])
    return {
        "kind": "manifest_validation",
        "cpu_only": True,
        "generated_at": _now(),
        "manifest_path": "assets/manifest.json",
        "manifest_version": manifest.get("version"),
        "summary": summary,
        "results": results,
        "cross_checks": cross,
        "cross_pass": cross_pass,
        "pass": summary["failed"] == 0 and cross_pass,
    }


def write_report(report):
    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    return report


def main(argv=None):
    ap = argparse.ArgumentParser(description="资产台账（manifest v2）合成与校验")
    ap.add_argument("--build", action="store_true", help="合成并写 assets/manifest.json（v2）")
    ap.add_argument("--validate", action="store_true", help="校验并写 assets/validation/manifest_report.json")
    ap.add_argument("--check", action="store_true", help="只校验不落盘（退出码非 0 即红）")
    args = ap.parse_args(argv)
    if not (args.build or args.validate or args.check):
        args.validate = True

    if args.build:
        m = write_manifest()
        print("[build] assets/manifest.json v%s：%d 个资产条目，files[] 快照 %d 条保留"
              % (m["version"], m["asset_count"], m["count"]))

    if args.validate or args.check:
        report = validate_manifest()
        if args.validate:
            write_report(report)
        s = report["summary"]
        n_cross = sum(len(sc["checks"]) for sc in report["cross_checks"])
        n_cross_ok = sum(1 for sc in report["cross_checks"] for c in sc["checks"] if c["ok"])
        print("[validate] 资产 %d/%d 通过，跨资产检查 %d/%d 通过"
              % (s["passed"], s["total"], n_cross_ok, n_cross))
        if s["failed_assets"]:
            print("  失败资产：", ", ".join(s["failed_assets"]))
        for sc in report["cross_checks"]:
            for c in sc["checks"]:
                if not c["ok"]:
                    print("  [FAIL] %s %s: %s" % (sc["scope"], c["code"], c["message"]))
        for k, v in report["results"].items():
            for c in v["checks"]:
                if not c["ok"]:
                    print("  [FAIL] %s %s: %s" % (k, c["code"], c["message"]))
        print("  报告：assets/validation/manifest_report.json" if args.validate
              else "  （--check 不落盘）")
        return 0 if report.get("pass") else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
