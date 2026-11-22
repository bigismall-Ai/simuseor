"""R2 · 镜头包写出器 —— 一个镜头包 = 一个自包含目录。

ROADMAP §2.4.2 的镜头包结构：
    shots/<shot_id>/
    ├── shot_spec.json          场景 + 角色 + 相机 + 时间段 + 状态（§2.5.1 字段表）
    ├── camera/
    │   ├── camera.usda         USD 相机时序（**逐帧**时间采样，不抽样）
    │   ├── camera.gltf         glTF camera（perspective + yfov/znear/zfar）
    │   └── intrinsics.json     逐帧 f_px/cx/cy + 近远平面 + 内外参 R/t
    ├── conditions/             逐帧条件序列（六通道 PNG + 每通道 sidecar）
    ├── geometry/               该镜头用到的资产实例（GLB）+ 清单
    ├── validation_report.json  构图 + 运动 + 条件图校验
    └── preview/                contact_sheet.jpg + previs.avi + 预览帧

权威源口径（关键）
==================
**逐帧内外参 JSON 是唯一权威源**：assets/validation/camera_intrinsics.json 存全部镜头的
逐帧内外参；每个镜头包里的 camera/intrinsics.json 是它的**同源切片**（同一份数据，
带切片 sha256）。USD 与 glTF 都从这份数据派生，不存在第二套真值。

条件图口径
==========
条件图走 R1 的 `conditions.render_conditions` + `conditions.save_condition_pack`
（同一次光栅化出六通道、同一个 sidecar schema），本模块**不另写一套渲染**。
唯一的差别是「相机由镜头包提供」——R1 的 `run_shot_conditions()` 把机位写死成
`render_shot.cam_at`，而 harness/conditions.py 属 R1 只读文件，所以这里复用它的
渲染与 sidecar 写出函数，只换掉相机这一层输入。

硬约束
======
禁 3D 生成式模型 / 全 CPU / 不下载模型权重 / 不引入 Blender 运行时 /
不做下游图视频模型 A/B 验证。
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
import struct
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import camera_moves as CM          # noqa: E402
import condition_contract as K     # noqa: E402

SHOTS_DIR = os.path.join(ROOT, "shots")
VALIDATION_DIR = os.path.join(ROOT, "assets", "validation")
AUTHORITY_PATH = os.path.join(VALIDATION_DIR, "camera_intrinsics.json")

DEFAULT_WIDTH, DEFAULT_HEIGHT = 720, 404
DEFAULT_FPS = 24
DEFAULT_DURATION_S = 5.0
CLIP_NEAR, CLIP_FAR = 0.1, 200.0
SEQUENCE_PATH = os.path.join(ROOT, "assets", "nongeometry", "shot001_hero.npz")
SCENE_GLB = os.path.join(ROOT, "assets", "geometry", "scene_street.glb")
HERO_GLB = os.path.join(ROOT, "assets", "geometry", "character_hero.glb")

CONVENTION = {
    "up_axis": "Z",
    "handedness": "right",
    "units": "meter",
    "world_to_camera": ("x = d·right, y = d·upv, z = d·fwd（z 向前为正）；"
                        "px = W/2 + (x/z)·f_px，py = H/2 - (y/z)·f_px"),
    "f_px": "f_px = H / (2·tan(fov_y/2))，fov_y = 2·atan(sensor_mm/2 / focal_mm)；f_px 是权威内参",
    "usd_camera": "看 −Z、+Y 向上；xformOp:rotateXYZ = Rz(rz)·Ry(ry)·Rx(rx)",
    "usd_aperture": ("horizontalAperture = sensor_mm·W/H，verticalAperture = sensor_mm "
                     "（方形像素，两轴 f_px 一致）"),
    "gltf_camera": "Y-up 世界系（p_yup = (x, z, −y)，契约里唯一那一处换算）；局部 +X 右 / +Y 上 / −Z 前",
    "authority": "assets/validation/camera_intrinsics.json 是逐帧内外参唯一权威源",
}


# ---------------------------------------------------------------- 工具
def _sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def canonical_json(obj) -> bytes:
    """规范化 JSON 字节串（切片哈希用；排序键 + 紧凑分隔符 + 不转义中文）。"""
    return json.dumps(obj, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")


def _write_json(path: str, obj) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return path


def _rel(path: str) -> str:
    return os.path.relpath(path, ROOT).replace(os.sep, "/")


# ---------------------------------------------------------------- 场景
def load_sequence(path: str = SEQUENCE_PATH):
    """读英雄帧序列（vertices / joints / faces / root_y）。"""
    with np.load(path, allow_pickle=False) as z:
        return (np.asarray(z["vertices"]), np.asarray(z["joints"]),
                np.asarray(z["faces"]), np.asarray(z["root_y"]))


def build_subject(verts, root_y):
    """主体轨迹 + 逐帧包围盒（英雄网格；不用关节索引，避开 ANK_L 的名字表差一位）。"""
    subj = CM.make_subject_track(root_y)
    off = np.array([0.0, -1.6, 0.0])          # 与 conditions.SHOT_HERO_OFFSET 同值
    v = verts + off
    bbox = np.stack([v.min(axis=1), v.max(axis=1)], axis=1)
    subj["bbox"] = bbox
    return subj


# ---------------------------------------------------------------- 内外参
def compute_intrinsics(plan, frames, width=DEFAULT_WIDTH, height=DEFAULT_HEIGHT):
    """由镜头计划算出**逐帧**内外参（本项目的唯一真值来源）。

    每帧给出：f_px / cx / cy / K / R（世界→相机，契约口径）/ t / USD 位姿 / glTF 节点变换。
    """
    sensor = float(plan["sensor_width_mm"])
    out = []
    for fr in frames:
        eye = np.asarray(fr["eye"], float)
        tgt = np.asarray(fr["target"], float)
        focal = float(fr["focal_mm"])
        f_px = CM.f_px_from_focal(focal, height, sensor)
        cx, cy = width / 2.0, height / 2.0
        _e, fwd, right, upv = CM.camera_basis(eye, tgt)
        # 契约口径（相机空间 z 向前为正）
        R_contract = np.stack([right, upv, fwd], axis=0)
        t_contract = -R_contract @ eye
        # USD 口径：R_cam_to_world 的列 = [right, upv, −fwd]（相机轴在世界系里的方向）
        # 世界→相机矩阵是它的转置（相机空间 z 向后为正）
        R_c2w_usd = np.stack([right, upv, -fwd], axis=1)
        R_w2c_usd = R_c2w_usd.T
        usd = CM.usd_camera_pose(eye, tgt)
        gltf = CM.gltf_node_transform(eye, tgt)
        out.append({
            "i": int(fr["i"]),
            "t": float(fr["t"]),
            "t_code": int(fr["i"]),
            "eye": [float(v) for v in eye],
            "target": [float(v) for v in tgt],
            "focal_mm": focal,
            "f_px": float(f_px),
            "fov_y_deg": float(CM.fov_y_from_f_px(f_px, height)),
            "cx": float(cx), "cy": float(cy),
            "K": [[float(f_px), 0.0, float(cx)],
                  [0.0, float(f_px), float(cy)],
                  [0.0, 0.0, 1.0]],
            "R_world_to_cam": [[float(v) for v in row] for row in R_contract],
            "t_world_to_cam": [float(v) for v in t_contract],
            "R_cam_to_world_usd": [[float(v) for v in row] for row in R_c2w_usd],
            "R_world_to_cam_usd": [[float(v) for v in row] for row in R_w2c_usd],
            "usd": {"translate": usd["translate"],
                    "rotate_xyz_deg": usd["rotate_xyz_deg"]},
            "gltf": {"translation": gltf["translation"],
                     "rotation_xyzw": gltf["rotation_xyzw"]},
        })
    return out


# ---------------------------------------------------------------- USD
def write_usda(path, intrinsics, width=DEFAULT_WIDTH, height=DEFAULT_HEIGHT,
               sensor_mm=CM.SENSOR_WIDTH_MM, fps=DEFAULT_FPS,
               near=CLIP_NEAR, far=CLIP_FAR):
    """写 USD 相机时序（**逐帧**时间采样，不抽样）。

    手写 USDA 文本而不是调 pxr：本机没有 usd-core（无 USD 运行时），而 USDA 是
    文本格式；写出来的文件由 harness/verify_shot_packages.py 用独立解析器回读，
    再与 intrinsics.json 逐帧比对（重投影误差 ≤ 1e-4）。

    孔径口径：horizontalAperture = sensor_mm·W/H，verticalAperture = sensor_mm
    ⇒ 两轴的 f_px 都是 H·focal/sensor（方形像素），与契约的投影式逐项一致。
    """
    n = len(intrinsics)
    h_ap = sensor_mm * float(width) / float(height)
    v_ap = sensor_mm
    f0 = float(intrinsics[0]["focal_mm"])
    L = []
    L.append("#usda 1.0")
    L.append("(")
    L.append('    defaultPrim = "World"')
    L.append("    metersPerUnit = 1")
    L.append('    upAxis = "Z"')
    L.append("    timeCodesPerSecond = %d" % int(fps))
    L.append("    startTimeCode = 0")
    L.append("    endTimeCode = %d" % (n - 1))
    L.append(")")
    L.append("")
    L.append('def Xform "World"')
    L.append("{")
    L.append('    def Camera "Camera"')
    L.append("    {")
    L.append("        float focalLength = %r" % f0)
    L.append("        float2 clippingRange = (%r, %r)" % (float(near), float(far)))
    L.append("        float horizontalAperture = %r" % float(h_ap))
    L.append("        float verticalAperture = %r" % float(v_ap))
    L.append("        double3 xformOp:translate.timeSamples = {")
    for fr in intrinsics:
        tr = fr["usd"]["translate"]
        L.append("            %d: (%r, %r, %r)," % (fr["t_code"], tr[0], tr[1], tr[2]))
    L.append("        }")
    L.append("        float3 xformOp:rotateXYZ.timeSamples = {")
    for fr in intrinsics:
        rt = fr["usd"]["rotate_xyz_deg"]
        L.append("            %d: (%r, %r, %r)," % (fr["t_code"], rt[0], rt[1], rt[2]))
    L.append("        }")
    L.append("        float focalLength.timeSamples = {")
    for fr in intrinsics:
        L.append("            %d: %r," % (fr["t_code"], float(fr["focal_mm"])))
    L.append("        }")
    L.append('        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateXYZ"]')
    L.append("    }")
    L.append("}")
    L.append("")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L))
    return path


# ---------------------------------------------------------------- glTF
def write_gltf(path, intrinsics, width=DEFAULT_WIDTH, height=DEFAULT_HEIGHT,
               near=CLIP_NEAR, far=CLIP_FAR, shot_id="shot"):
    """写 glTF 2.0 文件：核心规范的 perspective camera + 节点上的相机时序动画。

    * glTF 核心规范**没有**相机动画通道（Khronos 扩展目录里也没有 camera 扩展），
      所以逐帧位姿走**节点**的 TRS 动画（标准做法），相机本体只描述第 0 帧的内参。
    * glTF 世界系是 Y-up：机位与朝向都经契约里唯一那一处换算（p_yup = (x, z, −y)）。
    """
    n = len(intrinsics)
    times = np.array([f["t"] for f in intrinsics], dtype="<f4")
    trans = np.array([f["gltf"]["translation"] for f in intrinsics], dtype="<f4")
    rots = np.array([f["gltf"]["rotation_xyzw"] for f in intrinsics], dtype="<f4")

    blob = bytearray()
    views = []

    def _add(arr):
        nonlocal blob
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        blob.extend(arr.tobytes())
        views.append({"buffer": 0, "byteOffset": off, "byteLength": int(arr.nbytes),
                      "target": 34962})

    _add(times)
    _add(trans)
    _add(rots)

    f0 = float(intrinsics[0]["f_px"])
    yfov = math.radians(CM.fov_y_from_f_px(f0, height))
    gltf = {
        "asset": {"version": "2.0",
                  "generator": "harness/shot_package.py (R2 · 运镜体系化)"},
        "scene": 0,
        "scenes": [{"name": shot_id, "nodes": [0]}],
        "nodes": [{"name": shot_id + "_camera", "camera": 0,
                   "translation": [float(v) for v in trans[0]],
                   "rotation": [float(v) for v in rots[0]]}],
        "cameras": [{"name": shot_id + "_camera", "type": "perspective",
                     "aspectRatio": float(width) / float(height),
                     "yfov": float(yfov),
                     "znear": float(near), "zfar": float(far)}],
        "animations": [{
            "name": "camera_track",
            "samplers": [{"input": 0, "output": 1, "interpolation": "LINEAR"},
                         {"input": 0, "output": 2, "interpolation": "LINEAR"}],
            "channels": [
                {"sampler": 0, "target": {"node": 0, "path": "translation"}},
                {"sampler": 1, "target": {"node": 0, "path": "rotation"}},
            ],
        }],
        "buffers": [{
            "byteLength": len(blob),
            "uri": "data:application/octet-stream;base64," +
                   base64.b64encode(bytes(blob)).decode("ascii"),
        }],
        "bufferViews": views,
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": n, "type": "SCALAR",
             "min": [float(times.min())], "max": [float(times.max())]},
            {"bufferView": 1, "componentType": 5126, "count": n, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": n, "type": "VEC4"},
        ],
        "extras": {
            "r2_note": ("glTF 核心规范没有相机动画，逐帧位姿走节点 TRS 动画；"
                        "camera.yfov/znear/zfar 对应第 0 帧内参。"),
            "authority": "assets/validation/camera_intrinsics.json（逐帧内外参唯一权威源）",
            "up_axis_source": "Z-up 世界系 → glTF Y-up 世界系，p_yup = (x, z, −y)",
            "frames": n,
            "fps": DEFAULT_FPS,
        },
    }
    return _write_json(path, gltf)


# ---------------------------------------------------------------- 预览
def compose_preview(normal, mask, seg_rgb, palette):
    """由**同一次光栅化**的条件通道合成预览帧（不额外渲染）。

    normal : (H,W,3) 世界法线（0..1 编码）
    mask   : (H,W) 前景掩码
    seg_rgb: (H,W,3) 语义分割上色
    """
    n = np.clip(np.asarray(normal, float) * 2.0 - 1.0, -1.0, 1.0)
    light = np.array([0.45, 0.35, 0.82])
    light = light / np.linalg.norm(light)
    lam = np.clip(n @ light, 0.0, 1.0)
    shade = (0.42 + 0.58 * lam)
    rgb = np.repeat(shade[:, :, None], 3, axis=2)
    tint = np.asarray(seg_rgb, float) / 255.0
    rgb = rgb * 0.86 + tint * 0.14
    bg = np.array([0.945, 0.949, 0.956])
    m = np.asarray(mask, bool)
    out = np.where(m[:, :, None], rgb, bg[None, None, :])
    return np.clip(out * 255.0, 0, 255).astype(np.uint8)


def write_mjpeg_avi(path, jpegs, width, height, fps):
    """写 MJPEG AVI（纯 Python，无外部编码器）。

    本机没有 ffmpeg / imageio-ffmpeg / PyAV，离线可得的唯一视频容器就是 MJPEG AVI；
    它是标准 AVI（RIFF），主流播放器与 ffmpeg 都能读，且**逐帧无损于 JPEG 原帧**。
    """
    n = len(jpegs)
    micro = int(round(1e6 / float(fps)))

    def _chunk(fourcc, data):
        out = fourcc + struct.pack("<I", len(data)) + data
        if len(data) % 2:
            out += b"\x00"
        return out

    avih = struct.pack("<IIIIIIIIIIIIII",
                       micro, int(fps * max(len(j) for j in jpegs)), 0, 0x10,
                       n, 0, 1, max(len(j) for j in jpegs), width, height,
                       0, 0, 0, 0)
    strh = struct.pack("<4s4sIHHIIIIIIIIhhhh",
                       b"vids", b"MJPG", 0, 0, 0, 0, 1, int(fps), 0, n,
                       max(len(j) for j in jpegs), 0xFFFFFFFF, 0,
                       0, 0, width, height)
    strf = struct.pack("<IiiHH4sIiiII", 40, width, height, 1, 24, b"MJPG",
                       width * height * 3, 0, 0, 0, 0)
    strl = _chunk(b"LIST", b"strl" + _chunk(b"strh", strh) + _chunk(b"strf", strf))
    hdrl = _chunk(b"LIST", b"hdrl" + _chunk(b"avih", avih) + strl)

    movi_body = bytearray()
    index = []
    for j in jpegs:
        off = len(movi_body) + 4          # 相对 movi 数据起点
        movi_body.extend(_chunk(b"00dc", j))
        index.append(struct.pack("<4sIII", b"00dc", 0x10, off, len(j)))
    movi = _chunk(b"LIST", b"movi" + bytes(movi_body))
    idx1 = _chunk(b"idx1", b"".join(index))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(b"RIFF" + struct.pack("<I", 4 + len(hdrl) + len(movi) + len(idx1)))
        fh.write(b"AVI " + hdrl + movi + idx1)
    return path



# ---------------------------------------------------------------- USD 回读
def parse_usda_camera(path):
    """回读 USDA 里的相机时序（独立解析，不依赖写入时的内存对象）。"""
    import re
    text = open(path, "r", encoding="utf-8").read()

    # USDA 里属性行带类型前缀（float / double3 / float2 ...），前缀可选
    _TYPE = r"(?:[A-Za-z_][\w\[\]]*\s+)?"

    def _scalar(name):
        m = re.search(r"^\s*" + _TYPE + r"%s\s*=\s*([-0-9.eE+]+)\s*$" % re.escape(name),
                      text, re.M)
        return float(m.group(1)) if m else None

    def _vec2(name):
        m = re.search(r"^\s*" + _TYPE + r"%s\s*=\s*\(([^)]*)\)\s*$" % re.escape(name),
                      text, re.M)
        if not m:
            return None
        return [float(v) for v in m.group(1).split(",")]

    def _samples(name):
        m = re.search(r"^\s*" + _TYPE + r"[\w:]*%s\.timeSamples\s*=\s*\{(.*?)\}"
                      % re.escape(name), text, re.S | re.M)
        if not m:
            return {}
        out = {}
        for tcode, tup in re.findall(r"(\d+)\s*:\s*\(([^)]*)\)", m.group(1)):
            out[int(tcode)] = [float(v) for v in tup.split(",")]
        return out

    def _scalar_samples(name):
        m = re.search(r"^\s*" + _TYPE + r"[\w:]*%s\.timeSamples\s*=\s*\{(.*?)\}"
                      % re.escape(name), text, re.S | re.M)
        if not m:
            return {}
        return {int(t): float(v) for t, v in
                re.findall(r"(\d+)\s*:\s*([-0-9.eE+]+)", m.group(1))}

    return {
        "focal_length": _scalar("focalLength"),
        "clipping_range": _vec2("clippingRange"),
        "horizontal_aperture": _scalar("horizontalAperture"),
        "vertical_aperture": _scalar("verticalAperture"),
        "translate": _samples("translate"),
        "rotate_xyz": _samples("rotateXYZ"),
        "focal_samples": _scalar_samples("focalLength"),
        "meters_per_unit": _scalar("metersPerUnit"),
        "up_axis": "Z" if 'upAxis = "Z"' in text else None,
        "time_codes_per_second": _scalar("timeCodesPerSecond"),
        "end_time_code": _scalar("endTimeCode"),
    }


def _euler_xyz_to_matrix(rx, ry, rz):
    """rotateXYZ = Rz(rz)·Ry(ry)·Rx(rx)（与 export_usd._look_at_rot 同约定）。"""
    rx, ry, rz = map(math.radians, (rx, ry, rz))
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]], float)
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], float)
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]], float)
    return Rz @ Ry @ Rx


def usd_reprojection_check(usda_path, intrinsics, width=DEFAULT_WIDTH,
                            height=DEFAULT_HEIGHT, sample_frames=10,
                            extra_points=None):
    """USD 相机时序 vs intrinsics.json 的逐帧一致性（重投影误差）。

    从**落盘的 usda** 回读相机，逐帧重建位姿与内参，与 intrinsics.json 的
    R/t/K 对同一批 3D 点分别投影，比像素差。

    返回 {"n_sampled", "max_reproj_error_px", "per_frame":[...], "f_px_agree", ...}
    """
    usd = parse_usda_camera(usda_path)
    n = len(intrinsics)
    picks = sorted({int(round(k)) for k in np.linspace(0, n - 1, min(sample_frames, n))})
    h_ap = float(usd["horizontal_aperture"])
    v_ap = float(usd["vertical_aperture"])
    rows = []
    worst = 0.0
    fpx_disagree = 0.0
    for i in picks:
        fr = intrinsics[i]
        tcode = int(fr["t_code"])
        eye = np.array(usd["translate"][tcode], float)
        eul = usd["rotate_xyz"][tcode]
        R_usd = _euler_xyz_to_matrix(*eul)
        focal = float(usd["focal_samples"][tcode])
        f_px_v = height * focal / v_ap
        f_px_h = width * focal / h_ap
        fpx_disagree = max(fpx_disagree, abs(f_px_v - f_px_h))
        # USD 口径投影：相机空间 z 向后为正
        pts = _test_points(fr, extra_points)
        p_usd = (pts - eye) @ R_usd          # R_usd 是相机→世界阵，故此处不转置
        z = -p_usd[:, 2]
        px_usd = np.stack([width / 2.0 + (p_usd[:, 0] / z) * f_px_v,
                           height / 2.0 - (p_usd[:, 1] / z) * f_px_v], axis=-1)
        # intrinsics 口径投影
        R_c = np.array(fr["R_world_to_cam"], float)
        t_c = np.array(fr["t_world_to_cam"], float)
        p_c = pts @ R_c.T + t_c
        zc = p_c[:, 2]
        px_in = np.stack([width / 2.0 + (p_c[:, 0] / zc) * fr["f_px"],
                          height / 2.0 - (p_c[:, 1] / zc) * fr["f_px"]], axis=-1)
        err = float(np.abs(px_usd - px_in).max())
        worst = max(worst, err)
        rows.append({"frame": i, "t_code": tcode, "max_abs_err_px": err,
                     "f_px_usd": f_px_v, "f_px_intrinsics": fr["f_px"],
                     "eye_max_abs_diff_m": float(np.abs(eye - np.array(fr["eye"])).max()),
                     "n_points": int(len(pts))})
    return {"n_sampled": len(picks), "sampled_frames": picks,
            "max_reproj_error_px": worst, "per_frame": rows,
            "f_px_horizontal_vs_vertical_max_diff": fpx_disagree,
            "up_axis": usd["up_axis"], "meters_per_unit": usd["meters_per_unit"],
            "time_codes_per_second": usd["time_codes_per_second"],
            "end_time_code": usd["end_time_code"],
            "n_translate_samples": len(usd["translate"]),
            "n_rotate_samples": len(usd["rotate_xyz"]),
            "n_focal_samples": len(usd["focal_samples"])}


def _test_points(fr, extra_points=None):
    """重投影用的 3D 测试点：主体包围盒角点 + 固定世界点。"""
    pts = []
    if extra_points is not None:
        pts.extend(np.asarray(extra_points, float).tolist())
    else:
        e = np.array(fr["eye"], float)
        t = np.array(fr["target"], float)
        d = t - e
        n = np.linalg.norm(d)
        if n > 1e-6:
            d = d / n
        up = np.array([0.0, 0.0, 1.0])
        right = np.cross(d, up)
        right = right / max(np.linalg.norm(right), 1e-9)
        upv = np.cross(right, d)
        for sx in (-1.2, 0.0, 1.2):
            for sy in (-0.9, 0.0, 0.9):
                for sz in (-0.6, 0.0, 0.6):
                    pts.append((e + d * 3.0 + right * sx + upv * sy + d * sz).tolist())
    return np.array(pts, float)



# ---------------------------------------------------------------- 条件图（R1 渲染器）
def render_shot_conditions(frames, verts, faces, joints, out_dir, shot_id,
                           move_type, width=DEFAULT_WIDTH, height=DEFAULT_HEIGHT,
                           fps=DEFAULT_FPS, preview_dir=None, authority_note=""):
    """用 R1 的渲染器出六通道条件序列 + 每通道 sidecar。

    复用：conditions.render_conditions（一次光栅化出六通道）
        conditions._shot_scene_items / _shot_hero_and_shadow（同一套街景与主角）
        conditions._JointSource.from_soma77（pose 通道的关节源）
        conditions.save_condition_pack（sidecar 写出，七字段契约）
    本模块只换掉「相机」这一层输入，不另写渲染。
    """
    import io
    import conditions as C
    import geomlib
    from PIL import Image, ImageDraw

    static = C._shot_scene_items()
    os.makedirs(out_dir, exist_ok=True)
    per_frame = []
    jpegs = []
    palette = None
    sidecar_files = 0
    sidecar_ok = 0
    sidecar_skipped = 0
    sidecar_all_ok = True
    t0 = time.perf_counter()
    for i, fr in enumerate(frames):
        f_px = CM.f_px_from_focal(fr["focal_mm"], height, CM.SENSOR_WIDTH_MM)
        fov = CM.fov_y_from_f_px(f_px, height)
        cam = geomlib.Camera(tuple(fr["eye"]), tuple(fr["target"]), (0.0, 0.0, 1.0),
                             fov, width, height, fr["focal_mm"], CM.SENSOR_WIDTH_MM)
        hero, shadow = C._shot_hero_and_shadow(verts[i], faces)
        items = list(static) + [
            {"mesh": hero, "name": "hero", "label": "character"},
            {"mesh": shadow, "name": "hero_shadow"},
        ]
        source = C._JointSource.from_soma77(
            joints[i].astype(np.float64) + np.asarray(C.SHOT_HERO_OFFSET))
        res = C.render_conditions(items, cam, width=width, height=height,
                                  channels=C._CONTRACT_CHANNELS, pose_source=source)
        fdir = os.path.join(out_dir, "frame_%04d" % i)
        C.save_condition_pack(res, fdir, prefix="cond", extra={
            "shot": {"id": shot_id, "frame": i, "t_s": round(float(fr["t"]), 4),
                     "fps": fps, "move_type": move_type},
            "scene": {"source": "assets/geometry/scene_street.glb + shot001_hero.npz",
                      "objects": len(items),
                      "labels": res["meta"]["labels"],
                      "hidden_meshes": res["meta"]["hidden_labels"]},
            "pose_joints": {"source": "soma77（77 公共关节，不含 Root）",
                            "count": 77,
                            "keypoint_set": C._POSE_CANONICAL_KEYPOINT_SET},
            "camera_authority": authority_note,
        })
        if palette is None:
            palette = res["meta"]["palette"]
        fscan = C._scan_sidecar_dir(fdir)
        sidecar_files += int(fscan["n_files"])
        sidecar_ok += int(fscan["n_ok"])
        sidecar_skipped += int(fscan.get("n_skipped", 0))
        sidecar_all_ok = bool(sidecar_all_ok and fscan["all_ok"])
        # 预览：由同一次光栅化的条件通道合成（不额外渲染）
        pv = compose_preview(res["normal"], res["mask"], res["seg"], palette)
        img = Image.fromarray(pv)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=88)
        jpegs.append(buf.getvalue())
        if preview_dir:
            os.makedirs(preview_dir, exist_ok=True)
            img.save(os.path.join(preview_dir, "frame_%04d.jpg" % i), "JPEG", quality=88)
        per_frame.append({
            "frame": i, "dir": "conditions/frame_%04d" % i,
            "channels": list(C._CONTRACT_CHANNELS),
            "near_far_m": [round(float(res["depth_range_m"][0]), 4),
                           round(float(res["depth_range_m"][1]), 4)],
            "foreground_px": int(res["meta"]["foreground_px"]),
            "keypoints": len(res["keypoints"]),
            "f_px": round(float(f_px), 6),
        })
    wall = (time.perf_counter() - t0) * 1000.0
    # R1 的 sidecar 静态扫描器（七字段契约的唯一判定口），逐帧目录各扫一次
    scan = {"n_files": sidecar_files, "n_ok": sidecar_ok,
            "n_skipped": sidecar_skipped,
            "all_ok": bool(sidecar_all_ok)}
    idx = {
        "kind": "shot_conditions_index",
        "shot_id": shot_id, "move_type": move_type,
        "channels": list(C._CONTRACT_CHANNELS),
        "resolution": [width, height], "fps": fps, "frames": len(frames),
        "layout": "conditions/frame_<i>/cond_<channel>.png + cond_<channel>.json",
        "sidecar_required_fields": list(K.SIDECAR_REQUIRED_FIELDS),
        "palette_version": K.SEG_PALETTE_ID,
        "palette": palette,
        "sidecar_scan": {"frames_scanned": len(per_frame),
                         "sidecar_files": scan["n_files"],
                         "sidecar_ok": scan["n_ok"], "all_ok": scan["all_ok"]},
        "render_wall_ms": round(wall, 2),
        "per_frame": per_frame,
    }
    _write_json(os.path.join(out_dir, "index.json"), idx)
    return {"index": idx, "jpegs": jpegs, "scan": scan, "wall_ms": wall}


# ---------------------------------------------------------------- 联系表
def write_contact_sheet(jpegs, path, cols=4, rows=3, tile_w=360):
    """抽样帧的联系表（预览用）。"""
    from PIL import Image, ImageDraw
    import io
    n = len(jpegs)
    picks = sorted({int(round(k)) for k in np.linspace(0, n - 1, cols * rows)})
    tiles = []
    for i in picks:
        im = Image.open(io.BytesIO(jpegs[i])).convert("RGB")
        h = max(1, int(round(im.height * tile_w / im.width)))
        tiles.append((i, im.resize((tile_w, h), Image.LANCZOS)))
    th = tiles[0][1].height
    sheet = Image.new("RGB", (cols * tile_w, rows * (th + 22)), (250, 250, 251))
    dr = ImageDraw.Draw(sheet)
    for k, (i, im) in enumerate(tiles):
        x = (k % cols) * tile_w
        y = (k // cols) * (th + 22)
        sheet.paste(im, (x, y))
        dr.text((x + 6, y + th + 5), "frame %04d" % i, fill=(90, 92, 96))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sheet.save(path, "JPEG", quality=88)
    return path


# ---------------------------------------------------------------- 许可
def _manifest_licenses():
    """从资产台账读许可（R3 拥有该文件；读不到就退回项目自有的口径）。"""
    path = os.path.join(ROOT, "assets", "manifest.json")
    out = {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            man = json.load(fh)
    except Exception:
        return out
    items = man.get("assets") if isinstance(man, dict) else None
    if isinstance(items, list):
        for it in items:
            if isinstance(it, dict) and it.get("id"):
                out[it["id"]] = it.get("license")
    return out


def _license_entry(asset_id, source, fallback_note):
    man = _manifest_licenses()
    lic = man.get(asset_id)
    if isinstance(lic, dict):
        lic = lic.get("spdx") or lic.get("id")
    return {
        "asset_id": asset_id,
        "license": lic if lic else fallback_note,
        "source_url": source,
        "attribution_required": False,
        "note": "权威许可登记处：assets/manifest.json（R3 拥有）",
    }



# ---------------------------------------------------------------- 镜头包写出
COMPOSITION_CHECKS = ("subject_in_frame_ratio", "subject_corner_inside_mean",
                      "centering_offset", "offscreen_ratio",
                      "frustum_subject_ratio", "subject_height_ratio_band")


def build_shot_package(entry, verts, faces, joints, root_y,
                       width=DEFAULT_WIDTH, height=DEFAULT_HEIGHT,
                       fps=DEFAULT_FPS, duration_s=DEFAULT_DURATION_S,
                       with_conditions=True, shots_root=SHOTS_DIR,
                       condition_frames=None):
    """构建一个镜头包目录，落盘全部产物，返回摘要。"""
    shot_id = entry["shot_id"]
    shot_dir = os.path.join(shots_root, shot_id)
    os.makedirs(shot_dir, exist_ok=True)

    subj = build_subject(verts, root_y)
    spec_resolved, note = CM.resolve_move_spec(entry["spec"], subj)
    plan = CM.build_move(spec_resolved)
    frames = CM.sample_move(plan, subj)
    intrinsics = compute_intrinsics(plan, frames, width, height)

    # ---- 1) 逐帧内外参（唯一权威源的切片）
    slice_bytes = canonical_json(intrinsics)
    slice_sha = _sha256_bytes(slice_bytes)
    intr_doc = {
        "kind": "camera_intrinsics_shot",
        "shot_id": shot_id,
        "move_type": plan["type"],
        "authority": {
            "path": _rel(AUTHORITY_PATH),
            "section": "shots.%s" % shot_id,
            "slice_sha256": slice_sha,
            "note": "本文件的 frames 与权威源同源（同一份数据 + 同一 sha256）",
        },
        "convention": CONVENTION,
        "resolution": [width, height],
        "fps": fps, "duration_s": duration_s,
        "sensor_width_mm": plan["sensor_width_mm"],
        "clipping_range": {"near": CLIP_NEAR, "far": CLIP_FAR},
        "frames": intrinsics,
    }
    _write_json(os.path.join(shot_dir, "camera", "intrinsics.json"), intr_doc)

    # ---- 2) USD 相机时序（逐帧）
    usda_path = write_usda(os.path.join(shot_dir, "camera", "camera.usda"),
                           intrinsics, width, height,
                           sensor_mm=plan["sensor_width_mm"], fps=fps,
                           near=CLIP_NEAR, far=CLIP_FAR)
    # ---- 3) glTF camera
    gltf_path = write_gltf(os.path.join(shot_dir, "camera", "camera.gltf"),
                           intrinsics, width, height, CLIP_NEAR, CLIP_FAR, shot_id)

    # ---- 4) 条件图（R1 渲染器）
    cond = None
    jpegs = []
    if with_conditions:
        cond = render_shot_conditions(
            frames if condition_frames is None else frames[:condition_frames],
            verts, faces, joints,
            os.path.join(shot_dir, "conditions"), shot_id, plan["type"],
            width=width, height=height, fps=fps,
            preview_dir=os.path.join(shot_dir, "preview", "frames"),
            authority_note="shots/%s/camera/intrinsics.json" % shot_id)
        jpegs = cond["jpegs"]

    # ---- 5) 预览
    preview_paths = {}
    if jpegs:
        preview_paths["contact_sheet"] = write_contact_sheet(
            jpegs, os.path.join(shot_dir, "preview", "contact_sheet.jpg"))
        preview_paths["previs"] = write_mjpeg_avi(
            os.path.join(shot_dir, "preview", "previs.avi"), jpegs,
            int(round(720 * 0.5)), int(round(404 * 0.5)), fps)

    # ---- 6) 几何实例
    geom_dir = os.path.join(shot_dir, "geometry")
    os.makedirs(geom_dir, exist_ok=True)
    import shutil
    geom_files = []
    for src, dst in ((SCENE_GLB, "scene_street.glb"), (HERO_GLB, "character_hero.glb")):
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(geom_dir, dst))
            geom_files.append({"file": dst, "sha256": _sha256_file(src),
                               "bytes": os.path.getsize(src),
                               "source": _rel(src)})
    geom_manifest = {
        "kind": "shot_geometry_manifest",
        "shot_id": shot_id,
        "instances": geom_files,
        "sequence": {"asset_id": "shot001_hero_sequence",
                     "path": _rel(SEQUENCE_PATH),
                     "sha256": _sha256_file(SEQUENCE_PATH),
                     "role": "subject_animation（SOMA 帧序列，含 77 公共关节与 root_y）"},
        "note": "场景静态几何 + 主角动画序列；几何层 / 非几何参考层按 PLAN.md C4 分开",
    }
    _write_json(os.path.join(geom_dir, "geometry_manifest.json"), geom_manifest)

    # ---- 7) 校验量
    ev = CM.evaluate_move(plan, frames, subj, width, height, entry.get("limits"))
    reproj = usd_reprojection_check(usda_path, intrinsics, width, height, 10)
    checks = list(ev["checks"])
    checks.append({"id": "usd_intrinsics_reprojection", "name_zh": "USD 相机时序与 intrinsics 逐帧重投影误差（px）",
                   "value": round(reproj["max_reproj_error_px"], 12), "limit": 1e-4,
                   "op": "<=", "pass": bool(reproj["max_reproj_error_px"] <= 1e-4),
                   "detail": "抽样 %d 帧" % reproj["n_sampled"]})
    checks.append({"id": "usd_per_frame_samples", "name_zh": "USD 相机时序逐帧采样数",
                   "value": reproj["n_translate_samples"], "limit": len(frames),
                   "op": ">=", "pass": bool(reproj["n_translate_samples"] == len(frames)),
                   "detail": "translate/rotate/focal 三组时间采样均为逐帧"})
    if cond is not None:
        checks.append({"id": "conditions_sidecar_all_ok", "name_zh": "条件图 sidecar 七字段全通过",
                       "value": cond["scan"]["n_ok"],
                       "limit": cond["scan"]["n_files"] - cond["scan"]["n_skipped"],
                       "op": ">=", "pass": bool(cond["scan"]["all_ok"]),
                       "detail": "%d/%d 通过（另有 %d 个非 sidecar 的 JSON 被跳过）"
                                 % (cond["scan"]["n_ok"],
                                    cond["scan"]["n_files"] - cond["scan"]["n_skipped"],
                                    cond["scan"]["n_skipped"])})

    comp = [c for c in checks if c["id"] in COMPOSITION_CHECKS]
    motion = [c for c in checks if c["id"] not in COMPOSITION_CHECKS and c["id"] != "conditions_sidecar_all_ok"]
    conds = [c for c in checks if c["id"] == "conditions_sidecar_all_ok"]
    bbox = subj["bbox"]
    report = {
        "kind": "shot_validation_report",
        "shot_id": shot_id, "move_type": plan["type"],
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "resolution": [width, height], "fps": fps, "frames": len(frames),
        "pass": all(c["pass"] for c in checks),
        "summary": {"n_checks": len(checks),
                    "n_pass": sum(1 for c in checks if c["pass"]),
                    "composition": {"n": len(comp), "pass": sum(1 for c in comp if c["pass"])},
                    "motion": {"n": len(motion), "pass": sum(1 for c in motion if c["pass"])},
                    "conditions": {"n": len(conds), "pass": sum(1 for c in conds if c["pass"])}},
        "geometry": {
            "subject_bbox_m": {
                "x": [float(bbox[:, 0, 0].min()), float(bbox[:, 1, 0].max())],
                "y": [float(bbox[:, 0, 1].min()), float(bbox[:, 1, 1].max())],
                "z": [float(bbox[:, 0, 2].min()), float(bbox[:, 1, 2].max())],
            },
            "ground_min_z": float(bbox[:, 0, 2].min()),
            "subject_height_m": float((bbox[:, 1, 2] - bbox[:, 0, 2]).mean()),
            "instances": geom_files,
            "assets_sha256": {g["file"]: g["sha256"] for g in geom_files},
        },
        "composition": comp,
        "motion": motion,
        "conditions": conds,
        "camera_consistency": {
            "usd_reprojection": reproj,
            "intrinsics_authority": _rel(AUTHORITY_PATH),
            "intrinsics_slice_sha256": slice_sha,
            "gltf_camera": {"yfov": math.radians(CM.fov_y_from_f_px(
                intrinsics[0]["f_px"], height)), "znear": CLIP_NEAR, "zfar": CLIP_FAR},
        },
        "metrics": ev["metrics"],
        "limits": entry.get("limits") or {},
    }
    if cond is not None:
        report["condition_metrics"] = {
            "frames": cond["index"]["frames"],
            "channels": cond["index"]["channels"],
            "sidecar_files": cond["scan"]["n_files"],
            "sidecar_skipped": cond["scan"]["n_skipped"],
            "sidecar_ok": cond["scan"]["n_ok"],
            "sidecar_all_ok": cond["scan"]["all_ok"],
            "render_wall_ms": cond["wall_ms"],
            "palette_version": K.SEG_PALETTE_ID,
        }
    _write_json(os.path.join(shot_dir, "validation_report.json"), report)

    # ---- 8) shot spec（§2.5.1 字段表）
    keys = [{"t": float(fr["t"]), "eye": fr["eye"], "target": fr["target"],
             "focal_mm": float(fr["focal_mm"])} for fr in frames]
    track = [{"t": float(fr["t"]),
              "pos": [float(v) for v in subj["pos"][i]],
              "yaw_deg": 0.0} for i, fr in enumerate(frames)]
    spec_doc = {
        "kind": "shot_spec",
        "shot_id": shot_id,
        "title_zh": entry.get("title_zh", ""),
        "move_type": plan["type"],
        "fps": fps, "duration_s": duration_s,
        "resolution": [width, height],
        "up_axis": "Z",
        "assets": [
            {"asset_id": "scene_street", "path": "geometry/scene_street.glb",
             "role": "scene", "fingerprint": "sha256:" + _sha256_file(SCENE_GLB)},
            {"asset_id": "character_hero", "path": "geometry/character_hero.glb",
             "role": "subject", "fingerprint": "sha256:" + _sha256_file(HERO_GLB)},
            {"asset_id": "shot001_hero_sequence", "path": _rel(SEQUENCE_PATH),
             "role": "subject_animation",
             "fingerprint": "sha256:" + _sha256_file(SEQUENCE_PATH)},
        ],
        "actors": [{"asset": "character_hero", "asset_id": "character_hero",
                    "role": "subject", "track": track}],
        "camera": {
            "mode": "mounted" if plan["type"] == "follow" else "world",
            "mount": plan["mount"],
            "move": {
                "type": plan["type"], "label_zh": plan["label_zh"],
                "frame": plan["frame"], "duration_s": plan["duration_s"],
                "fps": plan["fps"], "easing": plan["easing"],
                "start": plan["start"], "end": plan["end"],
                "params": plan["params"], "handheld": plan["handheld"],
                "resolution_note": note,
            },
            "keys": keys,
            "keys_note": ("keys 是逐帧关键帧（每帧一条），与 camera/intrinsics.json 同源；"
                          "逐帧内外参真值见 camera/intrinsics.json"),
            "sensor_width_mm": plan["sensor_width_mm"],
            "near": CLIP_NEAR, "far": CLIP_FAR,
            "intrinsics_authority": "camera/intrinsics.json",
        },
        "conditions": {
            "dir": "conditions/",
            "channels": list(K.CHANNELS),
            "depth": {"polarity": K.DEPTH_POLARITY, "encoding": K.DEPTH_ENCODING,
                      "normalization": K.DEPTH_NORMALIZATION},
            "mask_semantics": K.MASK_SEMANTICS,
            "palette_version": K.SEG_PALETTE_ID,
            "sidecar_required_fields": list(K.SIDECAR_REQUIRED_FIELDS),
            "up_axis": "Z",
        },
        "timeline": {"events": []},
        "validation": {
            "report_path": "validation_report.json",
            "pass": report["pass"],
            "checks": [{"id": c["id"], "pass": c["pass"]} for c in checks],
        },
        "license": [
            _license_entry("scene_street", "harness/generate_assets.py（程序化生成）",
                            "项目程序化生成（PLAN.md C1：无生成式模型）"),
            _license_entry("character_hero", "harness/generate_assets.py（程序化生成）",
                            "项目程序化生成（PLAN.md C1：无生成式模型）"),
            _license_entry("shot001_hero_sequence", "harness/make_shot_soma.py（SOMA 序列）",
                           "项目程序化生成（PLAN.md C1：无生成式模型）"),
        ],
        "status": "validated" if report["pass"] else "draft",
    }
    _write_json(os.path.join(shot_dir, "shot_spec.json"), spec_doc)

    return {
        "shot_id": shot_id, "move_type": plan["type"], "dir": _rel(shot_dir),
        "frames": len(frames), "checks": checks,
        "n_pass": sum(1 for c in checks if c["pass"]), "n_total": len(checks),
        "pass": report["pass"],
        "reproj_max_px": reproj["max_reproj_error_px"],
        "intrinsics": intrinsics,
        "metrics": ev["metrics"],
        "products": {
            "spec": "shot_spec.json",
            "camera": ["camera/camera.usda", "camera/camera.gltf", "camera/intrinsics.json"],
            "conditions": "conditions/" if with_conditions else None,
            "validation": "validation_report.json",
            "preview": sorted(preview_paths.values()) if preview_paths else None,
        },
    }



# ---------------------------------------------------------------- 权威源
def write_authority(built, path=AUTHORITY_PATH):
    """写**逐帧内外参唯一权威源**。

    每个镜头包里的 camera/intrinsics.json 是这里的同源切片（同一份 frames +
    同一个 sha256），所以不存在「两套真值」：校验时按切片哈希逐条对账。
    """
    shots = {}
    for b in built:
        intr = b["intrinsics"]
        shots[b["shot_id"]] = {
            "move_type": b["move_type"],
            "slice_sha256": _sha256_bytes(canonical_json(intr)),
            "n_frames": len(intr),
            "frames": intr,
        }
    doc = {
        "kind": "camera_intrinsics_authoritative",
        "version": "1.0.0",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "generator": "harness/shot_package.py",
        "up_axis": "Z",
        "convention": CONVENTION,
        "note": ("本文件是逐帧内外参的唯一权威源；USD / glTF 均由它派生。"
                 "每个镜头包的 camera/intrinsics.json 是本文件的同源切片。"),
        "shots": shots,
    }
    _write_json(path, doc)
    return path


def main(argv=None):
    ap = argparse.ArgumentParser(description="R2 · 镜头包批量写出（9 类镜头）")
    ap.add_argument("--shot", default=None, help="只构建一个镜头（shot_id 或 move type）")
    ap.add_argument("--no-conditions", action="store_true", help="跳过条件图渲染")
    ap.add_argument("--condition-frames", type=int, default=0,
                    help="只渲染前 N 帧条件图（0 = 全部，调试用）")
    ap.add_argument("--shots-root", default=SHOTS_DIR)
    args = ap.parse_args(argv)

    verts, joints, faces, root_y = load_sequence()
    cat = CM.move_catalog()
    if args.shot:
        cat = [e for e in cat if e["shot_id"] == args.shot or e["type"] == args.shot]
        if not cat:
            raise SystemExit("找不到镜头：%s" % args.shot)

    built = []
    for entry in cat:
        t0 = time.perf_counter()
        s = build_shot_package(
            entry, verts, faces, joints, root_y,
            with_conditions=not args.no_conditions,
            shots_root=args.shots_root,
            condition_frames=args.condition_frames or None)
        built.append(s)
        print("[R2] %-14s checks %d/%d  reproj %.2e px  %.1fs  -> %s"
              % (s["shot_id"], s["n_pass"], s["n_total"], s["reproj_max_px"],
                 time.perf_counter() - t0, s["dir"]))
    write_authority(built)
    print(json.dumps({"built": [b["shot_id"] for b in built],
                      "authority": _rel(AUTHORITY_PATH),
                      "all_pass": all(b["pass"] for b in built)},
                     ensure_ascii=False, indent=2))
    return 0 if all(b["pass"] for b in built) else 1


if __name__ == "__main__":
    raise SystemExit(main())

