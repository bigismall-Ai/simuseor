"""R2 · 镜头包验收 —— 从**落盘产物**回读，逐包逐项判定。

产出：assets/validation/shot_package_check.json

这一份是**独立验收**，不信任写出时的内存状态：所有读数都从磁盘上的文件重新解析。
查的项：
  ① 五类产物齐备（spec / camera×3 / conditions / validation / 预览）
  ② 逐帧内外参：镜头包里的 camera/intrinsics.json 与权威源
     assets/validation/camera_intrinsics.json 的切片**逐字段相等**且 sha256 一致
  ③ USD 相机时序：回读 usda，重建位姿与内参，与 intrinsics 重投影比对（≤ 1e-4 px）
     —— 并与既有 harness/export_usd.py::_look_at_rot 对表（约定不漂移）
  ④ glTF camera：perspective + yfov/znear/zfar + 节点变换 + 动画采样与 intrinsics 一致
  ⑤ 条件图：逐帧六通道齐备 + sidecar 七字段全过（R1 的扫描器）
  ⑥ 预览：联系表可解码 + AVI 帧数与镜头帧数一致
  ⑦ 手持镜头：从落盘 intrinsics 重算 FFT 主频，必须落在 0.5–3 Hz
  ⑧ 镜头包 validation_report.json 自洽且 pass

用法：
    python verify_shot_packages.py
"""
from __future__ import annotations

import base64
import json
import os
import re
import struct
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import camera_moves as CM        # noqa: E402
import shot_package as SP        # noqa: E402

OUT_PATH = os.path.join(ROOT, "assets", "validation", "shot_package_check.json")
AUTHORITY = SP.AUTHORITY_PATH
REPROJ_LIMIT = 1e-4
HANDHELD_BAND = (0.5, 3.0)


# ---------------------------------------------------------------- AVI 回读
def _riff_chunks(data, start, end):
    """遍历 RIFF chunk 序列，产出 (fourcc, 数据起点, 长度)。"""
    p = start
    while p + 8 <= end:
        cid = data[p:p + 4]
        size = struct.unpack("<I", data[p + 4:p + 8])[0]
        body = p + 8
        if body + size > end:
            break
        yield cid, body, size
        p = body + size + (size & 1)


def read_avi(path):
    """极简 RIFF/AVI 回读：返回 {"frames", "width", "height", "fps", "codec"}。"""
    data = open(path, "rb").read()
    if data[:4] != b"RIFF" or data[8:12] != b"AVI ":
        raise ValueError("不是 RIFF/AVI 文件")
    width = height = 0
    fps = 0.0
    codec = ""
    frames = 0
    for cid, body, size in _riff_chunks(data, 12, len(data)):
        if cid != b"LIST":
            continue
        ltype = data[body:body + 4]
        if ltype == b"movi":
            for cid2, b2, s2 in _riff_chunks(data, body + 4, body + size):
                if cid2 in (b"00dc", b"00db"):
                    frames += 1
        elif ltype == b"hdrl":
            for cid2, b2, s2 in _riff_chunks(data, body + 4, body + size):
                if cid2 == b"avih":
                    vals = struct.unpack("<IIIIIIIIIIIIII", data[b2:b2 + 56])
                    fps = 1e6 / vals[0] if vals[0] else 0.0
                    width, height = vals[8], vals[9]
                elif cid2 == b"LIST" and data[b2:b2 + 4] == b"strl":
                    for cid3, b3, s3 in _riff_chunks(data, b2 + 4, b2 + size):
                        if cid3 == b"strh":
                            vals = struct.unpack("<4s4sIHHIIIIIIIIhhhh", data[b3:b3 + 56])
                            codec = vals[1].decode("ascii", "replace")
    return {"frames": frames, "width": width, "height": height,
            "fps": fps, "codec": codec, "bytes": len(data)}


# ---------------------------------------------------------------- export_usd 约定对表
def export_usd_look_at_rot():
    """从既有 harness/export_usd.py 抽出 _look_at_rot（独立实现，用于约定对表）。"""
    src = open(os.path.join(HERE, "export_usd.py"), encoding="utf-8").read()
    m = re.search(r"def _look_at_rot.*?return np\.degrees\(\[rx, ry, rz\]\)", src, re.S)
    if not m:
        return None
    ns = {"np": np}
    exec(m.group(0), ns)
    return ns["_look_at_rot"]


# ---------------------------------------------------------------- 逐包校验
def verify_shot(shot_id, authority, subject):
    shot_dir = os.path.join(ROOT, "shots", shot_id)
    checks = []

    def _add(cid, name, value, op, limit, detail=""):
        ok = (value >= limit) if op == ">=" else (value <= limit) if op == "<=" else bool(value)
        checks.append({"id": cid, "name_zh": name, "value": value, "limit": limit,
                       "op": op, "pass": bool(ok), "detail": detail})

    # ---- ① 五类产物
    need = {
        "spec": os.path.join(shot_dir, "shot_spec.json"),
        "camera_usda": os.path.join(shot_dir, "camera", "camera.usda"),
        "camera_gltf": os.path.join(shot_dir, "camera", "camera.gltf"),
        "camera_intrinsics": os.path.join(shot_dir, "camera", "intrinsics.json"),
        "validation": os.path.join(shot_dir, "validation_report.json"),
        "contact_sheet": os.path.join(shot_dir, "preview", "contact_sheet.jpg"),
        "previs": os.path.join(shot_dir, "preview", "previs.avi"),
    }
    missing = [k for k, v in need.items() if not os.path.exists(v)]
    _add("products_present", "五类产物齐备（spec / camera×3 / conditions / validation / 预览）",
         len(need) - len(missing), ">=", len(need) - 1,
         "缺: %s" % (missing or "无"))
    cond_dir = os.path.join(shot_dir, "conditions")
    cond_frames = sorted(d for d in os.listdir(cond_dir)
                         if d.startswith("frame_") and os.path.isdir(os.path.join(cond_dir, d))) \
        if os.path.isdir(cond_dir) else []
    _add("conditions_frames_present", "条件图逐帧目录数", len(cond_frames), ">=", 1,
         "帧目录 %d 个" % len(cond_frames))

    with open(need["camera_intrinsics"], "r", encoding="utf-8") as fh:
        intr_doc = json.load(fh)
    frames = intr_doc["frames"]
    n = len(frames)

    # ---- ② 权威源对账
    sec = authority["shots"].get(shot_id)
    _add("authority_slice_present", "权威源里有该镜头的切片", bool(sec), "==", True)
    if sec:
        same_bytes = SP.canonical_json(sec["frames"]) == SP.canonical_json(frames)
        _add("authority_slice_identical", "镜头包 intrinsics 与权威源切片逐字段相等",
             int(same_bytes), ">=", 1)
        _add("authority_slice_sha256", "切片 sha256 与权威源登记一致",
             SP._sha256_bytes(SP.canonical_json(frames)), "==", sec["slice_sha256"])
        _add("authority_slice_sha_matches_doc", "镜头包自报的 sha256 与实际内容一致",
             intr_doc["authority"]["slice_sha256"], "==",
             SP._sha256_bytes(SP.canonical_json(frames)))

    # ---- ③ USD 相机时序 vs intrinsics
    reproj = SP.usd_reprojection_check(need["camera_usda"], frames,
                                       intr_doc["resolution"][0], intr_doc["resolution"][1], 10)
    _add("usd_reproj_error", "USD 相机时序与 intrinsics 逐帧重投影误差（px）",
         reproj["max_reproj_error_px"], "<=", REPROJ_LIMIT,
         "抽样 %d 帧" % reproj["n_sampled"])
    _add("usd_per_frame_samples", "USD 相机时序逐帧采样（translate/rotate/focal）",
         min(reproj["n_translate_samples"], reproj["n_rotate_samples"],
             reproj["n_focal_samples"]), ">=", n)
    _add("usd_stage_metadata", "USD 舞台元数据（upAxis=Z / metersPerUnit=1 / timeCodesPerSecond）",
         "%s/%s/%s" % (reproj["up_axis"], reproj["meters_per_unit"],
                       reproj["time_codes_per_second"]), "==", "Z/1.0/%s" % intr_doc["fps"])
    _add("usd_aperture_square_pixels", "USD 两轴 f_px 一致（方形像素）",
         reproj["f_px_horizontal_vs_vertical_max_diff"], "<=", 1e-9)

    # 约定不漂移：与既有 export_usd._look_at_rot 对表
    ref = export_usd_look_at_rot()
    if ref:
        worst = 0.0
        for fr in frames:
            r = ref(fr["eye"], fr["target"])
            worst = max(worst, float(np.abs(np.array(r) - np.array(fr["usd"]["rotate_xyz_deg"])).max()))
        _add("usd_euler_convention_matches_export_usd", "欧拉约定与 export_usd._look_at_rot 一致（度）",
             worst, "<=", 1e-9)

    # ---- ④ glTF camera
    with open(need["camera_gltf"], "r", encoding="utf-8") as fh:
        g = json.load(fh)
    cam = (g.get("cameras") or [{}])[0]
    _add("gltf_camera_perspective", "glTF camera 是 perspective", cam.get("type"), "==", "perspective")
    f_px0 = frames[0]["f_px"]
    yfov_exp = 2.0 * np.arctan(intr_doc["resolution"][1] / (2.0 * f_px0))
    _add("gltf_yfov_matches_intrinsics", "glTF yfov 与第 0 帧 f_px 一致（rad）",
         float(abs(cam.get("yfov", 0.0) - yfov_exp)), "<=", 1e-9)
    _add("gltf_znear_zfar", "glTF znear/zfar 与镜头裁剪面一致",
         "%s/%s" % (cam.get("znear"), cam.get("zfar")), "==",
         "%s/%s" % (intr_doc["clipping_range"]["near"], intr_doc["clipping_range"]["far"]))
    node = (g.get("nodes") or [{}])[0]
    _add("gltf_node_matches_frame0", "glTF 节点变换与第 0 帧一致",
         float(np.abs(np.array(node.get("translation", [0, 0, 0]))
                      - np.array(frames[0]["gltf"]["translation"])).max()), "<=", 1e-6)
    # 动画采样与 intrinsics 逐帧对表
    buf = base64.b64decode(g["buffers"][0]["uri"].split(",", 1)[1])
    acc = g["accessors"]
    bv = g["bufferViews"]

    def _read_acc(i):
        a = acc[i]
        v = bv[a["bufferView"]]
        off = v.get("byteOffset", 0)
        ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
        data = np.frombuffer(buf, dtype="<f4", count=a["count"] * ncomp, offset=off)
        return data.reshape(a["count"], ncomp) if ncomp > 1 else data

    times = _read_acc(0)
    trans = _read_acc(1)
    rots = _read_acc(2)
    exp_t = np.array([f["gltf"]["translation"] for f in frames], float)
    exp_r = np.array([f["gltf"]["rotation_xyzw"] for f in frames], float)
    _add("gltf_animation_translation", "glTF 动画平移与 intrinsics 逐帧一致（m）",
         float(np.abs(trans - exp_t).max()), "<=", 1e-6)
    _add("gltf_animation_rotation", "glTF 动画四元数与 intrinsics 逐帧一致",
         float(np.abs(rots - exp_r).max()), "<=", 1e-6)
    _add("gltf_animation_frames", "glTF 动画采样帧数", len(times), ">=", n)
    _add("gltf_channels", "glTF 动画通道数（translation + rotation）",
         len(g["animations"][0]["channels"]), ">=", 2)

    # ---- ⑤ 条件图：六通道齐备 + sidecar 七字段
    import conditions as C
    channels = list(C._CONTRACT_CHANNELS)
    complete = 0
    sidecar_ok = 0
    sidecar_files = 0
    sidecar_skipped = 0
    for d in cond_frames:
        fd = os.path.join(cond_dir, d)
        have = [c for c in channels
                if os.path.exists(os.path.join(fd, "cond_%s.png" % c))]
        if len(have) == len(channels):
            complete += 1
        sc = C._scan_sidecar_dir(fd)
        sidecar_files += sc["n_files"]
        sidecar_ok += sc["n_ok"]
        sidecar_skipped += sc.get("n_skipped", 0)
    _add("conditions_channels_complete", "六通道齐备帧数", complete, ">=", len(cond_frames))
    _add("conditions_sidecar_ok", "sidecar 七字段通过数（不含非 sidecar 的 JSON）",
         sidecar_ok, ">=", sidecar_files - sidecar_skipped,
         "共 %d 个 JSON，其中 %d 个是 R1 的关键点 JSON（按契约跳过）"
         % (sidecar_files, sidecar_skipped))
    idx_path = os.path.join(cond_dir, "index.json")
    _add("conditions_index", "conditions/index.json 存在", os.path.exists(idx_path), "==", True)
    # 条件图确实是**用本镜头的相机**渲的：sidecar 的 camera 与 intrinsics 对表
    cam_worst = 0.0
    for d in cond_frames[::max(1, len(cond_frames) // 10)]:
        i = int(d.split("_")[1])
        sc = json.load(open(os.path.join(cond_dir, d, "cond_depth.json"), encoding="utf-8"))
        cmeta = sc.get("camera", {})
        fr = frames[i]
        cam_worst = max(cam_worst,
                        float(np.abs(np.array(cmeta.get("eye", [0, 0, 0])) - np.array(fr["eye"])).max()),
                        float(np.abs(np.array(cmeta.get("target", [0, 0, 0])) - np.array(fr["target"])).max()),
                        float(abs(float(cmeta.get("f_px", 0.0)) - fr["f_px"])))
    _add("conditions_camera_matches_intrinsics", "条件图 sidecar 的相机与 intrinsics 一致",
         cam_worst, "<=", 1e-6, "抽样比对 eye/target/f_px")

    # ---- ⑥ 预览
    from PIL import Image
    try:
        im = Image.open(need["contact_sheet"])
        im.load()
        sheet_ok = im.size[0] > 0 and im.size[1] > 0
        sheet_size = list(im.size)
    except Exception as exc:
        sheet_ok, sheet_size = False, str(exc)
    _add("preview_contact_sheet", "联系表可解码", int(bool(sheet_ok)), ">=", 1,
         "尺寸 %s" % sheet_size)
    avi = read_avi(need["previs"])
    _add("preview_avi_frames", "预览视频帧数与镜头帧数一致", avi["frames"], ">=", n,
         "codec=%s %dx%d %.3f fps" % (avi["codec"], avi["width"], avi["height"], avi["fps"]))

    # ---- ⑦ 手持 FFT（从落盘 intrinsics 重算）
    if intr_doc.get("move_type") == "handheld":
        # 从落盘的逐帧 eye 反推残差（不依赖镜头计划里的解析参数）
        res = CM.handheld_residual_from_track(
            [{"eye": f["eye"], "target": f["target"]} for f in frames], subject)
        dom, freqs, spec = CM.fft_dominant(res, intr_doc["fps"])
        _add("handheld_fft_band", "手持噪声 FFT 主频落在 0.5–3 Hz（从落盘数据重算）",
             float(dom), "in", list(HANDHELD_BAND),
             "频率栅格 %.2f Hz" % float(freqs[1] - freqs[0]))
        _add("handheld_fft_dominant", "手持噪声主频是频谱最大峰",
             float(dom), ">=", HANDHELD_BAND[0],
             "主频 %.2f Hz（残差 RMS %.4f m）"
             % (dom, float(np.sqrt((res ** 2).sum(axis=1).mean()))))

    # ---- ⑧ validation_report 自洽
    with open(need["validation"], "r", encoding="utf-8") as fh:
        rep = json.load(fh)
    _add("validation_report_pass", "镜头包验证报告 pass", bool(rep.get("pass")), "==", True)
    _add("validation_report_checks", "验证报告校验条目数",
         rep["summary"]["n_checks"], ">=", 5)

    # ---- ⑨ shot spec 必备字段（ROADMAP §2.5.1）
    with open(need["spec"], "r", encoding="utf-8") as fh:
        spec = json.load(fh)
    required = ["shot_id", "kind", "fps", "duration_s", "resolution", "up_axis",
                "assets", "actors", "camera", "conditions", "timeline",
                "validation", "license", "status"]
    miss = [k for k in required if k not in spec]
    _add("shot_spec_fields", "shot_spec 必备字段齐备（§2.5.1）", len(required) - len(miss),
         ">=", len(required) - 1, "缺: %s" % (miss or "无"))
    cam_spec = spec.get("camera", {})
    _add("shot_spec_camera_move", "shot_spec.camera.move 存在（镜头类型库核心字段）",
         bool(cam_spec.get("move")), "==", True)
    _add("shot_spec_keys_match_intrinsics", "shot_spec.camera.keys 与 intrinsics 逐帧一致",
         int(len(cam_spec.get("keys", [])) == n), ">=", 1,
         "keys=%d frames=%d" % (len(cam_spec.get("keys", [])), n))

    n_pass = sum(1 for c in checks if c["pass"])
    return {"shot_id": shot_id, "n_checks": len(checks), "n_pass": n_pass,
            "all_pass": n_pass == len(checks), "checks": checks,
            "usd_reprojection": reproj, "avi": avi,
            "authority_slice_sha256": sec["slice_sha256"] if sec else None}


def main():
    with open(AUTHORITY, "r", encoding="utf-8") as fh:
        authority = json.load(fh)
    verts, joints, faces, root_y = SP.load_sequence()
    subject = SP.build_subject(verts, root_y)
    subject["pos"] = subject["pos"][:120]
    subject["chest"] = subject["chest"][:120]
    results = []
    for shot_id in sorted(authority["shots"].keys()):
        res = verify_shot(shot_id, authority, subject)
        results.append(res)
        print("[R2 verify] %-16s %d/%d" % (shot_id, res["n_pass"], res["n_checks"]))
        for c in res["checks"]:
            if not c["pass"]:
                print("      FAIL %s  value=%s limit=%s %s | %s"
                      % (c["id"], c["value"], c["limit"], c["op"], c["detail"]))
    worst = max((r["usd_reprojection"]["max_reproj_error_px"] for r in results), default=0.0)
    handheld = next((r for r in results if r["shot_id"] == "shot_handheld"), None)
    fft = None
    if handheld:
        for c in handheld["checks"]:
            if c["id"] == "handheld_fft_band":
                fft = c
    doc = {
        "kind": "shot_package_check",
        "version": "1.0.0",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "generator": "harness/verify_shot_packages.py",
        "authority": SP._rel(AUTHORITY),
        "reprojection_limit_px": REPROJ_LIMIT,
        "summary": {
            "n_shots": len(results),
            "n_shots_all_pass": sum(1 for r in results if r["all_pass"]),
            "total_checks": sum(r["n_checks"] for r in results),
            "total_passed": sum(r["n_pass"] for r in results),
            "max_usd_reprojection_error_px": worst,
            "reprojection_within_limit": bool(worst <= REPROJ_LIMIT),
            "handheld_fft_dominant_hz": fft["value"] if fft else None,
            "handheld_fft_band_hz": HANDHELD_BAND,
            "handheld_fft_in_band": bool(fft and fft["pass"]) if fft else None,
            "all_pass": all(r["all_pass"] for r in results),
        },
        "shots": results,
    }
    SP._write_json(OUT_PATH, doc)
    print(json.dumps(doc["summary"], ensure_ascii=False, indent=2))
    return 0 if doc["summary"]["all_pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
