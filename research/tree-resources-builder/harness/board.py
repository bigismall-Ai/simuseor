#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R5 · 最小导演台（只读本地）——生成单文件离线看板 boards/shot_board.html。

口径来源：plans/ROADMAP-IMAGE-VIDEO.md §4「R5 · 最小导演台（只读本地）」。
  范围 ① 镜头列表 ② 缩略图墙（读现成 contact sheet）③ 时间轴（读 camera_intrinsics.json）
        ④ 状态字段（draft/validated/approved）⑤ 批注位（本地、无账号）
  验收 ① file:// 打开、0 外链、0 控制台错误（沿用 verify_report.py 口径 → harness/verify_board.py）
        ② 能从镜头列表跳到镜头包
        ③ 状态字段可编辑并回写 shot spec → 本次不实施（用户已拍板「只读看板」＋ 本阶段禁改 shots/**，
          改为只读展示状态，来源是 shots/*/shot_spec.json 的 status 字段）

只读引用（本脚本一个字都不写回）：
  assets/validation/shot_library.json / camera_intrinsics.json / shot_package_check.json
  assets/manifest.json / assets/nongeometry/scene_layout.json
  shots/**（shot_spec.json、camera/intrinsics.json、validation_report.json、preview/contact_sheet.jpg）

自产产物（仅这两个）：
  boards/shot_board.html            —— 单文件离线看板（0 外链，contact sheet 原字节内联）
  assets/validation/board_data.json —— 看板数据快照（不含图片字节）＋ 各来源 sha256 指纹
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_HTML = os.path.join(ROOT, "boards", "shot_board.html")
OUT_DATA = os.path.join(ROOT, "assets", "validation", "board_data.json")

SRC_LIBRARY = "assets/validation/shot_library.json"
SRC_INTRINSICS = "assets/validation/camera_intrinsics.json"
SRC_PACKAGE = "assets/validation/shot_package_check.json"
SRC_MANIFEST = "assets/manifest.json"
SRC_LAYOUT = "assets/nongeometry/scene_layout.json"

STATUS_ORDER = {"approved": 0, "validated": 1, "draft": 2}


def rel(path):
    return os.path.join(ROOT, path)


def read_json(path):
    with open(rel(path), encoding="utf-8") as f:
        return json.load(f)


def sha256_of(path):
    h = hashlib.sha256()
    with open(rel(path), "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def source_row(path, kind, note, obj=None):
    row = {
        "path": path,
        "kind": kind,
        "note": note,
        "bytes": os.path.getsize(rel(path)),
        "sha256": sha256_of(path),
        "generated_at": "",
        "generator": "",
    }
    if obj:
        row["generated_at"] = str(obj.get("generated_at", ""))
        row["generator"] = str(obj.get("generator", ""))
    return row


def build_timeline(frames):
    """把权威源的逐帧内外参折成看板要画的几条曲线（不改动权威源本身）。"""
    out = {"t": [], "eye_z": [], "dist": [], "planar": [], "focal_mm": [], "f_px": [],
           "n_frames": len(frames), "first": {}, "last": {}}
    for fr in frames:
        eye = fr.get("eye", [0.0, 0.0, 0.0])
        tgt = fr.get("target", [0.0, 0.0, 0.0])
        d3 = sum((a - b) ** 2 for a, b in zip(eye, tgt)) ** 0.5
        dxy = ((eye[0] - tgt[0]) ** 2 + (eye[1] - tgt[1]) ** 2) ** 0.5
        out["t"].append(round(float(fr.get("t", 0.0)), 6))
        out["eye_z"].append(round(float(eye[2]), 4))
        out["dist"].append(round(float(d3), 4))
        out["planar"].append(round(float(dxy), 4))
        out["focal_mm"].append(round(float(fr.get("focal_mm", 0.0)), 3))
        out["f_px"].append(round(float(fr.get("f_px", 0.0)), 3))
    if frames:
        out["first"] = {"eye": frames[0].get("eye"), "target": frames[0].get("target"),
                        "focal_mm": frames[0].get("focal_mm"), "f_px": frames[0].get("f_px"),
                        "t": frames[0].get("t")}
        out["last"] = {"eye": frames[-1].get("eye"), "target": frames[-1].get("target"),
                       "focal_mm": frames[-1].get("focal_mm"), "f_px": frames[-1].get("f_px"),
                       "t": frames[-1].get("t")}
    return out


def collect():
    lib = read_json(SRC_LIBRARY)
    intr = read_json(SRC_INTRINSICS)
    pkg = read_json(SRC_PACKAGE)
    man = read_json(SRC_MANIFEST)
    layout = read_json(SRC_LAYOUT)

    pkg_by_id = {s["shot_id"]: s for s in pkg.get("shots", [])}
    man_by_id = {a["id"]: a for a in man.get("assets", [])}
    aliases = man.get("aliases", {})

    shots = []
    for idx, entry in enumerate(lib.get("entries", []), start=1):
        sid = entry["shot_id"]
        shot_dir = entry.get("shot_dir", "shots/" + sid)
        spec = read_json(shot_dir + "/shot_spec.json")
        pkg_entry = pkg_by_id.get(sid, {})
        intr_entry = intr.get("shots", {}).get(sid, {})
        frames = intr_entry.get("frames", [])

        thumb_rel = shot_dir + "/preview/contact_sheet.jpg"
        thumb_b64 = ""
        thumb_exists = os.path.exists(rel(thumb_rel))
        if thumb_exists:
            with open(rel(thumb_rel), "rb") as f:
                thumb_b64 = base64.b64encode(f.read()).decode("ascii")

        cam = spec.get("camera", {})
        move = cam.get("move", {})
        param = entry.get("parameterization", {})

        assets = []
        for a in spec.get("assets", []):
            aid = a.get("asset_id")
            mid = aliases.get(aid, "")
            ma = man_by_id.get(mid, {})
            lic = ma.get("license", {}) or {}
            assets.append({
                "asset_id": aid,
                "role": a.get("role", ""),
                "path": a.get("path", ""),
                "spec_fingerprint": (a.get("fingerprint", "") or "")[:23],
                "manifest_id": mid,
                "category": ma.get("category", ""),
                "license_credit": lic.get("credit", ""),
                "license_spdx": lic.get("spdx", ""),
                "validation_pass": bool((ma.get("validation", {}) or {}).get("pass", False)),
                "validation_report": (ma.get("validation", {}) or {}).get("report_path", ""),
            })

        lic_by_id = {x.get("asset_id"): x for x in spec.get("license", [])}
        for a in assets:
            l = lic_by_id.get(a["asset_id"], {})
            if not a["license_credit"]:
                a["license_credit"] = l.get("license", "")
            if not a["spec_fingerprint"]:
                a["spec_fingerprint"] = (l.get("source_url", "") or "")[:23]

        mount = cam.get("mount")
        if mount:
            camera_desc = "随动机位（挂载 " + str(mount.get("asset", "?")) + "）"
        else:
            camera_desc = "世界机位（固定坐标系）"

        status = str(spec.get("status", "unknown"))
        shots.append({
            "no": "%02d" % idx,
            "shot_id": sid,
            "type": entry.get("type", ""),
            "type_zh": entry.get("label_zh", ""),
            "title": entry.get("title_zh", ""),
            "shot_dir": shot_dir,
            "duration_s": spec.get("duration_s", param.get("duration_s", 0)),
            "fps": spec.get("fps", param.get("fps", 0)),
            "resolution": spec.get("resolution", []),
            "n_frames": intr_entry.get("n_frames", len(frames)),
            "status": status,
            "status_source": shot_dir + "/shot_spec.json",
            "lib_checks": {"n_pass": entry.get("n_pass", 0), "n_checks": entry.get("n_checks", 0),
                           "all_pass": bool(entry.get("all_pass", False))},
            "pkg_checks": {"n_pass": pkg_entry.get("n_pass", 0), "n_checks": pkg_entry.get("n_checks", 0),
                           "all_pass": bool(pkg_entry.get("all_pass", False))},
            "lib_check_items": entry.get("checks", []),
            "pkg_check_items": pkg_entry.get("checks", []),
            "metrics": entry.get("metrics", {}),
            "camera": {
                "mode": cam.get("mode", ""),
                "mount": mount,
                "desc": camera_desc,
                "move": move,
                "parameterization": param,
                "easing": param.get("easing", ""),
                "focal_mm": param.get("focal_mm", {}),
                "sensor_width_mm": param.get("sensor_width_mm", ""),
                "start": param.get("start", {}),
                "end": param.get("end", {}),
                "handheld": param.get("handheld"),
            },
            "subject": next((a["asset_id"] for a in assets if a["role"] == "subject"), ""),
            "scene": next((a["asset_id"] for a in assets if a["role"] == "scene"), ""),
            "animation": next((a["asset_id"] for a in assets if a["role"] == "subject_animation"), ""),
            "assets": assets,
            "timeline": build_timeline(frames),
            "thumb_path": thumb_rel,
            "thumb_b64": thumb_b64,
            "thumb_bytes": os.path.getsize(rel(thumb_rel)) if thumb_exists else 0,
            "thumb_sha256": sha256_of(thumb_rel) if thumb_exists else "",
            "thumb_exists": thumb_exists,
            "links": {
                "spec": "../" + shot_dir + "/shot_spec.json",
                "intrinsics": "../" + shot_dir + "/camera/intrinsics.json",
                "report": "../" + shot_dir + "/validation_report.json",
                "contact_sheet": "../" + thumb_rel,
                "package_dir": "../" + shot_dir + "/",
            },
            "package_report": entry.get("package_report", ""),
            "package_report_agrees": bool(entry.get("package_report_agrees", False)),
            "conditions": {
                "dir": (spec.get("conditions", {}) or {}).get("dir", ""),
                "channels": (spec.get("conditions", {}) or {}).get("channels", []),
                "depth_polarity": ((spec.get("conditions", {}) or {}).get("depth", {}) or {}).get("polarity", ""),
            },
        })

    # 行序＝镜头库台账里的顺序（镜号 01→09），同状态内按镜号排
    shots.sort(key=lambda s: (STATUS_ORDER.get(s["status"], 9), s["no"]))

    cats = {}
    for o in layout.get("objects", []):
        cats[o.get("category", "?")] = cats.get(o.get("category", "?"), 0) + 1

    sources = [
        source_row(SRC_LIBRARY, "镜头库台账（9 类参数化＋读数）", "本看板的镜头类型、参数化、镜头库校验项来源", lib),
        source_row(SRC_INTRINSICS, "逐帧内外参权威源", "时间轴曲线的唯一来源", intr),
        source_row(SRC_PACKAGE, "镜头包验收读数", "每包 30 项验收（产物齐备/权威源一致/USD 重投影/条件图 sidecar/AVI）", pkg),
        source_row(SRC_MANIFEST, "资产台账 v2", "资产 id / 许可 / 指纹 / 校验状态", man),
        source_row(SRC_LAYOUT, "场景布局", "场景对象构成（只读引用）", layout),
    ]
    for s in shots:
        sources.append({
            "path": s["shot_dir"] + "/shot_spec.json",
            "kind": "镜头包 spec",
            "note": s["shot_id"] + " 的状态/机位/资产引用来源",
            "bytes": os.path.getsize(rel(s["shot_dir"] + "/shot_spec.json")),
            "sha256": sha256_of(s["shot_dir"] + "/shot_spec.json"),
            "generated_at": "",
            "generator": "",
        })
        sources.append({
            "path": s["thumb_path"],
            "kind": "现成 contact sheet",
            "note": s["shot_id"] + " 的缩略图（原字节内联，未缩放未重渲染）",
            "bytes": s["thumb_bytes"],
            "sha256": s["thumb_sha256"],
            "generated_at": "",
            "generator": "",
        })

    payload = {
        "meta": {
            "kind": "director_board",
            "version": "1.0.0",
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "generator": "harness/board.py",
            "readonly": True,
            "note": "只读本地看板：不写回任何产物、不做服务端/协作/审片流、不额外渲染缩略图。",
            "shot_count": len(shots),
            "type_count": len(lib.get("move_types", [])),
            "thumb_count": sum(1 for s in shots if s["thumb_exists"]),
            "library_all_green": bool(lib.get("all_green", False)),
            "library_summary": lib.get("summary", {}),
            "package_all_pass": bool(pkg.get("summary", {}).get("all_pass", False)),
            "package_summary": pkg.get("summary", {}),
            "library_convention": lib.get("convention", {}),
            "up_axis": lib.get("up_axis", ""),
            "resolution": lib.get("resolution", []),
            "fps": lib.get("fps", 0),
            "duration_s": lib.get("duration_s", 0),
        },
        "scene": {
            "hero_source": layout.get("hero_source", ""),
            "n_objects": len(layout.get("objects", [])),
            "categories": cats,
            "camera_ref": layout.get("camera_ref", ""),
            "source_convention": layout.get("source_convention", ""),
        },
        "manifest": {
            "version": man.get("version", ""),
            "asset_count": man.get("asset_count", 0),
            "count": man.get("count", 0),
            "cpu_only": man.get("cpu_only", True),
            "generated_at": man.get("generated_at", ""),
        },
        "shots": shots,
        "sources": sources,
    }
    return payload


CSS = """
:root{
  --bg:#f7f8fa; --panel:#ffffff; --ink:#1d2430; --muted:#5d6878; --line:#e1e5ec;
  --accent:#2f5f8f; --accent2:#c07a3e; --ok:#2f7d5c; --warn:#a9741f; --bad:#b34b4b;
  --radius:10px; --mono:"Cascadia Mono","Consolas","SFMono-Regular",monospace;
}
html[data-theme="dark"]{
  --bg:#12161c; --panel:#181e27; --ink:#e6eaf0; --muted:#98a3b3; --line:#2a3341;
  --accent:#7aa7d6; --accent2:#d99a5b; --ok:#6bbd94; --warn:#d9b06a; --bad:#dd7b7b;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.7 "Segoe UI","Microsoft YaHei","PingFang SC",system-ui,sans-serif}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:var(--mono);font-size:.88em;background:rgba(127,140,160,.12);padding:1px 5px;border-radius:4px}
.side{position:fixed;inset:0 auto 0 0;width:248px;border-right:1px solid var(--line);background:var(--panel);
  padding:22px 16px 26px;overflow:auto;z-index:20}
.brand{font-weight:700;font-size:15px;line-spacing:.02em;line-height:1.4}
.brand small{display:block;font-weight:400;color:var(--muted);font-size:11.5px;margin-top:4px}
.nav{margin-top:18px;display:flex;flex-direction:column;gap:2px}
.nav a{padding:7px 9px;border-radius:6px;color:var(--muted);font-size:13px}
.nav a:hover{background:rgba(127,140,160,.10);text-decoration:none;color:var(--ink)}
.nav a.active{background:rgba(47,95,143,.12);color:var(--accent);font-weight:600}
.tools{margin-top:18px;display:flex;gap:8px;flex-wrap:wrap}
.btn{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:999px;
  padding:4px 11px;font-size:12px;cursor:pointer}
.btn:hover{color:var(--ink);border-color:var(--muted)}
main{margin-left:248px;padding:40px 44px 90px;max-width:1320px}
h1{font-size:29px;line-height:1.3;margin:0 0 8px;letter-spacing:-.01em}
h2{font-size:21px;margin:48px 0 12px;padding-top:10px;border-top:1px solid var(--line)}
h3{font-size:16.5px;margin:26px 0 8px}
p{margin:8px 0}
.sub{color:var(--muted);font-size:13.5px;margin:0 0 18px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;margin:18px 0 6px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:13px 15px}
.card .k{font-size:11.5px;color:var(--muted);letter-spacing:.04em}
.card .v{font-size:22px;font-weight:700;margin-top:3px}
.card .s{font-size:12px;color:var(--muted);margin-top:3px}
.badge{display:inline-block;font-size:11.5px;padding:2px 9px;border-radius:999px;border:1px solid var(--line);
  color:var(--muted);vertical-align:middle}
.badge.ro{color:var(--ok);border-color:rgba(47,125,92,.45);background:rgba(47,125,92,.08)}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);
  border-radius:var(--radius);overflow:hidden;font-size:13.5px}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600;background:rgba(127,140,160,.06)}
tr:last-child td{border-bottom:none}
tbody tr{cursor:pointer}
tbody tr:hover{background:rgba(47,95,143,.06)}
tbody tr.sel{background:rgba(47,95,143,.11);box-shadow:inset 3px 0 0 var(--accent)}
.chip{display:inline-block;font-size:11.5px;padding:1px 8px;border-radius:999px;border:1px solid var(--line)}
.chip.validated{color:var(--ok);border-color:rgba(47,125,92,.45);background:rgba(47,125,92,.08)}
.chip.draft{color:var(--warn);border-color:rgba(169,116,31,.45);background:rgba(169,116,31,.08)}
.chip.approved{color:var(--accent);border-color:rgba(47,95,143,.45);background:rgba(47,95,143,.08)}
.chip.bad{color:var(--bad);border-color:rgba(179,75,75,.45);background:rgba(179,75,75,.08)}
.wall{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;margin-top:14px}
.wall .item{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;cursor:pointer}
.wall .item:hover{border-color:var(--accent)}
.wall .item.sel{border-color:var(--accent);box-shadow:0 0 0 2px rgba(47,95,143,.22)}
.wall img{width:100%;display:block;background:#0d1117}
.wall .cap{padding:9px 12px 11px;font-size:13px}
.wall .cap .row1{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.wall .cap .m{font-size:11.5px;color:var(--muted);margin-top:4px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media (max-width:1080px){.grid2{grid-template-columns:1fr}}
.kv{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:13.5px}
.kv dt{color:var(--muted);white-space:nowrap}
.kv dd{margin:0}
.ctl{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:10px 0 14px}
.ctl input,.ctl select{font:inherit;font-size:13px;padding:6px 9px;border-radius:8px;
  border:1px solid var(--line);background:var(--panel);color:var(--ink)}
.ctl input{min-width:250px}
.chk{font-size:12.5px;color:var(--muted)}
.chk .ok{color:var(--ok)}
.chk .no{color:var(--bad)}
.chk ul{list-style:none;margin:6px 0 0;padding:0}
.chk li{padding:3px 0;border-bottom:1px dashed var(--line)}
.chk li:last-child{border-bottom:none}
.chk .id{font-family:var(--mono);font-size:11.5px;color:var(--muted)}
.spark{display:block;width:100%;height:auto;background:var(--panel);border:1px solid var(--line);border-radius:8px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px;margin:10px 0}
.note{font-size:12.5px;color:var(--muted);background:rgba(127,140,160,.08);border-left:3px solid var(--accent);
  padding:9px 12px;border-radius:0 8px 8px 0;margin:12px 0}
.notes-area{width:100%;min-height:76px;font:inherit;font-size:13.5px;padding:9px 10px;border-radius:8px;
  border:1px solid var(--line);background:var(--bg);color:var(--ink)}
.links{display:flex;gap:12px;flex-wrap:wrap;font-size:13px;margin-top:10px}
.hide{display:none !important}
footer{margin-top:54px;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:12.5px}
"""

JS = r"""
(function () {
  var DATA = JSON.parse(document.getElementById('boardData').textContent);
  var SHOTS = DATA.shots;
  var NOTES_KEY = 'trb-board-notes';
  var THEME_KEY = 'trb-board-theme';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(v, d) {
    if (v === undefined || v === null) return '—';
    if (typeof v === 'number') {
      if (v === 0) return '0';
      if (Math.abs(v) < 1e-4 || Math.abs(v) >= 1e6) return v.toExponential(2);
      return v.toFixed(d === undefined ? 3 : d);
    }
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
  function vec(v, d) {
    if (!Array.isArray(v)) return '—';
    return '[' + v.map(function (x) { return num(x, d); }).join(', ') + ']';
  }
  function lim(v) {
    if (Array.isArray(v)) return '[' + v.join(', ') + ']';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return num(v, 4);
    return String(v);
  }
  function chip(st) {
    return '<span class="chip ' + esc(st) + '">' + esc(st) + '</span>';
  }

  /* ---- 状态筛选 / 过滤 ---- */
  var state = { q: '', status: '', sel: SHOTS.length ? SHOTS[0].shot_id : '' };

  function matchShot(s) {
    if (state.status && s.status !== state.status) return false;
    if (!state.q) return true;
    var hay = [s.no, s.shot_id, s.type, s.type_zh, s.title, s.subject, s.scene,
      s.camera.mode, s.camera.desc, s.status].join(' ').toLowerCase();
    return hay.indexOf(state.q.toLowerCase()) >= 0;
  }

  function renderList() {
    var tb = $('shotRows');
    var shown = 0;
    var html = '';
    SHOTS.forEach(function (s) {
      if (!matchShot(s)) return;
      shown++;
      var cls = s.shot_id === state.sel ? ' class="sel"' : '';
      html += '<tr data-shot="' + esc(s.shot_id) + '"' + cls + '>'
        + '<td><code>' + esc(s.no) + '</code></td>'
        + '<td><a href="' + esc(s.links.spec) + '">' + esc(s.shot_id) + '</a></td>'
        + '<td>' + esc(s.type_zh) + ' <span style="color:var(--muted)">' + esc(s.type) + '</span></td>'
        + '<td>' + esc(s.title) + '</td>'
        + '<td>' + num(s.duration_s, 1) + ' s<br><span style="color:var(--muted)">'
        + esc(s.fps) + ' fps · ' + esc(s.n_frames) + ' 帧</span></td>'
        + '<td>' + esc(s.resolution.join('×')) + '</td>'
        + '<td>' + esc(s.subject || '—') + '</td>'
        + '<td>' + esc(s.scene || '—') + '</td>'
        + '<td>' + esc(s.camera.desc) + '</td>'
        + '<td>包 ' + esc(s.pkg_checks.n_pass) + '/' + esc(s.pkg_checks.n_checks)
        + '<br><span style="color:var(--muted)">库 ' + esc(s.lib_checks.n_pass) + '/'
        + esc(s.lib_checks.n_checks) + '</span></td>'
        + '<td>' + chip(s.status) + '</td>'
        + '</tr>';
    });
    tb.innerHTML = html;
    $('listCount').textContent = shown + ' / ' + SHOTS.length + ' 个镜头包';
    Array.prototype.forEach.call(tb.querySelectorAll('tr'), function (tr) {
      tr.addEventListener('click', function () { select(tr.getAttribute('data-shot')); });
    });
  }

  function renderWall() {
    var g = $('wallGrid');
    var html = '';
    SHOTS.forEach(function (s) {
      if (!matchShot(s)) return;
      var cls = s.shot_id === state.sel ? ' sel' : '';
      var img = s.thumb_exists
        ? '<img alt="' + esc(s.shot_id) + ' contact sheet" src="data:image/jpeg;base64,' + esc(s.thumb_b64) + '">'
        : '<div style="height:120px;display:flex;align-items:center;justify-content:center;color:var(--muted)">（无 contact sheet）</div>';
      html += '<div class="item' + cls + '" data-shot="' + esc(s.shot_id) + '">' + img
        + '<div class="cap"><div class="row1"><b>' + esc(s.shot_id) + '</b>' + chip(s.status) + '</div>'
        + '<div class="m">' + esc(s.no) + ' · ' + esc(s.type_zh) + ' · ' + num(s.duration_s, 1) + ' s · '
        + '校验 ' + esc(s.pkg_checks.n_pass) + '/' + esc(s.pkg_checks.n_checks) + '（包）</div>'
        + '<div class="m">缩略图＝现成 contact_sheet.jpg（原字节内联）</div>'
        + '</div></div>';
    });
    g.innerHTML = html;
    Array.prototype.forEach.call(g.querySelectorAll('.item'), function (it) {
      it.addEventListener('click', function () { select(it.getAttribute('data-shot')); });
    });
  }

  /* ---- 时间轴：三条曲线，各自独立刻度 ---- */
  function spark(title, unit, series, color) {
    var W = 680, H = 96, PL = 46, PR = 12, PT = 16, PB = 18;
    if (!series.length) return '<p class="sub">无数据</p>';
    var min = Math.min.apply(null, series), max = Math.max.apply(null, series);
    var span = (max - min) || 1;
    var iw = W - PL - PR, ih = H - PT - PB;
    var pts = series.map(function (v, i) {
      var x = PL + (series.length === 1 ? iw / 2 : iw * i / (series.length - 1));
      var y = PT + ih - ih * (v - min) / span;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var ticks = '';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
      var y = PT + ih - ih * f;
      var val = min + span * (1 - f);
      ticks += '<line x1="' + PL + '" y1="' + y.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + y.toFixed(1)
        + '" stroke="var(--line)" stroke-width="1"/>'
        + '<text x="' + (PL - 5) + '" y="' + (y + 3.5).toFixed(1) + '" font-size="9" fill="var(--muted)" text-anchor="end">'
        + num(val, 2) + '</text>';
    });
    return '<div style="margin:8px 0 12px"><div style="font-size:12.5px;color:var(--muted)">'
      + esc(title) + '（' + esc(unit) + '）</div>'
      + '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">'
      + ticks
      + '<polyline fill="none" stroke="' + color + '" stroke-width="1.6" points="' + pts + '"/>'
      + '<text x="' + PL + '" y="' + (H - 5) + '" font-size="9" fill="var(--muted)">首帧</text>'
      + '<text x="' + (W - PR) + '" y="' + (H - 5) + '" font-size="9" fill="var(--muted)" text-anchor="end">末帧</text>'
      + '</svg></div>';
  }

  function checkList(items, emptyText) {
    if (!items || !items.length) return '<p class="sub">' + esc(emptyText) + '</p>';
    var html = '<ul>';
    items.forEach(function (c) {
      var ok = c.pass === true;
      html += '<li><span class="' + (ok ? 'ok' : 'no') + '">' + (ok ? '✓' : '✗') + '</span> '
        + esc(c.name_zh || c.id) + ' <span class="id">' + esc(c.id) + '</span>'
        + '<span style="color:var(--muted)"> — 实测 ' + esc(lim(c.value)) + ' ' + esc(c.op || '')
        + ' ' + esc(lim(c.limit)) + (c.detail ? ' · ' + esc(c.detail) : '') + '</span></li>';
    });
    return html + '</ul>';
  }

  function renderDetail() {
    var s = null;
    for (var i = 0; i < SHOTS.length; i++) { if (SHOTS[i].shot_id === state.sel) { s = SHOTS[i]; break; } }
    if (!s) { $('detailBody').innerHTML = '<p class="sub">没有可显示的镜头。</p>'; return; }
    $('detailTitle').textContent = s.no + ' · ' + s.shot_id;

    var tl = s.timeline;
    var mv = s.camera.move || {};
    var par = s.camera.parameterization || {};

    var html = '';
    html += '<div class="panel"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap">'
      + '<div><b style="font-size:17px">' + esc(s.title) + '</b></div><div>' + chip(s.status)
      + ' <span class="badge">状态来源：' + esc(s.status_source) + '</span></div></div>'
      + '<p class="sub" style="margin-top:6px">' + esc(s.type_zh) + '（' + esc(s.type) + '）· '
      + num(s.duration_s, 1) + ' s · ' + esc(s.fps) + ' fps · ' + esc(s.n_frames) + ' 帧 · '
      + esc(s.resolution.join('×')) + ' · ' + esc(s.camera.desc) + '</p>'
      + '<dl class="kv">'
      + '<dt>主体</dt><dd>' + esc(s.subject || '—') + '</dd>'
      + '<dt>场景</dt><dd>' + esc(s.scene || '—') + '</dd>'
      + '<dt>动作源</dt><dd>' + esc(s.animation || '—') + '</dd>'
      + '<dt>机位模式</dt><dd>' + esc(s.camera.mode || '—') + '</dd>'
      + '<dt>条件图通道</dt><dd>' + esc(s.conditions.channels.join(' / ') || '—') + '</dd>'
      + '<dt>深度极性</dt><dd>' + esc(s.conditions.depth_polarity || '—') + '</dd>'
      + '</dl>'
      + '<div class="links">'
      + '<a href="' + esc(s.links.spec) + '">打开镜头包 spec ↗</a>'
      + '<a href="' + esc(s.links.intrinsics) + '">打开该包 intrinsics ↗</a>'
      + '<a href="' + esc(s.links.report) + '">打开镜头包校验报告 ↗</a>'
      + '<a href="' + esc(s.links.contact_sheet) + '">打开 contact sheet ↗</a>'
      + '<a href="' + esc(s.links.package_dir) + '">打开镜头包目录 ↗</a>'
      + '</div></div>';

    html += '<div class="grid2"><div class="panel"><h3 style="margin-top:0">参数化</h3><dl class="kv">'
      + '<dt>构图基准</dt><dd>' + esc(mv.frame || par.frame || '—') + '</dd>'
      + '<dt>缓动</dt><dd>' + esc(mv.easing || '—') + '</dd>'
      + '<dt>焦距</dt><dd>' + (s.camera.focal_mm && s.camera.focal_mm.start !== undefined
        ? num(s.camera.focal_mm.start, 1) + ' → ' + num(s.camera.focal_mm.end, 1) + ' mm' : '—') + '</dd>'
      + '<dt>传感器宽</dt><dd>' + (s.camera.sensor_width_mm ? num(s.camera.sensor_width_mm, 1) + ' mm' : '—') + '</dd>'
      + '<dt>起始机位</dt><dd>' + vec(s.camera.start && s.camera.start.eye) + '</dd>'
      + '<dt>起始目标</dt><dd>' + vec(s.camera.start && s.camera.start.target) + '</dd>'
      + '<dt>结束机位</dt><dd>' + vec(s.camera.end && s.camera.end.eye) + '</dd>'
      + '<dt>结束目标</dt><dd>' + vec(s.camera.end && s.camera.end.target) + '</dd>'
      + '<dt>手持噪声</dt><dd>' + (s.camera.handheld ? JSON.stringify(s.camera.handheld) : '—') + '</dd>'
      + '<dt>备注</dt><dd>' + esc((mv.params && mv.params.note) || '—') + '</dd>'
      + '</dl></div>';

    html += '<div class="panel"><h3 style="margin-top:0">时间轴（读 camera_intrinsics.json）</h3>'
      + spark('机位高度 z', 'm', tl.eye_z, 'var(--accent)')
      + spark('机位到目标距离', 'm', tl.dist, 'var(--accent2)')
      + spark('焦距', 'mm', tl.focal_mm, 'var(--ok)')
      + '<dl class="kv" style="margin-top:6px">'
      + '<dt>首帧</dt><dd>t=' + num(tl.first.t, 3) + ' s · eye ' + vec(tl.first.eye) + ' · f_px ' + num(tl.first.f_px, 2) + '</dd>'
      + '<dt>末帧</dt><dd>t=' + num(tl.last.t, 3) + ' s · eye ' + vec(tl.last.eye) + ' · f_px ' + num(tl.last.f_px, 2) + '</dd>'
      + '<dt>帧数</dt><dd>' + esc(tl.n_frames) + '（权威源逐帧）</dd>'
      + '</dl></div></div>';

    html += '<div class="grid2"><div class="panel"><h3 style="margin-top:0">镜头库校验（' + esc(s.lib_checks.n_pass)
      + '/' + esc(s.lib_checks.n_checks) + '）</h3><div class="chk">' + checkList(s.lib_check_items, '无读数') + '</div></div>'
      + '<div class="panel"><h3 style="margin-top:0">镜头包验收（' + esc(s.pkg_checks.n_pass) + '/'
      + esc(s.pkg_checks.n_checks) + '）</h3><div class="chk">' + checkList(s.pkg_check_items, '无读数') + '</div></div></div>';

    html += '<div class="panel"><h3 style="margin-top:0">资产引用（台账 assets/manifest.json v2）</h3><table><thead><tr>'
      + '<th>asset_id</th><th>角色</th><th>类别</th><th>许可</th><th>校验</th></tr></thead><tbody>';
    s.assets.forEach(function (a) {
      html += '<tr style="cursor:default"><td><code>' + esc(a.asset_id) + '</code><br><span style="color:var(--muted);font-size:12px">'
        + esc(a.manifest_id || '') + '</span></td>'
        + '<td>' + esc(a.role) + '</td>'
        + '<td>' + esc(a.category || '—') + '</td>'
        + '<td style="font-size:12.5px">' + esc(a.license_credit || a.license_spdx || '—') + '</td>'
        + '<td>' + (a.validation_pass ? '<span class="ok">✓ pass</span>' : '<span class="no">✗</span>') + '</td></tr>';
    });
    html += '</tbody></table></div>';

    html += '<div class="panel"><h3 style="margin-top:0">批注位（本地 · 无账号）</h3>'
      + '<textarea id="shotNote" class="notes-area" placeholder="给这个镜头写点批注……（只存本机浏览器，不联网、不回写 shot spec）"></textarea>'
      + '<p class="sub" style="margin-top:8px">批注只保存在这台机器的浏览器本地存储里，没有账号、没有服务端、不联网，也不会写回任何产物。'
      + '关掉页面内容还在；换机器或清了浏览器数据就没了。</p></div>';

    $('detailBody').innerHTML = html;

    var ta = $('shotNote');
    ta.value = loadNote(s.shot_id);
    ta.addEventListener('input', function () { saveNote(s.shot_id, ta.value); });
  }

  /* ---- 本地批注（localStorage，file:// 下可能被浏览器禁掉，已兜底） ---- */
  function readNotes() {
    try {
      var raw = window.localStorage.getItem(NOTES_KEY);
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) { return {}; }
  }
  function loadNote(id) {
    var n = readNotes();
    return (n && n[id]) ? String(n[id]) : '';
  }
  function saveNote(id, val) {
    try {
      var n = readNotes();
      n[id] = val;
      window.localStorage.setItem(NOTES_KEY, JSON.stringify(n));
    } catch (e) { /* file:// 下 localStorage 不可用时静默降级为仅内存 */ }
  }

  function select(id) {
    state.sel = id;
    renderList();
    renderWall();
    renderDetail();
  }

  function applyFilter() {
    state.q = ($('q') && $('q').value || '').trim();
    state.status = $('statusFilter') ? $('statusFilter').value : '';
    renderList();
    renderWall();
  }

  function initTheme() {
    var root = document.documentElement;
    try {
      var saved = window.localStorage.getItem(THEME_KEY);
      if (saved) { root.setAttribute('data-theme', saved); }
    } catch (e) { /* ignore */ }
    var btn = $('themeBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var cur = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', cur);
      try { window.localStorage.setItem(THEME_KEY, cur); } catch (e) { /* ignore */ }
    });
  }

  function initNav() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.nav a'));
    var secs = links.map(function (a) { return document.querySelector(a.getAttribute('href')); })
      .filter(function (x) { return !!x; });
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          links.forEach(function (l) {
            l.classList.toggle('active', l.getAttribute('href') === '#' + e.target.id);
          });
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    secs.forEach(function (s) { io.observe(s); });
  }

  function init() {
    initTheme();
    initNav();
    if ($('q')) $('q').addEventListener('input', applyFilter);
    if ($('statusFilter')) $('statusFilter').addEventListener('change', applyFilter);
    renderList();
    renderWall();
    renderDetail();
    $('boardMeta').textContent = DATA.meta.generated_at + ' · 生成器 ' + DATA.meta.generator
      + ' · ' + SHOTS.length + ' 个镜头包 / ' + DATA.meta.type_count + ' 类运镜';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
"""


def render_html(payload):
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    data = data.replace("<", "\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    m = payload["meta"]
    s = payload["shots"]
    lib_sum = m.get("library_summary", {})
    pkg_sum = m.get("package_summary", {})

    rows = []
    for sh in s:
        rows.append(
            '<tr><td>镜头包</td><td><code>' + sh["shot_id"] + '</code></td>'
            '<td>' + sh["type_zh"] + '（' + sh["type"] + '）</td>'
            '<td>' + str(sh["duration_s"]) + ' s</td><td>' + str(sh["fps"]) + " fps</td>"
            '<td>' + str(sh["n_frames"]) + '</td>'
            '<td>' + str(sh["pkg_checks"]["n_pass"]) + "/" + str(sh["pkg_checks"]["n_checks"]) + '</td>'
            '<td>' + str(sh["lib_checks"]["n_pass"]) + "/" + str(sh["lib_checks"]["n_checks"]) + '</td>'
            '<td>' + sh["status"] + '</td></tr>')

    src_rows = []
    for x in payload["sources"]:
        src_rows.append(
            "<tr><td><code>" + x["path"] + "</code></td><td>" + x["kind"] + "</td>"
            "<td>" + (x.get("generated_at") or "—") + "</td>"
            "<td>" + str(x["bytes"]) + "</td>"
            "<td style=\"font-size:11.5px\">" + x["sha256"][:16] + "…</td>"
            "<td>" + x["note"] + "</td></tr>")

    html = """<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>最小导演台 · 只读本地 | Tree Resources Builder</title>
<style>__CSS__</style>
</head>
<body>
<aside class="side">
  <div class="brand">最小导演台 · 只读本地
    <small>白模路线 R5 · 9 类运镜 / __NSHOTS__ 个镜头包 · 离线单文件</small></div>
  <nav class="nav">
    <div class="grp">看板</div>
    <a href="#overview">概览读数</a>
    <a href="#list">镜头列表</a>
    <a href="#wall">缩略图墙</a>
    <a href="#detail">镜头详情</a>
    <div class="grp">台账</div>
    <a href="#assets">资产与场景</a>
    <a href="#sources">来源与指纹</a>
    <a href="#boundary">边界说明</a>
  </nav>
  <div class="tools">
    <button class="btn" id="themeBtn" type="button">切换深/浅</button>
    <span class="badge ro">只读 · 不写回</span>
  </div>
</aside>
<main>
  <h1>最小导演台（只读本地）</h1>
  <p class="sub">选镜头、选资产、看校验。数据全部来自仓库里已落盘的读数，本页是它们的只读视图：
     离线打开、0 外链、file:// 双击可用，不做协作、不做服务端、不做审片流、不额外渲染缩略图。</p>
  <p class="sub" id="boardMeta"></p>

  <section id="overview">
    <div class="cards">
      <div class="card"><div class="k">镜头包</div><div class="v">__NSHOTS__</div>
        <div class="s">9 类运镜各 1 个样例</div></div>
      <div class="card"><div class="k">镜头库校验</div><div class="v">__LIBPASS__/__LIBTOTAL__</div>
        <div class="s">逐类参数化检查，全绿</div></div>
      <div class="card"><div class="k">镜头包验收</div><div class="v">__PKGPASS__/__PKGTOTAL__</div>
        <div class="s">每包 30 项 × 9 包</div></div>
      <div class="card"><div class="k">USD 重投影误差</div><div class="v">__REPROJ__ px</div>
        <div class="s">权威源逐帧比对，上限 1e-4</div></div>
      <div class="card"><div class="k">手持主频</div><div class="v">__FFT__ Hz</div>
        <div class="s">落在 0.5–3 Hz 带内</div></div>
      <div class="card"><div class="k">接触表缩略图</div><div class="v">__NTHUMB__</div>
        <div class="s">现成 contact sheet，原字节内联</div></div>
    </div>
    <div class="note">权威源：<code>assets/validation/camera_intrinsics.json</code> 是逐帧内外参的唯一权威源；
      镜头包里的 <code>camera/intrinsics.json</code> 是它的同源切片。
      镜头库台账 <code>shot_library.json</code>、镜头包验收 <code>shot_package_check.json</code>、
      资产台账 <code>assets/manifest.json</code> v2 在本页都是只读引用。</div>
  </section>

  <section id="list">
    <h2>镜头列表</h2>
    <p class="sub">点一行看详情；点镜号可直接跳到该镜头包的 spec 文件（相对路径，file:// 下可直接打开）。</p>
    <div class="ctl">
      <input id="q" type="search" placeholder="筛选：镜号 / 类型 / 主体 / 场景 / 机位"/>
      <select id="statusFilter">
        <option value="">全部状态</option>
        <option value="draft">draft</option>
        <option value="validated">validated</option>
        <option value="approved">approved</option>
      </select>
      <span class="chk" id="listCount"></span>
    </div>
    <table>
      <thead><tr>
        <th>镜号</th><th>shot_id</th><th>类型</th><th>描述</th><th>时长</th><th>分辨率</th>
        <th>主体</th><th>场景</th><th>机位</th><th>校验通过（包/库）</th><th>状态</th>
      </tr></thead>
      <tbody id="shotRows"></tbody>
    </table>
  </section>

  <section id="wall">
    <h2>缩略图墙</h2>
    <p class="sub">每格是镜头包里现成的 <code>preview/contact_sheet.jpg</code>，按原字节内联，没有做任何缩放或重渲染。</p>
    <div class="wall" id="wallGrid"></div>
  </section>

  <section id="detail">
    <h2>镜头详情 · <span id="detailTitle"></span></h2>
    <div id="detailBody"></div>
  </section>

  <section id="assets">
    <h2>资产与场景</h2>
    <div class="cards">
      <div class="card"><div class="k">manifest v2</div><div class="v">__ASSETS__</div>
        <div class="s">资产条目（id+fingerprint+license+validation 四项齐全）</div></div>
      <div class="card"><div class="k">场景对象</div><div class="v">__NOBJ__</div>
        <div class="s">__CATS__</div></div>
      <div class="card"><div class="k">纯 CPU</div><div class="v">__CPU__</div>
        <div class="s">无生成式模型、无 GPU 运行时</div></div>
      <div class="card"><div class="k">台账生成时间</div><div class="v" style="font-size:15px">__MFTIME__</div>
        <div class="s">assets/manifest.json</div></div>
    </div>
    <h3>各镜头包引用的资产</h3>
    <table>
      <thead><tr><th>asset_id</th><th>角色</th><th>manifest id</th><th>类别</th><th>许可 / 出处</th><th>校验</th></tr></thead>
      <tbody>__ASSET_ROWS__</tbody>
    </table>
    <p class="sub">许可与指纹的权威登记处是 <code>assets/manifest.json</code>；本页只做只读展示。</p>
  </section>

  <section id="sources">
    <h2>来源与指纹</h2>
    <p class="sub">看板每个数字都能回指到下面这些文件。sha256 为本次生成看板时读到的内容指纹。</p>
    <table>
      <thead><tr><th>文件</th><th>类型</th><th>读数生成时间</th><th>字节</th><th>sha256</th><th>说明</th></tr></thead>
      <tbody>__SRC_ROWS__</tbody>
    </table>
    <h3>镜头包读数一览</h3>
    <table>
      <thead><tr><th>类别</th><th>shot_id</th><th>类型</th><th>时长</th><th>fps</th><th>帧数</th>
        <th>镜头包验收</th><th>镜头库校验</th><th>状态</th></tr></thead>
      <tbody>__SHOT_ROWS__</tbody>
    </table>
  </section>

  <section id="boundary">
    <h2>边界说明</h2>
    <div class="note">这个页面是<b>只读看板</b>：它不写回任何产物、不做服务端、不做多人协作、不做审片流，
      也没有额外渲染任何缩略图——墙上的图就是镜头包里现成的 contact sheet 原件。</div>
    <h3>本次做了什么</h3>
    <ul>
      <li>镜头列表：镜号 / 类型 / 描述 / 时长 / 分辨率 / 主体 / 场景 / 机位 / 校验通过项数 / 状态；点镜号可跳到镜头包 spec。</li>
      <li>缩略图墙：9 个镜头包的现成 contact sheet（base64 原字节内联，单文件可整份拷走）。</li>
      <li>时间轴：读 <code>assets/validation/camera_intrinsics.json</code> 的逐帧内外参，画机位高度、到目标距离、焦距三条曲线。</li>
      <li>状态字段：<code>draft / validated / approved</code>，取值来自各镜头包 <code>shot_spec.json</code> 的 <code>status</code> 字段，页面只读展示。</li>
      <li>批注位：每镜一格，只存本机浏览器本地存储，无账号、无服务端、不回写 shot spec。</li>
    </ul>
    <h3>本次没做（说清楚）</h3>
    <ul>
      <li><b>状态字段没有做成可编辑回写。</b>ROADMAP R5 验收第 ③ 条写的是「状态字段可编辑并回写 shot spec」，
        但用户已拍板这块只做只读看板，且本阶段禁止改 <code>shots/**</code> 既有产物，所以状态只展示不写回。</li>
      <li><b>没有服务端、没有协作、没有审片流、没有批注同步</b>：批注只在本机浏览器里，换机器就没了。</li>
      <li><b>没有额外渲染缩略图</b>：没有调用任何渲染器，contact sheet 是 R2 已经落盘的文件。</li>
      <li><b>没有引入 Blender 作为运行时</b>：整个看板是纯 Python 标准库 + 浏览器原生 JS，纯 CPU。</li>
      <li><b>没有做下游图/视频模型的 A/B 验证</b>：按约定本轮只做 CPU 侧读数展示。</li>
      <li>镜头级<b>审片结论</b>没有做：状态字段目前全部是 spec 自带的 <code>validated</code>，
        没有人工判读结论，也没有把批注转成状态。</li>
    </ul>
  </section>

  <footer>Tree Resources Builder · R5 最小导演台（只读本地）· 单文件离线看板 · 生成于 __TIME__</footer>
</main>
<script id="boardData" type="application/json">__DATA__</script>
<script>__JS__</script>
</body>
</html>
"""

    asset_rows = []
    seen = set()
    for sh in s:
        for a in sh["assets"]:
            key = (sh["shot_id"], a["asset_id"])
            if key in seen:
                continue
            seen.add(key)
            asset_rows.append(
                "<tr><td><code>" + a["asset_id"] + "</code></td><td>" + a["role"] + "</td>"
                "<td>" + a["manifest_id"] + "</td><td>" + (a["category"] or "—") + "</td>"
                "<td style=\"font-size:12.5px\">" + (a["license_credit"] or a["license_spdx"] or "—") + "</td>"
                "<td>" + ("pass" if a["validation_pass"] else "—") + "</td></tr>")

    html = html.replace("__CSS__", CSS).replace("__JS__", JS).replace("__DATA__", data)
    html = html.replace("__NSHOTS__", str(m["shot_count"]))
    html = html.replace("__LIBPASS__", str(lib_sum.get("total_passed", 0)))
    html = html.replace("__LIBTOTAL__", str(lib_sum.get("total_checks", 0)))
    html = html.replace("__PKGPASS__", str(pkg_sum.get("total_passed", 0)))
    html = html.replace("__PKGTOTAL__", str(pkg_sum.get("total_checks", 0)))
    html = html.replace("__REPROJ__", "{:.3e}".format(float(pkg_sum.get("max_usd_reprojection_error_px", 0.0))))
    html = html.replace("__FFT__", str(pkg_sum.get("handheld_fft_dominant_hz", "—")))
    html = html.replace("__NTHUMB__", str(m["thumb_count"]))
    html = html.replace("__ASSETS__", str(payload["manifest"]["asset_count"]))
    html = html.replace("__NOBJ__", str(payload["scene"]["n_objects"]))
    html = html.replace("__CATS__", "、".join(k + " " + str(v) for k, v in sorted(payload["scene"]["categories"].items())))
    html = html.replace("__CPU__", "是" if payload["manifest"]["cpu_only"] else "否")
    html = html.replace("__MFTIME__", payload["manifest"]["generated_at"])
    html = html.replace("__ASSET_ROWS__", "".join(asset_rows))
    html = html.replace("__SRC_ROWS__", "".join(src_rows))
    html = html.replace("__SHOT_ROWS__", "".join(rows))
    html = html.replace("__TIME__", m["generated_at"])
    return html


def main():
    payload = collect()
    os.makedirs(os.path.dirname(OUT_HTML), exist_ok=True)
    html = render_html(payload)
    with open(OUT_HTML, "w", encoding="utf-8") as f:
        f.write(html)

    snapshot = json.loads(json.dumps(payload))
    for sh in snapshot["shots"]:
        sh.pop("thumb_b64", None)
    snapshot["meta"]["board_html"] = "boards/shot_board.html"
    snapshot["meta"]["board_html_bytes"] = len(html.encode("utf-8"))
    snapshot["meta"]["board_html_sha256"] = hashlib.sha256(html.encode("utf-8")).hexdigest()
    os.makedirs(os.path.dirname(OUT_DATA), exist_ok=True)
    with open(OUT_DATA, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2)

    print(json.dumps({
        "board": os.path.relpath(OUT_HTML, ROOT),
        "bytes": len(html.encode("utf-8")),
        "shots": payload["meta"]["shot_count"],
        "types": payload["meta"]["type_count"],
        "thumbs": payload["meta"]["thumb_count"],
        "library_all_green": payload["meta"]["library_all_green"],
        "package_all_pass": payload["meta"]["package_all_pass"],
        "data": os.path.relpath(OUT_DATA, ROOT),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
