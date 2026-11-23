"""R8 · 从镜头包生成「白模视频 + prompt + 参考绑定 + 本地模型请求」。

R8.0：中性灰白模 + 从几何量出的 prompt + request + 自检。
R8.1：narrative（时间线动作）+ 参考图绑定（@图片1/@图片2）+ text-only prompt。

一条原则
========
prompt 里的每个数字都必须从 `shot_spec.json` / `camera/intrinsics.json` /
`validation_report.json` 量出来，不手写、不从设计稿抄。这份模块就是那条
「同一份几何 → 白模 / prompt / 请求」的出口。

下游还没有接
============
这里只产出**请求**（`probe/request.json`）与**评分表**（`probe/score_sheet.json`）。
本地模型接入后，由适配器读 request、写 `probe/result.json` + `probe/generated.mp4`。
`--mock` 只验证接口闭环，不假装模型已经跑过。
"""
from __future__ import annotations

import datetime as _dt
import json
import math
import os
import re
import shutil
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

# 参考图槽位：只允许这两个 token，绑定后复制进镜头包，保证自包含。
IMAGE_SLOTS = {
    "@图片1": {
        "role": "character_identity",
        "slot": "角色身份 / 服装",
        "inherit": ["身份", "服装", "长相"],
        "exclude": ["机位", "构图"],
        "note": "角色参考图；没有就先留 unbound，用 text-only prompt。",
    },
    "@图片2": {
        "role": "scene_style",
        "slot": "场景 / 材质 / 光线",
        "inherit": ["材质", "光线", "色调", "氛围"],
        "exclude": ["机位", "走位"],
        "note": "场景/风格参考图；没有就先留 unbound，用 text-only prompt。",
    },
}

DEFAULT_SUBJECT = "一个成年人"
DEFAULT_SCENE = "城市街道，两侧有建筑、行道树和停放车辆，路面有标线，远处有人群"
DEFAULT_STYLE = "写实电影感，自然光"

DEFAULT_ACTIONS = {
    "dolly_in": "主体迎面朝镜头匀速走来，保持自然步态，不停顿、不回头；镜头沿视线同步推近。",
    "dolly_out": "主体保持行走；镜头沿视线匀速后退，主体始终在画内。",
    "orbit": "主体沿街道匀速行走；镜头绕主体转圈，主体始终在画内。",
    "follow": "主体背对镜头向前匀速行走；镜头与主体同速跟随，距离保持不变。",
    "pan": "主体保持自然动作；镜头水平摇动，主体始终在画内。",
    "tilt": "主体保持自然动作；镜头俯仰，主体始终在画内。",
    "truck": "主体保持行走；镜头平行横移，主体始终在画内。",
    "pedestal": "主体保持自然动作；镜头垂直升降，主体始终在画内。",
    "handheld": "主体保持自然动作；镜头带受限频带的手持晃动，主体始终在画内。",
    "unknown": "主体保持自然动作；镜头按事实表运动。",
}


# ---------------------------------------------------------------- 小工具
def _load(path: str):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _write(path: str, obj) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return path


def _rel(shot_dir: str, path: str) -> str:
    return os.path.relpath(path, shot_dir).replace(os.sep, "/")


def _dir(shot: str) -> str:
    if os.path.isabs(shot):
        return shot
    if os.sep in shot or "/" in shot:
        return os.path.join(ROOT, shot)
    return os.path.join(ROOT, "shots", shot)


def _check(report: dict, group: str, cid: str):
    for item in report.get(group, []):
        if item.get("id") == cid:
            return item
    return None


def _value(report: dict, group: str, cid: str, default=None):
    item = _check(report, group, cid)
    return item.get("value") if item else default


def _detail(report: dict, group: str, cid: str) -> str:
    item = _check(report, group, cid)
    return str(item.get("detail", "")) if item else ""


def _range_from_detail(detail: str, key: str):
    m = re.search(rf"{key}\s+([-\d.]+)\s*[–-]\s*([-\d.]+)", detail)
    if not m:
        return None
    return [float(m.group(1)), float(m.group(2))]


def _r(v, n=2):
    return None if v is None else round(float(v), n)


def _f(v, unit="", n=2):
    if v is None:
        return "—"
    return f"{float(v):.{n}f}{unit}"


def _stats(values):
    if not values:
        return None
    arr = np.asarray(values, dtype=np.float64)
    return {
        "start": _r(arr[0], 4),
        "end": _r(arr[-1], 4),
        "min": _r(arr.min(), 4),
        "max": _r(arr.max(), 4),
        "mean": _r(arr.mean(), 4),
    }


def _shot_size(height_ratio: float | None) -> str:
    if height_ratio is None:
        return "未知"
    if height_ratio < 0.12:
        return "远景"
    if height_ratio < 0.30:
        return "全景"
    if height_ratio < 0.55:
        return "中景"
    if height_ratio < 0.80:
        return "中近景"
    return "近景/特写"


def _subject_motion(track: list[dict]) -> dict:
    if not track or len(track) < 2:
        return {}
    speeds = []
    path_len = 0.0
    for a, b in zip(track, track[1:]):
        dt = float(b["t"]) - float(a["t"])
        pa = np.asarray(a["pos"], dtype=np.float64)
        pb = np.asarray(b["pos"], dtype=np.float64)
        seg = float(np.linalg.norm(pb - pa))
        path_len += seg
        if dt > 0:
            speeds.append(seg / dt)
    p0 = np.asarray(track[0]["pos"], dtype=np.float64)
    p1 = np.asarray(track[-1]["pos"], dtype=np.float64)
    net = float(np.linalg.norm(p1 - p0))
    return {
        "speed_mps": _stats(speeds),
        "path_length_m": _r(path_len, 3),
        "net_displacement_m": _r(net, 3),
    }


# ---------------------------------------------------------------- 事实
def collect_facts(shot_dir: str) -> dict:
    spec = _load(os.path.join(shot_dir, "shot_spec.json"))
    intr = _load(os.path.join(shot_dir, "camera", "intrinsics.json"))
    report = _load(os.path.join(shot_dir, "validation_report.json"))

    frames = intr.get("frames") or []
    eyes = [np.asarray(f["eye"], dtype=np.float64) for f in frames]
    targets = [np.asarray(f["target"], dtype=np.float64) for f in frames]
    lens = [float(f["focal_mm"]) for f in frames]
    dist = [float(np.linalg.norm(t - e)) for e, t in zip(eyes, targets)]
    heights = [float(e[2]) for e in eyes]
    pitches = []
    for e, t in zip(eyes, targets):
        fwd = t - e
        n = float(np.linalg.norm(fwd))
        if n > 1e-9:
            pitches.append(math.degrees(math.asin(max(-1.0, min(1.0, -fwd[2] / n)))))
        else:
            pitches.append(0.0)

    height_ratio = _value(report, "composition", "subject_height_ratio_band")
    height_ratio_range = _range_from_detail(
        _detail(report, "motion", "orbit_subject_height_constant"), "height_ratio")
    centering = _value(report, "composition", "centering_offset")
    in_frame = _value(report, "composition", "subject_in_frame_ratio")

    actors = spec.get("actors") or []
    subject = actors[0] if actors else {}
    motion = _subject_motion(subject.get("track") or [])

    orbit_radius = None
    orbit_angular_rate = None
    detail = _detail(report, "motion", "orbit_radius_constant")
    m = re.search(r"radius\s+([-\d.]+)", detail)
    if m:
        orbit_radius = float(m.group(1))
    if orbit_radius is None:
        params = (spec.get("camera", {}).get("move") or {}).get("params") or {}
        orbit_radius = params.get("radius_m")
    detail = _detail(report, "motion", "orbit_angular_rate_constant")
    m = re.search(r"rate\s+([-\d.]+)", detail)
    if m:
        orbit_angular_rate = float(m.group(1))

    move = spec.get("camera", {}).get("move") or {}
    move_type = spec.get("move_type") or move.get("type") or "unknown"
    duration = float(spec.get("duration_s") or intr.get("duration_s") or 5.0)
    fps = float(spec.get("fps") or intr.get("fps") or 24.0)
    resolution = spec.get("resolution") or intr.get("resolution") or [720, 404]

    return {
        "shot_id": spec.get("shot_id"),
        "title": spec.get("title_zh") or spec.get("shot_id"),
        "move_type": move_type,
        "move_label": move.get("label_zh") or move_type,
        "easing": move.get("easing"),
        "duration_s": duration,
        "fps": fps,
        "resolution": resolution,
        "frames": len(frames),
        "lens_mm": _stats(lens),
        "distance_m": _stats(dist),
        "camera_height_m": _stats(heights),
        "pitch_down_deg": _stats(pitches),
        "subject_height_ratio_mean": _r(height_ratio, 4),
        "subject_height_ratio_range": height_ratio_range,
        "shot_size": _shot_size(height_ratio),
        "centering_offset": _r(centering, 4),
        "subject_in_frame_ratio": _r(in_frame, 4),
        "subject_motion": motion,
        "orbit_radius_m": _r(orbit_radius, 3),
        "orbit_angular_rate_deg_s": _r(orbit_angular_rate, 3),
        "validation_pass": bool(report.get("pass")),
        "assets": [
            {"asset_id": a.get("asset_id"), "role": a.get("role"),
             "path": a.get("path")}
            for a in (spec.get("assets") or [])
        ],
        "license": spec.get("license") or [],
    }


# ---------------------------------------------------------------- narrative
def ensure_narrative(shot_dir: str, facts: dict) -> dict:
    """读/建 narrative.json；已有内容不覆盖，只补缺字段。"""
    path = os.path.join(shot_dir, "narrative.json")
    if os.path.exists(path):
        doc = _load(path)
    else:
        doc = {}
    default_action = DEFAULT_ACTIONS.get(facts["move_type"], DEFAULT_ACTIONS["unknown"])
    doc.setdefault("kind", "r8_narrative")
    doc.setdefault("schema", "r8-narrative/1")
    doc.setdefault("shot_id", facts["shot_id"])
    doc.setdefault("subject", DEFAULT_SUBJECT)
    doc.setdefault("scene", DEFAULT_SCENE)
    doc.setdefault("style", DEFAULT_STYLE)
    if not doc.get("segments"):
        doc["segments"] = [{
            "t": [0.0, float(facts["duration_s"])],
            "action": default_action,
        }]
    doc.setdefault("notes", "")
    _write(path, doc)
    return doc


def _timeline_text(narrative: dict) -> str:
    segs = narrative.get("segments") or []
    if not segs:
        return "0–5.0s：[待填：主体在做什么]"
    lines = []
    for seg in segs:
        t = seg.get("t") or [0, 5]
        t0 = _f(t[0], "", 1) if isinstance(t, (list, tuple)) else "0"
        t1 = _f(t[1], "s", 1) if isinstance(t, (list, tuple)) and len(t) > 1 else "5.0s"
        action = str(seg.get("action") or "[待填：主体在做什么]")
        lines.append(f"{t0}–{t1}：{action}")
    return "\n".join(lines)


# ---------------------------------------------------------------- 参考绑定
def ensure_bindings(shot_dir: str, facts: dict) -> dict:
    path = os.path.join(shot_dir, "refs", "bindings.json")
    if os.path.exists(path):
        doc = _load(path)
    else:
        doc = {
            "kind": "r8_ref_bindings",
            "schema": "r8-bindings/1",
            "shot_id": facts["shot_id"],
            "slots": {},
        }
    slots = doc.setdefault("slots", {})
    for token, meta in IMAGE_SLOTS.items():
        slots.setdefault(token, {
            "role": meta["role"],
            "slot": meta["slot"],
            "path": None,
            "status": "unbound",
            "original_name": None,
            "note": meta["note"],
        })
    _write(path, doc)
    return doc


def bind_image(shot_dir: str, token: str, src: str, facts: dict) -> dict:
    if token not in IMAGE_SLOTS:
        raise ValueError(f"未知参考槽位 {token!r}；只支持 {list(IMAGE_SLOTS)}")
    if not os.path.exists(src):
        raise FileNotFoundError(src)
    bindings = ensure_bindings(shot_dir, facts)
    old = (bindings["slots"].get(token) or {}).get("path")
    if old and old.startswith("refs/images/"):
        old_path = os.path.join(shot_dir, old)
        if os.path.exists(old_path):
            os.remove(old_path)
    ext = os.path.splitext(src)[1].lower() or ".png"
    name = ("image1" if token == "@图片1" else "image2") + ext
    dest_dir = os.path.join(shot_dir, "refs", "images")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, name)
    shutil.copy2(src, dest)
    bindings["slots"][token] = {
        "role": IMAGE_SLOTS[token]["role"],
        "slot": IMAGE_SLOTS[token]["slot"],
        "path": _rel(shot_dir, dest),
        "status": "bound",
        "original_name": os.path.basename(src),
        "note": IMAGE_SLOTS[token]["note"],
    }
    _write(os.path.join(shot_dir, "refs", "bindings.json"), bindings)
    return bindings["slots"][token]


def unbind_image(shot_dir: str, token: str, facts: dict) -> dict:
    bindings = ensure_bindings(shot_dir, facts)
    old = (bindings["slots"].get(token) or {}).get("path")
    if old and old.startswith("refs/images/"):
        old_path = os.path.join(shot_dir, old)
        if os.path.exists(old_path):
            os.remove(old_path)
    bindings["slots"][token] = {
        "role": IMAGE_SLOTS[token]["role"],
        "slot": IMAGE_SLOTS[token]["slot"],
        "path": None,
        "status": "unbound",
        "original_name": None,
        "note": IMAGE_SLOTS[token]["note"],
    }
    _write(os.path.join(shot_dir, "refs", "bindings.json"), bindings)
    return bindings["slots"][token]


def set_narrative(shot_dir: str, facts: dict, **fields) -> dict:
    doc = ensure_narrative(shot_dir, facts)
    for key in ("subject", "scene", "style", "notes"):
        if fields.get(key) is not None:
            doc[key] = str(fields[key])
    action = fields.get("action")
    if action is not None:
        if not doc.get("segments"):
            doc["segments"] = [{"t": [0.0, float(facts["duration_s"])], "action": str(action)}]
        else:
            doc["segments"][0]["action"] = str(action)
    _write(os.path.join(shot_dir, "narrative.json"), doc)
    return doc


def build_refs(shot_dir: str) -> list[dict]:
    facts = collect_facts(shot_dir)
    bindings = ensure_bindings(shot_dir, facts)
    clay_mp4 = os.path.join(shot_dir, "clay", "clay.mp4")
    clay_avi = os.path.join(shot_dir, "clay", "clay.avi")
    clay_rel = "clay/clay.mp4" if os.path.exists(clay_mp4) else "clay/clay.avi"
    refs = [{
        "token": "@白模1",
        "aliases": ["@视频1", "@Clay Render 1"],
        "kind": "clay_render",
        "file": clay_rel if os.path.exists(clay_mp4) or os.path.exists(clay_avi) else None,
        "required": True,
        "status": "ready" if os.path.exists(clay_mp4) or os.path.exists(clay_avi) else "missing",
        "inherit": ["运镜", "景别", "主体走位", "遮挡关系", "时间节奏"],
        "exclude": ["材质", "颜色", "身份"],
    }]
    for token, meta in IMAGE_SLOTS.items():
        slot = bindings["slots"].get(token) or {}
        refs.append({
            "token": token,
            "kind": "image",
            "file": slot.get("path"),
            "required": False,
            "status": slot.get("status", "unbound"),
            "role": meta["role"],
            "slot": meta["slot"],
            "original_name": slot.get("original_name"),
            "inherit": meta["inherit"],
            "exclude": meta["exclude"],
        })
    return refs


def _refs_status(refs: list[dict]) -> str:
    clay = next((r for r in refs if r["token"] == "@白模1"), None)
    if not clay or clay.get("status") != "ready":
        return "blocked"
    images = [r for r in refs if r["kind"] == "image"]
    return "ready" if all(r.get("status") == "bound" for r in images) else "partial"


# ---------------------------------------------------------------- prompt
def _facts_sentence(facts: dict) -> str:
    lens = facts["lens_mm"] or {}
    dist = facts["distance_m"] or {}
    height = facts["camera_height_m"] or {}
    pitch = facts["pitch_down_deg"] or {}
    ratio = facts.get("subject_height_ratio_mean")
    ratio_range = facts.get("subject_height_ratio_range")
    ratio_txt = _f(ratio, "", 3)
    if ratio_range:
        ratio_txt += f"（{ratio_range[0]:.3f}–{ratio_range[1]:.3f}）"

    extra = []
    if facts.get("orbit_radius_m"):
        extra.append(f"环绕半径 {_f(facts['orbit_radius_m'], ' m')}")
    if facts.get("orbit_angular_rate_deg_s"):
        extra.append(f"角速度 {_f(facts['orbit_angular_rate_deg_s'], '°/s')}")
    motion = facts.get("subject_motion") or {}
    if motion.get("speed_mps"):
        extra.append(f"主体速度均值 {_f(motion['speed_mps']['mean'], ' m/s')}"
                     f"（最大 {_f(motion['speed_mps']['max'], ' m/s')}）")
    if facts.get("move_type") in ("dolly_in", "dolly_out") and dist:
        extra.append(f"起幅→落幅距离 {_f(dist['start'], ' m')} → {_f(dist['end'], ' m')}")
    extra_txt = "；".join(extra)
    if extra_txt:
        extra_txt = "；" + extra_txt

    return (
        f"{facts['move_label']}，{_f(facts['duration_s'], 's', 1)}，"
        f"{_f(facts['fps'], 'fps', 0)}，{facts['resolution'][0]}×{facts['resolution'][1]}；"
        f"焦段 {_f((lens or {}).get('start'), ' mm', 1)} → {_f((lens or {}).get('end'), ' mm', 1)}；"
        f"机位高度 {_f((height or {}).get('start'), ' m')} → {_f((height or {}).get('end'), ' m')}；"
        f"主体距离 {_f((dist or {}).get('start'), ' m')} → {_f((dist or {}).get('end'), ' m')}；"
        f"主体占画高 {ratio_txt}（{facts['shot_size']}）；"
        f"俯角 {_f((pitch or {}).get('start'), '°', 1)} → {_f((pitch or {}).get('end'), '°', 1)}"
        f"{extra_txt}。"
    )


def build_prompt_text(facts: dict, narrative: dict, refs: list[dict], text_only: bool = False) -> str:
    timeline = _timeline_text(narrative)
    facts_line = _facts_sentence(facts)
    negatives = (
        "【负面约束】不要出现轨迹线、坐标轴、相机 cone；不要把白模的灰色或替身颜色带进成片；"
        "不要改变镜头时序；不要添加字幕、水印、箭头标签。"
    )

    if text_only:
        return "\n".join([
            "【参考声明】参考 @白模1 的运镜、景别、主体走位、遮挡关系和节奏；不从 @白模1 继承材质、颜色、身份。",
            f"【角色】{narrative.get('subject') or DEFAULT_SUBJECT}。",
            f"【场景】{narrative.get('scene') or DEFAULT_SCENE}；风格：{narrative.get('style') or DEFAULT_STYLE}。",
            f"【镜头事实】{facts_line}",
            "【时间线】\n" + timeline,
            "【整体收束】角色、场景、材质与光线按上面的文字生成；保持白模的运镜、走位、切点和节奏；"
            "不要改变动作，不穿模、不串脸。",
            negatives,
        ])

    img1 = next((r for r in refs if r["token"] == "@图片1"), {})
    img2 = next((r for r in refs if r["token"] == "@图片2"), {})
    s1 = "已绑定" if img1.get("status") == "bound" else "待绑定"
    s2 = "已绑定" if img2.get("status") == "bound" else "待绑定"
    return "\n".join([
        "【参考声明】参考 @白模1 的运镜、景别、主体走位、遮挡关系和节奏；不从 @白模1 继承材质、颜色、身份。",
        f"【替换关系】将 @白模1 中的灰色人形替换为 @图片1 的角色（{s1}）；"
        f"场景材质、光线、色调参考 @图片2（{s2}）。",
        f"【镜头事实】{facts_line}",
        "【时间线】\n" + timeline,
        "【整体收束】保持 @白模1 的运镜、走位、切点和节奏不变；角色身份与服装严格参考 @图片1；"
        "场景材质与光线参考 @图片2；不穿模、不串脸、不改变动作。",
        negatives,
    ])


def _facts_table(facts: dict) -> list[str]:
    lens = facts["lens_mm"] or {}
    dist = facts["distance_m"] or {}
    height = facts["camera_height_m"] or {}
    pitch = facts["pitch_down_deg"] or {}
    ratio = facts.get("subject_height_ratio_mean")
    rr = facts.get("subject_height_ratio_range")
    ratio_txt = _f(ratio, "", 3)
    if rr:
        ratio_txt += f"（{rr[0]:.3f}–{rr[1]:.3f}）"
    lines = [
        "| 项 | 值 |",
        "|---|---|",
        f"| 时长 / fps | {_f(facts['duration_s'], ' s', 1)} / {_f(facts['fps'], '', 0)} |",
        f"| 分辨率 | {facts['resolution'][0]} × {facts['resolution'][1]} |",
        f"| 焦段 | {_f((lens or {}).get('start'), ' mm', 1)} → {_f((lens or {}).get('end'), ' mm', 1)} |",
        f"| 机位高度 | {_f((height or {}).get('start'), ' m')} → {_f((height or {}).get('end'), ' m')} |",
        f"| 主体距离 | {_f((dist or {}).get('start'), ' m')} → {_f((dist or {}).get('end'), ' m')} |",
        f"| 主体占画高 | {ratio_txt} |",
        f"| 景别（估算） | {facts['shot_size']} |",
        f"| 俯角 | {_f((pitch or {}).get('start'), '°', 1)} → {_f((pitch or {}).get('end'), '°', 1)} |",
    ]
    if facts.get("orbit_radius_m"):
        lines.append(f"| 环绕半径 | {_f(facts['orbit_radius_m'], ' m')} |")
    if facts.get("orbit_angular_rate_deg_s"):
        lines.append(f"| 环绕角速度 | {_f(facts['orbit_angular_rate_deg_s'], ' °/s')} |")
    motion = facts.get("subject_motion") or {}
    if motion.get("speed_mps"):
        lines.append(f"| 主体速度 | 均值 {_f(motion['speed_mps']['mean'], ' m/s')}，"
                     f"最大 {_f(motion['speed_mps']['max'], ' m/s')} |")
    return lines


def _refs_table(refs: list[dict]) -> list[str]:
    lines = ["| token | 文件 | 继承 | 不继承 | 状态 |", "|---|---|---|---|---|"]
    for r in refs:
        lines.append(f"| `{r['token']}` | {r.get('file') or '（待绑定）'} | "
                     f"{'、'.join(r['inherit'])} | {'、'.join(r['exclude'])} | {r['status']} |")
    return lines


def _build_refs_md(facts: dict, narrative: dict, refs: list[dict], prompt_text: str) -> str:
    refs_status = _refs_status(refs)
    return "\n".join([
        f"# {facts['shot_id']} · {facts['move_label']}",
        "",
        f"> {facts['title']}",
        "",
        "## 叙事（可改 `narrative.json`）",
        "",
        f"- 角色：{narrative.get('subject') or DEFAULT_SUBJECT}",
        f"- 场景：{narrative.get('scene') or DEFAULT_SCENE}",
        f"- 风格：{narrative.get('style') or DEFAULT_STYLE}",
        "- 时间线：",
        "",
        *[f"  - {line}" for line in _timeline_text(narrative).splitlines()],
        "",
        "## 镜头事实（从几何量出）",
        "",
        *_facts_table(facts),
        "",
        "## 参考绑定",
        "",
        *_refs_table(refs),
        "",
        f"参考状态：**{refs_status}**（`@图片1` / `@图片2` 用 `--bind` 绑定；未绑定时用 text-only）。",
        "",
        "## 可直接粘贴的 prompt（参考绑定版）",
        "",
        "```text",
        prompt_text,
        "```",
        "",
        "## 另一个版本",
        "",
        "- 不依赖参考图：`prompt_textonly.md`（白模 + 纯文字）。",
        "",
        "## 说明",
        "",
        "- 数字来自 `camera/intrinsics.json` 与 `validation_report.json`；改白模后重跑 `r8_probe.py`，不要手改。",
        "- `@白模1` 的别名包括 `@视频1` / `@Clay Render 1`，按下游模型的语法选用。",
        "",
    ])


def _build_textonly_md(facts: dict, narrative: dict, prompt_text: str) -> str:
    return "\n".join([
        f"# {facts['shot_id']} · text-only prompt",
        "",
        f"> {facts['title']}",
        "",
        "不依赖参考图；只用白模视频 + 文字。适合本地模型先把运镜/走位跑通。",
        "",
        "## 镜头事实（从几何量出）",
        "",
        *_facts_table(facts),
        "",
        "## 可直接粘贴的 prompt",
        "",
        "```text",
        prompt_text,
        "```",
        "",
        "## 说明",
        "",
        "- 角色/场景/风格来自 `narrative.json`；改完重跑 `--prompt`。",
        "- 数字来自 `camera/intrinsics.json` 与 `validation_report.json`，不手写。",
        "",
    ])


def build_prompt_pack(shot_dir: str, facts: dict) -> dict:
    narrative = ensure_narrative(shot_dir, facts)
    refs = build_refs(shot_dir)
    prompt_text = build_prompt_text(facts, narrative, refs, text_only=False)
    textonly_text = build_prompt_text(facts, narrative, refs, text_only=True)
    refs_status = _refs_status(refs)

    prompt = {
        "kind": "r8_prompt",
        "schema": "r8-prompt/1",
        "shot_id": facts["shot_id"],
        "title": facts["title"],
        "move": {
            "type": facts["move_type"],
            "label_zh": facts["move_label"],
            "easing": facts.get("easing"),
        },
        "duration_s": facts["duration_s"],
        "fps": facts["fps"],
        "resolution": facts["resolution"],
        "measured": {
            "lens_mm": facts["lens_mm"],
            "distance_m": facts["distance_m"],
            "camera_height_m": facts["camera_height_m"],
            "pitch_down_deg": facts["pitch_down_deg"],
            "subject_height_ratio_mean": facts["subject_height_ratio_mean"],
            "subject_height_ratio_range": facts["subject_height_ratio_range"],
            "shot_size": facts["shot_size"],
            "centering_offset": facts["centering_offset"],
            "subject_in_frame_ratio": facts["subject_in_frame_ratio"],
            "orbit_radius_m": facts["orbit_radius_m"],
            "orbit_angular_rate_deg_s": facts["orbit_angular_rate_deg_s"],
            "subject_motion": facts["subject_motion"],
        },
        "narrative": {
            "subject": narrative.get("subject"),
            "scene": narrative.get("scene"),
            "style": narrative.get("style"),
            "segments": narrative.get("segments"),
        },
        "refs": refs,
        "refs_status": refs_status,
        "prompt": prompt_text,
        "prompt_text_only": textonly_text,
        "variants": {
            "refs": "prompt/prompt.md",
            "text_only": "prompt/prompt_textonly.md",
        },
        "negative": [
            "不要出现轨迹线、坐标轴、相机 cone",
            "不要把白模的灰色或替身颜色带进成片",
            "不要改变镜头时序",
            "不要添加字幕、水印、箭头标签",
            "不要穿模、串脸、改变主体动作",
        ],
        "source": {
            "shot_spec": "shot_spec.json",
            "intrinsics": "camera/intrinsics.json",
            "validation": "validation_report.json",
            "narrative": "narrative.json",
            "bindings": "refs/bindings.json",
            "clay": "clay/clay.mp4",
            "rule": "所有数字从几何量出，不手写",
        },
        "license": facts.get("license") or [],
        "status": "ready" if refs_status in ("ready", "partial") else "blocked",
    }

    md_refs = _build_refs_md(facts, narrative, refs, prompt_text)
    md_textonly = _build_textonly_md(facts, narrative, textonly_text)
    return {
        "facts": facts,
        "narrative": narrative,
        "refs": refs,
        "refs_status": refs_status,
        "prompt": prompt,
        "markdown_refs": md_refs,
        "markdown_textonly": md_textonly,
        "textonly": textonly_text,
    }


def write_prompt_pack(shot_dir: str) -> dict:
    facts = collect_facts(shot_dir)
    pack = build_prompt_pack(shot_dir, facts)
    ensure_bindings(shot_dir, facts)
    os.makedirs(os.path.join(shot_dir, "prompt"), exist_ok=True)
    os.makedirs(os.path.join(shot_dir, "refs"), exist_ok=True)

    _write(os.path.join(shot_dir, "prompt", "prompt.json"), pack["prompt"])
    _write(os.path.join(shot_dir, "prompt", "prompt_textonly.json"), {
        "kind": "r8_prompt_textonly",
        "schema": "r8-prompt-textonly/1",
        "shot_id": facts["shot_id"],
        "duration_s": facts["duration_s"],
        "fps": facts["fps"],
        "resolution": facts["resolution"],
        "measured": pack["prompt"]["measured"],
        "narrative": pack["prompt"]["narrative"],
        "prompt": pack["textonly"],
        "negative": pack["prompt"]["negative"],
        "status": pack["prompt"]["status"],
    })
    with open(os.path.join(shot_dir, "prompt", "prompt.md"), "w", encoding="utf-8") as fh:
        fh.write(pack["markdown_refs"])
    with open(os.path.join(shot_dir, "prompt", "prompt_textonly.md"), "w", encoding="utf-8") as fh:
        fh.write(pack["markdown_textonly"])

    bindings = _load(os.path.join(shot_dir, "refs", "bindings.json"))
    _write(os.path.join(shot_dir, "refs", "refs.json"), {
        "kind": "r8_refs",
        "schema": "r8-refs/1",
        "shot_id": facts["shot_id"],
        "refs": pack["refs"],
        "bindings": bindings,
        "refs_status": pack["refs_status"],
        "note": "未绑定槽位在本地模型接入时补齐；@白模1 必须 ready。",
    })

    clay_mp4 = os.path.join(shot_dir, "clay", "clay.mp4")
    clay_avi = os.path.join(shot_dir, "clay", "clay.avi")
    primary = clay_mp4 if os.path.exists(clay_mp4) else clay_avi
    request = {
        "kind": "r8_probe_request",
        "schema": "r8-probe/1",
        "shot_id": facts["shot_id"],
        "move_type": facts["move_type"],
        "inputs": {
            "clay_video": _rel(shot_dir, primary),
            "clay_video_fallback": _rel(shot_dir, clay_avi) if os.path.exists(clay_avi) else None,
            "clay_contact_sheet": _rel(shot_dir, os.path.join(shot_dir, "clay", "contact_sheet.jpg")),
            "prompt_md": "prompt/prompt.md",
            "prompt_json": "prompt/prompt.json",
            "prompt_textonly_md": "prompt/prompt_textonly.md",
            "prompt_textonly_json": "prompt/prompt_textonly.json",
            "narrative": "narrative.json",
            "refs": "refs/refs.json",
            "bindings": "refs/bindings.json",
        },
        "expected": {
            "duration_s": facts["duration_s"],
            "fps": facts["fps"],
            "resolution": facts["resolution"],
            "frames": facts["frames"],
            "move_type": facts["move_type"],
            "shot_size": facts["shot_size"],
            "subject_height_ratio_mean": facts["subject_height_ratio_mean"],
            "refs_status": pack["refs_status"],
            "checks": [
                "运镜路径与起幅/落幅一致",
                "主体在画、景别与占画高一致",
                "切点/时长/节奏一致",
                "无颜色泄漏、无轨迹线/坐标轴",
            ],
        },
        "output_contract": {
            "video": "probe/generated.mp4",
            "metadata": "probe/result.json",
            "required_fields": [
                "kind", "schema", "shot_id", "model", "run_id", "seed",
                "video", "duration_s", "fps", "resolution", "status",
            ],
            "status_values": ["ok", "failed", "mock"],
            "note": "本地模型适配器读本文件，写 result.json + generated.mp4；不修改 clay/ 与 prompt/。",
        },
        "status": "ready" if pack["refs_status"] in ("ready", "partial") else "blocked",
    }
    _write(os.path.join(shot_dir, "probe", "request.json"), request)

    score = {
        "kind": "r8_score_sheet",
        "schema": "r8-score/1",
        "shot_id": facts["shot_id"],
        "scale": {"min": 1, "max": 5, "meaning": "1=明显不符，3=基本一致，5=高度一致"},
        "criteria": [
            {"id": "camera_path", "label": "运镜路径",
             "hint": "起幅/落幅/方向/速度是否与白模一致"},
            {"id": "blocking", "label": "主体走位与遮挡",
             "hint": "主体位置、前后关系、出入画是否一致"},
            {"id": "framing", "label": "景别与构图",
             "hint": "占画高、居中、焦段感是否一致"},
            {"id": "timing", "label": "时间与节奏",
             "hint": "时长、动作节点、切点是否一致"},
            {"id": "identity_material", "label": "身份与材质",
             "hint": "角色/场景/材质是否按参考图或文字绑定"},
            {"id": "artifacts", "label": "伪影",
             "hint": "有无颜色泄漏、轨迹线、坐标轴、穿模、字幕"},
        ],
        "scores": None,
        "notes": "",
        "instructions": "人类或 VLM 逐项 1–5 分；不要用总分替代单项，运镜/走位不过关时先看 camera_path/blocking。",
    }
    _write(os.path.join(shot_dir, "probe", "score_sheet.json"), score)

    return {
        "facts": facts,
        "narrative": pack["narrative"],
        "prompt": pack["prompt"],
        "refs": pack["refs"],
        "refs_status": pack["refs_status"],
        "markdown_refs": pack["markdown_refs"],
        "markdown_textonly": pack["markdown_textonly"],
        "request": request,
        "score_sheet": score,
    }


def write_mock_result(shot_dir: str) -> dict:
    """接口闭环用：不假装跑模型，只把 clay 当作 mock 输出。"""
    facts = collect_facts(shot_dir)
    clay = os.path.join(shot_dir, "clay", "clay.mp4")
    if not os.path.exists(clay):
        clay = os.path.join(shot_dir, "clay", "clay.avi")
    result = {
        "kind": "r8_probe_result",
        "schema": "r8-result/1",
        "shot_id": facts["shot_id"],
        "model": "mock",
        "run_id": "mock-" + _dt.datetime.now().strftime("%Y%m%d%H%M%S"),
        "seed": 0,
        "video": _rel(shot_dir, clay),
        "duration_s": facts["duration_s"],
        "fps": facts["fps"],
        "resolution": facts["resolution"],
        "status": "mock",
        "notes": "下游本地模型尚未接入；本结果只验证 request/result 接口，不代表生成质量。",
    }
    _write(os.path.join(shot_dir, "probe", "result.mock.json"), result)
    return result


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="R8 prompt / narrative / refs / request 生成")
    ap.add_argument("shots", nargs="+")
    ap.add_argument("--bind", action="append", default=[], metavar="TOKEN=PATH",
                    help="绑定参考图，例如 --bind @图片1=path/char.png")
    ap.add_argument("--unbind", action="append", default=[], metavar="TOKEN")
    ap.add_argument("--action", default=None, help="设置第一时间线动作")
    ap.add_argument("--subject", default=None)
    ap.add_argument("--scene", default=None)
    ap.add_argument("--style", default=None)
    ap.add_argument("--mock", action="store_true")
    args = ap.parse_args()

    for shot in args.shots:
        d = _dir(shot)
        facts = collect_facts(d)
        if any((args.action, args.subject, args.scene, args.style)):
            set_narrative(d, facts, action=args.action, subject=args.subject,
                          scene=args.scene, style=args.style)
        for token in args.unbind:
            unbind_image(d, token, facts)
        for item in args.bind:
            if "=" not in item:
                raise SystemExit(f"--bind 需要 TOKEN=PATH，收到 {item!r}")
            token, path = item.split("=", 1)
            slot = bind_image(d, token.strip(), path, facts)
            print(f"[r8] bind {token} -> {slot['path']}")
        out = write_prompt_pack(d)
        print(json.dumps({"shot": out["facts"]["shot_id"],
                          "refs_status": out["refs_status"],
                          "prompt_status": out["prompt"]["status"]},
                         ensure_ascii=False))
        if args.mock:
            print(json.dumps(write_mock_result(d), ensure_ascii=False))
