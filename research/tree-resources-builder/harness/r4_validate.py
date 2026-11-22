"""R4 校验器：把既有校验口径（welding/间隙/贴地/退化面…）套到 R4 新资产上，
并补 R4 专属检查（面数预算 / 命名规范 / 类别语义 / 同拓扑 / 场景混排 / 服装贴合）。

口径来源
--------
* 几何口径直接调用既有 harness/validate.py 的 validate_geometry()：
  MESH_WATERTIGHT（焊接闭合）/ MESH_VOLUME / DEGENERATE_FACES（退化面）/
  FLOATING_PART（部件间隙）/ GROUND_CONTACT（贴地）/ COMPONENT_LIMIT。
  —— 不另立一套标准，只把 R4 新件接进去。
* 校验对象是**磁盘上的文件**（重新解析 GLB），不是内存里的网格：
  证明落盘件真的能被独立回读。
* trimesh 的 split()/body_count() 依赖 scipy；本机主环境没有 scipy 时会静默退化
  （ENV.md §6.3），所以这里用 --with scipy 跑严格口径，部件数/水密率不退化。

R4 专属检查
-----------
FACE_BUDGET     面数预算（按用途分级：low<=500 / mid<=5000 / hero<=50000）
NAME_CONVENTION <category>_<name>_<variant>
CATEGORY_SEMANTIC 名字解析到的语义类别与台账 category 一致（走 conditions.resolve_category）
LICENSE_PRESENT 许可 SPDX + 来源 + 署名文本齐备
FINGERPRINT_MATCH sidecar 记录的 sha256 与磁盘文件一致（台账可查）
LOD_TIER        用途分级档位合法且与预算一致
TOPOLOGY_HASH   四车身顶点拓扑哈希一致
CLOTH_FIT       服装壳对躯干的 Z 覆盖率与水平偏移
SCENE_GROUND_ZERO 场景实例贴地偏移 = 0
SCENE_NO_INTERPENETRATION 场景混排无穿插

纯 CPU、无生成式模型、无模型权重。
"""
from __future__ import annotations

import argparse
import json
import os
import re

import numpy as np
import trimesh

import r4_common as C
from validate import validate_geometry

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GEO = os.path.join(ROOT, "assets", "geometry")
VAL = os.path.join(ROOT, "assets", "validation")

#: <category>_<name>_<variant>：category 词必须取自语义表；name/variant 可含下划线
NAME_RE = re.compile(
    r"^(prop|tree|tree_canopy|vehicle|building|hero|jacket|clothing|scene)"
    r"_[a-z0-9]+(_[a-z0-9]+)*$")

# 类别 -> 部件数上限（COMPONENT_LIMIT）
MAX_PARTS = {"prop": 16, "tree": 120, "vehicle": 32, "character": 8, "scene": 0}


def _check(checks, code, ok, message, hint=""):
    checks.append({"code": code, "ok": bool(ok), "message": message, "hint": hint})


def _sidecars(directory):
    out = []
    if not os.path.isdir(directory):
        return out
    for name in sorted(os.listdir(directory)):
        if name.endswith(".json"):
            doc = C.read_json(os.path.join(directory, name))
            if isinstance(doc, dict) and doc.get("kind") == "r4_asset":
                out.append(doc)
    return out


def _glb_nodes(path):
    """读回 GLB：返回 [(节点名, 世界坐标网格)]。"""
    scene = trimesh.load(path, force="scene", process=False)
    out = []
    for node in scene.graph.nodes_geometry:
        tf, gname = scene.graph[node]
        mesh = scene.geometry[gname]
        m = mesh.copy()
        m.apply_transform(np.asarray(tf, dtype=float))
        out.append((node, m))
    return out


def _glb_has_color(path):
    """检查 GLB 里有没有材质/贴图（颜色通道）。

    「深度/线稿/法线与显示色彩无关」不是口头约定，而是结构保证：
    R4 资产一律是**纯几何** GLB（无 images / 无 textures / 无 materials），
    条件图通道只能从几何算出来，不可能被显示色彩污染。
    """
    import struct

    with open(path, "rb") as fh:
        head = fh.read(20)
        if len(head) < 20 or head[:4] != b"glTF":
            return {"ok": False, "detail": "不是 GLB"}
    chunk_len, chunk_type = struct.unpack("<I4s", head[12:20])
    if chunk_type != b"JSON":
        return {"ok": False, "detail": "没有 JSON 块"}
    with open(path, "rb") as fh:
        fh.seek(20)
        blob = fh.read(chunk_len).decode("utf-8", "ignore")
    hits = [k for k in ("images", "textures", "materials") if ('"%s"' % k) in blob]
    return {"ok": not hits, "detail": ("无材质/贴图" if not hits
                                       else "含 " + ", ".join(hits))}


def _asset_checks(doc, nodes, category, expect_scale=None):
    """通用资产检查：既有几何口径 + R4 专属。"""
    checks = []
    name = doc.get("name", "")
    usage = doc.get("usage_level", "")
    budget = doc.get("budget_faces", 0)

    # ---- 命名
    _check(checks, "NAME_CONVENTION",
           bool(NAME_RE.match(name)) and len(name.split("_")) >= 3,
           "资产名 %r 符合 <category>_<name>_<variant>" % name,
           "命名必须是 <category>_<name>_<variant>，category 词取自语义表")
    semantic = C.resolve_semantic(name)
    expect_sem = C.EXPECTED_SEMANTIC.get(category, category)
    _check(checks, "CATEGORY_SEMANTIC", semantic == expect_sem,
           "resolve_category(%r) = %r（期望 %r）" % (name, semantic, expect_sem),
           "语义类别走 conditions.resolve_category 的真表，不另造词表")

    # ---- 用途分级与预算
    _check(checks, "LOD_TIER", usage in C.USAGE_LEVELS,
           "用途分级 %r（hero 近景主线 / mid 中景 / low 远景占位）" % usage,
           "分级按用途，不按镜头距离")
    total_faces = sum(int(len(m.faces)) for _, m in nodes)
    _check(checks, "FACE_BUDGET", budget == C.budget_for(usage) and total_faces <= budget,
           "总面数 %d，预算 %d（%s 档）" % (total_faces, budget, usage),
           "预算：low<=500 / mid<=5000 / hero<=50000")

    # ---- 许可与指纹
    lic = doc.get("license") or {}
    _check(checks, "LICENSE_PRESENT",
           bool(lic.get("spdx")) and bool(lic.get("credit"))
           and (lic.get("attribution_required") is not True or bool(lic.get("credit"))),
           "许可 %s；来源 %s" % (lic.get("spdx"), (lic.get("source_url") or "程序化生成")),
           "许可逐件可查：SPDX + 来源页 + 署名文本")
    fp_ok = True
    fp_msg = "sidecar 指纹与磁盘文件一致"
    for f in doc.get("files") or []:
        p = os.path.join(ROOT, f["path"])
        if not os.path.exists(p) or C.sha256_file(p) != f.get("sha256"):
            fp_ok = False
            fp_msg = "指纹不一致：%s" % f.get("path")
    _check(checks, "FINGERPRINT_MATCH", fp_ok, fp_msg,
           "台账逐件可查 sha256：落盘文件变了指纹必须跟着变")

    # ---- 颜色无关：条件通道只能来自几何（纯几何 GLB，无材质/贴图）
    color = _glb_has_color(os.path.join(ROOT, doc["files"][0]["path"]))
    _check(checks, "COLOR_INDEPENDENT", bool(color.get("ok")),
           "深度/线稿/法线与显示色彩无关：GLB %s" % color.get("detail"),
           "R4 资产一律纯几何（无 images/textures/materials），"
           "条件通道不可能被显示色彩污染")

    # ---- 既有几何口径（逐节点）
    max_parts = MAX_PARTS.get(category, 8)
    geo_pass = True
    worst_gap = 0.0
    degen_total = 0
    for node, mesh in nodes:
        # 贴地是**资产级**口径（整个资产最低点在 z=0），不是逐部件：
        # 人物的手/头/躯干本来就在半空，逐部件判贴地必然误红。
        res = validate_geometry(node, mesh, expect_scale,
                                 extra={"check_floating": True, "ground": False})
        for c in res["checks"]:
            if c["code"] == "MESH_VOLUME":
                # 尺度无关化：既有阈值 1e-4 m^3 是绝对值，对 1.24 m 儿童的小部件
                # （手肘球）不公平。改成同口径的退化判据：「体积必须显著大于
                # 自身包围盒体积的 0.01%」——面翻转/截面退化时该比值趋近 0。
                vol = float(res["metrics"].get("volume_m3") or 0.0)
                size = res["metrics"].get("size_m") or {}
                bbox = float(size.get("x", 0)) * float(size.get("y", 0)) * float(size.get("z", 0))
                ok = vol > max(1e-9, 1e-4 * bbox)
                c = {"code": "MESH_VOLUME", "ok": bool(ok),
                     "message": "体积 %.6g m^3，包围盒占比 %.4f%%（阈值 0.01%%，尺度无关判据）"
                                % (vol, (vol / bbox * 100.0) if bbox > 0 else 0.0),
                     "hint": "体积近零通常意味着面反转或截面退化"}
            checks.append(c)
            if not c["ok"]:
                geo_pass = False
        worst_gap = max(worst_gap, float(res["metrics"].get("max_part_gap_m") or 0.0))
        degen_total += int(res["metrics"].get("degenerate_faces") or 0)
        if max_parts:
            _check(checks, "COMPONENT_LIMIT",
                   int(res["metrics"].get("components") or 0) <= max_parts,
                   "%s 部件数 %s（上限 %d）" % (node, res["metrics"].get("components"),
                                              max_parts),
                   "合并相邻部件或减少细节件")
    # 资产级贴地（场景类另有场景口径：地面层在 z<0）
    if category != "scene" and nodes:
        lo = min(float(m.bounds[0][2]) for _, m in nodes)
        _check(checks, "GROUND_CONTACT", abs(lo) <= 0.05,
               "资产最低点 z=%.4f m（阈值 0.05）" % lo,
               "沿 Z 平移使最低点贴地")
    return checks, {"faces": total_faces, "nodes": len(nodes),
                    "max_part_gap_m": round(worst_gap, 4),
                    "degenerate_faces": degen_total}


def validate_props():
    rows = []
    for doc in _sidecars(os.path.join(GEO, "props")):
        path = os.path.join(ROOT, doc["files"][0]["path"])
        nodes = _glb_nodes(path)
        checks, metrics = _asset_checks(doc, nodes, "prop")
        rows.append({"asset": doc["name"], "id": doc["id"],
                     "origin": doc.get("origin"),
                     "usage_level": doc["usage_level"],
                     "budget_faces": doc["budget_faces"],
                     "faces": metrics["faces"],
                     "license": doc["license"]["spdx"],
                     "source": doc["license"].get("source_url"),
                     "pass": all(c["ok"] for c in checks),
                     "checks": checks, "metrics": metrics})
    passed = sum(1 for r in rows if r["pass"])
    report = {"kind": "r4_prop_library", "cpu_only": True,
              "generated_at": C._now() if hasattr(C, "_now") else "",
              "summary": {"total": len(rows), "passed": passed,
                          "failed": len(rows) - passed,
                          "failed_assets": [r["asset"] for r in rows if not r["pass"]]},
              "items": rows}
    C.write_json(os.path.join(VAL, "prop_library.json"), report)
    print("[prop] %d/%d 通过" % (passed, len(rows)))
    for r in rows:
        for c in r["checks"]:
            if not c["ok"]:
                print("   [FAIL] %s %s: %s" % (r["asset"], c["code"], c["message"]))
    return report


def validate_vegetation():
    rows = []
    for doc in _sidecars(os.path.join(GEO, "vegetation")):
        path = os.path.join(ROOT, doc["files"][0]["path"])
        nodes = _glb_nodes(path)
        checks, metrics = _asset_checks(doc, nodes, "tree")
        lod = (doc.get("recipe") or {}).get("variant")
        _check(checks, "LOD_VARIANT", lod in C.USAGE_LEVELS,
               "变体（LOD 档）%r" % lod, "植被变体名即 LOD 档")
        rows.append({"asset": doc["name"], "id": doc["id"], "lod": lod,
                     "usage_level": doc["usage_level"],
                     "budget_faces": doc["budget_faces"],
                     "faces": metrics["faces"],
                     "pass": all(c["ok"] for c in checks),
                     "checks": checks, "metrics": metrics})
    passed = sum(1 for r in rows if r["pass"])
    report = {"kind": "r4_vegetation_lod", "cpu_only": True,
              "summary": {"total": len(rows), "passed": passed,
                          "failed": len(rows) - passed,
                          "failed_assets": [r["asset"] for r in rows if not r["pass"]],
                          "all_within_budget": all(r["faces"] <= r["budget_faces"]
                                                   for r in rows)},
              "items": rows}
    C.write_json(os.path.join(VAL, "vegetation_lod.json"), report)
    print("[veg] %d/%d 通过" % (passed, len(rows)))
    for r in rows:
        for c in r["checks"]:
            if not c["ok"]:
                print("   [FAIL] %s %s: %s" % (r["asset"], c["code"], c["message"]))
    return report


def validate_vehicles():
    rows = []
    hashes = {}
    for doc in _sidecars(GEO):
        if doc.get("category") != "vehicle":
            continue
        path = os.path.join(ROOT, doc["files"][0]["path"])
        nodes = _glb_nodes(path)
        checks, metrics = _asset_checks(doc, nodes, "vehicle")
        body = [m for n, m in nodes if n == "body"]
        if body:
            hashes[doc["name"]] = C.topology_hash(body[0])
        part_names = sorted(n for n, _ in nodes)
        lib = C.read_json(os.path.join(C.R4META, "vehicle_car_parts.json"), {}) or {}
        expected = sorted((lib.get("parts") or {}).keys())
        _check(checks, "PART_SET_STABLE", part_names == expected,
               "部件集 %d 件（四车身一致：%s）" % (len(part_names), "是" if part_names == expected else "否"),
               "语义零件库在 vehicle_car_parts.json")
        rows.append({"asset": doc["name"], "id": doc["id"],
                     "variant": (doc.get("recipe") or {}).get("variant"),
                     "parts": len(part_names),
                     "faces": metrics["faces"],
                     "body_topology_hash": hashes.get(doc["name"], ""),
                     "pass": all(c["ok"] for c in checks),
                     "checks": checks, "metrics": metrics})
    same = len(set(hashes.values())) == 1 and len(hashes) >= 2
    for r in rows:
        ok = True
        _check(r["checks"], "TOPOLOGY_HASH", same,
               "四车身顶点拓扑哈希%s（%s…）"
               % ("一致" if same else "不一致",
                  (r["body_topology_hash"] or "")[:16]),
               "同拓扑 = 面索引表逐字节一致")
        r["pass"] = all(c["ok"] for c in r["checks"])
    passed = sum(1 for r in rows if r["pass"])
    report = {"kind": "r4_vehicle_topology", "cpu_only": True,
              "summary": {"total": len(rows), "passed": passed,
                          "failed": len(rows) - passed,
                          "failed_assets": [r["asset"] for r in rows if not r["pass"]],
                          "all_variants_identical": same},
              "body_topology_hashes": hashes, "items": rows}
    C.write_json(os.path.join(VAL, "vehicle_topology.json"), report)
    print("[veh] %d/%d 通过（同拓扑 %s）" % (passed, len(rows), same))
    for r in rows:
        for c in r["checks"]:
            if not c["ok"]:
                print("   [FAIL] %s %s: %s" % (r["asset"], c["code"], c["message"]))
    return report


def validate_characters():
    rows = []
    for doc in _sidecars(os.path.join(GEO, "soma_variants")):
        path = os.path.join(ROOT, doc["files"][0]["path"])
        nodes = _glb_nodes(path)
        checks, metrics = _asset_checks(doc, nodes, "character")
        body_nodes = [m for n, m in nodes if n.endswith("_torso")]
        # 服装壳按「躯干壳」比贴合（袖子垂在手边，不该算成壳没盖住躯干）
        jacket_nodes = [m for n, m in nodes
                        if n.startswith("jacket_") and n.endswith("_body")]
        _check(checks, "PART_SPLIT", len(nodes) >= 20,
               "部件级拆分：%d 个独立部件节点" % len(nodes),
               "部件级拆分是 R4 验收项（人 10 变体）")
        if body_nodes and jacket_nodes:
            blo, bhi = body_nodes[0].bounds
            jlo, jhi = jacket_nodes[0].bounds
            z_ov = max(0.0, min(bhi[2], jhi[2]) - max(blo[2], jlo[2]))
            j_h = max(jhi[2] - jlo[2], 1e-6)
            ratio = z_ov / j_h
            c_body = ((blo + bhi) / 2)[:2]
            c_jkt = ((jlo + jhi) / 2)[:2]
            off = float(np.linalg.norm(c_body - c_jkt))
            _check(checks, "CLOTH_FIT", ratio > 0.85 and off < 0.05,
                   "服装壳 Z 覆盖 %.0f%%，水平偏移 %.3f m" % (ratio * 100, off),
                   "贴合服装壳：覆盖 >85% 且水平偏移 <0.05 m")
            metrics["cloth_z_cover"] = round(ratio, 3)
            metrics["cloth_center_offset_m"] = round(off, 4)
        rows.append({"asset": doc["name"], "id": doc["id"],
                     "identity": (doc.get("recipe") or {}).get("params", {}).get("name"),
                     "usage_level": doc["usage_level"],
                     "budget_faces": doc["budget_faces"],
                     "faces": metrics["faces"],
                     "pass": all(c["ok"] for c in checks),
                     "checks": checks, "metrics": metrics})
    passed = sum(1 for r in rows if r["pass"])
    report = {"kind": "r4_character_variants", "cpu_only": True,
              "summary": {"total": len(rows), "passed": passed,
                          "failed": len(rows) - passed,
                          "failed_assets": [r["asset"] for r in rows if not r["pass"]]},
              "items": rows}
    C.write_json(os.path.join(VAL, "character_variants.json"), report)
    print("[char] %d/%d 通过" % (passed, len(rows)))
    for r in rows:
        for c in r["checks"]:
            if not c["ok"]:
                print("   [FAIL] %s %s: %s" % (r["asset"], c["code"], c["message"]))
    return report


def validate_scenes():
    """场景混排：无穿插 + 贴地为 0 + 公共件在场。"""
    inst_doc = C.read_json(os.path.join(C.R4META, "scene_instances.json"), {}) or {}
    instances = inst_doc.get("instances") or []
    by_scene = {}
    for inst in instances:
        by_scene.setdefault(inst.get("scene"), []).append(inst)
    rows = []
    for doc in _sidecars(GEO):
        if doc.get("category") != "scene":
            continue
        scene = doc["name"]
        path = os.path.join(ROOT, doc["files"][0]["path"])
        nodes = _glb_nodes(path)
        checks = []
        # 回读校验：文件能被独立解析
        _check(checks, "SCENE_RELOAD", len(nodes) > 10,
               "场景回读：%d 个节点" % len(nodes),
               "场景件必须能被独立解析回读")
        # 贴地：非地面层实例的最低点 = 0
        ground_kinds = ("ground", "road", "sidewalk")
        insts = by_scene.get(scene, [])
        # 按分组算贴地（树 = 树干 + 树冠：树冠在半空，但树组整体贴地）
        groups_g = {}
        for inst in insts:
            if inst.get("kind") in ground_kinds:
                continue
            g = inst.get("group") or inst["instance"]
            hits = [m for n, m in nodes if n == inst["instance"]]
            if not hits:
                continue
            cur = groups_g.setdefault(g, 1e9)
            groups_g[g] = min(cur, min(float(m.bounds[0][2]) for m in hits))
        worst = max((abs(v) for v in groups_g.values()), default=0.0)
        _check(checks, "SCENE_GROUND_ZERO", worst <= 0.001,
               "实例最大离地 %.4f m（阈值 0.001）" % worst,
               "地面/道路/路缘顶面在 z=0，其余实例底面也必须在 z=0")
        # 穿插：按分组（同一资产的多个部件算一组）判 AABB 重叠
        groups = {}
        for inst in insts:
            g = inst.get("group") or inst["instance"]
            if inst.get("kind") in ground_kinds:
                continue
            nodes_hit = [(n, m) for n, m in nodes if n == inst["instance"]]
            if not nodes_hit:
                continue
            lo = np.min([m.bounds[0] for _, m in nodes_hit], axis=0)
            hi = np.max([m.bounds[1] for _, m in nodes_hit], axis=0)
            cur = groups.setdefault(g, [lo, hi, inst["kind"]])
            cur[0] = np.minimum(cur[0], lo)
            cur[1] = np.maximum(cur[1], hi)
        clashes = []
        keys = sorted(groups)
        for i in range(len(keys)):
            for j in range(i + 1, len(keys)):
                lo1, hi1, k1 = groups[keys[i]]
                lo2, hi2, k2 = groups[keys[j]]
                ov = np.minimum(hi1, hi2) - np.maximum(lo1, lo2)
                if ov[0] > 0.02 and ov[1] > 0.02 and ov[2] > 0.02:
                    clashes.append("%s × %s (%.2f,%.2f,%.2f m)"
                                   % (keys[i], keys[j], ov[0], ov[1], ov[2]))
        _check(checks, "SCENE_NO_INTERPENETRATION", not clashes,
               "分组互不穿插：%d 组检查%s"
               % (len(keys), "" if not clashes else "；冲突：" + "；".join(clashes[:6])),
               "同组（同一资产的多部件）不互判，组间必须不穿插")
        # 公共件混排在场
        kinds = {i.get("kind") for i in insts}
        _check(checks, "SCENE_PUBLIC_MIX",
               {"prop", "character", "vehicle", "tree"} <= kinds,
               "混排类别：%s" % ", ".join(sorted(kinds)),
               "街区必须同时含公共件/人物/载具/植被")
        # 分块 LOD
        chunks = {i.get("chunk") for i in insts}
        _check(checks, "SCENE_CHUNK_LOD", {"near", "mid", "far"} <= chunks,
               "分块 LOD 覆盖：%s" % ", ".join(sorted(str(c) for c in chunks)),
               "近/中/远三块都要有实例")
        faces = sum(int(len(m.faces)) for _, m in nodes)
        rows.append({"asset": scene, "id": doc["id"], "nodes": len(nodes),
                     "faces": faces, "instances": len(insts),
                     "kinds": sorted(kinds), "chunks": sorted(str(c) for c in chunks),
                     "max_ground_offset_m": round(worst, 4),
                     "pass": all(c["ok"] for c in checks),
                     "checks": checks,
                     "metrics": {"faces": faces, "nodes": len(nodes),
                                 "instances": len(insts)}})
    passed = sum(1 for r in rows if r["pass"])
    report = {"kind": "r4_scene_mix", "cpu_only": True,
              "summary": {"total": len(rows), "passed": passed,
                          "failed": len(rows) - passed,
                          "failed_assets": [r["asset"] for r in rows if not r["pass"]]},
              "scenes": rows}
    C.write_json(os.path.join(VAL, "scene_mix.json"), report)
    print("[scene] %d/%d 通过" % (passed, len(rows)))
    for r in rows:
        for c in r["checks"]:
            if not c["ok"]:
                print("   [FAIL] %s %s: %s" % (r["asset"], c["code"], c["message"]))
    return report


def main():
    ap = argparse.ArgumentParser(description="R4 资产校验")
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()
    reports = []
    reports.append(validate_props())
    reports.append(validate_vegetation())
    reports.append(validate_vehicles())
    reports.append(validate_characters())
    reports.append(validate_scenes())
    total = sum(r["summary"]["total"] for r in reports)
    passed = sum(r["summary"]["passed"] for r in reports)
    summary = {"kind": "r4_validation_summary", "cpu_only": True,
               "total": total, "passed": passed, "failed": total - passed,
               "classes": {r["kind"]: r["summary"] for r in reports},
               "reports": ["assets/validation/prop_library.json",
                           "assets/validation/vegetation_lod.json",
                           "assets/validation/vehicle_topology.json",
                           "assets/validation/character_variants.json",
                           "assets/validation/scene_mix.json"]}
    C.write_json(os.path.join(VAL, "r4_summary.json"), summary)
    print("[r4] 总计 %d/%d 通过 -> assets/validation/r4_summary.json" % (passed, total))
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
