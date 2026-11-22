#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R5 · 最小导演台（只读本地）——看板验收。

口径沿用 harness/verify_report.py（静态外链扫描 + JS 语法 + 真机 file:// 打开），
额外加一组「看板专属」断言：9 个镜头包齐全、字段齐全、跳转链接落到真实文件、
缩略图字节与镜头包里现成的 contact_sheet.jpg 完全一致（证明没有额外渲染）。

产出：assets/validation/board_check.json（读数）
只读：boards/shot_board.html 与所有被引用的读数/镜头包；不写回任何既有产物。
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BOARD = os.path.join(ROOT, "boards", "shot_board.html")
OUT = os.path.join(ROOT, "assets", "validation", "board_check.json")
SHOTS = os.path.join(ROOT, "assets", "validation", "ui")

SRC_LIBRARY = "assets/validation/shot_library.json"
SRC_INTRINSICS = "assets/validation/camera_intrinsics.json"
SRC_PACKAGE = "assets/validation/shot_package_check.json"
SRC_MANIFEST = "assets/manifest.json"

VALID_STATUS = {"draft", "validated", "approved"}


def rel(p):
    return os.path.join(ROOT, p)


def read_json(p):
    with open(rel(p), encoding="utf-8") as f:
        return json.load(f)


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def static_checks(html):
    res = {}
    res["bytes"] = os.path.getsize(BOARD)
    res["external_resource_tags"] = len(re.findall(
        r'<(?:script|img|link|iframe)[^>]+(?:src|href)\s*=\s*["\']https?://', html, re.I))
    res["css_imports"] = len(re.findall(r'@import|url\(\s*["\']?https?://', html, re.I))
    res["data_uris"] = len(re.findall(r'data:image/[a-z]+;base64,', html))
    res["svg_inline"] = len(re.findall(r'<svg[^>]*>', html))
    res["img_tags"] = len(re.findall(r'<img[^>]*>', html))
    res["sections"] = re.findall(r'<section id="([^"]+)"', html)
    res["nav_targets"] = sorted(set(re.findall(r'<a href="#([^"]+)"', html)))
    m = re.search(r"<title>(.*?)</title>", html, re.S)
    res["title"] = m.group(1) if m else ""
    res["external_anchors"] = len(re.findall(r'<a [^>]*href="https?://', html, re.I))
    res["http_occurrences_total"] = len(re.findall(r"https?://", html))
    res["protocol_relative"] = len(re.findall(r'(?:src|href)="//', html))
    res["cjk_ok"] = ("白模" in html) and ("????" not in html)
    bad = 0
    for m in re.finditer(r'data:image/[a-z]+;base64,([A-Za-z0-9+/=]+)', html):
        try:
            base64.b64decode(m.group(1)[:400] + "==", validate=False)
        except Exception:
            bad += 1
    res["undecodable_images"] = bad
    res["js_bytes"] = sum(len(s) for s in re.findall(r"<script>(.*?)</script>", html, re.S))
    # 缩略图是 base64 原字节内联在数据块里（运行时才拼成 data: URI），这里按块计数
    payload = embedded_payload(html) or {}
    blobs = [s.get("thumb_b64", "") for s in payload.get("shots", []) if s.get("thumb_b64")]
    res["embedded_thumb_blobs"] = len(blobs)
    res["embedded_thumb_blobs_decodable"] = sum(
        1 for b in blobs if _b64_ok(b))
    res["embedded_thumb_bytes_total"] = sum(len(b) for b in blobs)
    return res


def _b64_ok(b64):
    try:
        base64.b64decode(b64, validate=True)
        return True
    except Exception:
        return False


def js_syntax(html):
    scripts = re.findall(r"<script>(.*?)</script>", html, re.S)
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
        f.write("\n".join(scripts))
        tmp = f.name
    try:
        p = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
        return {"ok": p.returncode == 0, "stderr": (p.stderr or "").strip()[:600]}
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def ui_check():
    os.makedirs(SHOTS, exist_ok=True)
    p = subprocess.run(["node", os.path.join(HERE, "verify_board.js"), BOARD, SHOTS],
                       capture_output=True, text=True, timeout=300)
    if p.returncode != 0 and not p.stdout.strip():
        return {"ok": False, "stderr": (p.stderr or "")[:1200]}
    try:
        data = json.loads(p.stdout.strip())
    except Exception:
        return {"ok": False, "stdout": p.stdout[:800], "stderr": (p.stderr or "")[:800]}
    return data


def embedded_payload(html):
    m = re.search(r'<script id="boardData" type="application/json">(.*?)</script>', html, re.S)
    if not m:
        return None
    return json.loads(m.group(1).replace("\\u003c", "<"))


def board_checks(html, payload):
    """看板专属断言：镜头包齐全、字段齐全、跳转链接真实存在、缩略图字节未被改动。"""
    lib = read_json(SRC_LIBRARY)
    pkg = read_json(SRC_PACKAGE)
    intr = read_json(SRC_INTRINSICS)
    man = read_json(SRC_MANIFEST)

    lib_ids = [e["shot_id"] for e in lib.get("entries", [])]
    pkg_by_id = {s["shot_id"]: s for s in pkg.get("shots", [])}
    payload_by_id = {s["shot_id"]: s for s in payload.get("shots", [])}

    res = {}
    res["n_payload_shots"] = len(payload_by_id)
    res["expected_shot_ids"] = lib_ids
    res["all_library_shots_present"] = all(sid in payload_by_id for sid in lib_ids)
    res["n_expected"] = len(lib_ids)

    row_fields = []
    mismatches = []
    link_targets = []
    thumb_diffs = []
    for sid in lib_ids:
        s = payload_by_id.get(sid)
        if not s:
            mismatches.append(sid + ": 不在看板里")
            continue
        pe = pkg_by_id.get(sid, {})
        row = {
            "shot_id": sid,
            "镜号": s.get("no"),
            "类型": s.get("type"),
            "类型_中文": s.get("type_zh"),
            "时长_s": s.get("duration_s"),
            "校验通过_包": s.get("pkg_checks", {}).get("n_pass"),
            "校验项数_包": s.get("pkg_checks", {}).get("n_checks"),
            "校验通过_库": s.get("lib_checks", {}).get("n_pass"),
            "校验项数_库": s.get("lib_checks", {}).get("n_checks"),
            "状态": s.get("status"),
        }
        row_fields.append(row)
        if row["时长_s"] is None or row["校验通过_包"] is None:
            mismatches.append(sid + ": 关键字段缺失")
        if pe and row["校验通过_包"] != pe.get("n_pass"):
            mismatches.append(sid + ": 包校验通过数与 shot_package_check.json 不一致")
        if s.get("status") not in VALID_STATUS:
            mismatches.append(sid + ": 状态值不在 draft/validated/approved 闭集内")
        # 跳转链接必须落到真实文件
        for key, target in (s.get("links") or {}).items():
            p = os.path.normpath(os.path.join(ROOT, "boards", target))
            exists = os.path.exists(p)
            link_targets.append({"shot_id": sid, "kind": key, "href": target,
                                 "resolved": os.path.relpath(p, ROOT), "exists": exists})
            if not exists:
                mismatches.append(sid + ": 跳转链接指向不存在的文件 → " + target)
        # 缩略图字节必须与镜头包里的现成文件完全一致
        thumb_rel = s.get("thumb_path", "")
        if thumb_rel and os.path.exists(rel(thumb_rel)):
            with open(rel(thumb_rel), "rb") as f:
                disk = f.read()
            inline = base64.b64decode(s.get("thumb_b64", ""))
            same = sha256_bytes(disk) == sha256_bytes(inline) == s.get("thumb_sha256")
            thumb_diffs.append({"shot_id": sid, "path": thumb_rel, "bytes": len(disk),
                                "identical": bool(same)})
            if not same:
                mismatches.append(sid + ": 缩略图字节与现成 contact sheet 不一致")
        else:
            mismatches.append(sid + ": 缺 contact sheet")

    res["rows"] = row_fields
    res["fields_present_all"] = all(
        r["镜号"] and r["类型"] and r["时长_s"] is not None
        and r["校验通过_包"] is not None and r["状态"] for r in row_fields)
    res["link_targets"] = link_targets
    res["n_links"] = len(link_targets)
    res["n_links_missing"] = sum(1 for t in link_targets if not t["exists"])
    res["thumb_checks"] = thumb_diffs
    res["thumbs_identical"] = all(t["identical"] for t in thumb_diffs) and len(thumb_diffs) == len(lib_ids)
    res["mismatches"] = mismatches
    res["n_mismatches"] = len(mismatches)

    res["intrinsics_shots_covered"] = sum(1 for sid in lib_ids if sid in intr.get("shots", {}))
    res["intrinsics_all_covered"] = res["intrinsics_shots_covered"] == len(lib_ids)
    res["manifest_version"] = man.get("version")
    res["status_closed_set"] = all(s.get("status") in VALID_STATUS for s in payload_by_id.values())
    res["timeline_frames_per_shot"] = {sid: payload_by_id[sid]["timeline"]["n_frames"]
                                       for sid in lib_ids if sid in payload_by_id}
    res["timeline_matches_intrinsics"] = all(
        payload_by_id[sid]["timeline"]["n_frames"] == intr["shots"][sid].get("n_frames")
        for sid in lib_ids if sid in payload_by_id and sid in intr.get("shots", {}))
    return res


def main():
    html = open(BOARD, encoding="utf-8").read()
    st = static_checks(html)
    js = js_syntax(html)
    payload = embedded_payload(html)
    board = board_checks(html, payload) if payload else {"n_mismatches": -1, "mismatches": ["看板数据块缺失"]}
    ui = ui_check()
    ui_ok = bool(ui.get("ok"))
    payload_out = {
        "checked_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "board": "boards/shot_board.html",
        "generator": "harness/board.py",
        "verifier": "harness/verify_board.py",
        "static": st,
        "js_syntax": js,
        "board_checks": board,
        "ui": ui,
    }
    payload_out["summary"] = {
        "static_ok": (st["external_resource_tags"] == 0 and st["css_imports"] == 0
                      and st["external_anchors"] == 0 and st["http_occurrences_total"] == 0
                      and st["protocol_relative"] == 0 and st["undecodable_images"] == 0
                      and st["embedded_thumb_blobs"] == 9
                      and st["embedded_thumb_blobs_decodable"] == st["embedded_thumb_blobs"]),
        "js_ok": js["ok"],
        "board_ok": (board.get("n_mismatches") == 0 and board.get("all_library_shots_present")
                     and board.get("fields_present_all") and board.get("thumbs_identical")
                     and board.get("timeline_matches_intrinsics")),
        "ui_ok": ui_ok,
        "console_errors": len(ui.get("errors", []) or []),
        "external_requests": len(ui.get("external_requests", []) or []),
        "failed_requests": len(ui.get("failed_requests", []) or []),
        "broken_images": (ui.get("images", {}) or {}).get("broken", -1),
        "shots_listed": (ui.get("checks", {}).get("probe", {}) or {}).get("rows", -1),
        "thumb_cards": (ui.get("checks", {}).get("probe", {}) or {}).get("cards", -1),
    }
    payload_out["ok"] = all(payload_out["summary"][k] for k in ("static_ok", "js_ok", "board_ok", "ui_ok"))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload_out, f, ensure_ascii=False, indent=2)
    print(json.dumps(payload_out["summary"], ensure_ascii=False, indent=2))
    if not payload_out["ok"]:
        print(json.dumps({"mismatches": board.get("mismatches", []),
                          "ui_errors": ui.get("errors", []),
                          "js_stderr": js.get("stderr", "")}, ensure_ascii=False, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()
